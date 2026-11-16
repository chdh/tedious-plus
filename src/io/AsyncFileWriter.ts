/**
* This module provides an unbuffered `AsyncFileWriter` and a `BufferedAsyncFileWriter` for writing files.
*
* @internal @module
*/

import * as NodeFsPromises from "node:fs/promises";
import {assert} from "../utils/Utils.ts";
import {type AsyncWriter, type BufferedAsyncWriterOptions, BufferedAsyncWriter} from "./AsyncWriter.ts";

//--- Unbuffered file writer ---------------------------------------------------

/**
* Options for the {@link AsyncFileWriter} constructor.
*/
export interface AsyncFileWriterOptions {

   /**
   * `true` to append to an existing file, `false` to replace it.
   * In both cases, the file is created if it does not exist.
   *
   * @defaultValue false
   */
   append?:                            boolean;

   /**
   * `true` to flush the file content to the storage device (`fsync`) when the writer is closed.
   *
   * @defaultValue false
   */
   syncOnClose?:                       boolean; }

/**
* An unbuffered writer for byte arrays to a file.
*
* Each byte array is written to the file directly. Use {@link BufferedAsyncFileWriter} for writing
* many small byte arrays or text lines.
*
* Usage:
* ```js
* await using writer = new AsyncFileWriter("data.bin");
* await writer.open();
* await writer.write(data);
* await writer.close();
* ```
*
* Behavior:
*
* - `open()` must be called before `write()`.
* - Only one operation may be pending at a time. A call before the promise of the previous call has settled
*   is rejected.
* - `close()` and `abort()` close the file. A partially written file is not deleted by `abort()`.
* - `abort()` is called implicitly at the end of the scope of an `await using` declaration.
*   After `close()`, this has no effect.
*/
export class AsyncFileWriter implements Required<AsyncWriter<Uint8Array>>, AsyncDisposable {

   private filePath:                   string;
   private append:                     boolean;
   private syncOnClose:                boolean;
   private fileHandle:                 NodeFsPromises.FileHandle | undefined;
   private openCalled:                 boolean = false;
   private busy:                       boolean = false;
   private closed:                     boolean = false;                        // set by close() and abort()

   /**
   * Creates a file writer. The file is opened by {@link open}.
   *
   * @param filePath
   *    The path of the file to be written.
   * @param options
   *    Optional settings, e.g. whether to append to an existing file.
   */
   public constructor (filePath: string, options?: AsyncFileWriterOptions) {
      this.filePath    = filePath;
      this.append      = options?.append ?? false;
      this.syncOnClose = options?.syncOnClose ?? false; }

   /**
   * Opens the file.
   */
   public async open() : Promise<void> {
      if (this.openCalled) {
         throw new Error("AsyncFileWriter: open() called more than once."); }
      this.openCalled = true;
      const fileHandle = await NodeFsPromises.open(this.filePath, this.append ? "a" : "w");
      if (this.closed) {                                                       // close() or abort() has been called while opening
         await fileHandle.close();
         throw new Error("AsyncFileWriter: Closed or aborted while opening."); }
      this.fileHandle = fileHandle; }

   /**
   * Writes a byte array to the file.
   *
   * @param data
   *    The bytes to be written.
   */
   public async write (data: Uint8Array) : Promise<void> {
      this.checkNotBusy();
      if (this.closed) {
         throw new Error("AsyncFileWriter: Called after close() or abort()."); }
      if (!this.fileHandle) {
         throw new Error("AsyncFileWriter: The file has not been opened."); }
      this.busy = true;
      try {
         await writeAll(this.fileHandle, data); }
       finally {
         this.busy = false; }}

   /**
   * Closes the file.
   * With the `syncOnClose` option, the file content is first flushed to the storage device.
   */
   public async close() : Promise<void> {
      if (this.closed) {
         return; }
      this.checkNotBusy();
      this.closed = true;
      const fileHandle = this.takeFileHandle();
      if (!fileHandle) {
         return; }
      try {
         if (this.syncOnClose) {
            await fileHandle.sync(); }}
       finally {
         await fileHandle.close(); }}

   /**
   * Closes the file without completing the writing.
   *
   * @param _error
   *    The error that caused the abort. Not used by this writer.
   */
   public async abort (_error?: unknown) : Promise<void> {
      if (this.closed) {
         return; }
      this.closed = true;
      await this.takeFileHandle()?.close(); }

   /**
   * Aborts the writer, unless it has already been closed.
   * Called implicitly at the end of the scope of an `await using` declaration.
   */
   public [Symbol.asyncDispose]() : Promise<void> {
      return this.abort(); }

   private checkNotBusy() {
      if (this.busy) {
         throw new Error("AsyncFileWriter: Called while a previous operation is still pending."); }}

   private takeFileHandle() : NodeFsPromises.FileHandle | undefined {
      const fileHandle = this.fileHandle;
      this.fileHandle = undefined;
      return fileHandle; }}

// Writes all bytes of a byte array. FileHandle.write() may write only a part of the bytes.
async function writeAll (fileHandle: NodeFsPromises.FileHandle, data: Uint8Array) : Promise<void> {
   let offset = 0;
   while (offset < data.length) {
      const result = await fileHandle.write(data, offset, data.length - offset);
      assert(result.bytesWritten > 0, "AsyncFileWriter: No bytes written.");
      offset += result.bytesWritten; }}

//--- Buffered file writer -----------------------------------------------------

/**
* Options for the {@link BufferedAsyncFileWriter} constructor.
*/
export interface BufferedAsyncFileWriterOptions extends AsyncFileWriterOptions, BufferedAsyncWriterOptions {}

/**
* A buffered writer for byte arrays and text lines to a file.
*
* This is a {@link BufferedAsyncWriter} with an {@link AsyncFileWriter} as the underlying writer.
*
* Usage:
* ```js
* await using writer = new BufferedAsyncFileWriter("data.jsonl");
* await writer.open();
* await writer.writeJsonLine({id: 1, name: "abc"});
* await writer.close();
* ```
*
* `open()` must be called before writing. `abort()` is called implicitly at the end of the scope of an
* `await using` declaration. After `close()`, this has no effect.
*/
export class BufferedAsyncFileWriter extends BufferedAsyncWriter {

   private fileWriter:                 AsyncFileWriter;

   /**
   * Creates a buffered file writer. The file is opened by {@link open}.
   *
   * @param filePath
   *    The path of the file to be written.
   * @param options
   *    Optional settings, e.g. whether to append to an existing file, or the block size.
   */
   public constructor (filePath: string, options?: BufferedAsyncFileWriterOptions) {
      const fileWriter = new AsyncFileWriter(filePath, options);
      super(fileWriter, options);
      this.fileWriter = fileWriter; }

   /**
   * Opens the file.
   */
   public open() : Promise<void> {
      return this.fileWriter.open(); }}
