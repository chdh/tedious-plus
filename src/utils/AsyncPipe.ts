/**
* This module provides an `AsyncPipe`, a buffered connection between an async writer and an async reader.
*
* @module
*/

import {assert} from "./Utils.ts";
import type {AsyncWriter} from "./AsyncWriter.ts";
import {type AsyncReader, AsyncReaderIterator} from "./AsyncReader.ts";

/**
* Options for the {@link AsyncPipe} constructor.
*/
export interface AsyncPipeOptions {

   /**
   * The maximum number of values buffered in the pipe.
   *
   * When the FIFO is full, `write()` waits until the consumer has read a value.
   * With a size of 0, each value is handed over directly from the writer to the reader.
   *
   * @defaultValue 16
   */
   fifoSize?:                          number; }

/**
* A buffered connection between an active producer and an active consumer, like a Unix pipe.
*
* The producer writes the values with {@link writer}. The consumer reads them with {@link reader},
* or with {@link source} in a `for await` loop.
*
* Usage:
* ```js
* const pipe = new AsyncPipe();
* await Promise.all([produce(pipe.writer), consume(pipe.source)]);
*
* async function produce (writer) {
*    try {
*       for (let i = 0; i < 100; i++) {
*          await writer.write(i);
*       }
*       await writer.close();
*    } catch (error) {
*       await writer.abort(error);
*       throw error;
*    }
* }
*
* async function consume (source) {
*    for await (const value of source) {
*       console.log(value);
*    }
* }
* ```
*
* Behavior:
*
* - `write()` waits when the FIFO is full. `read()` and `next()` wait when the FIFO is empty.
* - There can be at most one pending write and one pending read. `reader` and `source` share the
*   same read end.
* - `undefined` cannot be written, because it signals the end of the values to the reader.
* - `writer.close()` ends the sequence of values. The reader receives the buffered values first, then the end.
* - `writer.abort(error)` discards the buffered values. Reading then fails with `error`.
* - `reader.close()`, or exiting the `for await` loop early, discards the buffered values. Writing then
*   fails with a "broken pipe" error, so that the producer can stop.
* - The producer and the consumer must run concurrently, e.g. with `Promise.all()` as above. If one side
*   stops without closing or aborting its end, the other side waits forever.
*/
export class AsyncPipe<T> implements Disposable {

   private controller:                 PipeController<T>;
   private _writer:                    PipeWriter<T>;
   private _reader:                    PipeReader<T>;
   private _source:                    AsyncReaderIterator<T>;

   /**
   * Creates a pipe.
   *
   * @param options
   *    Optional settings for the pipe, e.g. the FIFO size.
   */
   public constructor (options?: AsyncPipeOptions) {
      const fifoSize = options?.fifoSize ?? 16;
      assert(Number.isInteger(fifoSize) && fifoSize >= 0, "The fifoSize option must be a non-negative integer.");
      this.controller = new PipeController<T>(fifoSize);
      this._writer = new PipeWriter<T>(this.controller);
      this._reader = new PipeReader<T>(this.controller);
      this._source = new AsyncReaderIterator<T>(this._reader); }

   /**
   * The write end of the pipe, for the producer.
   */
   public get writer() : Required<AsyncWriter<T>> {
      return this._writer; }

   /**
   * The read end of the pipe, for procedural reading by the consumer.
   */
   public get reader() : Required<AsyncReader<T>> {
      return this._reader; }

   /**
   * The read end of the pipe as an async iterator, for use in a `for await` loop.
   * This is an alternative to {@link reader}. Exiting the loop early closes the reader.
   */
   public get source() : AsyncIteratorObject<T> {
      return this._source; }

   /**
   * Aborts the pipe, unless the writer has already been closed or aborted. A pending or subsequent
   * read or write then fails with an error. Called implicitly at the end of the scope of a `using`
   * declaration.
   *
   * This ensures that neither the producer nor the consumer waits forever when the scope that owns
   * the pipe is exited, e.g. because of an exception.
   */
   public [Symbol.dispose]() : void {
      this.controller.abort(new Error("AsyncPipe: The pipe has been disposed.")); }}

//--- Writer and reader --------------------------------------------------------

// Internal class for the write end of the pipe.
class PipeWriter<T> implements Required<AsyncWriter<T>> {

   private controller:                 PipeController<T>;

   public constructor (controller: PipeController<T>) {
      this.controller = controller; }

