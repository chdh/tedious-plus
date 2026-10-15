import test from "node:test";
import * as Tedious from "tedious";
import * as ConnectionPromises from "../src/ConnectionPromises.ts";
import {AsyncRowIterator} from "../src/AsyncRowIterator.ts";
import {assert, sleep} from "../src/Utils.ts";
import {dummyCallback} from "../src/TediousFixes.ts";
import {connectionConfig} from "./Config.ts";
import "./ExitWatchdog.ts";

// Tests the basic functionality of the AsyncRowIterator with use of the internal FIFO.
async function testBasic (connection: Tedious.Connection) {
   console.log("AsyncRowIterator basic test started.");

   const n = 20000;
   const fifoSize = 512;
   const sql = `
      with cte1 as
         (select 1 as i union all select i + 1 from cte1 where i < ${n})
      select i from cte1 option (maxrecursion 0)`;

   const request = new Tedious.Request(sql, dummyCallback);
   const iterator = new AsyncRowIterator(request, {fifoSize});
   connection.execSql(request);

   const metadata = await iterator.getMetadata();
   assert(metadata.length == 1);

   let rowCount = 0;
   for await (const row of iterator) {
      rowCount++;
      assert(rowCount == iterator.rowCount);
      assert(row.length == 1);
      const i = row[0];
      assert(typeof i == "number");
      assert(i == rowCount);
      if (rowCount == Math.floor(n / 2)) {
         await sleep(500);
         assert(rowCount == iterator.rowCount);
         if (iterator.fifoRowCount != fifoSize) {
            console.log(`Warning: iterator.fifoRowCount is ${iterator.fifoRowCount} instead of ${fifoSize}.`); }}}
   assert(rowCount == n);

   console.log("AsyncRowIterator basic test completed."); }

// Checks that a for loop with an AsyncRowIterator can be aborted before the end of the result set.
async function testAbort (connection: Tedious.Connection) {
   console.log("AsyncRowIterator abort test started.");

   await testForLoop(10000, 500);
   await testForLoop(10000, 3);
   await testForLoop(10000, 250, 100);
   await testForLoop(100, 100);

   console.log("AsyncRowIterator abort test completed.");

   async function testForLoop (n: number, abortCount: number, sleepPos = -1) {

      const sql = `
         with cte1 as
            (select 1 as i union all select i + 1 from cte1 where i < ${n})
         select i from cte1 option (maxrecursion 0)`;

      const request = new Tedious.Request(sql, dummyCallback);
      const iterator = new AsyncRowIterator(request);
      connection.execSql(request);

      let rowCount = 0;
      for await (const row of iterator) {
         rowCount++;
         assert(row.length == 1);
         const i = row[0];
         assert(typeof i == "number");
         assert(i == rowCount);
         if (rowCount == sleepPos) {
            await sleep(250); }
         if (rowCount == abortCount) {
            break; }}
      assert(rowCount == abortCount); }}

// Test the error handling logic of the AsyncRowIterator.
async function testErrorHandling (connection: Tedious.Connection) {
   console.log("AsyncRowIterator error handling test started.");

   const sql = `
      with q1 as (
         select -1 as i union select 0 union select 1 union select 2 union select 3)
      select i, 2 / i from q1 order by q1.i desc`;

   const request = new Tedious.Request(sql, dummyCallback);
   const iterator = new AsyncRowIterator(request);
   connection.execSql(request);

   let rowCount = 0;
   let errCtr = 0;
   try {
      for await (const row of iterator) {
         rowCount++;
         assert(row.length == 2);
         const i = row[0];
         assert(typeof i == "number");
         assert(i == 4 - rowCount); }}
    catch (err) {
      assert(err instanceof Tedious.RequestError);
      const reqErr = <Tedious.RequestError>err;
      assert(reqErr.message.toLowerCase().includes("divide by zero"));
      errCtr++; }
   assert(rowCount == 3);
   assert(errCtr == 1);

   console.log("AsyncRowIterator error handling test completed."); }

async function main() {
   console.log("AsyncRowIterator tests started.");

   const connection = new Tedious.Connection(connectionConfig);
   try {
      await ConnectionPromises.connect(connection);
      await testBasic(connection);
      await testAbort(connection);
      await testErrorHandling(connection); }
    finally {
      await ConnectionPromises.close(connection); }

   console.log("AsyncRowIterator tests completed."); }

test("AsyncRowIterator test", main);
