import {suite, test} from "node:test";
import * as NodeAssert from "node:assert";
import {type AsyncWriter, BufferedAsyncWriter} from "../src/utils/AsyncWriter.ts";
import {AsyncPipe} from "../src/utils/AsyncPipe.ts";

//--- Test helpers -------------------------------------------------------------

// An underlying writer that records the received blocks.
// With `holdWrites`, write() waits until release() is called.
class TestWriter implements AsyncWriter<Uint8Array> {

   public  blocks:                     Uint8Array[] = [];
   public  closeCount:                 number = 0;
   public  holdWrites:                 boolean = false;
   public  failWrite:                  boolean = false;
   private pendingWrite:               PromiseWithResolvers<void> | undefined;

   public async write (data: Uint8Array) : Promise<void> {
      this.blocks.push(data);
      if (this.failWrite) {
         throw new Error("write failed"); }
      if (this.holdWrites) {
         this.pendingWrite = Promise.withResolvers();
         await this.pendingWrite.promise; }}

   public close() : Promise<void> {
      this.closeCount++;
      return Promise.resolve(); }

   // Resolves a pending write and stops holding subsequent writes.
   public release() {
      this.holdWrites = false;
      this.pendingWrite?.resolve(); }}

class AbortableTestWriter extends TestWriter {

   public  abortErrors:                unknown[] = [];

   public abort (error?: unknown) : Promise<void> {
      this.abortErrors.push(error);
      return Promise.resolve(); }}

function bytes (length: number, start: number = 0) : Uint8Array {
   return Uint8Array.from({length}, (_, i) => (start + i) & 0xFF); }

function concat (blocks: Uint8Array[]) : Uint8Array {
   const result = new Uint8Array(blocks.reduce((n, block) => n + block.length, 0));
   let pos = 0;
   for (const block of blocks) {
      result.set(block, pos);
      pos += block.length; }
   return result; }

function decode (blocks: Uint8Array[]) : string {
   return new TextDecoder().decode(concat(blocks)); }

function blockLengths (blocks: Uint8Array[]) : number[] {
   return blocks.map((block) => block.length); }

//--- Blocks -------------------------------------------------------------------

suite("BufferedAsyncWriter blocks", () => {

   test("small byte arrays are collected into full blocks", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      const pieces = Array.from({length: 7}, (_, i) => bytes(5, i * 5));
      for (const piece of pieces) {
         await writer.write(piece); }
      NodeAssert.deepStrictEqual(blockLengths(target.blocks), [16, 16]);       // full blocks are sent immediately
      await writer.close();
      NodeAssert.deepStrictEqual(blockLengths(target.blocks), [16, 16, 3]);
      NodeAssert.deepStrictEqual(concat(target.blocks), concat(pieces));
      NodeAssert.strictEqual(target.closeCount, 1); });

   test("large byte arrays are passed directly after the current block", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      const small = bytes(3);
      const halfBlock = bytes(8, 3);
      const large = bytes(20, 11);
      await writer.write(small);
      await writer.write(halfBlock);
      await writer.write(large);
      await writer.close();
      NodeAssert.strictEqual(target.blocks.length, 3);
      NodeAssert.deepStrictEqual(target.blocks[0], small);
      NodeAssert.strictEqual(target.blocks[1], halfBlock);                     // passed without copying
      NodeAssert.strictEqual(target.blocks[2], large); });

   test("flush() sends the partial block", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      await writer.write(bytes(3));
      await writer.flush();
      NodeAssert.deepStrictEqual(blockLengths(target.blocks), [3]);
      await writer.flush();                                                    // nothing buffered, nothing sent
      await writer.close();
      NodeAssert.deepStrictEqual(blockLengths(target.blocks), [3]); });

   test("works with an AsyncPipe, which keeps references to the blocks", async () => {
      const pipe = new AsyncPipe<Uint8Array>({fifoSize: 4});
      const consumer = (async () => {
         const chunks: Uint8Array[] = [];
         for await (const chunk of pipe.source) {
            chunks.push(chunk); }
         return chunks; })();
      const writer = new BufferedAsyncWriter(pipe.writer, {blockSize: 16});
      const lines = Array.from({length: 50}, (_, i) => `line ${i}`);
      for (const line of lines) {
         await writer.writeLine(line); }
      await writer.close();
      const chunks = await consumer;
      NodeAssert.strictEqual(decode(chunks), lines.map((line) => line + "\n").join(""));
      // No block buffer has been reused while the pipe was still holding it.
      NodeAssert.strictEqual(new Set(chunks.map((chunk) => chunk.buffer)).size, chunks.length); }); });

//--- Text lines ---------------------------------------------------------------

