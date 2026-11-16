/**
* This module provides an unbuffered `AsyncZipEntryWriter` and a `BufferedAsyncZipEntryWriter` for writing
* an entry (subfile) into a ZIP archive.
*
* It uses the experimental ZIP API of Node.js (`node:zlib`, since Node.js 26.8).
*
* @internal @module
*/

import * as NodeFsPromises from "node:fs/promises";
import * as NodeZlib from "node:zlib";
import {AsyncPipe} from "./AsyncPipe.ts";
import {type AsyncWriter, type BufferedAsyncWriterOptions, BufferedAsyncWriter} from "./AsyncWriter.ts";

const pipeFifoSize = 4;                                                        // number of byte arrays buffered between write() and the ZIP serializer

//--- Unbuffered ZIP entry writer ----------------------------------------------

/**
* Options for the {@link AsyncZipEntryWriter} constructor.
*/
export interface AsyncZipEntryWriterOptions {

   /**
   * `true` to add the entry to an existing ZIP archive, `false` to replace the archive.
   * In both cases, the archive is created if it does not exist.
   *
   * With `true`, `open()` fails if the archive already contains an entry with the same name.
   *
   * @defaultValue false
   */
   append?:                            boolean;

   /**
   * Options for the ZIP entry, e.g. the compression method or the modification time.
   * They are passed to `zlib.ZipEntry.createStream()`.
   */
   entryOptions?:                      NodeZlib.ZipEntryCreateStreamOptions; }

/**
* An unbuffered writer for byte arrays to an entry (subfile) of a ZIP archive.
*
* The data is compressed and streamed into the ZIP archive while it is written.
* Each writer writes one entry. To write multiple entries, use one writer after the other with the `append` option.
* Use {@link BufferedAsyncZipEntryWriter} for writing many small byte arrays or text lines.
*
* Usage:
* ```js
* await using writer = new AsyncZipEntryWriter("archive.zip", "data.bin", {append: true});
* await writer.open();
* await writer.write(data);
* await writer.close();
* ```
*
* Behavior:
*
* - `open()` creates the ZIP archive if necessary and must be called before `write()`.
* - A byte array must not be modified after it has been passed to `write()`, because it is written asynchronously.
* - Only one operation may be pending at a time. A call before the promise of the previous call has settled
*   is rejected.
* - `close()` completes the entry and closes the ZIP archive.
* - `abort()` stops writing the entry and closes the ZIP archive. The state of the ZIP archive is then undefined.
* - `abort()` is called implicitly at the end of the scope of an `await using` declaration.
*   After `close()`, this has no effect.
*/
export class AsyncZipEntryWriter implements Required<AsyncWriter<Uint8Array>>, AsyncDisposable {

   private zipFilePath:                string;
   private entryName:                  string;
   private append:                     boolean;
   private entryOptions:               NodeZlib.ZipEntryCreateStreamOptions | undefined;
   private pipe:                       AsyncPipe<Uint8Array>;
   private zipFile:                    NodeZlib.ZipFile | undefined;
   private addEntryPromise:            Promise<void> | undefined;              // never rejected, see addEntry()
   private addEntryFailed:             boolean = false;
   private addEntryError:              unknown;
   private openCalled:                 boolean = false;
   private busy:                       boolean = false;
   private closed:                     boolean = false;                        // set by close() and abort()

   /**
   * Creates a ZIP entry writer. The ZIP archive is opened by {@link open}.
   *
   * @param zipFilePath
   *    The path of the ZIP archive.
   * @param entryName
   *    The name of the entry within the ZIP archive.
   * @param options
   *    Optional settings, e.g. whether to add the entry to an existing ZIP archive.
   */
   public constructor (zipFilePath: string, entryName: string, options?: AsyncZipEntryWriterOptions) {
      this.zipFilePath  = zipFilePath;
      this.entryName    = entryName;
      this.append       = options?.append ?? false;
      this.entryOptions = options?.entryOptions;
      this.pipe         = new AsyncPipe<Uint8Array>({fifoSize: pipeFifoSize}); }

   /**
   * Opens the ZIP archive, after creating it if necessary, and starts writing the entry.
   */
   public async open() : Promise<void> {
      if (this.openCalled) {
         throw new Error("AsyncZipEntryWriter: open() called more than once."); }
      this.openCalled = true;
      await createEmptyZipArchive(this.zipFilePath, this.append);
      const zipFile = await NodeZlib.ZipFile.open(this.zipFilePath, {writable: true});
      try {
         if (this.closed) {
            throw new Error("AsyncZipEntryWriter: Closed or aborted while opening."); }
         if (this.append && zipFile.has(this.entryName)) {
            throw new Error(`AsyncZipEntryWriter: The ZIP archive already contains an entry named "${this.entryName}".`); }
         const entry = NodeZlib.ZipEntry.createStream(this.entryName, this.pipe.source, this.entryOptions);
         this.addEntryPromise = this.addEntry(zipFile, entry); }
       catch (error) {
         await zipFile.close();
         throw error; }
      this.zipFile = zipFile; }

