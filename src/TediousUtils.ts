/**
* Tedious-specific utilities.
*
* @module
*/

import {Tedious_Column, Tedious_ColumnMetadata} from "./TediousFixes.ts";

/**
* An array of column values for a data row.
*
* The values are in the same order as the columns of the result set (see {@link RowMetadata}).
* They are the JavaScript values converted by Tedious, e.g. `number`, `string`, `boolean`, etc.
*/
export type RowValues = unknown[];

/**
* The column metadata of a result set row, with one entry per column.
*
* This is the metadata array that Tedious provides with the `columnMetadata` event of a `Request`.
*/
export type RowMetadata = Tedious_ColumnMetadata[];

/** @internal */
export function extractRowColumnValues (columns: Tedious_Column[]) : RowValues {
   return columns.map(e => e.value); }
