/**
* Main module for database data export. It provides the export options and the main export function.
*
* @module
*/

import {isRowversion} from "../utils/TediousFixes.ts";
import {type ArrayRow, type ArrayRowMetadata} from "../utils/TediousUtils.ts";
import {type AsyncWriter} from "../io/AsyncWriter.ts";
import {AsyncFileWriter} from "../io/AsyncFileWriter.ts";
import {AsyncZipEntryWriter} from "../io/AsyncZipEntryWriter.ts";
import * as ExportJson from "./ExportJson.ts";
import {type ExportControllerOptions, ExportController, selectColumnMetadata} from "./ExportController.ts";

/**
* Options for the selection and the order of the exported columns.
*/
export interface ExportColumnsOptions {

   /**
   * `true` to order the columns by name (case-insensitive), `false` to keep the order of the result set.
   *
   * @defaultValue false
   */
   orderByName?:                       boolean;

   /**
   * `true` to omit columns with the data type `rowversion`.
   *
   * @defaultValue false
   */
   omitRowversion?:                    boolean; }

/**
* Options for the JSON Lines format (JSONL), with one JSON value per line.
*
* The column values are converted as follows:
*
* | SQL data type                                              | JSON value                                       |
* | ---------------------------------------------------------- | ------------------------------------------------ |
* | `NULL`                                                     | `null`                                           |
* | `bit`                                                      | `true` or `false`                                |
* | Numeric types, except `bigint`                             | Number, e.g. `123.45`                            |
* | `bigint`                                                   | Object, e.g. `{"$bigint": "9007199254740993"}`   |
* | String types, `uniqueidentifier`, `xml`                    | String                                           |
* | `date`                                                     | String, e.g. `"2026-11-16"`                      |
* | `time`                                                     | String, e.g. `"12:34:56.789"`                    |
* | `datetime`, `smalldatetime`, `datetime2`, `datetimeoffset` | String in UTC, e.g. `"2026-11-16T12:34:56.789Z"` |
* | Binary types, `rowversion`                                 | String with hex digits, e.g. `"0102abff"`        |
*
* Time values have a precision of milliseconds. `decimal` and `numeric` values are converted to JavaScript
* numbers by Tedious and may therefore lose precision.
*/
export interface ExportFormatTypeJsonlOptions {

   /**
   * The format type.
   */
   type:                               "jsonl";

   /**
   * The shape of the rows.
   *
   * - `"object"`: Each row is written as a JSON object, e.g. `{"id": 1, "name": "abc"}`.
   *   The column names must be unique.
   * - `"array"`: Each row is written as a JSON array, e.g. `[1, "abc"]`. The first line contains
   *   the column names, e.g. `["id", "name"]`.
   *
   * @defaultValue "object"
   */
   rowShape?:                          "object" | "array"; }

/**
* Options for the export format.
*/
export type ExportFormatOptions = ExportFormatTypeJsonlOptions;

/**
* Options for exporting into a file. An existing file is replaced.
*/
export interface ExportOutputTypeFileOptions {

   /**
   * The output type.
   */
   type:                               "file";

   /**
   * The path of the output file.
   */
   path:                               string; }

/**
* Options for exporting into an entry (subfile) of a ZIP archive.
*
* This uses the experimental ZIP API of Node.js.
*/
export interface ExportOutputTypeZipOptions {

   /**
   * The output type.
   */
   type:                               "zip";

   /**
   * The path of the ZIP archive.
   */
   zipPath:                            string;

   /**
   * The name of the entry within the ZIP archive.
   */
   entryName:                          string;

   /**
   * What to do when the ZIP archive already exists.
   *
   * - `"replaceArchive"`: The whole ZIP archive is replaced by a new archive with only this entry.
   * - `"addEntry"`: The entry is added to the existing ZIP archive. The export fails if the archive already
   *   contains an entry with the same name.
   *
   * In both cases, the ZIP archive is created if it does not exist.
   *
   * @defaultValue "replaceArchive"
   */
   ifExists?:                          "replaceArchive" | "addEntry"; }

/**
* Options for the export output.
*/
export type ExportOutputOptions = ExportOutputTypeFileOptions | ExportOutputTypeZipOptions;

/**
* Options for the export.
*/
export interface ExportOptions {

   /**
   * Options for the selection and the order of the exported columns.
   * By default, all columns are exported in the order of the result set.
   */
   columns?:                           ExportColumnsOptions;

   /**
   * The export format.
   *
   * @defaultValue `{type: "jsonl"}`
   */
   format?:                            ExportFormatOptions;

