/**
* Types and utility functions for result set rows, metadata, value data types and SQL parameters.
*
* @module
*/

import * as Tedious from "tedious";
import {assert, createBareObject, getTypeName} from "./Utils.ts";
import * as TediousFixes from "./TediousFixes.ts";
import type {Tedious_ArrayRow, Tedious_ObjectRow, Tedious_ArrayRowMetadata, Tedious_ObjectRowMetadata, Tedious_DataType} from "./TediousFixes.ts";

/**
* The result from executing an SQL request.
*/
export interface RequestResult<RT extends RowType> {

   /**
   * The number of rows affected or returned.
   */
   rowCount:                           number;

   /**
   * The rows returned by the query.
   * Only the first result set is processed. Extra result sets are ignored.
   */
   rows:                               Row<RT>[];

   /**
   * Row metadata of the result set.
   */
   metadata:                           RowMetadata; }

//--- Result set rows ----------------------------------------------------------

/**
* A result set row as an object structure.
*
* Example: `{col1: 123, col2: "abc"}`
*
* For duplicate column names, only the first value is used.
*
* The value data type `any` is used for convenience and because the type is given by the SQL query.
*/
export type ObjectRow = Record<string, any>;

/**
* A result set row as an array of column values.
*
* Example: `[123, "abc"]`
*
* The values are in the same order as the columns of the result set (see {@link RowMetadata}).
* They are the JavaScript values converted by Tedious, e.g. `number`, `string`, `boolean`, etc.
*
* The data type `any` is used for convenience and because the type is given by the SQL query.
*/
export type ArrayRow = any[];

/**
* A result set row as a `Map` from column names to column values.
*
* Example: `Map {"col1" => 123, "col2" => "abc"}`
*
* For duplicate column names, only the first value is used.
*
* The data type `any` is used for convenience and because the type is given by the SQL query.
*/
export type MapRow = Map<string, any>;

/**
* A result set row in the format provided by the `row` event of a Tedious `Request`.
*
* Example:
* ```js
* [
*    {value: 123, metadata: {colName: "col1", type: Tedious.TYPES.Int, ...}},
*    {value: "abc", metadata: {colName: "col2", type: Tedious.TYPES.VarChar, ...}}
* ]
* ```
*/
export type TediousArrayRow = Tedious_ArrayRow;

/**
* A result set row in the format provided by the `row` event of a Tedious `Request`
* when `config.options.useColumnNames` is `true`.
*
* Example:
* ```js
* {
*    col1: {value: 123, metadata: {colName: "col1", type: Tedious.TYPES.Int, ...}},
*    col2: {value: "abc", metadata: {colName: "col2", type: Tedious.TYPES.VarChar, ...}}
* }
* ```
*/
export type TediousObjectRow = Tedious_ObjectRow;

/**
* The name of a row format. Used for the `rowType` option.
*
* | Value                | Row format                                                               |
* | -------------------- | ------------------------------------------------------------------------ |
* | `"ObjectRow"`        | An object with one property per column (default), see {@link ObjectRow}. |
* | `"ArrayRow"`         | An array of column values, see {@link ArrayRow}.                         |
* | `"MapRow"`           | A `Map` from column names to column values, see {@link MapRow}.          |
* | `"TediousArrayRow"`  | The row array provided by Tedious, see {@link TediousArrayRow}.          |
* | `"TediousObjectRow"` | The Tedious row as an object, see {@link TediousObjectRow}.              |
*/
export type RowType = "ObjectRow" | "ArrayRow" | "MapRow" | "TediousArrayRow" | "TediousObjectRow";

/**
* Maps the row type names (see {@link RowType}) to the corresponding row types.
*/
export interface RowTypes extends Record<RowType, unknown> {
   ObjectRow:                          ObjectRow;                              // eslint-disable-line
   ArrayRow:                           ArrayRow;                               // eslint-disable-line
   MapRow:                             MapRow;                                 // eslint-disable-line
   TediousArrayRow:                    TediousArrayRow;                        // eslint-disable-line
   TediousObjectRow:                   TediousObjectRow; }                     // eslint-disable-line

/**
* The row type for a row type name, e.g. `Row<"ArrayRow">` is {@link ArrayRow}.
*/
export type Row<RT extends RowType> = RowTypes[RT];

