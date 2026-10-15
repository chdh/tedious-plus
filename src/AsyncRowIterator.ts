/**
* This module provides an `AsyncIterator` for reading the result rows of a Tedious `Request`.
*
* @module
*/

import * as Tedious from "tedious";
import {assert, waitWithTimeout} from "./Utils.ts";
import * as TediousFixes from "./TediousFixes.ts";
import {Tedious_RowData, Tedious_ColumnMetadataDef} from "./TediousFixes.ts";
import * as TediousUtils from "./TediousUtils.ts";
import {RowValues, RowMetadata} from "./TediousUtils.ts";

/**
* Options for the {@link AsyncRowIterator} constructor.
*/
export interface AsyncRowIteratorOptions {

   /**
   * The target size for the internal row buffer FIFO.
   *
   * Rows received from the server are stored in this FIFO until they are delivered by the iterator.
   * When the FIFO reaches this size, the request is paused. It is resumed when the number of buffered
   * rows has dropped to half of this size.
   *
   * @defaultValue 1024
   */
   fifoSize:                           number; }

/**
* An async iterator for the result rows of a Tedious `Request`.
*
* The iterator must be created before the request is executed, so that it does not miss any events of
* the request. The request can then be executed, e.g. with `connection.execSql()`.
*
* Usage:
* ```js
* const request = new Tedious.Request("select name from sys.databases", () => {});
* const iterator = new AsyncRowIterator(request);
* connection.execSql(request);
* for await (const row of iterator) {
*    console.log(row);
* }
* ```
*
* The type declarations of the current Tedious version require a completion callback for the
* `Request` constructor. The dummy callback `() => {}` in the example above can be omitted once
* Tedious makes it optional.
*
* Behavior:
*
* - Each row is delivered as an array of column values (see {@link RowValues}).
* - Only the first result set of the request is processed. Additional result sets are ignored.
* - The rows received from the server are buffered in an internal FIFO. When the FIFO is full, the
*   request is paused until enough rows have been consumed (see {@link AsyncRowIteratorOptions.fifoSize}).
* - When the request fails, e.g. because of an SQL error, the rows received before the error are delivered
*   first. Then the error is thrown within the `for await` loop, i.e. the promise returned by `next()` is
*   rejected.
* - When the `for await` loop is exited early (by `break`, `return` or an exception), the request is
*   canceled. The loop exit waits until the request has completed, so that the connection can be used for
*   the next request immediately afterwards.
*
* Requirements:
*
* The connection options `useColumnNames`, `rowCollectionOnDone` and `rowCollectionOnRequestCompletion`
* must not be set. Otherwise the iteration fails with an error.
*/
export class AsyncRowIterator {

   private options:                    AsyncRowIteratorOptions;
   private controller:                 RowIteratorController;
   private iteratorObject:             RowIteratorObject;

   /**
   * Creates a row iterator for a Tedious request.
   *
   * @param request
   *    The Tedious request whose result rows are to be iterated.
   * @param options
   *    Optional settings for the iterator.
   */
   public constructor (request: Tedious.Request, options?: Partial<AsyncRowIteratorOptions>) {
      this.options = {fifoSize: options?.fifoSize ?? 1024};
      this.controller = new RowIteratorController(request, this.options);
      this.iteratorObject = new RowIteratorObject(this.controller); }

   /**
   * Returns the number of rows that have been delivered by the iterator so far.
   */
   public get rowCount() : number {
      return this.controller.rowCount; }

   /**
   * Returns the number of rows that have been received from the server, but not yet delivered by the
   * iterator. These rows are stored in the internal FIFO row buffer.
   */
   public get fifoRowCount() : number {
      return this.controller.fifo.length; }

   /**
   * Returns the column metadata of the first result set.
   *
   * The metadata is guaranteed to be available when the first row is delivered.
   *
   * @throws Error
   *    If the metadata has not yet been received.
   */
   public get metadata() : RowMetadata {
      const metadata = this.controller.metadata;
      assert(!!metadata, "Metadata not yet available.");
      return metadata; }

   /**
   * Returns a promise for the column metadata of the first result set.
   *
   * The returned promise is resolved as soon as the metadata has been received, which is before
   * the first row is delivered. It is rejected if the request completes without producing a
   * result set, e.g. because of an error, because the SQL statement does not produce a result
   * set, or because the iteration has been terminated early.
   */
   public getMetadata() : Promise<RowMetadata> {
      return this.controller.getMetadata(); }

   /**
   * Returns the `AsyncIterator` for the rows. This method is called implicitly by a `for await` loop.
   *
   * The same iterator object is returned on each call.
   */
   public [Symbol.asyncIterator]() : AsyncIterator<RowValues> {
      return this.iteratorObject; }