   public write (value: T) : Promise<void> {
      return this.controller.write(value); }

   public close() : Promise<void> {
      this.controller.closeWriter();
      return Promise.resolve(); }

   public abort (error?: unknown) : Promise<void> {
      this.controller.abort(error ?? new Error("AsyncPipe: Aborted by the writer."));
      return Promise.resolve(); }}

// Internal class for the read end of the pipe.
class PipeReader<T> implements Required<AsyncReader<T>> {

   private controller:                 PipeController<T>;

   public constructor (controller: PipeController<T>) {
      this.controller = controller; }

   public read() : Promise<T | undefined> {
      return this.controller.read(); }

   public close() : Promise<void> {
      this.controller.closeReader();
      return Promise.resolve(); }}

//--- Controller ---------------------------------------------------------------

interface PendingWrite<T> {
   value:                              T;
   promise:                            PromiseWithResolvers<void>; }

// Internal class for the state logic of the pipe.
// A pending read only exists while the FIFO is empty. A pending write only exists while the FIFO is full.
class PipeController<T> {

   private fifo:                       T[] = [];
   private fifoSize:                   number;
   private writerClosed:               boolean = false;
   private aborted:                    boolean = false;
   private abortError:                 unknown;
   private readerClosed:               boolean = false;
   private pendingWrite:               PendingWrite<T> | undefined;
   private pendingRead:                PromiseWithResolvers<T | undefined> | undefined;

   public constructor (fifoSize: number) {
      this.fifoSize = fifoSize; }

   //--- Write end -------------------------------------------------------------

   public async write (value: T) : Promise<void> {
      if (this.pendingWrite) {
         throw new Error("AsyncPipe: write() called while a previous write is still pending."); }
      if (value === undefined) {
         throw new Error("AsyncPipe: The value undefined cannot be written."); }
      if (this.aborted) {
         throw this.abortError; }
      if (this.writerClosed) {
         throw new Error("AsyncPipe: write() called after close()."); }
      if (this.readerClosed) {
         throw createBrokenPipeError(); }
      const pendingRead = this.takePendingRead();
      if (pendingRead) {
         pendingRead.resolve(value);
         return; }
      if (this.fifo.length < this.fifoSize) {
         this.fifo.push(value);
         return; }
      const promise: PromiseWithResolvers<void> = Promise.withResolvers();
      this.pendingWrite = {value, promise};
      return promise.promise; }

   public closeWriter() {
      if (this.writerClosed || this.aborted) {
         return; }
      this.writerClosed = true;
      this.takePendingRead()?.resolve(undefined); }

   public abort (error: unknown) {
      if (this.writerClosed || this.aborted) {
         return; }
      this.aborted = true;
      this.abortError = error;
      this.fifo = [];
      this.takePendingWrite()?.promise.reject(error);
      this.takePendingRead()?.reject(error); }

   //--- Read end --------------------------------------------------------------

   public async read() : Promise<T | undefined> {
      if (this.pendingRead) {
         throw new Error("AsyncPipe: read() called while a previous read is still pending."); }
      if (this.readerClosed) {
         return undefined; }
      if (this.aborted) {
         throw this.abortError; }
      const pendingWrite = this.takePendingWrite();
      if (pendingWrite) {                                                      // the FIFO has room for this value after the shift below
         this.fifo.push(pendingWrite.value);
         pendingWrite.promise.resolve(); }
      if (this.fifo.length) {
         return this.fifo.shift(); }
      if (this.writerClosed) {
         return undefined; }
      const promise: PromiseWithResolvers<T | undefined> = Promise.withResolvers();
      this.pendingRead = promise;
      return promise.promise; }

   public closeReader() {
      if (this.readerClosed) {
         return; }
      this.readerClosed = true;
      this.fifo = [];
      this.takePendingWrite()?.promise.reject(createBrokenPipeError());
      this.takePendingRead()?.resolve(undefined); }

   //--- Helpers ---------------------------------------------------------------

   private takePendingWrite() : PendingWrite<T> | undefined {
      const pendingWrite = this.pendingWrite;
      this.pendingWrite = undefined;
      return pendingWrite; }

   private takePendingRead() : PromiseWithResolvers<T | undefined> | undefined {
      const pendingRead = this.pendingRead;
      this.pendingRead = undefined;
      return pendingRead; }}

function createBrokenPipeError() : Error {
   return new Error("AsyncPipe: Broken pipe, the reader has been closed."); }