   /**
   * The output file.
   */
   output:                             ExportOutputOptions; }

function createColumnSelection (metadata: ArrayRowMetadata, options?: ExportColumnsOptions) : number[] | undefined {
   if (!options?.orderByName && !options?.omitRowversion) {
      return undefined; }
   let sel = metadata.map((_, i) => i);
   if (options?.omitRowversion) {
      sel = sel.filter(i => !isRowversion(metadata[i])); }
   if (options?.orderByName) {
      const collator = new Intl.Collator('en', {sensitivity: 'base'});
      sel.sort((a, b) => collator.compare(metadata[a].colName, metadata[b].colName)); }
   return sel; }

class OutputFileController {
   private fileWriter?:                AsyncFileWriter;
   private zipEntryWriter?:            AsyncZipEntryWriter;

   public get outputFile() : AsyncWriter<Uint8Array> {
      return (this.fileWriter ?? this.zipEntryWriter)!; }

   public async open (options: ExportOutputOptions) : Promise<void> {
      switch (options.type) {
         case "file": {
            this.fileWriter = new AsyncFileWriter(options.path);
            await this.fileWriter.open();
            break; }
         case "zip": {
            let append: boolean;
            switch (options.ifExists ?? "replaceArchive") {
               case "replaceArchive": {
                  append = false;
                  break; }
               case "addEntry": {
                  append = true;
                  break; }
               default: {
                  throw new Error("Undefined export zip ifExists option."); }}
            this.zipEntryWriter = new AsyncZipEntryWriter(options.zipPath, options.entryName, {append});
            await this.zipEntryWriter.open();
            break; }
         default: {
            throw new Error("Undefined export output type."); }}}

   public async close() : Promise<void> {
      await this.fileWriter?.close();
      await this.zipEntryWriter?.close(); }

   public async abort (error?: unknown) : Promise<void> {
      await this.fileWriter?.abort(error);
      await this.zipEntryWriter?.abort(error); }}

// The format-specific functions of the export controller.
type ExportFormatHandlers = Pick<ExportControllerOptions, "headerGenerator" | "valueShaper" | "rowWriter">;

function createJsonlFormatHandlers (options: ExportFormatTypeJsonlOptions | undefined, metadata: ArrayRowMetadata) : ExportFormatHandlers {
   const valueShaper = ExportJson.jsonValueShaper;
   switch (options?.rowShape ?? "object") {
      case "object": {
         ExportJson.checkUniqueColumnNames(metadata);
         return {valueShaper, rowWriter: ExportJson.jsonObjectRowWriter}; }
      case "array": {
         return {valueShaper, headerGenerator: ExportJson.jsonArrayHeaderGenerator, rowWriter: ExportJson.jsonArrayRowWriter}; }
      default: {
         throw new Error("Undefined export JSONL rowShape."); }}}

// Creates the format-specific functions and verifies that the metadata of the selected columns is compatible with the format.
function createFormatHandlers (options: ExportFormatOptions | undefined, metadata: ArrayRowMetadata) : ExportFormatHandlers {
   switch (options?.type ?? "jsonl") {
      case "jsonl": {
         return createJsonlFormatHandlers(options, metadata); }
      default: {
         throw new Error("Undefined export format type."); }}}

/**
* Exports rows of tabular data, e.g. the result rows of a query, into a file.
*
* This is the function used by `ConnectionPlus.exportQuery()`. It can be used directly to export rows
* from another source. When the export fails, the state of the output file is undefined.
*
* @param rowSource
*    The rows to be exported, as arrays of column values.
* @param metadata
*    The metadata of the columns.
* @param options
*    The output file and optional settings for the columns and the format.
* @returns
*    A promise for the number of rows exported.
*/
export async function exportRows (rowSource: AsyncIterable<ArrayRow>, metadata: ArrayRowMetadata, options: ExportOptions) : Promise<number> {
   const columnSelection = createColumnSelection(metadata, options.columns);
   const selectedMetadata = selectColumnMetadata(metadata, columnSelection);
   const formatHandlers = createFormatHandlers(options.format, selectedMetadata);
   const out = new OutputFileController();
   try {
      await out.open(options.output);
      const controller = new ExportController({rowSource, metadata, columnSelection, outputFile: out.outputFile, ...formatHandlers});
      await controller.exportData();
      await out.close();
      return controller.rowCount; }
    catch (error) {
      try {
         await out.abort(error); }
       catch {
         /* The original error takes precedence over an error of abort(). */ }
      throw error; }}
