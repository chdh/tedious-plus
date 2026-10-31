/**
* Promisified wrappers for the methods of the Tedious `Connection` class.
*
* @module
*/

import * as Tedious from "tedious";
import * as TediousFixes from "./utils/TediousFixes.ts";
import type {Tedious_ComboRow, Tedious_ComboRowMetadata} from "./utils/TediousFixes.ts";
import {AsyncRowIterator, type AsyncRowIteratorOptions} from "./AsyncRowIterator.ts";
import * as TediousUtils from "./utils/TediousUtils.ts";
import type {Row, RowType, RowMetadata, RequestResult} from "./utils/TediousUtils.ts";

//--- Connection monitor -------------------------------------------------------

/**
* An internal class that tracks the state of a Tedious connection.
*
* @internal
*/
export class ConnectionMonitor {

   //--- Static ----------------------------------------------------------------

   private static map                  = new WeakMap<Tedious.Connection, ConnectionMonitor>();
      // This map is used to associate `Connection` objects with `ConnectionMonitor` objects.

   // A single monitor object is attached to each connection object.
   public static attach (connection: Tedious.Connection) : ConnectionMonitor {
      let monitor = this.map.get(connection);
      if (monitor) {
         return monitor; }
      monitor = new ConnectionMonitor(connection);
      this.map.set(connection, monitor);
      return monitor; }

   // Verifies that the connection is open. Throws an error otherwise.
   public static verifyIsOpen (connection: Tedious.Connection) {
      const monitor = ConnectionMonitor.attach(connection);
      monitor.verifyIsOpen(); }

   //--- Instance --------------------------------------------------------------

   private connection:                 Tedious.Connection;
   private errorObj:                   Error | undefined;                      // set when a fatal connection error occurred
   private hasEnded:                   boolean = false;                        // true = connection has ended
   public  endPromise:                 PromiseWithResolvers<void>;

   private constructor (connection: Tedious.Connection) {
      this.connection = connection;
      this.endPromise = Promise.withResolvers();
      if (connection.closed) {                                                 // (warning: `closed` is a private field)
         this.hasEnded = true;
         this.endPromise.resolve(); }
      this.addEventListeners(); }

   // Verifies that the connection is open. Throws an error otherwise.
   public verifyIsOpen() {
      if (this.errorObj) {
         throw this.errorObj; }
      if (this.hasEnded) {
         throw new Error("The connection has ended."); }}

   //--- Event handlers --------------------------------------------------------

   // The event listeners are never removed, because the monitor has the same lifetime as the connection.
   // The `error` listener must stay registered after the `end` event, because Tedious may emit `error`
   // after `end` (e.g. on socket errors). Without a listener, the process would crash with an unhandled
   // `error` event.
   private addEventListeners() {
      this.connection.addListener("error", this.errorEventHandler);
      this.connection.addListener("end", this.endEventHandler); }

   private errorEventHandler = (error: Error) => {
      this.errorObj ??= error ?? new Error("Unspecified connection error."); };

   private endEventHandler = () => {
      this.hasEnded = true;
      this.endPromise.resolve(); }; }

//--- Request monitor ----------------------------------------------------------

// An internal class that tracks the state of a Tedious request.
class RequestMonitor<RT extends RowType = RowType> {

   private request:                    Tedious.Request;
   private rowType:                    RT;
   private requestCompleted:           boolean;
   private resultSetNo:                number;
   public  metadata:                   RowMetadata;
   private rows:                       Row<RT>[];
   private rowCount:                   number;                                 // row count returned from SQL server
   private error:                      Error | undefined;
   private completedPromise:           PromiseWithResolvers<void>;

   public constructor (request: Tedious.Request);
   public constructor (request: Tedious.Request, rowType: RT);
   public constructor (request: Tedious.Request, rowType: RowType = "ObjectRow") {
      this.request = request;
      this.rowType = <RT>rowType;
      this.requestCompleted = false;
      this.resultSetNo = 0;
      this.metadata = [];
      this.rows = [];
      this.rowCount = 0;
      this.completedPromise = Promise.withResolvers();
      this.addEventListeners();
      TediousFixes.interceptRequestCompletion(request, this.requestCompletionHandler); }

   public async getResult() : Promise<RequestResult<RT>> {
      await this.completedPromise.promise;
      if (this.error) {
         throw this.error; }
      return {rowCount: this.rowCount, rows: this.rows, metadata: this.metadata}; }

   // Records an internal error and cancels the request, so that the remaining rows are not transferred.
   // The error is delivered when the canceled request has completed.
   private abortWithError (msg: string) {
      if (this.error) {
         return; }
      this.error = new Error(msg);
      this.request.cancel(); }

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
      if (!Array.isArray(metadata)) {
         this.abortWithError("Unsupported metadata format, probably because config.options.useColumnNames is set.");
         return; }
      this.metadata = metadata; };

   private rowEventHandler = (tediousRow: Tedious_ComboRow) => {
      if (this.resultSetNo > 1 || this.error) {
         return; }                                                             // ignore extra result sets and rows after an error
      if (!Array.isArray(tediousRow)) {
         this.abortWithError("Unsupported row data format, probably because config.options.useColumnNames is set.");
         return; }
      const row = TediousUtils.convertTediousArrayRow(tediousRow, this.rowType);
      this.rows.push(row); };

   //--- Request completion ----------------------------------------------------

   private requestCompletionHandler = (error: Error | null | undefined, rowCount?: number, _rows?: any) => {
      if (this.requestCompleted) {
         return; }
      this.requestCompleted = true;
      this.removeEventListeners();
      if (error && !this.error) {
         this.error = error; }
      this.rowCount = rowCount ?? 0;
      this.completedPromise.resolve(); }; }