   /**
   * Writes a byte array to the ZIP entry.
   *
   * @param data
   *    The bytes to be written. The array must not be modified afterwards.
   */
   public async write (data: Uint8Array) : Promise<void> {
      this.checkNotBusy();
      if (this.closed) {
         throw new Error("AsyncZipEntryWriter: Called after close() or abort()."); }
      if (!this.zipFile) {
         throw new Error("AsyncZipEntryWriter: The ZIP archive has not been opened."); }
      this.busy = true;
      // Future: Once immutable ArrayBuffers are available (TC39 proposal, `ArrayBuffer.prototype.transferToImmutable()`),
      // `data` should be transferred to an immutable buffer here, to enforce that it is not modified after write()
      // without copying it. A copy is still needed as a fallback for non-detachable buffers (e.g. pooled Node.js Buffers).
      try {
         await this.pipe.writer.write(data); }                                 // fails with the error of addEntry() when it has failed
       finally {
         this.busy = false; }}

   /**
   * Completes the ZIP entry and closes the ZIP archive.
   */
   public async close() : Promise<void> {
      if (this.closed) {
         return; }
      this.checkNotBusy();
      this.closed = true;
      const zipFile = this.takeZipFile();
      if (!zipFile) {
         return; }
      try {
         await this.pipe.writer.close();
         await this.addEntryPromise;
         if (this.addEntryFailed) {
            throw this.addEntryError; }}
       finally {
         await zipFile.close(); }}

   /**
   * Stops writing the ZIP entry and closes the ZIP archive. The state of the ZIP archive is then undefined.
   *
   * @param error
   *    The error that caused the abort.
   */
   public async abort (error?: unknown) : Promise<void> {
      if (this.closed) {
         return; }
      this.closed = true;
      const zipFile = this.takeZipFile();
      if (!zipFile) {
         return; }
      try {
         await this.pipe.writer.abort(error ?? new Error("AsyncZipEntryWriter: Aborted."));
         await this.addEntryPromise; }                                         // addEntry() fails with the abort error, which is ignored
       finally {
         await zipFile.close(); }}

   /**
   * Aborts the writer, unless it has already been closed.
   * Called implicitly at the end of the scope of an `await using` declaration.
   */
   public [Symbol.asyncDispose]() : Promise<void> {
      return this.abort(); }

   // Writes the entry into the ZIP archive. An error is stored instead of being thrown,
   // so that the returned promise is never rejected.
   // After an error (e.g. a disk error), zipFile.addEntry() no longer reads from the pipe. Aborting the pipe
   // prevents that a pending write() waits forever, and lets write() fail with the error of zipFile.addEntry().
   private async addEntry (zipFile: NodeZlib.ZipFile, entry: NodeZlib.ZipEntry) : Promise<void> {
      try {
         await zipFile.addEntry(entry); }
       catch (error) {
         this.addEntryFailed = true;
         this.addEntryError = error;
         this.pipe.abort(error); }}

   private checkNotBusy() {
      if (this.busy) {
         throw new Error("AsyncZipEntryWriter: Called while a previous operation is still pending."); }}

   private takeZipFile() : NodeZlib.ZipFile | undefined {
      const zipFile = this.zipFile;
      this.zipFile = undefined;
      return zipFile; }}

// Creates a ZIP archive without entries. With `ifMissing`, an existing file is left unchanged.
async function createEmptyZipArchive (filePath: string, ifMissing: boolean) : Promise<void> {
   try {
      await NodeFsPromises.writeFile(filePath, NodeZlib.createZipArchive([]), {flag: ifMissing ? "wx" : "w"}); }
    catch (error) {
      if (ifMissing && (error as NodeJS.ErrnoException).code === "EEXIST") {
         return; }
      throw error; }}

//--- Buffered ZIP entry writer ------------------------------------------------

/**
* Options for the {@link BufferedAsyncZipEntryWriter} constructor.
*/
export interface BufferedAsyncZipEntryWriterOptions extends AsyncZipEntryWriterOptions, BufferedAsyncWriterOptions {}

/**
* A buffered writer for byte arrays and text lines to an entry (subfile) of a ZIP archive.
*
* This is a {@link BufferedAsyncWriter} with an {@link AsyncZipEntryWriter} as the underlying writer.
*
* Usage:
* ```js
* await using writer = new BufferedAsyncZipEntryWriter("archive.zip", "data.jsonl");
* await writer.open();
* await writer.writeJsonLine({id: 1, name: "abc"});
* await writer.close();
* ```
*
* `open()` must be called before writing. `abort()` is called implicitly at the end of the scope of an
* `await using` declaration. After `close()`, this has no effect.
*/
export class BufferedAsyncZipEntryWriter extends BufferedAsyncWriter {

   private zipEntryWriter:             AsyncZipEntryWriter;

   /**
   * Creates a buffered ZIP entry writer. The ZIP archive is opened by {@link open}.
   *
   * @param zipFilePath
   *    The path of the ZIP archive.
   * @param entryName
   *    The name of the entry within the ZIP archive.
   * @param options
   *    Optional settings, e.g. whether to add the entry to an existing ZIP archive, or the block size.
   */
   public constructor (zipFilePath: string, entryName: string, options?: BufferedAsyncZipEntryWriterOptions) {
      const zipEntryWriter = new AsyncZipEntryWriter(zipFilePath, entryName, options);
      super(zipEntryWriter, options);
      this.zipEntryWriter = zipEntryWriter; }

   /**
   * Opens the ZIP archive, after creating it if necessary, and starts writing the entry.
   */
   public open() : Promise<void> {
      return this.zipEntryWriter.open(); }}
