/**
* This module provides an enhanced `Connection` for communicating with the database server.
*
* @module
*/

import * as Tedious from "tedious";
import {getTypeName} from "./utils/Utils.ts";
import {dummyCallback} from "./utils/TediousFixes.ts";
import * as TediousUtils from "./utils/TediousUtils.ts";
import {type Row, type RowType, type SqlParamDefVariants, type SqlParamDef, type RequestResult, type JsValue, type JsValueDataType, testJsValueDataType} from "./utils/TediousUtils.ts";
import * as ConnectionPromises from "./ConnectionPromises.ts";
import {AsyncRowIterator, type AsyncRowIteratorOptions} from "./AsyncRowIterator.ts";

/**
* Options that are common to all request methods of {@link ConnectionPlus}.
*/
export interface BasicRequestOptions {

   /**
   * The number of milliseconds before the request is considered failed, or 0 for no timeout.
   * When no timeout is set, the `options.requestTimeout` of the `Connection` is used.
   */
   timeoutMs?:                         number; }

/**
* Options for the request methods of {@link ConnectionPlus}, including the SQL parameters.
*/
export type CommonRequestOptions = BasicRequestOptions & SqlParamDefVariants;

/**
* Options for {@link ConnectionPlus.query} and {@link ConnectionPlus.queryRows}.
*/
export interface QueryOptions<RT extends RowType = RowType> extends CommonRequestOptions {

   /**
   * The format of the returned rows.
   *
   * @defaultValue "ObjectRow"
   */
   rowType?:                           RT; }

/**
* Options for {@link ConnectionPlus.queryScalar}.
*/
export interface QueryScalarOptions<DT extends JsValueDataType = JsValueDataType> extends CommonRequestOptions {

   /**
   * The expected data type of the returned value.
   *
   * The data type is verified at runtime and determines the TypeScript type of the returned value.
   * Without this option, the value is returned with the type `any`.
   */
   dataType?:                          DT; }

/**
* Options for {@link ConnectionPlus.queryIterator}.
*/
export type QueryIteratorOptions<RT extends RowType = RowType> = QueryOptions<RT> & AsyncRowIteratorOptions<RT>;

/**
* A wrapper class for the Tedious `Connection` class.
*
* This class provides promisified methods and conveniences to work with a database connection.
*
* Usage:
* ```js
* await using conn = new ConnectionPlus(config);
* await conn.open();
* const rows = await conn.queryRows("select name from sys.databases");
* ```
*/
export class ConnectionPlus implements AsyncDisposable {

   private _connection:                Tedious.Connection;

   /**
   * Creates a `ConnectionPlus` object. The connection is not yet opened.
   *
   * @param configOrConnection
   *    A Tedious connection configuration, from which a new Tedious `Connection` is created,
   *    or an existing Tedious `Connection` object.
   */
   public constructor (configOrConnection: Tedious.ConnectionConfiguration | Tedious.Connection) {
      if (configOrConnection instanceof Tedious.Connection) {
         this._connection = configOrConnection; }
       else {
         this._connection = new Tedious.Connection(configOrConnection); }}

   /**
   * The underlying Tedious `Connection` object.
   */
   public get connection() : Tedious.Connection {
      return this._connection; }

   /**
   * Opens the connection to the database server.
   *
   * See {@link ConnectionPromises.connect} for details.
   *
   * @returns
   *    A promise that is resolved when the connection has been established and the login has completed.
   */
   public open() : Promise<void> {
      return ConnectionPromises.connect(this.connection); }

   /**
   * Closes the connection.
   *
   * @returns
   *    A promise that is resolved when the connection has ended. The promise is always resolved,
   *    even if the connection has failed before.
   */
   public close() : Promise<void> {
      return ConnectionPromises.close(this.connection); }

   /**
   * Closes the connection. Called implicitly at the end of the scope of an `await using` declaration.
   */
   public [Symbol.asyncDispose]() : Promise<void> {
      return this.close(); }

