import {suite, test} from "node:test";
import * as NodeAssert from "node:assert";
import * as NodeTimers from "node:timers/promises";
import {AsyncPipe} from "../src/utils/AsyncPipe.ts";
import type {AsyncWriter} from "../src/utils/AsyncWriter.ts";
import {waitWithTimeout} from "../src/utils/Utils.ts";

//--- Test helpers -------------------------------------------------------------

// Returns `true` if the promise is already settled. Also marks a rejection of the promise as handled.
function isSettled (promise: Promise<unknown>) : Promise<boolean> {
   return waitWithTimeout(promise, 0); }

// Writes the values 1..count and closes the writer. Optionally yields to the event loop before each write.
async function produce (writer: AsyncWriter<number>, count: number, delay: boolean = false) : Promise<void> {
   for (let i = 1; i <= count; i++) {
      if (delay) {
         await NodeTimers.setImmediate(); }
      await writer.write(i); }
   await writer.close(); }

// Collects all values of the source. Optionally yields to the event loop after each value.
async function consume (source: AsyncIterable<number>, delay: boolean = false) : Promise<number[]> {
   const values: number[] = [];
   for await (const value of source) {
      if (delay) {
         await NodeTimers.setImmediate(); }
      values.push(value); }
   return values; }

function range (count: number) : number[] {
   return Array.from({length: count}, (_, i) => i + 1); }

//--- Data transfer ------------------------------------------------------------

suite("AsyncPipe data transfer", () => {

   test("transfers all values in order with concurrent producer and consumer", async () => {
      for (const fifoSize of [0, 1, 3, 16]) {
         for (const [producerDelay, consumerDelay] of [[false, false], [true, false], [false, true], [true, true]]) {
            const pipe = new AsyncPipe<number>({fifoSize});
            const [, values] = await Promise.all([produce(pipe.writer, 20, producerDelay), consume(pipe.source, consumerDelay)]);
            NodeAssert.deepStrictEqual(values, range(20), `fifoSize=${fifoSize} producerDelay=${producerDelay} consumerDelay=${consumerDelay}`); }}});

   test("write() waits when the FIFO is full", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 2});
      await pipe.writer.write(1);
      await pipe.writer.write(2);
      const write3 = pipe.writer.write(3);
      NodeAssert.strictEqual(await isSettled(write3), false);
      NodeAssert.strictEqual(await pipe.reader.read(), 1);
      NodeAssert.strictEqual(await isSettled(write3), true);
      NodeAssert.strictEqual(await pipe.reader.read(), 2);
      NodeAssert.strictEqual(await pipe.reader.read(), 3); });

   test("the default FIFO size is 16", async () => {
      const pipe = new AsyncPipe<number>();
      for (let i = 1; i <= 16; i++) {
         await pipe.writer.write(i); }
      const write17 = pipe.writer.write(17);
      NodeAssert.strictEqual(await isSettled(write17), false);
      NodeAssert.strictEqual(await pipe.reader.read(), 1);
      NodeAssert.strictEqual(await isSettled(write17), true); });

   test("read() waits when the FIFO is empty", async () => {
      const pipe = new AsyncPipe<number>();
      const read = pipe.reader.read();
      NodeAssert.strictEqual(await isSettled(read), false);
      await pipe.writer.write(5);
      NodeAssert.strictEqual(await read, 5); });

   test("with fifoSize 0, write() waits until the value has been read", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 0});
      const write = pipe.writer.write(1);
      NodeAssert.strictEqual(await isSettled(write), false);
      NodeAssert.strictEqual(await pipe.reader.read(), 1);
      NodeAssert.strictEqual(await isSettled(write), true);
      const read = pipe.reader.read();                                         // read before write
      await pipe.writer.write(2);
      NodeAssert.strictEqual(await read, 2); });

   test("reader and source share the same read end", async () => {
      const pipe = new AsyncPipe<number>();
      const producer = produce(pipe.writer, 4);
      NodeAssert.strictEqual(await pipe.reader.read(), 1);
      NodeAssert.deepStrictEqual(await consume(pipe.source), [2, 3, 4]);
      await producer; }); });

//--- Writer close -------------------------------------------------------------

suite("AsyncPipe writer.close()", () => {

   test("delivers the buffered values, then the end", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      await pipe.writer.write(2);
      await pipe.writer.close();                                               // resolves without waiting for the reader
      NodeAssert.strictEqual(await pipe.reader.read(), 1);
      NodeAssert.strictEqual(await pipe.reader.read(), 2);
      NodeAssert.strictEqual(await pipe.reader.read(), undefined);
      NodeAssert.strictEqual(await pipe.reader.read(), undefined); });         // stays at the end

   test("ends a pending read", async () => {
      const pipe = new AsyncPipe<number>();
      const read = pipe.reader.read();
      await pipe.writer.close();
      NodeAssert.strictEqual(await read, undefined); });

   test("the value of a pending write is still delivered", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 1});
      await pipe.writer.write(1);
      const write2 = pipe.writer.write(2);
      await pipe.writer.close();
      NodeAssert.deepStrictEqual(await consume(pipe.source), [1, 2]);
      await write2; });

   test("is idempotent", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      await pipe.writer.close();
      await pipe.writer.close();
      await pipe.writer.abort(new Error("ignored"));                           // no effect after close()
      NodeAssert.deepStrictEqual(await consume(pipe.source), [1]); });

   test("write() after close() is rejected", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.close();
      await NodeAssert.rejects(pipe.writer.write(1), /after close/); }); });

