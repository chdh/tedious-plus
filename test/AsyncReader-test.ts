import {suite, test} from "node:test";
import * as NodeAssert from "node:assert";
import {type AsyncReader, AsyncIteratorReader, AsyncReaderIterator} from "../src/AsyncReader.ts";

//--- Test helpers -------------------------------------------------------------

// Creates an async generator as a test source. The returned state records whether the
// generator's finally block has run, i.e. whether the source has been terminated or completed.
function createSource (count: number, failAt?: number) {
   const state = {finalized: false};
   // eslint-disable-next-line @typescript-eslint/require-await -- test source with synchronous data
   async function* generate() {
      try {
         for (let i = 1; i <= count; i++) {
            if (i === failAt) {
               throw new Error(`fail at ${i}`); }
            yield i; }}
       finally {
         state.finalized = true; }}
   return {iterable: generate(), state}; }

// A reader that delivers 1..count, with optional failures, and counts the close() calls.
class TestReader implements AsyncReader<number> {

   public  closeCount:                 number = 0;
   private position:                   number = 0;
   private count:                      number;
   private options:                    {failReadAt?: number; failClose?: boolean};

   public constructor (count: number, options: {failReadAt?: number; failClose?: boolean} = {}) {
      this.count = count;
      this.options = options; }

   // eslint-disable-next-line @typescript-eslint/require-await -- implements the async interface synchronously
   public async read() : Promise<number | undefined> {
      this.position++;
      if (this.position === this.options.failReadAt) {
         throw new Error("read failed"); }
      return this.position <= this.count ? this.position : undefined; }

   // eslint-disable-next-line @typescript-eslint/require-await -- implements the async interface synchronously
   public async close() : Promise<void> {
      this.closeCount++;
      if (this.options.failClose) {
         throw new Error("close failed"); }}}

async function collect<T> (iterable: AsyncIterable<T>) : Promise<T[]> {
   const values: T[] = [];
   for await (const value of iterable) {
      values.push(value); }
   return values; }

//--- AsyncIteratorReader ------------------------------------------------------

suite("AsyncIteratorReader", () => {

   test("reads all values, then undefined", async () => {
      const {iterable, state} = createSource(3);
      const reader = new AsyncIteratorReader(iterable);
      NodeAssert.strictEqual(await reader.read(), 1);
      NodeAssert.strictEqual(await reader.read(), 2);
      NodeAssert.strictEqual(await reader.read(), 3);
      NodeAssert.strictEqual(reader.done, false);                              // end not yet detected
      NodeAssert.strictEqual(await reader.read(), undefined);
      NodeAssert.strictEqual(reader.done, true);
      NodeAssert.strictEqual(await reader.read(), undefined);                  // stays at the end
      NodeAssert.strictEqual(state.finalized, true); });

   test("close() terminates the source early", async () => {
      const {iterable, state} = createSource(3);
      const reader = new AsyncIteratorReader(iterable);
      NodeAssert.strictEqual(await reader.read(), 1);
      await reader.close();
      NodeAssert.strictEqual(state.finalized, true);
      NodeAssert.strictEqual(await reader.read(), undefined);
      await reader.close(); });                                                // idempotent, must not throw

   test("await using closes the reader", async () => {
      const {iterable, state} = createSource(3);
      {  await using reader = new AsyncIteratorReader(iterable);
         NodeAssert.strictEqual(await reader.read(), 1);
         NodeAssert.strictEqual(state.finalized, false); }
      NodeAssert.strictEqual(state.finalized, true); });

   test("an error of the source rejects read() and finishes the reader", async () => {
      const {iterable} = createSource(3, 2);
      const reader = new AsyncIteratorReader(iterable);
      NodeAssert.strictEqual(await reader.read(), 1);
      await NodeAssert.rejects(reader.read(), /fail at 2/);
      NodeAssert.strictEqual(reader.done, true);
      NodeAssert.strictEqual(await reader.read(), undefined); });

   test("a concurrent read() is rejected", async () => {
      const {iterable} = createSource(3);
      const reader = new AsyncIteratorReader(iterable);
      const first = reader.read();                                             // intentionally not awaited yet
      await NodeAssert.rejects(reader.read(), /still pending/);
      NodeAssert.strictEqual(await first, 1); });

   test("for await over the reader continues where read() stopped", async () => {
      const {iterable} = createSource(4);
      const reader = new AsyncIteratorReader(iterable);
      NodeAssert.strictEqual(await reader.read(), 1);
      NodeAssert.deepStrictEqual(await collect(reader), [2, 3, 4]); });

   test("break in for await over the reader closes it", async () => {
      const {iterable, state} = createSource(4);
      const reader = new AsyncIteratorReader(iterable);
      for await (const value of reader) {
         NodeAssert.strictEqual(value, 1);
         break; }
      NodeAssert.strictEqual(state.finalized, true);
      NodeAssert.strictEqual(reader.done, true); }); });

//--- AsyncReaderIterator ------------------------------------------------------

suite("AsyncReaderIterator", () => {

   test("iterates all values and closes the reader once at the end", async () => {
      const reader = new TestReader(3);
      NodeAssert.deepStrictEqual(await collect(new AsyncReaderIterator(reader)), [1, 2, 3]);
      NodeAssert.strictEqual(reader.closeCount, 1); });

   test("break closes the reader once", async () => {
      const reader = new TestReader(3);
      const iterator = new AsyncReaderIterator(reader);
      for await (const value of iterator) {
         NodeAssert.strictEqual(value, 1);
         break; }
      NodeAssert.strictEqual(reader.closeCount, 1);
      await iterator.return();                                                 // second termination has no effect
      NodeAssert.strictEqual(reader.closeCount, 1); });

   test("an error of read() is thrown in the loop and the reader is closed", async () => {
      const reader = new TestReader(3, {failReadAt: 2});
      const values: number[] = [];
      await NodeAssert.rejects(async () => {
         for await (const value of new AsyncReaderIterator(reader)) {
            values.push(value); }},
         /read failed/);
      NodeAssert.deepStrictEqual(values, [1]);
      NodeAssert.strictEqual(reader.closeCount, 1); });

   test("the error of read() takes precedence over an error of close()", async () => {
      const reader = new TestReader(3, {failReadAt: 2, failClose: true});
      await NodeAssert.rejects(collect(new AsyncReaderIterator(reader)), /read failed/);
      NodeAssert.strictEqual(reader.closeCount, 1); });

   test("an error of close() at the normal end is thrown", async () => {
      const reader = new TestReader(2, {failClose: true});
      await NodeAssert.rejects(collect(new AsyncReaderIterator(reader)), /close failed/); });

   test("round trip: iterable -> reader -> iterable", async () => {
      const {iterable, state} = createSource(3);
      const values = await collect(new AsyncReaderIterator(new AsyncIteratorReader(iterable)));
      NodeAssert.deepStrictEqual(values, [1, 2, 3]);
      NodeAssert.strictEqual(state.finalized, true); }); });
