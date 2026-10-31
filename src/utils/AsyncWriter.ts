/**
* This module provides an `AsyncWriter` interface for procedural writing of a sequence of values,
* and a `BufferedAsyncWriter` for writing bytes and text lines in blocks.
*
* @module
*/

import {assert} from "./Utils.ts";

//--- Interface ----------------------------------------------------------------

/**
* Basic functionality of an async writer, for procedural output of a sequence of values.
*/
export interface AsyncWriter<T> {

   /**
   * Writes the next value.
   *
   * `write()` must not be called again before the promise of the previous call has settled.
   * It must not be called after `close()` or `abort()`.
   *
   * @param value
   *    The value to be written.
   * @returns
   *    A promise that is resolved when the value has been accepted by the writer.
   *    The promise is rejected if the value cannot be written.
   */
   write (value: T) : Promise<void>;

   /**
   * Completes the writing and releases the resources of the writer.
   *
   * Values that have been accepted by `write()` but not yet written are written before the promise
   * is resolved.
   *
   * Must be idempotent: it may be called multiple times, and also after `write()` has failed or after
   * `abort()`. In these cases it must succeed without further effect, apart from releasing resources
   * that have not yet been released.
   *
   * @returns
   *    A promise that is resolved when all values have been written and the resources have been released.
   *    The promise is rejected if the remaining values cannot be written.
   */
   close() : Promise<void>;

   /**
   * Terminates the writing without completing it and releases the resources of the writer.
   *
   * Values that have been accepted by `write()` but not yet written are discarded.
   *
   * Must be idempotent: it may be called multiple times, and also after `write()` has failed or after
   * `close()`. In these cases it must succeed without further effect, apart from releasing resources
   * that have not yet been released.
   *
   * Optional, for writers that do not support aborting.
   *
   * @param error
   *    The error that caused the abort. Can be passed on by the writer to the underlying target.
   */
   abort? (error?: unknown) : Promise<void>; }

//--- Buffered writer ----------------------------------------------------------

/**
* Options for the {@link BufferedAsyncWriter} constructor.
*/
export interface BufferedAsyncWriterOptions {

   /**
   * The size of the blocks that are passed to the underlying writer, in bytes.
   *
   * Byte arrays of at least half this size are passed to the underlying writer directly,
   * without copying them into a block.
   *
   * @defaultValue 65536
   */
   blockSize?:                         number;

   /**
   * The line terminator that is appended by `writeLine()` and `writeJsonLine()`.
   *
   * @defaultValue "\n"
   */
   eol?:                               string; }

const textEncoder = new TextEncoder();

/**
* A buffering wrapper for an `AsyncWriter<Uint8Array>`.
*
* Small byte arrays and text lines are collected in blocks, which are passed to the underlying writer
* when they are full. Text is encoded as UTF-8 directly into the blocks.
*
* Usage:
* ```js
* const writer = new BufferedAsyncWriter(byteWriter);
* await writer.writeLine("Hello");
* await writer.writeJsonLine({id: 1, name: "abc"});
* await writer.close();
* ```
*
* Behavior:
*
* - A byte array of at least half the block size is passed to the underlying writer directly, after the
*   content of the current block. It must therefore not be modified after it has been passed to `write()`.
* - Only one operation may be pending at a time. A call before the promise of the previous call has settled
*   is rejected.
* - `close()` sends the remaining buffered bytes and closes the underlying writer.
* - `abort()` discards the buffered bytes and aborts the underlying writer. If the underlying writer does not
*   support `abort()`, it is closed instead.
*/
export class BufferedAsyncWriter implements Required<AsyncWriter<Uint8Array>> {

   private writer:                     AsyncWriter<Uint8Array>;
   private blockSize:                  number;
   private largeDataSize:              number;                                 // byte arrays of this size or larger are not copied into a block
   private eol:                        string;
   private block:                      Uint8Array | undefined;                 // allocated when needed
   private used:                       number = 0;                             // number of bytes used in the current block
   private busy:                       boolean = false;
   private closed:                     boolean = false;
   private aborted:                    boolean = false;

   /**
   * Creates a buffered writer.
   *
   * @param writer
   *    The underlying writer to which the blocks are passed.
   * @param options
   *    Optional settings, e.g. the block size.
   */
   public constructor (writer: AsyncWriter<Uint8Array>, options?: BufferedAsyncWriterOptions) {
      this.writer = writer;
      this.blockSize = options?.blockSize ?? 64 * 1024;
      assert(Number.isInteger(this.blockSize) && this.blockSize >= 16, "The blockSize option must be an integer >= 16.");
         // The minimum size guarantees that a UTF-8 encoded character always fits into an empty block.
      this.largeDataSize = Math.ceil(this.blockSize / 2);
      this.eol = options?.eol ?? "\n"; }

