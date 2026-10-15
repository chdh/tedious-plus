/**
* This module provides temporary workarounds for problems with the current Tedious API.
*
* @internal @module
*/

import * as Tedious from "tedious";

// Temporary solution for as long as the Tedious package does not export these
// types in an ordinary manner:
import {type Column as Tedious_Column} from "tedious/lib/token/row-token-parser.js";
import {type ColumnMetadata as Tedious_ColumnMetadata} from "tedious/lib/token/colmetadata-token-parser.js";
type Tedious_RowData = Tedious_Column[] | Record<string, Tedious_Column>;
   // type variant depending on config.options.useColumnNames
type Tedious_ColumnMetadataDef = Tedious_ColumnMetadata[] | Record<string, Tedious_ColumnMetadata>;
   // type variant depending on config.options.useColumnNames
export {Tedious_Column, Tedious_ColumnMetadata, Tedious_RowData, Tedious_ColumnMetadataDef};

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
