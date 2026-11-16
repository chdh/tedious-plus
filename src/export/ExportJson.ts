/**
* Helper functions for JSONL export.
*
* @internal @module
*/

import {Buffer} from 'node:buffer';
import {assert, getTypeName} from "../utils/Utils.ts";
import {BufferedAsyncWriter} from "../io/AsyncWriter.ts";
import {type Tedious_ColumnMetadata} from "../utils/TediousFixes.ts";
import {type ArrayRow, type ArrayRowMetadata, convertArrayRowToObjectRow} from "../utils/TediousUtils.ts";

/**
* Creates a header line for the JSONL array export.
*
* The header line has the form:
* ```json
* ["col1", "col2", "col3", ...]
* ```
*/
export function jsonArrayHeaderGenerator (metadata: ArrayRowMetadata) : string {
   const colNames = metadata.map(e => e.colName);
   const json = JSON.stringify(colNames);
   assert(json !== undefined);
   return json; }

/**
* Writes a row as a JSONL array line, e.g. `[1, "abc"]`.
*/
export function jsonArrayRowWriter (row: ArrayRow, _metadata: ArrayRowMetadata, out: BufferedAsyncWriter) : Promise<void> {
   return out.writeJsonLine(row); }

/**
* Writes a row as a JSONL object line, e.g. `{"id": 1, "name": "abc"}`.
*/
export function jsonObjectRowWriter (row: ArrayRow, metadata: ArrayRowMetadata, out: BufferedAsyncWriter) : Promise<void> {
   const obj = convertArrayRowToObjectRow(row, metadata);
   return out.writeJsonLine(obj); }

/**
* Verifies that the column names are unique. This is required for the JSONL object export,
* because a duplicate column name would overwrite a property of the row object.
*
* @throws Error
*    If a column name occurs more than once.
*/
export function checkUniqueColumnNames (metadata: ArrayRowMetadata) : void {
   const colNames = new Set<string>();
   for (const colMetadata of metadata) {
      const colName = colMetadata.colName;
      if (colNames.has(colName)) {
         throw new Error(`Duplicate column name "${colName}". Column names must be unique for the JSONL object row shape.`); }
      colNames.add(colName); }}

/**
* Converts a Tedious database column value into a JavaScript value for `JSON.stringify()`.
*
* The conversion is described in `ExportFormatTypeJsonlOptions` in the module `ExportMain`.
*
* @throws Error
*    If the data type of the value is not supported.
*/
export function jsonValueShaper (value: any, colMetadata: Tedious_ColumnMetadata) : any {
   if (value === undefined || value === null) {
      return null; }
   if (isBigIntColumn(colMetadata) || typeof value == "bigint") {
      return {$bigint: String(value)}; }                                       // Tedious delivers bigint values as strings
   switch (typeof value) {
      case "string":  return value;
      case "number":  return value;
      case "boolean": return value; }
   if (value instanceof Date) {
      return formatDateValue(value, colMetadata); }
   if (Buffer.isBuffer(value)) {
      return value.toString("hex"); }
   throw new Error(`Unsupported Tedious data type, metaDataType="${colMetadata.type.name}", valueType="${getTypeName(value)}".`); }

// Returns `true` for a column with the SQL data type `bigint`.
// SQL Server sends nullable `bigint` columns with the data type `IntN` and a data length of 8.
function isBigIntColumn (colMetadata: Tedious_ColumnMetadata) : boolean {
   switch (colMetadata.type.name) {
      case "BigInt": return true;
      case "IntN":   return colMetadata.dataLength == 8;
      default:       return false; }}

// Formats a date/time value. Only the column data types `date` and `time` need a special format.
// Tedious delivers `time` values as a `Date` on 1970-01-01.
function formatDateValue (value: Date, colMetadata: Tedious_ColumnMetadata) : string {
   const isoString = value.toISOString();
   switch (colMetadata.type.name) {
      case "Date": return isoString.substring(0, 10);                          // e.g. "2026-11-16"
      case "Time": return isoString.substring(11, 23);                         // e.g. "12:34:56.789"
      default:     return isoString; }}