   /**
   * Writes a byte array.
   *
   * @param data
   *    The bytes to be written.
   */
   public write (data: Uint8Array) : Promise<void> {
      return this.runOperation(() => this.writeData(data)); }

   /**
   * Writes a text line, encoded as UTF-8, followed by the line terminator.
   *
   * @param text
   *    The text of the line, without the line terminator.
   */
   public writeLine (text: string) : Promise<void> {
      return this.runOperation(() => this.encodeLine(text)); }

   /**
   * Writes a value as a JSON line, e.g. for the JSON Lines format.
   *
   * @param value
   *    The value to be written. It is converted with `JSON.stringify()`.
   */
   public writeJsonLine (value: unknown) : Promise<void> {
      return this.runOperation(() => {
         const json: string | undefined = JSON.stringify(value);
         if (json === undefined) {
            throw new Error("BufferedAsyncWriter: The value cannot be converted to JSON."); }
         return this.encodeLine(json); }); }

   /**
   * Passes the buffered bytes to the underlying writer without waiting until the current block is full.
   */
   public flush() : Promise<void> {
      return this.runOperation(() => this.sendBlock()); }

   /**
   * Sends the remaining buffered bytes and closes the underlying writer.
   */
   public async close() : Promise<void> {
      if (this.closed || this.aborted) {
         return; }
      this.checkNotBusy();
      this.closed = true;
      try {
         await this.sendBlock(); }
       finally {
         await this.writer.close(); }}

   /**
   * Discards the buffered bytes and aborts the underlying writer.
   * If the underlying writer does not support `abort()`, it is closed instead.
   *
   * @param error
   *    The error that caused the abort. It is passed on to the underlying writer.
   */
   public async abort (error?: unknown) : Promise<void> {
      if (this.closed || this.aborted) {
         return; }
      this.aborted = true;
      this.block = undefined;
      this.used = 0;
      if (this.writer.abort) {
         await this.writer.abort(error); }
       else {
         await this.writer.close(); }}

   // Runs a write operation. Concurrent operations and operations after close() or abort() are rejected.
   private async runOperation (operation: () => Promise<void>) : Promise<void> {
      this.checkNotBusy();
      if (this.closed || this.aborted) {
         throw new Error("BufferedAsyncWriter: Called after close() or abort()."); }
      this.busy = true;
      try {
         await operation(); }
       finally {
         this.busy = false; }}

   private checkNotBusy() {
      if (this.busy) {
         throw new Error("BufferedAsyncWriter: Called while a previous operation is still pending."); }}

   private async writeData (data: Uint8Array) : Promise<void> {
      if (data.length >= this.largeDataSize) {
         await this.sendBlock();
         await this.send(data);
         return; }
      const block = this.getBlock();
      const n = Math.min(data.length, block.length - this.used);
      block.set(data.subarray(0, n), this.used);
      this.used += n;
      if (this.used < block.length) {
         return; }
      await this.sendBlock();
      if (n < data.length) {                                                   // the rest fits into the new block, because data is smaller than half a block
         this.getBlock().set(data.subarray(n));
         this.used = data.length - n; }}

   private async encodeLine (text: string) : Promise<void> {
      await this.encodeString(text);
      await this.encodeString(this.eol); }

   // Encodes a string as UTF-8 into the current block. Full blocks are sent to the underlying writer.
   private async encodeString (s: string) : Promise<void> {
      let rest = s;
      while (true) {
         const block = this.getBlock();
         const result = textEncoder.encodeInto(rest, block.subarray(this.used));
         this.used += result.written;
         if (result.read >= rest.length) {
            return; }
         rest = rest.substring(result.read);
         await this.sendBlock(); }}

   private getBlock() : Uint8Array {
      this.block ??= new Uint8Array(this.blockSize);
      return this.block; }

   // Passes the used part of the current block to the underlying writer.
   // A new block is allocated when needed, because the underlying writer may keep a reference to the old one.
   private async sendBlock() : Promise<void> {
      if (!this.used) {
         return; }
      const block = this.block!;
      const used = this.used;
      this.block = undefined;
      this.used = 0;
      await this.send(used < block.length ? block.subarray(0, used) : block); }

   // The check after the write stops a pending operation when abort() has been called in the meantime.
   private async send (data: Uint8Array) : Promise<void> {
      await this.writer.write(data);
      if (this.aborted) {
         throw new Error("BufferedAsyncWriter: Aborted."); }}}