suite("BufferedAsyncWriter text lines", () => {

   test("writeLine() encodes the text as UTF-8, followed by the line terminator", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target);
      await writer.writeLine("abc");
      await writer.writeLine("äöü €");
      await writer.writeLine("");
      await writer.close();
      NodeAssert.strictEqual(decode(target.blocks), "abc\näöü €\n\n"); });

   test("the line terminator can be specified", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target, {eol: "\r\n"});
      await writer.writeLine("a");
      await writer.writeLine("b");
      await writer.close();
      NodeAssert.strictEqual(decode(target.blocks), "a\r\nb\r\n"); });

   test("long lines span multiple blocks without splitting characters", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      const text = "aä€😀".repeat(10);                                         // 1 + 2 + 3 + 4 bytes per repetition
      await writer.writeLine(text);
      await writer.close();
      NodeAssert.strictEqual(decode(target.blocks), text + "\n");
      const fatalDecoder = new TextDecoder("utf-8", {fatal: true});
      for (const block of target.blocks) {
         fatalDecoder.decode(block); }                                         // throws if a character has been split
      for (const block of target.blocks.slice(0, -1)) {                        // at most 3 bytes are unused in a block
         NodeAssert.ok(block.length >= 13, `block length ${block.length}`); }});

   test("text lines and byte arrays can be mixed", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      await writer.writeLine("first");
      await writer.write(new TextEncoder().encode("bytes "));
      await writer.writeLine("second line");
      await writer.write(new TextEncoder().encode("a large byte array\n"));
      await writer.writeLine("third");
      await writer.close();
      NodeAssert.strictEqual(decode(target.blocks), "first\nbytes second line\na large byte array\nthird\n"); });

   test("writeJsonLine() writes a value as a JSON line", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target);
      await writer.writeJsonLine({id: 1, name: "abc"});
      await writer.writeJsonLine([1, 2]);
      await writer.close();
      NodeAssert.strictEqual(decode(target.blocks), '{"id":1,"name":"abc"}\n[1,2]\n'); }); });

//--- Close and abort ----------------------------------------------------------

suite("BufferedAsyncWriter close and abort", () => {

   test("close() is idempotent", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target);
      await writer.writeLine("a");
      await writer.close();
      await writer.close();
      await writer.abort();                                                    // no effect after close()
      NodeAssert.strictEqual(target.closeCount, 1);
      NodeAssert.strictEqual(decode(target.blocks), "a\n"); });

   test("close() closes the underlying writer even when sending the last block fails", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target);
      await writer.writeLine("a");
      target.failWrite = true;
      await NodeAssert.rejects(writer.close(), /write failed/);
      NodeAssert.strictEqual(target.closeCount, 1); });

   test("abort() discards the buffered bytes and aborts the underlying writer", async () => {
      const target = new AbortableTestWriter();
      const writer = new BufferedAsyncWriter(target);
      await writer.writeLine("a");
      const error = new Error("producer failed");
      await writer.abort(error);
      await writer.abort();                                                    // idempotent
      await writer.close();                                                    // no effect after abort()
      NodeAssert.deepStrictEqual(target.blocks, []);
      NodeAssert.deepStrictEqual(target.abortErrors, [error]);
      NodeAssert.strictEqual(target.closeCount, 0); });

   test("abort() closes an underlying writer that does not support abort()", async () => {
      const target = new TestWriter();
      const writer = new BufferedAsyncWriter(target);
      await writer.writeLine("a");
      await writer.abort();
      NodeAssert.deepStrictEqual(target.blocks, []);
      NodeAssert.strictEqual(target.closeCount, 1); });

   test("abort() stops a pending operation", async () => {
      const target = new AbortableTestWriter();
      target.holdWrites = true;
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      const line = writer.writeLine("x".repeat(40));                           // needs 3 blocks
      await writer.abort(new Error("producer failed"));
      target.release();
      await NodeAssert.rejects(line, /Aborted/);
      NodeAssert.strictEqual(target.blocks.length, 1); }); });                 // no write after abort()

//--- Concurrency --------------------------------------------------------------

suite("BufferedAsyncWriter concurrency", () => {

   test("an operation is rejected while a previous operation is pending", async () => {
      const target = new TestWriter();
      target.holdWrites = true;
      const writer = new BufferedAsyncWriter(target, {blockSize: 16});
      const first = writer.write(bytes(8));                                    // passed directly, held by the target
      await NodeAssert.rejects(writer.write(bytes(1)), /still pending/);
      await NodeAssert.rejects(writer.writeLine("a"), /still pending/);
      await NodeAssert.rejects(writer.writeJsonLine(1), /still pending/);
      await NodeAssert.rejects(writer.flush(), /still pending/);
      await NodeAssert.rejects(writer.close(), /still pending/);
      target.release();
      await first;
      await writer.writeLine("b");                                             // works again after the pending operation has settled
      await writer.close();
      NodeAssert.deepStrictEqual(concat(target.blocks), concat([bytes(8), new TextEncoder().encode("b\n")])); }); });
