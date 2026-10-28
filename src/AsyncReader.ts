/**
* This module provides an `AsyncReader` interface for procedural reading of a sequence of values,
* and adapters to convert between async iterables and async readers.
*
* @module
*/

//--- Interface ----------------------------------------------------------------

/**
* Basic functionality of an async reader, for procedural processing of a sequence of values.
*
* The end of the sequence is signaled by `undefined`, so `undefined` cannot be a legitimate value.
*/
export interface AsyncReader<T> {

   /**
   * Reads the next value.
   *
   * After the end has been reached, after an error or after `close()`, `undefined` is returned.
   * `read()` must not be called again before the promise of the previous call has settled.
   *
   * @returns
   *    A promise for the next value, or `undefined` at the end of the sequence.
   *    The promise is rejected if the value cannot be read.
   */
   read() : Promise<T | undefined>;

   /**
   * Terminates the reading and releases the resources of the reader.
   *
   * Must be idempotent: it may be called multiple times, and also after the end has been reached or
   * after `read()` has failed. In these cases it must succeed without further effect, apart from
   * releasing resources that have not yet been released. Users of a reader, such as
   * {@link AsyncReaderIterator}, may therefore call it whenever they are done with the reader,
   * regardless of how the reading ended.
   *
   * Optional, for readers that do not need to release anything.
   */
   close?() : Promise<void>; }

//--- Iterator -> Reader -------------------------------------------------------

/**
* A reader for the values of an async iterable, for procedural processing (as an alternative to a
* `for await` loop).
*
* Usage:
* ```js
* await using reader = new AsyncIteratorReader(iterable);
* const firstValue = await reader.read();
* const secondValue = await reader.read();
* ```
*
* Behavior:
*
* - `read()` returns `undefined` at the end of the iteration. If `undefined` can be a legitimate value
*   of the iterable, use `readResult()` instead.
* - After the end has been reached, after an error or after `close()`, `read()` returns `undefined`
*   without accessing the underlying iterator again.
* - If the underlying iterator fails, the promise returned by `read()` is rejected. The iteration is then
*   considered finished, as in a `for await` loop.
* - `close()` terminates the iteration early by calling `return()` on the underlying iterator. This has
*   the same effect as exiting a `for await` loop early. `close()` is called implicitly at the end of the
*   scope of an `await using` declaration.
* - `read()` must not be called again before the promise of the previous call has settled.
* - The remaining values can also be consumed with a `for await` loop over the reader. Exiting that loop
*   early closes the reader.
*/
export class AsyncIteratorReader<T> implements AsyncReader<T>, AsyncDisposable {

   private iterator:                   AsyncIterator<T>;
   private finished:                   boolean = false;
   private reading:                    boolean = false;

   /**
   * Creates a reader for an async iterable.
   *
   * @param iterable
   *    The async iterable whose values are to be read.
   */
   public constructor (iterable: AsyncIterable<T>) {
      this.iterator = iterable[Symbol.asyncIterator](); }

   /**
   * Returns `true` if the iteration has finished, i.e. the end has been reached, an error has occurred
   * or the reader has been closed.
   */
   public get done() : boolean {
      return this.finished; }

   /**
   * Reads the next value.
   *
   * @returns
   *    A promise for the next value, or `undefined` if the iteration has finished.
   */
   public async read() : Promise<T | undefined> {
      const result = await this.readResult();
      return result.done ? undefined : result.value; }

   /**
   * Reads the next value and returns it as an `IteratorResult`.
   * Use this method instead of `read()` if `undefined` can be a legitimate value of the iterable.
   */
   public async readResult() : Promise<IteratorResult<T, undefined>> {
      if (this.finished) {
         return {done: true, value: undefined}; }
      if (this.reading) {
         throw new Error("AsyncIteratorReader: read() called while a previous read is still pending."); }
      this.reading = true;
      try {
         const result = await this.iterator.next();
         if (result.done) {
            this.finished = true;
            return {done: true, value: undefined}; }
         return result; }
       catch (error) {
         this.finished = true;
         throw error; }
       finally {
         this.reading = false; }}