/** @internal */
export function convertTediousArrayRow<RT extends RowType> (tediousArrayRow: TediousArrayRow, rowType: RT) : Row<RT>;
export function convertTediousArrayRow (tediousArrayRow: TediousArrayRow, rowType: RowType) : Row<RowType> {
   switch (rowType) {
      case "ObjectRow": {
         return convertTediousArrayRowToObjectRow(tediousArrayRow); }
      case "ArrayRow": {
         return tediousArrayRow.map(e => e.value); }
      case "MapRow": {
         return convertTediousArrayRowToMapRow(tediousArrayRow); }
      case "TediousArrayRow": {
         return tediousArrayRow; }
      case "TediousObjectRow": {
         return TediousFixes.convertTediousArrayRowToTediousObjectRow(tediousArrayRow); }
      default: {
         assert(false, `Invalid row type "${rowType}".`); }}}

// Converts a `TediousArrayRow` into an `ObjectRow`.
// For duplicate column names only the first value is used.
function convertTediousArrayRowToObjectRow (tediousArrayRow: TediousArrayRow) : ObjectRow {
   const objectRow: ObjectRow = createBareObject();
   for (const e of tediousArrayRow) {
      const colName = e.metadata.colName;
      if (!(colName in objectRow)) {
         objectRow[colName] = e.value; }}
   return objectRow; }

// Converts a `TediousArrayRow` into a `MapRow`.
// For duplicate column names only the first value is used.
function convertTediousArrayRowToMapRow (tediousArrayRow: TediousArrayRow) : MapRow {
   const mapRow: MapRow = new Map();
   for (const e of tediousArrayRow) {
      const colName = e.metadata.colName;
      if (!mapRow.has(colName)) {
         mapRow.set(colName, e.value); }}
   return mapRow; }

/**
* The metadata of a result set row, with one array entry per column.
*
* This is the metadata array that Tedious provides with the `columnMetadata` event of a `Request`.
*
* Example:
* ```js
* [
*    {colName: "col1", type: Tedious.TYPES.Int, ...},
*    {colName: "col2", type: Tedious.TYPES.VarChar, ...}
* ]
* ```
*/
export type RowMetadata = Tedious_ArrayRowMetadata;

/**
* The metadata of a result set row, with one object property per column.
*
* This is the metadata object that Tedious would have sent with the `columnMetadata` event of a `Request`
* when `config.options.useColumnNames` was set.
*
* Example:
* ```js
* {
*    col1: {colName: "col1", type: Tedious.TYPES.Int, ...},
*    col2: {colName: "col2", type: Tedious.TYPES.VarChar, ...}
* }
* ```
*/
export type ObjectRowMetadata = Tedious_ObjectRowMetadata;

//--- JS value data types ------------------------------------------------------

/**
* The name of a JavaScript value data type. Used for the `dataType` option of `ConnectionPlus.queryScalar()`.
*
* - `"number"`, `"string"`, `"boolean"`, `"bigint"`: A value of this primitive type.
* - `"object"`: Any object, but not `null`.
* - `"Date"`, `"Buffer"`: An instance of this class.
* - `"number|null"`, `"string|null"`, `"boolean|null"`, `"bigint|null"`, `"object|null"`, `"Date|null"`,
*   `"Buffer|null"`: Same as the data type without `|null`, but `null` is also accepted.
* - `"any"`, `"unknown"`: Any value. The value is not checked. The TypeScript type is `any` or `unknown`.
*/
export type JsValueDataType =
   "number" | "string" | "boolean" | "bigint" | "object" | "Date" | "Buffer" |
   "number|null" | "string|null" | "boolean|null" | "bigint|null" | "object|null" | "Date|null" | "Buffer|null" |
   "any" | "unknown";

/**
* Maps the data type names (see {@link JsValueDataType}) to the corresponding TypeScript types.
*/
export interface JsValueDataTypes extends Record<JsValueDataType, unknown> {
   // Native data types:
   number:                             number;                                 // eslint-disable-line
   string:                             string;                                 // eslint-disable-line
   boolean:                            boolean;                                // eslint-disable-line
   bigint:                             bigint;
   object:                             object;
   // Object data types:
   Date:                               Date;                                   // eslint-disable-line
   Buffer:                             Buffer;                                 // eslint-disable-line
   // Nullable types:
   "number|null":                      number | null;                          // eslint-disable-line
   "string|null":                      string | null;                          // eslint-disable-line
   "boolean|null":                     boolean | null;                         // eslint-disable-line
   "bigint|null":                      bigint | null;                          // eslint-disable-line
   "object|null":                      object | null;                          // eslint-disable-line
   "Date|null":                        Date | null;                            // eslint-disable-line
   "Buffer|null":                      Buffer | null;                          // eslint-disable-line
   // Permissive types:
   any:                                any;                                    // eslint-disable-line
   unknown:                            unknown; }                              // eslint-disable-line