   //--- execSql ---------------------------------------------------------------

   /**
   * Executes SQL code that does not return a result set, e.g. `insert`, `update` or DDL statements.
   *
   * Without parameters, the SQL code is executed as a batch (Tedious `Connection.execSqlBatch()`) in the
   * scope of the session. Changed settings and local temporary tables (`#tmp`) persist in the session.
   *
   * With parameters, the SQL code is executed with `sp_executesql` (Tedious `Connection.execSql()`)
   * in a nested scope. Local temporary tables created by the SQL code are dropped when it finishes,
   * and most changed settings are restored.
   *
   * Usage:
   * ```js
   * await conn.execSql("insert into t1 (id, name) values (@id, @name)", {params: {id: 123, name: "abc"}});
   * ```
   *
   * @param sql
   *    The SQL code to be executed.
   * @param options
   *    Optional request options and SQL parameters.
   * @returns
   *    A promise for the number of rows affected. The promise is rejected when the execution fails.
   */
   public async execSql (sql: string, options?: CommonRequestOptions) : Promise<number> {
      const {request, hasParameters} = createRequest(sql, options);
      if (!hasParameters) {
         return ConnectionPromises.execSqlBatch(this.connection, request); }
       else {
         const result = await ConnectionPromises.execSql(this.connection, request);
         return result.rowCount; }}

   //--- query -----------------------------------------------------------------

   /**
   * Executes an SQL query and returns the rows of the result set, together with the row count and the metadata.
   *
   * All rows are buffered in memory. Use {@link ConnectionPlus.queryIterator} to process large result sets.
   *
   * Usage:
   * ```js
   * const result = await conn.query("select * from t1 where id = @id", {params: {id: 123}});
   * console.log(result.metadata, result.rows);
   * ```
   *
   * @param sql
   *    The SQL query to be executed.
   * @param options
   *    Optional request options, SQL parameters and the row type.
   * @returns
   *    A promise for the result of the query. The promise is rejected when the execution fails.
   */
   public query (sql: string, options?: QueryOptions<"ObjectRow">) : Promise<RequestResult<"ObjectRow">>;
   public query<RT extends RowType> (sql: string, options: QueryOptions<RT> & {rowType: RT}) : Promise<RequestResult<RT>>;
   public async query (sql: string, options?: QueryOptions<any>) : Promise<RequestResult<any>> {
      const {request} = createRequest(sql, options);
      const rowType = options?.rowType ?? "ObjectRow";
      return ConnectionPromises.execSql(this.connection, request, rowType); }

   /**
   * Executes an SQL query and returns the rows of the result set.
   *
   * All rows are buffered in memory. Use {@link ConnectionPlus.queryIterator} to process large result sets.
   *
   * Usage:
   * ```js
   * const objectRows = await conn.queryRows("select id, name from t1");
   * // Output: [ { id: 123, name: 'abc' }, ... ]
   * const arrayRows = await conn.queryRows("select id, name from t1", {rowType: "ArrayRow"});
   * // Output: [ [ 123, 'abc' ], ... ]
   * ```
   *
   * @param sql
   *    The SQL query to be executed.
   * @param options
   *    Optional request options, SQL parameters and the row type.
   * @returns
   *    A promise for the rows. The promise is rejected when the execution fails.
   */
   public queryRows (sql: string, options?: QueryOptions<"ObjectRow">) : Promise<Row<"ObjectRow">[]>;
   public queryRows<RT extends RowType> (sql: string, options: QueryOptions<RT> & {rowType: RT}) : Promise<Row<RT>[]>;
   public async queryRows (sql: string, options?: QueryOptions<any>) : Promise<Row<any>[]> {
      const result = await this.query(sql, options);
      return result.rows; }

