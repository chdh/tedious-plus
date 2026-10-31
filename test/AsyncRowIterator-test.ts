import {suite, test, before, after} from "node:test";
import * as NodeAssert from "node:assert";
import * as Tedious from "tedious";
import * as ConnectionPromises from "../src/ConnectionPromises.ts";
import {AsyncRowIterator, type RowType, type ArrayRow, type ObjectRow, type MapRow, type TediousArrayRow, type TediousObjectRow} from "../src/Index.ts";
import {assert, sleep, toBareObject} from "../src/utils/Utils.ts";
import {dummyCallback} from "../src/utils/TediousFixes.ts";
import {connectionConfig} from "./Config.ts";
import {assertType, type TypeEqual} from "./TestUtils.ts";
import "./ExitWatchdog.ts";

// Tests the basic functionality of the AsyncRowIterator with use of the internal FIFO.
async function testBasic (connection: Tedious.Connection) {
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
      assertType<TypeEqual<typeof row, ObjectRow>>();
      assert(typeof row.i == "number");
      assert(row.i == rowCount);
      if (rowCount == Math.floor(n / 2)) {
         await sleep(500);
         assert(rowCount == iterator.rowCount);
         if (iterator.fifoRowCount != fifoSize) {
            console.log(`Warning: iterator.fifoRowCount is ${iterator.fifoRowCount} instead of ${fifoSize}.`); }}}
   assert(rowCount == n); }

// Tests the the different row types.
async function testRowTypes (connection: Tedious.Connection) {
   // Loop over all row types and check the result.
   const allRowTypes: RowType[] = ["ArrayRow", "ObjectRow", "MapRow", "TediousArrayRow", "TediousObjectRow"];
   for (const rowType of allRowTypes) {
      await testRowType(rowType); }

   // Check that the iterator returns the correct row type at compile-time.
   {  const request = new Tedious.Request("select 1", dummyCallback);
      const iterator = new AsyncRowIterator(request);
      connection.execSql(request);
      for await (const _row of iterator) {
         assertType<TypeEqual<typeof _row, ObjectRow>>(); }}
   {  const request = new Tedious.Request("select 1", dummyCallback);
      const iterator = new AsyncRowIterator(request, {rowType: "ArrayRow"});
      connection.execSql(request);
      for await (const _row of iterator) {
         assertType<TypeEqual<typeof _row, ArrayRow>>(); }}

   async function testRowType (rowType: RowType) {
      const sql = "select 123 as col1, 'abc' as col2";
      const request = new Tedious.Request(sql, dummyCallback);
      const iterator = new AsyncRowIterator(request, {rowType});
      connection.execSql(request);
      let rowCount = 0;
      for await (const row0 of iterator) {
         rowCount++;
         switch (rowType) {
            case "ObjectRow": {
               const row = <ObjectRow>row0;
               NodeAssert.deepStrictEqual(row, toBareObject({col1: 123, col2: "abc"}));
               break; }
            case "ArrayRow": {
               const row = <ArrayRow>row0;
               NodeAssert.deepStrictEqual(row, [123, "abc"]);
               break; }
            case "MapRow": {
               const row = <MapRow>row0;
               NodeAssert.deepStrictEqual(Array.from(row.entries()), [["col1", 123], ["col2", "abc"]]);
               break; }
            case "TediousArrayRow": {
               const row = <TediousArrayRow>row0;
               NodeAssert.partialDeepStrictEqual(row, [
                  {value: 123, metadata: {colName: "col1", type: Tedious.TYPES.Int}},
                  {value: "abc", metadata: {colName: "col2", type: Tedious.TYPES.VarChar}} ]);
               break; }
            case "TediousObjectRow": {
               const row = <TediousObjectRow>row0;
               NodeAssert.partialDeepStrictEqual(row, {
                  col1: {value: 123, metadata: {colName: "col1", type: Tedious.TYPES.Int}},
                  col2: {value: "abc", metadata: {colName: "col2", type: Tedious.TYPES.VarChar}} });
               break; }}}
      assert(rowCount == 1); }}

// Checks that a for loop with an AsyncRowIterator can be aborted before the end of the result set.
async function testAbort (connection: Tedious.Connection) {
   await testForLoop(10000, 500);
   await testForLoop(10000, 3);
   await testForLoop(10000, 250, 100);
   await testForLoop(100, 100);

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
         assert(typeof row.i == "number");
         assert(row.i == rowCount);
         if (rowCount == sleepPos) {
            await sleep(250); }
         if (rowCount == abortCount) {
            break; }}
      assert(rowCount == abortCount); }}

// Test the error handling logic of the AsyncRowIterator.
async function testErrorHandling (connection: Tedious.Connection) {
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
         assert(typeof row.i == "number");
         assert(row.i == 4 - rowCount); }}
    catch (err) {
      assert(err instanceof Tedious.RequestError);
      const reqErr = <Tedious.RequestError>err;
      assert(reqErr.message.toLowerCase().includes("divide by zero"));
      errCtr++; }
   assert(rowCount == 3);
   assert(errCtr == 1); }

suite("AsyncRowIterator", () => {
   const connection = new Tedious.Connection(connectionConfig);
   before(() => ConnectionPromises.connect(connection));
   after(() => ConnectionPromises.close(connection));
   test("basic functionality with FIFO", () => testBasic(connection));
   test("row types", () => testRowTypes(connection));
   test("abort of the for loop", () => testAbort(connection));
   test("error handling", () => testErrorHandling(connection)); });
