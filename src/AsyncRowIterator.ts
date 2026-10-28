/**
* This module provides an `AsyncIterator` for reading the result rows of a Tedious `Request`.
*
* @module
*/

import * as Tedious from "tedious";
import {assert, waitWithTimeout} from "./Utils.ts";
import * as TediousFixes from "./TediousFixes.ts";
import type {Tedious_ComboRow, Tedious_ComboRowMetadata} from "./TediousFixes.ts";
import * as TediousUtils from "./TediousUtils.ts";
import type {Row, RowType, RowMetadata, ObjectRowMetadata} from "./TediousUtils.ts";

/**
* Options for the {@link AsyncRowIterator} constructor.
*/
export interface AsyncRowIteratorOptions<RT extends RowType = RowType> {

   /**
   * The target size for the internal row buffer FIFO.
   *
   * Rows received from the server are stored in this FIFO until they are delivered by the iterator.
   * When the FIFO reaches this size, the request is paused. It is resumed when the number of buffered
   * rows has dropped to half of this size.
   *
   * @defaultValue 1024
   */
   fifoSize?:                          number;

   /**
   * The format of the rows delivered by the iterator.
   *
   * @defaultValue "ObjectRow"
   */
   rowType?:                           RT; }

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
* - By default, each row is delivered as an object (`ObjectRow`). Other row formats can be
*   selected with the option {@link AsyncRowIteratorOptions.rowType}.
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
export class AsyncRowIterator<RT extends RowType = "ObjectRow"> implements AsyncDisposable {

   private options:                    Required<AsyncRowIteratorOptions<RT>>;
   private controller:                 RowIteratorController<RT>;
   private iteratorObject:             RowIteratorObject<RT>;
   private _objectRowMetadata:         ObjectRowMetadata | undefined;

   /**
   * Creates a row iterator for a Tedious request.
   *
   * @param request
   *    The Tedious request whose result rows are to be iterated.
   * @param options
   *    Optional settings for the iterator, e.g. the row type.
   */
   public constructor (request: Tedious.Request, options?: AsyncRowIteratorOptions<RT>) {
      this.options = {
         fifoSize:                     options?.fifoSize ?? 1024,
         rowType:                      options?.rowType ?? "ObjectRow" as RT };
            // The assertion is only correct if RT has not been specified explicitly without passing rowType.
      this.controller = new RowIteratorController<RT>(request, this.options);
      this.iteratorObject = new RowIteratorObject<RT>(this.controller); }

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
   * Returns the row metadata of the first result set.
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
   * Returns the row metadata of the first result set as an object with one property per column.
   *
   * @throws Error
   *    If the metadata has not yet been received.
   */
   public get objectRowMetadata() : ObjectRowMetadata {
      this._objectRowMetadata ??= TediousFixes.convertArrayRowMetadataToObjectRowMetadata(this.metadata);
      return this._objectRowMetadata; }

   /**
   * Returns a promise for the row metadata of the first result set.
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
   public [Symbol.asyncIterator]() : AsyncIterator<Row<RT>> {
      return this.iteratorObject; }

   /**
   * Terminates the iteration. This method is called implicitly at the end of the scope of an
   * `await using` declaration.
   *
   * If the request is still active, it is canceled. The returned promise is resolved when the request
   * has completed, so that the connection can be used for the next request immediately afterwards.
   * This has the same effect as exiting a `for await` loop early.
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
class RowIteratorObject<RT extends RowType> implements AsyncIterator<Row<RT>> {

   private controller:                 RowIteratorController<RT>;

   public constructor (controller: RowIteratorController<RT>) {
      this.controller = controller; }

   public next() : Promise<IteratorResult<Row<RT>>> {
      const promise: PromiseWithResolvers<IteratorResult<Row<RT>>> = Promise.withResolvers();
      this.controller.pushIteratorPromise(promise);
      return promise.promise; }

   public async return (value?: any) : Promise<IteratorResult<Row<RT>>> {
      await this.controller.terminate();
      return {value, done: true}; }

   public async throw (exception?: any) : Promise<IteratorResult<Row<RT>>> {
      await this.controller.terminate();
      if (exception) {
         throw exception; }
       else {
         return {done: true, value: undefined}; }}}

//--- Controller ---------------------------------------------------------------

const minCancelTimeout                 = 5000;                                 // used instead of the Tedious `cancelTimeout` when that is lower
const terminationTimeoutMargin         = 5000;                                 // added to the cancel timeout for the termination timeout

// Internal class for the state controller logic of the row iterator.
class RowIteratorController<RT extends RowType> {

   private request:                    Tedious.Request;
   private rowType:                    RT;
   private requestCompleted:           boolean;
   private requestPaused:              boolean;
   private error:                      Error | undefined;
   private terminating:                boolean;

   private resultSetNo:                number;
   public  metadata:                   RowMetadata | undefined;
   public  rowCount:                   number;
   public  fifo:                       Row<RT>[];
   private fifoPauseLevel:             number;
   private fifoResumeLevel:            number;

   private iteratorPromises:           PromiseWithResolvers<IteratorResult<Row<RT>>>[];  // FIFO of pending iterator promises
   private metadataPromise:            PromiseWithResolvers<RowMetadata>;
   private completedPromise:           PromiseWithResolvers<void>;

   //--- Constructor / terminator ----------------------------------------------

   public constructor (request: Tedious.Request, options: Required<AsyncRowIteratorOptions<RT>>) {
      this.request = request;
      this.rowType = options.rowType;

      this.requestCompleted = false;
      this.requestPaused = false;
      this.terminating = false;

      this.resultSetNo = 0;
      this.rowCount = 0;
      this.fifo = [];
      assert(options.fifoSize >= 2, "The fifoSize option must be at least 2.");
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

   // Records an internal error and cancels the request, so that the remaining rows are not transferred.
   // The error is delivered to the API client when the canceled request has completed.
   private abortWithError (msg: string) {
      if (this.error) {
         return; }
      this.error = new Error(msg);
      this.cancelRequest(); }

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

   public pushIteratorPromise (promise: PromiseWithResolvers<IteratorResult<Row<RT>>>) {
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

   private columnMetadataEventHandler = (metadata: Tedious_ComboRowMetadata) => {
      this.resultSetNo++;
      if (this.resultSetNo > 1 || this.error) {
         return; }                                                             // ignore extra result sets and metadata after an error
      const optionsErrorMsg = TediousFixes.checkConnectionOptions(this.request.connection);
         // This check has to be done here because in the constructor the variable `request.connection` has not yet been set.
      if (optionsErrorMsg) {
         this.abortWithError(optionsErrorMsg);
         return; }
      if (!Array.isArray(metadata)) {
         this.abortWithError("Unsupported metadata format, probably because config.options.useColumnNames is set.");
         return; }
      this.metadata = metadata;
      this.metadataPromise.resolve(metadata); };

   private rowEventHandler = (tediousRow: Tedious_ComboRow) => {
      if (this.requestCompleted || this.error || this.terminating) {
         return; }
      if (this.resultSetNo > 1) {
         return; }                                                             // ignore extra result sets
      if (this.resultSetNo == 0 || !this.metadata) {
         this.abortWithError('No "columnMetadata" event received before "row" event.');
         return; }
      if (!Array.isArray(tediousRow)) {
         this.abortWithError("Unsupported row data format, probably because config.options.useColumnNames is set.");
         return; }
      const row = TediousUtils.convertTediousArrayRow<RT>(tediousRow, this.rowType);
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