/**
* The TypeScript type for a data type name, e.g. `JsValue<"string|null">` is `string | null`.
*/
export type JsValue<T extends JsValueDataType> = JsValueDataTypes[T];

/**
* Verifies whether a value matches a data type.
*
* This is a TypeScript type guard. When it returns `true`, the type of `value` is narrowed accordingly.
*
* @param value
*    The value to be checked.
* @param dataType
*    The name of the data type.
* @returns
*    `true` if the value matches the data type.
*/
export function testJsValueDataType<T extends JsValueDataType> (value: unknown, dataType: T) : value is JsValue<T> {
   switch (dataType) {
      case "number":                   return typeof value == "number";
      case "string":                   return typeof value == "string";
      case "boolean":                  return typeof value == "boolean";
      case "bigint":                   return typeof value == "bigint";
      case "object":                   return typeof value == "object"  && value !== null;
      case "Date":                     return value instanceof Date;
      case "Buffer":                   return Buffer.isBuffer(value);
      case "number|null":              return typeof value == "number"  || value === null;
      case "string|null":              return typeof value == "string"  || value === null;
      case "boolean|null":             return typeof value == "boolean" || value === null;
      case "bigint|null":              return typeof value == "bigint"  || value === null;
      case "object|null":              return typeof value == "object"  || value === null;
      case "Date|null":                return value instanceof Date || value === null;
      case "Buffer|null":              return Buffer.isBuffer(value) || value === null;
      case "any":                      return true;
      case "unknown":                  return true;
      default:                         return false; }}

//--- SQL parameters -----------------------------------------------------------

/**
* The SQL data type of a parameter.
*/
export interface SqlParamDataType {

   /**
   * The Tedious data type, e.g. `Tedious.TYPES.Int`.
   */
   type:                               Tedious_DataType;

   /**
   * The length, for string and binary data types (e.g. `NVarChar`, `VarBinary`).
   */
   length?:                            number;

   /**
   * The precision, for the data types `Decimal` and `Numeric`.
   */
   precision?:                         number;

   /**
   * The scale, for the data types `Decimal`, `Numeric`, `Time`, `DateTime2` and `DateTimeOffset`.
   */
   scale?:                             number; }

/**
* The value and the SQL data type of a parameter.
*/
export interface SqlParamValueAndDataType extends SqlParamDataType {

   /**
   * The parameter value. `null` or `undefined` is passed as SQL `NULL`.
   */
   value:                              unknown; }

/**
* A complete SQL parameter definition, with name, value and data type.
*/
export interface SqlParamDef extends SqlParamValueAndDataType {

   /**
   * The parameter name, without the `@` prefix.
   */
   name:                               string; }

/**
* This structure provides variants for specifying SQL parameters.
*
* Only one of the variants may be used.
*
* In the SQL code, the parameters are referenced with an `@` prefix, e.g. `@p1`.
*/
export interface SqlParamDefVariants {

   /**
   * This variant is used to specify parameter names and values.
   *
   * Example: `{p1: 123, p2: "abc"}`
   *
   * The data types are derived from the values (see {@link deriveParamDataTypeFromValue}).
   */
   params?:                            Record<string, unknown>;

   /**
   * This variant is used to specify only the parameter values.
   *
   * Example: `[123, "abc"]`
   *
   * The parameter names `a`, `b`, `c`, ... are generated (see {@link genParamName}), so the
   * parameters are referenced as `@a`, `@b`, `@c`, ... in the SQL code.
   * The data types are derived from the values (see {@link deriveParamDataTypeFromValue}).
   */
   paramValues?:                       unknown[];

   /**
   * This variant is used to specify full parameter definitions as an object.
   *
   * Example:
   * ```js
   * {
   *    p1: {type: Tedious.TYPES.Int, value: 123},
   *    p2: {type: Tedious.TYPES.NVarChar, value: "abc"}
   * }
   * ```
   */
   paramDefs?:                         Record<string, SqlParamValueAndDataType>;