   /**
   * Terminates the iteration early. Has no effect if the iteration has already finished, so it can be
   * called multiple times (idempotent).
   *
   * Calls `return()` on the underlying iterator, if available, and waits for its completion.
   */
   public async close() : Promise<void> {
      if (this.finished) {
         return; }
      this.finished = true;
      await this.iterator.return?.(); }

   /**
   * Closes the reader. Called implicitly at the end of the scope of an `await using` declaration.
   */
   public [Symbol.asyncDispose]() : Promise<void> {
      return this.close(); }

   /**
   * Allows the remaining values to be consumed with a `for await` loop.
   * Exiting the loop early closes the reader.
   */
   public async *[Symbol.asyncIterator]() : AsyncGenerator<T, void, undefined> {
      try {
         while (true) {
            const result = await this.readResult();
            if (result.done) {
               return; }
            yield result.value; }}
       finally {
         await this.close(); }}}

//--- Reader -> Iterator -------------------------------------------------------

/**
* An async iterator for the values of an {@link AsyncReader}.
*
* The object is both the iterable and the iterator (like an async generator object), so it can be
* used directly in a `for await` loop. It is single-pass: a second loop continues where the first one
* stopped.
*
* Usage:
* ```js
* for await (const value of new AsyncReaderIterator(reader)) {
*    console.log(value);
* }
* ```
*
* Behavior:
*
* - The iteration ends when `read()` returns `undefined`.
* - If `read()` fails, the promise returned by `next()` is rejected, i.e. the error is thrown within
*   the `for await` loop. The iteration is then considered finished.
* - The reader is closed exactly once by this object, however the iteration ends: at the end of the
*   values, after an error of `read()`, or when the `for await` loop is exited early (by `break`,
*   `return` or an exception in the loop body), in which case `return()` is called implicitly.
*   Since `close()` must be idempotent (see {@link AsyncReader.close}), the reader may also be
*   closed elsewhere, e.g. by an `await using` declaration.
* - `next()` must not be called again before the promise of the previous call has settled. A
*   `for await` loop never does that.
*/
export class AsyncReaderIterator<T> implements AsyncIterator<T, undefined>, AsyncIterable<T>, AsyncDisposable {

   private reader:                     AsyncReader<T>;
   private finished:                   boolean = false;

   /**
   * Creates an async iterator for a reader.
   *
   * @param reader
   *    The reader whose values are to be iterated.
   */
   public constructor (reader: AsyncReader<T>) {
      this.reader = reader; }

   /**
   * Returns the next value of the reader as an `IteratorResult`.
   */
   public async next() : Promise<IteratorResult<T, undefined>> {
      if (this.finished) {
         return {done: true, value: undefined}; }
      let value: T | undefined;
      try {
         value = await this.reader.read(); }
       catch (error) {
         this.finished = true;
         try {
            await this.reader.close?.(); }
          catch {
            /* The error of read() takes precedence over an error of close(). */ }
         throw error; }
      if (value === undefined) {
         this.finished = true;
         await this.reader.close?.();
         return {done: true, value: undefined}; }
      return {done: false, value}; }

   /**
   * Terminates the iteration early and closes the reader. Has no effect if the iteration has already
   * finished, because the reader has then already been closed. Called implicitly when a `for await`
   * loop is exited early.
   */
   public async return() : Promise<IteratorResult<T, undefined>> {
      if (!this.finished) {
         this.finished = true;
         await this.reader.close?.(); }
      return {done: true, value: undefined}; }

   /**
   * Returns this object, so that it can be used in a `for await` loop.
   */
   public [Symbol.asyncIterator]() : this {
      return this; }

   /**
   * Terminates the iteration. Called implicitly at the end of the scope of an `await using` declaration.
   */
   public async [Symbol.asyncDispose]() : Promise<void> {
      await this.return(); }}
