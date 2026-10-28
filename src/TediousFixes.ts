/**
* This module provides temporary workarounds for problems with the current Tedious API.
*
* @internal @module
*/

import * as Tedious from "tedious";
import {createBareObject} from "./Utils.ts";

// Temporary solution for as long as the Tedious package does not export these
// types in an ordinary manner:
import {type Column as Tedious_Column} from "tedious/lib/token/row-token-parser.js";
import {type ColumnMetadata as Tedious_ColumnMetadata} from "tedious/lib/token/colmetadata-token-parser.js";
export type {Tedious_Column, Tedious_ColumnMetadata};
export type Tedious_ArrayRow = Tedious_Column[];
export type Tedious_ObjectRow = Record<string, Tedious_Column>;
export type Tedious_ComboRow = Tedious_ArrayRow & Tedious_ObjectRow;
   // The actual Type at runtime depends on config.options.useColumnNames.
export type Tedious_ArrayRowMetadata = Tedious_ColumnMetadata[];
export type Tedious_ObjectRowMetadata = Record<string, Tedious_ColumnMetadata>;
export type Tedious_ComboRowMetadata = Tedious_ArrayRowMetadata & Tedious_ObjectRowMetadata;
   // The actual Type at runtime depends on config.options.useColumnNames.
/**
* The type of a Tedious data type object, e.g. `Tedious.TYPES.Int`.
*/
export type Tedious_DataType = typeof Tedious.TYPES.Bit;

// The current Tedious implementation does not pass the `error` and `rowCount` values to the `requestCompleted` event.
// In some cases (e.g. EINVALIDSTATE, ECLOSE, socket errors) the error is only passed to the completion callback
// of the request and not stored in `request.error`.
// Therefore the completion callback of the request is intercepted for the duration of one execution.
// Hopefully the PR #1820 will fix that. See https://github.com/tediousjs/tedious/pull/1820
export type RequestCompletionHandler = (error: Error | null | undefined, rowCount?: number, rows?: any) => void;
export function interceptRequestCompletion (request: Tedious.Request, handler: RequestCompletionHandler) {
   const originalCallback = request.userCallback;                              // (warning: `userCallback` is an internal field)
   request.userCallback = interceptedCallback;
   function interceptedCallback (error: Error | null | undefined, rowCount?: number, rows?: any) {
      request.userCallback = originalCallback;
         // The original callback is restored first, so that the request can be re-executed from within a callback.
      try {
         handler(error, rowCount, rows); }
       finally {
         originalCallback.call(request, error, rowCount, rows); }}}

// Returns `true` if the request is currently being executed on a connection.
// Returns `false` if the request has not yet been executed or if its execution has already completed.
// Tedious sets `connection.request` when the request is sent and clears it before the completion callback is called.
export function isRequestActive (request: Tedious.Request) : boolean {
   const connection = request.connection;
   return !!connection && connection.request === request; }                    // (warning: `request` is an internal field)

// Currently the callback argument of the `Request` constructor is not optional.
// This dummy function is used where the parameter is required.
// Hopefully the PR #1820 will fix that. See https://github.com/tediousjs/tedious/pull/1820
export function dummyCallback() {}

// Verifies that the connection options are compatible with this package.
// Returns an error message, or `undefined` otherwise.
export function checkConnectionOptions (connection: Tedious.Connection | undefined) : string | undefined {
   const options = connection?.config?.options;
   if (!options) {
      return undefined; }
   if (options.useColumnNames) {
      return "The Tedious connection option useColumnNames is not compatible with this package."; }
   if (options.rowCollectionOnDone) {
      return "The Tedious connection option rowCollectionOnDone is not compatible with this package."; }
   if (options.rowCollectionOnRequestCompletion) {
      return "The Tedious connection option rowCollectionOnRequestCompletion is not compatible with this package."; }
   return undefined; }

// This is a copy of the function `toColumnsMap()` in Tedious/src/token/row-token-parser.ts.
// It converts a `Tedious_ArrayRow` into a `Tedious_ObjectRow`.
export function convertTediousArrayRowToTediousObjectRow (arrayRow: Tedious_ArrayRow) : Tedious_ObjectRow {
   const columnsMap: Tedious_ObjectRow = createBareObject();
   for (const column of arrayRow) {
      columnsMap[column.metadata.colName] ??= column; }
   return columnsMap; }

// This is a copy of a code sequence in Tedious/src/token/handler.ts in function `onColMetadata()`.
// It converts a `Tedious_ArrayRowMetadata` into a `Tedious_ObjectRowMetadata`.
export function convertArrayRowMetadataToObjectRowMetadata (arrayRowMetadata: Tedious_ArrayRowMetadata) : Tedious_ObjectRowMetadata {
   const obj: Tedious_ObjectRowMetadata = createBareObject();
   for (const col of arrayRowMetadata) {
      obj[col.colName] ??= col; }
   return obj; }