   /**
   * This variant is used to specify full parameter definitions as an array.
   *
   * Example:
   * ```js
   * [
   *    {name: "p1", type: Tedious.TYPES.Int, value: 123},
   *    {name: "p2", type: Tedious.TYPES.NVarChar, value: "abc"}
   * ]
   * ```
   */
   paramDefArray?:                     SqlParamDef[]; }

/** @internal */
export function genParamDefArrayFromVariants (v?: SqlParamDefVariants) : SqlParamDef[] | undefined {
   if (!v) {
      return undefined; }
   const variantCount = [v.params, v.paramValues, v.paramDefs, v.paramDefArray].filter(e => e !== undefined).length;
   if (variantCount > 1) {
      throw new Error("Only one of the options params, paramValues, paramDefs or paramDefArray may be specified."); }
   if (v.params) {
      return Object.entries(v.params).map(e => ({name: e[0], value: e[1], type: deriveParamDataTypeFromValue(e[1])})); }
   if (v.paramValues) {
      return v.paramValues.map((e, i) => ({name: genParamName(i), value: e, type: deriveParamDataTypeFromValue(e)})); }
   if (v.paramDefs) {
      return Object.entries(v.paramDefs).map(e => ({...e[1], name: e[0]})); }
   if (v.paramDefArray) {
      return v.paramDefArray; }
   return undefined; }

/**
* Generates an automatic parameter name.
*
* Parameter names are generated in the following sequence:<br>
* 'a' - 'z', 'aa' - 'az', 'ba' - 'bz', ... 'za' - 'zz', 'aaa' ...
*
* For use in an SQL statement, the "@" character must be added as a prefix.
*
* @param paramNo
*    The zero-based parameter number.
*/
export function genParamName (paramNo: number) : string {
   assert(Number.isSafeInteger(paramNo) && paramNo >= 0 && paramNo < 5000, "Parameter number out of range.");
   let n = paramNo;
   let s = "";
   do {
      const r = n % 26;
      s = String.fromCharCode(97 + r) + s;
      n = Math.floor(n / 26) - 1;
   } while (n >= 0);
   return s; }

/**
* Returns a string with automatically generated parameter names in the form "@a,@b,@c,...".
*
* Usage, together with the `paramValues` option:
* ```js
* const values = [123, "abc", true];
* await conn.execSql(`insert into t1 values (${genParamNameList(values.length)})`, {paramValues: values});
* ```
*
* @param n
*    The number of parameter names.
*/
export function genParamNameList (n: number) : string {
   let s = "";
   for (let i = 0; i < n; i++) {
      if (i > 0) {
         s += ","; }
      s += "@" + genParamName(i); }
   return s; }

/**
* Derives the SQL parameter data type from a JavaScript value.
*
* | Value                        | Data type                |
* | ---------------------------- | ------------------------ |
* | `string`                     | `NVarChar`               |
* | `number`, int32 range        | `Int`                    |
* | `number`, other safe integer | `BigInt`                 |
* | `number`, other              | `Float`                  |
* | `bigint`                     | `BigInt`                 |
* | `boolean`                    | `Bit`                    |
* | `Buffer`                     | `VarBinary`              |
* | `Date`                       | `DateTime2`              |
* | `null`, `undefined`          | `Bit` (passed as `NULL`) |
*
* @param value
*    The parameter value.
* @returns
*    The Tedious data type.
* @throws Error
*    If the data type of the value is not supported.
*/
export function deriveParamDataTypeFromValue (value: unknown) : Tedious_DataType {
   if (value === null || value === undefined) {
      return Tedious.TYPES.Bit; }                                              // (Tedious.TYPES.Null does not exist. We use Bit instead to pass a NULL parameter value.)
   switch (typeof value) {
      case "string": {
         return Tedious.TYPES.NVarChar; }
      case "number": {
         if (!Number.isSafeInteger(value)) {
            return Tedious.TYPES.Float; }
         if (value >= -0x80000000 && value <= 0x7FFFFFFF) {
            return Tedious.TYPES.Int; }
          else {
            return Tedious.TYPES.BigInt; }}
      case "bigint": {
         return Tedious.TYPES.BigInt; }
      case "boolean": {
         return Tedious.TYPES.Bit; }}
   if (value instanceof Buffer) {
      return Tedious.TYPES.VarBinary; }
   if (value instanceof Date) {
      return Tedious.TYPES.DateTime2; }
   throw new Error(`Unsupported parameter data type "${getTypeName(value)}".`); }