//--- Connection functions -----------------------------------------------------

/**
* Opens a connection to the database server.
*
* This is the promisified version of `Connection.connect()`.
*
* This function registers a permanent listener for the `error` event of the connection.
* Therefore, unlike with plain Tedious, a fatal connection error does not crash the process
* when the application has not registered its own `error` listener.
* Instead, the error is thrown by the next function of this module that is called for the connection.
*
* @param connection
*    A newly created Tedious connection that has not yet been connected.
* @returns
*    A promise that is resolved when the connection has been established and the login has completed.
*/
export async function connect (connection: Tedious.Connection) : Promise<void> {
   const optionsErrorMsg = TediousFixes.checkConnectionOptions(connection);
   if (optionsErrorMsg) {
      throw new Error(optionsErrorMsg); }
   ConnectionMonitor.attach(connection);
   const promise: PromiseWithResolvers<void> = Promise.withResolvers();
   connection.connect(connectCallback);
   return promise.promise;
   function connectCallback (err?: Error) {
      if (err) {
         promise.reject(err); }
       else {
         promise.resolve(); }}}

/**
* Closes a connection.
*
* This is the promisified version of `Connection.close()`.
* A request that is still active on the connection is completed by Tedious with an error.
*
* Connection errors are ignored. The returned promise is always resolved, even if the connection
* has failed before.
*
* @param connection
*    The Tedious connection to be closed.
* @returns
*    A promise that is resolved when the connection has ended.
*    If the connection is already closed, the promise is resolved immediately.
*/
export async function close (connection: Tedious.Connection) : Promise<void> {
   const monitor = ConnectionMonitor.attach(connection);
   connection.close();
   return monitor.endPromise.promise; }

/**
* Executes an SQL query and returns the result.
*
* This is a promisified version of `Connection.execSql()`.
* The rows of the result set are buffered in an array and returned on completion.
* The optional parameter `rowType` specifies the format of the rows (default: `"ObjectRow"`).
*
* Usage:
* ```js
* const request = new Tedious.Request("select name from sys.databases", () => {});
* const result = await ConnectionPromises.execSql(connection, request);
* console.log(result.rows);
* ```
*
* @param connection
*    An open Tedious connection.
* @param request
*    The Tedious request to be executed.
* @returns
*    A promise for the result of the request. The promise is rejected when the request fails.
*/
export function execSql (connection: Tedious.Connection, request: Tedious.Request) : Promise<RequestResult<"ObjectRow">>;
export function execSql<RT extends RowType> (connection: Tedious.Connection, request: Tedious.Request, rowType: RT) : Promise<RequestResult<RT>>;
export async function execSql (connection: Tedious.Connection, request: Tedious.Request, rowType: RowType = "ObjectRow") : Promise<RequestResult<RowType>> {
   ConnectionMonitor.verifyIsOpen(connection);
   const requestMonitor = new RequestMonitor<RowType>(request, rowType);
   connection.execSql(request);
   return requestMonitor.getResult(); }

/**
* Executes an SQL query and returns an `AsyncRowIterator` to process the result set.
*
* This is an iterator-based variant of `Connection.execSql()`.
* It returns an `AsyncIterator` that allows processing the rows as soon as they arrive from the
* database server. The iteration must be completed or terminated before the next request is
* executed on the connection. See {@link AsyncRowIterator} for details.
*
* Usage:
* ```js
* const request = new Tedious.Request("select name from sys.databases", () => {});
* const iterator = ConnectionPromises.execSqlIterator(connection, request);
* for await (const row of iterator) {
*    console.log(row);
* }
* ```
*
* @param connection
*    An open Tedious connection.
* @param request
*    The Tedious request to be executed.
* @param options
*    Optional settings for the iterator, e.g. the row type.
* @returns
*    An iterator for the result rows. When the request fails, the error is thrown within the
*    `for await` loop.
*/
export function execSqlIterator (connection: Tedious.Connection, request: Tedious.Request, options?: AsyncRowIteratorOptions<"ObjectRow">) : AsyncRowIterator<"ObjectRow">;
export function execSqlIterator<RT extends RowType> (connection: Tedious.Connection, request: Tedious.Request, options: AsyncRowIteratorOptions<RT> & {rowType: RT}) : AsyncRowIterator<RT>;
export function execSqlIterator (connection: Tedious.Connection, request: Tedious.Request, options?: AsyncRowIteratorOptions) : AsyncRowIterator<any> {
   ConnectionMonitor.verifyIsOpen(connection);
   const iterator = new AsyncRowIterator<RowType>(request, options);
   connection.execSql(request);
   return iterator; }

/**
* Executes an SQL batch block.
*
* This is the promisified version of `Connection.execSqlBatch()`.
* It can be used e.g. to execute the blocks of an SQL script.
*
* The SQL code runs within the scope of the session.
* Changed settings and local temporary tables (`#tmp`) persist in the session across batches.
*
* SQL parameters are not supported with `execSqlBatch()`.
*
* @param connection
*    An open Tedious connection.
* @param request
*    The Tedious request to be executed.
* @returns
*    A promise for the number of rows affected, or 0. The promise is rejected when the request fails.
*/
export async function execSqlBatch (connection: Tedious.Connection, request: Tedious.Request) : Promise<number> {
   ConnectionMonitor.verifyIsOpen(connection);
   const requestMonitor = new RequestMonitor(request);
   connection.execSqlBatch(request);
   const result = await requestMonitor.getResult();
   return result.rowCount; }