   /**
   * Terminates the iteration. This method is called implicitly at the end of the scope of an
   * `await using` declaration.
   *
   * If the request is still active, it is canceled. The returned promise is resolved when the request
   * has completed, so that the connection can be used for the next request immediately afterwards.
   * This has the same effect as exiting a `for await` loop early.
   *
   * A request that has not yet been executed is left untouched.
   * If a canceled request does not complete within a safety timeout, the returned promise is resolved
   * anyway. The connection then remains in a non-ready state and the next request on it fails.
   *
   * Usage:
   * ```js
   * await using iterator = ConnectionPromises.execSqlIterator(connection, request);
   * const metadata = await iterator.getMetadata();
   * ...
   * ```
   */
   public [Symbol.asyncDispose]() : Promise<void> {
      return this.controller.terminate(); }}

//--- Iterator object ----------------------------------------------------------

// Internal class for the iterator object which is passed to the API client.
class RowIteratorObject implements AsyncIterator<RowValues> {

   private controller:                 RowIteratorController;

   public constructor (controller: RowIteratorController) {
      this.controller = controller; }

   public next() : Promise<IteratorResult<RowValues>> {
      const promise: PromiseWithResolvers<IteratorResult<RowValues>> = Promise.withResolvers();
      this.controller.pushIteratorPromise(promise);
      return promise.promise; }

   public async return (value?: any) : Promise<IteratorResult<RowValues>> {
      await this.controller.terminate();
      return {value, done: true}; }

   public async throw (exception?: any) : Promise<IteratorResult<RowValues>> {
      await this.controller.terminate();
      if (exception) {
         throw exception; }
       else {
         return {done: true, value: undefined}; }}}

//--- Controller ---------------------------------------------------------------

const minCancelTimeout                 = 5000;                                 // used instead of the Tedious `cancelTimeout` when that is lower
const terminationTimeoutMargin         = 5000;                                 // added to the cancel timeout for the termination timeout

// Internal class for the state controller logic of the row iterator.
class RowIteratorController {

   private request:                    Tedious.Request;
   private requestCompleted:           boolean;
   private requestPaused:              boolean;
   private error:                      Error | undefined;
   private terminating:                boolean;

   private resultSetNo:                number;
   public  metadata:                   RowMetadata | undefined;
   public  rowCount:                   number;
   public  fifo:                       RowValues[];
   private fifoPauseLevel:             number;
   private fifoResumeLevel:            number;

   private iteratorPromises:           PromiseWithResolvers<IteratorResult<RowValues>>[];  // FIFO of pending iterator promises
   private metadataPromise:            PromiseWithResolvers<RowMetadata>;
   private completedPromise:           PromiseWithResolvers<void>;

   //--- Constructor / terminator ----------------------------------------------

   public constructor (request: Tedious.Request, options: AsyncRowIteratorOptions) {
      this.request = request;
      this.requestCompleted = false;
      this.requestPaused = false;
      this.terminating = false;

      this.resultSetNo = 0;
      this.rowCount = 0;
      this.fifo = [];
      assert(options.fifoSize >= 2);
      this.fifoPauseLevel = options.fifoSize;
      this.fifoResumeLevel = Math.floor(options.fifoSize / 2);

      this.iteratorPromises = [];
      this.metadataPromise = Promise.withResolvers();
      this.metadataPromise.promise.catch(() => {});
         // Prevents an unhandled rejection when the API client does not use the metadata promise.
      this.completedPromise = Promise.withResolvers();
      this.addEventListeners();
      TediousFixes.interceptRequestCompletion(request, this.requestCompletionHandler); }

   // Terminates the iteration. This function must never hang.
   // A request that has not yet been executed is left untouched.
   // An active request is canceled and its completion is awaited, but at most until the termination timeout
   // has elapsed. In that case the connection is left in a non-ready state.
   public async terminate() : Promise<void> {
      this.terminating = true;
      this.serveIteratorPromises();
      if (!this.requestCompleted && TediousFixes.isRequestActive(this.request)) {
         this.cancelRequest();
         await waitWithTimeout(this.completedPromise.promise, this.getTerminationTimeout()); }
      this.removeEventListeners(); }

   private cancelRequest() {
      if (this.requestPaused) {
         this.request.resume();                                                // required to receive the completion of the canceled request
         this.requestPaused = false; }
      this.request.cancel(); }

   // Returns the maximum time to wait for the completion of a canceled request.
   // Normally Tedious completes a canceled request within `cancelTimeout`, by closing the connection if necessary.
   // The additional margin is a safety measure to guarantee that the termination never hangs, even when
   // `cancelTimeout` is disabled.
   private getTerminationTimeout() : number {
      const cancelTimeout = this.request.connection?.config.options.cancelTimeout ?? 0;
      return Math.max(cancelTimeout, minCancelTimeout) + terminationTimeoutMargin; }

   //--- Promise logic ---------------------------------------------------------

   public getMetadata() : Promise<RowMetadata> {
      return this.metadataPromise.promise; }