   /**
   * Executes an SQL query and returns a single value, i.e. the first column of the first row of the result set.
   *
   * If the result set is empty, `null` is returned.
   *
   * Without the `dataType` option, the value is returned with the type `any`, because its type is given
   * by the SQL expression. With the `dataType` option, the data type of the value is verified at runtime.
   *
   * Usage:
   * ```js
   * const count = await conn.queryScalar("select count(*) from t1", {dataType: "number"});
   * ```
   *
   * @param sql
   *    The SQL query to be executed.
   * @param options
   *    Optional request options, SQL parameters and the expected data type.
   * @returns
   *    A promise for the value. The promise is rejected when the execution fails or when the
   *    value does not match the `dataType` option.
   */
   public queryScalar (sql: string, options?: QueryScalarOptions<"any">) : Promise<JsValue<"any">>;
   public queryScalar<DT extends JsValueDataType> (sql: string, options: QueryScalarOptions & {dataType: DT}) : Promise<JsValue<DT>>;
   public async queryScalar (sql: string, options?: QueryScalarOptions) : Promise<any> {
      const value = await this.queryFirstValue(sql, options);
      const dataType = options?.dataType;
      if (dataType && !testJsValueDataType(value, dataType)) {
         if (value === null) {
            throw new Error(`The query returned no value or NULL, which does not match the data type "${dataType}".`); }
         throw new Error(`Scalar value of type "${getTypeName(value)}" does not match the data type "${dataType}".`); }
      return value; }

   // Returns the first value of the first row of the result set, or `null` if there is no such value.
   private async queryFirstValue (sql: string, options?: QueryScalarOptions) : Promise<any> {
      const rows = await this.queryRows(sql, {...options, rowType: "ArrayRow"});
      if (!rows.length) {
         return null; }
      const row = rows[0];
      if (!row.length) {
         return null; }
      const value = row[0];
      if (value === null || value === undefined) {
         return null; }
      return value; }

   /**
   * Executes an SQL query and returns an iterator to process the rows as soon as they arrive from the server.
   *
   * Usage:
   * ```js
   * for await (const row of conn.queryIterator("select id, name from t1")) {
   *    console.log(row);
   * }
   * ```
   *
   * Only one request can be active on a connection. The iteration must be completed or terminated before
   * the next request is executed on the connection. Exiting the `for await` loop early terminates it.
   * See {@link AsyncRowIterator} for details.
   *
   * @param sql
   *    The SQL query to be executed.
   * @param options
   *    Optional request options, SQL parameters, the row type and settings for the iterator.
   * @returns
   *    An iterator for the rows. When the request fails, the error is thrown within the `for await` loop.
   */
   public queryIterator (sql: string, options?: QueryIteratorOptions<"ObjectRow">) : AsyncRowIterator<"ObjectRow">;
   public queryIterator<RT extends RowType> (sql: string, options: QueryIteratorOptions<RT> & {rowType: RT}) : AsyncRowIterator<RT>;
   public queryIterator (sql: string, options?: QueryIteratorOptions<any>) : AsyncRowIterator<any> {
      const {request} = createRequest(sql, options);
      return ConnectionPromises.execSqlIterator(this.connection, request, options); }}

//--- Helper functions ---------------------------------------------------------

function createRequest (sql: string, options?: CommonRequestOptions) {
   const request = new Tedious.Request(sql, dummyCallback);
   if (options?.timeoutMs !== undefined) {
      request.setTimeout(options.timeoutMs); }
   const paramDefs = TediousUtils.genParamDefArrayFromVariants(options);
   const hasParameters = paramDefs && paramDefs.length > 0;
   if (hasParameters) {
      addRequestParameters(request, paramDefs); }
   return {request, hasParameters}; }

function addRequestParameters (request: Tedious.Request, paramDefs: SqlParamDef[]) {
   for (const pd of paramDefs) {
      request.addParameter(pd.name, pd.type, pd.value, {length: pd.length, precision: pd.precision, scale: pd.scale}); }}
