/**
* Controller for the export of tabular database data.
*
* @internal @module
*/

import {type AsyncWriter, BufferedAsyncWriter} from "../io/AsyncWriter.ts";
import {type Tedious_ColumnMetadata} from "../utils/TediousFixes.ts";
import {type ArrayRow, type ArrayRowMetadata} from "../utils/TediousUtils.ts";

/**
* Options for the {@link ExportController} constructor.
*/
export interface ExportControllerOptions {

   /**
   * The rows to be exported, as arrays of column values.
   */
   rowSource:                          AsyncIterable<ArrayRow>;

   /**
   * The metadata of all columns of the rows.
   */
   metadata:                           ArrayRowMetadata;

   /**
   * The indexes of the columns to be exported, in the output order.
   * By default, all columns are exported in their original order.
   */
   columnSelection?:                   number[];

   /**
   * The writer for the output. It is not closed by the controller.
   */
   outputFile:                         AsyncWriter<Uint8Array>;

   /**
   * Creates a header line from the metadata of the selected columns. Without this function,
   * no header line is written.
   */
   headerGenerator?:                   (metadata: ArrayRowMetadata) => string;

   /**
   * Converts a column value before the row is passed to `rowWriter`.
   */
   valueShaper?:                       (value: any, colMetadata: Tedious_ColumnMetadata) => any;

   /**
   * Writes a row, with the selected and converted column values, to the output.
   */
   rowWriter:                          (row: ArrayRow, metadata: ArrayRowMetadata, out: BufferedAsyncWriter) => Promise<void>; }

/**
* Controls the export of rows of tabular data into an output file.
*
* This is the format-independent part of the export. The format-specific functions are passed with the options.
* Applications normally use `ConnectionPlus.exportQuery()` instead of this class.
*/
export class ExportController {

   private options:                    ExportControllerOptions;
   private _rowCount:                  number = 0;

   /**
   * Creates an export controller.
   *
   * @param options
   *    The row source, the output and the format-specific functions.
   */
   public constructor (options: ExportControllerOptions) {
      this.options = options; }

   /**
   * Returns the number of rows that have been exported so far.
   *
   * This value is intended for a progress indicator when large tables are exported interactively.
   * Support for a progress indicator will be added in a future version.
   */
   public get rowCount() : number {
      return this._rowCount; }

   /**
   * Writes the header line, if any, and all rows to the output.
   * At the end, the buffered output is flushed, but the output is not closed.
   */
   public async exportData() : Promise<void> {
      const options = this.options;
      const columnSelection = options.columnSelection;
      const valueShaper = options.valueShaper;
      const metadataSel = selectColumnMetadata(options.metadata, columnSelection);
      const out = new BufferedAsyncWriter(options.outputFile);
      if (options.headerGenerator) {
         const header = options.headerGenerator(metadataSel);
         await out.writeLine(header); }
      for await (const row of options.rowSource) {
         this._rowCount++;
         const rowValues1 = columnSelection ? columnSelection.map(i => row[i]) : row;
         const rowValues2 = valueShaper ? rowValues1.map((e, i) => valueShaper(e, metadataSel[i])) : rowValues1;
         await options.rowWriter(rowValues2, metadataSel, out); }
      await out.flush(); }}

/**
* Returns the metadata of the selected columns, or all metadata if there is no column selection.
*
* @internal
*/
export function selectColumnMetadata (metadata: ArrayRowMetadata, columnSelection: number[] | undefined) : ArrayRowMetadata {
   if (!columnSelection) {
      return metadata; }
   return columnSelection.map(i => metadata[i]); }