//--- Writer abort -------------------------------------------------------------

suite("AsyncPipe writer.abort()", () => {

   test("discards the buffered values and rejects subsequent reads", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      await pipe.writer.abort(new Error("producer failed"));
      await NodeAssert.rejects(pipe.reader.read(), /producer failed/);
      await NodeAssert.rejects(pipe.reader.read(), /producer failed/); });

   test("rejects a pending read", async () => {
      const pipe = new AsyncPipe<number>();
      const read = pipe.reader.read();
      await pipe.writer.abort(new Error("producer failed"));
      await NodeAssert.rejects(read, /producer failed/); });

   test("rejects a pending write", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 0});
      const write = pipe.writer.write(1);
      await pipe.writer.abort(new Error("producer failed"));
      await NodeAssert.rejects(write, /producer failed/);
      await NodeAssert.rejects(pipe.writer.write(2), /producer failed/); });

   test("uses a default error when none is given", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.abort();
      await NodeAssert.rejects(pipe.reader.read(), /Aborted by the writer/); });

   test("the error is thrown in the for await loop", async () => {
      const pipe = new AsyncPipe<number>();
      const producer = (async () => {
         await pipe.writer.write(1);
         await pipe.writer.abort(new Error("producer failed")); })();
      const values: number[] = [];
      await NodeAssert.rejects(async () => {
         for await (const value of pipe.source) {
            values.push(value); }},
         /producer failed/);
      NodeAssert.deepStrictEqual(values, [1]);
      await producer; }); });

//--- Reader close -------------------------------------------------------------

suite("AsyncPipe reader.close()", () => {

   test("rejects a pending write and subsequent writes with a broken pipe error", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 1});
      await pipe.writer.write(1);
      const write2 = pipe.writer.write(2);
      await pipe.reader.close();
      await NodeAssert.rejects(write2, /Broken pipe/);
      await NodeAssert.rejects(pipe.writer.write(3), /Broken pipe/);
      await pipe.writer.close();                                               // must succeed after a failed write()
      await pipe.writer.abort(); });

   test("subsequent reads return undefined", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      await pipe.reader.close();
      await pipe.reader.close();                                               // idempotent
      NodeAssert.strictEqual(await pipe.reader.read(), undefined); });

   test("ends a pending read", async () => {
      const pipe = new AsyncPipe<number>();
      const read = pipe.reader.read();
      await pipe.reader.close();
      NodeAssert.strictEqual(await read, undefined); });

   test("exiting a for await loop early closes the reader", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      await pipe.writer.write(2);
      for await (const value of pipe.source) {
         NodeAssert.strictEqual(value, 1);
         break; }
      await NodeAssert.rejects(pipe.writer.write(3), /Broken pipe/); });

   test("the producer stops when the consumer exits early", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 2});
      const producer = produce(pipe.writer, 100);
      for await (const value of pipe.source) {
         if (value == 3) {
            break; }}
      await NodeAssert.rejects(producer, /Broken pipe/); }); });

//--- Dispose ------------------------------------------------------------------

suite("AsyncPipe dispose", () => {

   test("rejects a pending read and a pending write", async () => {
      let read: Promise<number | undefined>;
      let write: Promise<void>;
      {  using pipe1 = new AsyncPipe<number>();
         using pipe2 = new AsyncPipe<number>({fifoSize: 0});
         read = pipe1.reader.read();
         write = pipe2.writer.write(1); }
      await NodeAssert.rejects(read, /disposed/);
      await NodeAssert.rejects(write, /disposed/); });

   test("subsequent reads and writes are rejected", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      pipe[Symbol.dispose]();
      await NodeAssert.rejects(pipe.reader.read(), /disposed/);
      await NodeAssert.rejects(pipe.writer.write(2), /disposed/); });

   test("has no effect after the writer has been closed", async () => {
      const pipe = new AsyncPipe<number>();
      await pipe.writer.write(1);
      await pipe.writer.close();
      pipe[Symbol.dispose]();
      NodeAssert.deepStrictEqual(await consume(pipe.source), [1]); });

   test("works with await using", async () => {
      let read: Promise<number | undefined>;
      {  await using pipe = new AsyncPipe<number>();
         read = pipe.reader.read(); }
      await NodeAssert.rejects(read, /disposed/); }); });

//--- Usage errors -------------------------------------------------------------

suite("AsyncPipe usage errors", () => {

   test("undefined cannot be written", async () => {
      const pipe = new AsyncPipe<number | undefined>();
      await NodeAssert.rejects(pipe.writer.write(undefined), /undefined cannot be written/); });

   test("a concurrent write() is rejected", async () => {
      const pipe = new AsyncPipe<number>({fifoSize: 0});
      const write1 = pipe.writer.write(1);                                     // intentionally not awaited yet
      await NodeAssert.rejects(pipe.writer.write(2), /still pending/);
      NodeAssert.strictEqual(await pipe.reader.read(), 1);
      await write1; });

   test("a concurrent read() is rejected", async () => {
      const pipe = new AsyncPipe<number>();
      const read1 = pipe.reader.read();                                        // intentionally not awaited yet
      await NodeAssert.rejects(pipe.reader.read(), /still pending/);
      await pipe.writer.write(1);
      NodeAssert.strictEqual(await read1, 1); }); });