   public pushIteratorPromise (promise: PromiseWithResolvers<IteratorResult<RowValues>>) {
      this.iteratorPromises.push(promise);
      this.serveIteratorPromises(); }

   // Resolves all pending iterator promises with `done: true` once the iterator is in the terminating state.
   private serveTermination() : boolean {
      if (!this.terminating) {
         return false; }
      const promise = this.iteratorPromises.shift();
      if (!promise) {
         return false; }
      promise.resolve({ done: true, value: undefined });
      return true; }

   // Delivers the next row.
   private serveRow() : boolean {
      if (!this.fifo.length) {
         return false; }
      const promise = this.iteratorPromises.shift();
      if (!promise) {
         return false; }
      const row = this.fifo.shift()!;
      this.rowCount++;
      promise.resolve({value: row});
      if (this.fifo.length <= this.fifoResumeLevel && this.requestPaused) {
         this.request.resume();
         this.requestPaused = false; }
      return true; }

   // Rejects all pending iterator promises once the request has completed with an error.
   // The rejection is deferred until the request has completed, so that the connection can be used for
   // the next request immediately after the `for await` loop has been exited.
   private serveError() : boolean {
      if (!this.error || !this.requestCompleted) {
         return false; }
      const promise = this.iteratorPromises.shift();
      if (!promise) {
         return false; }
      promise.reject(this.error);
      return true; }

   // Signals the normal completion of the request, when all rows have been delivered.
   private serveRequestCompletion() : boolean {
      if (!this.requestCompleted) {
         return false; }
      const promise = this.iteratorPromises.shift();
      if (!promise) {
         return false; }
      promise.resolve({ done: true, value: undefined });
      return true; }

   private serveNextIteratorPromise() : boolean {
      if (this.serveTermination()) {
         return true; }
      if (this.serveRow()) {
         return true; }
      if (this.serveError()) {
         return true; }
      if (this.serveRequestCompletion()) {
         return true; }
      return false; }

   // During normal operation, this function transfers the available rows from the FIFO
   // to pending iterator promises.
   // When the end of the result set is reached, when an error occurred or when the iterator
   // has been terminated, all pending promises are dispatched.
   private serveIteratorPromises() {
      while (true) {
         if (!this.serveNextIteratorPromise()) {
            break; }}}

   //--- Events ----------------------------------------------------------------

   private addEventListeners() {
      this.request.addListener("row", this.rowEventHandler);
      this.request.addListener("columnMetadata", this.columnMetadataEventHandler); }

   private removeEventListeners() {
      this.request.removeListener("row", this.rowEventHandler);
      this.request.removeListener("columnMetadata", this.columnMetadataEventHandler); }

   private columnMetadataEventHandler = (columnMetadataDef: Tedious_ColumnMetadataDef) => {
      this.resultSetNo++;
      if (this.resultSetNo > 1 || this.error) {
         return; }                                                             // ignore extra result sets and metadata after an error
      const optionsErrorMsg = TediousFixes.checkConnectionOptions(this.request.connection);
         // This check has to be done here because in the constructor the variable `request.connection` has not yet been set.
      if (optionsErrorMsg) {
         this.error ??= new Error(optionsErrorMsg);
         return; }
      if (!Array.isArray(columnMetadataDef)) {
         this.error ??= new Error("Unsupported metadata format, probably because config.options.useColumnNames is set.");
         return; }
      this.metadata = columnMetadataDef;
      this.metadataPromise.resolve(columnMetadataDef); };

   private rowEventHandler = (rowData: Tedious_RowData) => {
      if (this.requestCompleted || this.error || this.terminating) {
         return; }
      if (this.resultSetNo > 1) {
         return; }                                                             // ignore extra result sets
      if (this.resultSetNo == 0 || !this.metadata) {
         this.error ??= new Error('No "columnMetadata" event received before "row" event.');
         return; }
      if (!Array.isArray(rowData)) {
         this.error ??= new Error("Unsupported row data format, probably because config.options.useColumnNames is set.");
         return; }
      const row = TediousUtils.extractRowColumnValues(rowData);
      this.fifo.push(row);
      if (this.fifo.length >= this.fifoPauseLevel && !this.requestPaused) {
         this.request.pause();
         this.requestPaused = true; }
      this.serveIteratorPromises(); };

   //--- Request completion ----------------------------------------------------

   private requestCompletionHandler = (error: Error | null | undefined, _rowCount?: number, _rows?: any) => {
      if (this.requestCompleted) {
         return; }
      this.requestCompleted = true;
      this.removeEventListeners();
      if (error && !this.error) {
         this.error = error; }
      this.metadataPromise.reject(this.error ?? new Error("The request did not return a result set."));
         // This has no effect when the metadata promise has already been resolved.
      this.completedPromise.resolve();
      this.serveIteratorPromises(); }; }
