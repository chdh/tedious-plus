import {suite, test, before, after} from "node:test";
import * as NodeAssert from "node:assert";
import * as Tedious from "tedious";
import {ConnectionPromises, type ArrayRow, type ObjectRow} from "../src/Index.ts";
import {assert, toBareObject} from "../src/utils/Utils.ts";
import {dummyCallback} from "../src/utils/TediousFixes.ts";
import {connectionConfig} from "./Config.ts";
import {assertType, type TypeEqual} from "./TestUtils.ts";
import "./ExitWatchdog.ts";

// Tests the basic functionality of the ConnectionPromises module.
async function testBasic (connection: Tedious.Connection) {
   const tempTableName = "#tempTediousPlusTestConnPromises";

   // Test execSqlBatch().
   {  const sql = `
         drop table if exists ${tempTableName};
         create table ${tempTableName} (i int, s varchar(50));
         insert into ${tempTableName} values (1, 'one'), (2, 'two'), (3, 'three');`;
      const request = new Tedious.Request(sql, dummyCallback);
      await ConnectionPromises.execSqlBatch(connection, request); }

   // Test execSql().
   {  const sql = `select * from ${tempTableName} order by i`;
      const request = new Tedious.Request(sql, dummyCallback);
      const result = await ConnectionPromises.execSql(connection, request);
      assertType<TypeEqual<typeof result.rows, ObjectRow[]>>();
      assert(result.rowCount == 3);
      assert(result.metadata.length == 2);
      const expectedRows = [
         {i: 1, s: "one"},
         {i: 2, s: "two"},
         {i: 3, s: "three"} ];
      const expectedRowsBare = expectedRows.map(toBareObject);
      NodeAssert.deepStrictEqual(result.rows, expectedRowsBare); }

   // Test execSqlIterator().
   {  const sql = `select * from ${tempTableName} order by i`;
      const request = new Tedious.Request(sql, dummyCallback);
      const iterator = ConnectionPromises.execSqlIterator(connection, request);
      let rowCount = 0;
      for await (const row of iterator) {
         rowCount++;
         assertType<TypeEqual<typeof row, ObjectRow>>();
         const expectedRow = {i: rowCount, s: ["one", "two", "three"][rowCount - 1]};
         NodeAssert.deepStrictEqual(row, toBareObject(expectedRow));
         assert(iterator.metadata.length == 2); }
      assert(rowCount == 3); }

   // Verify that execSqlIterator() returns the correct row type at compile-time.
   {  const request = new Tedious.Request("select 1", dummyCallback);
      const iterator = ConnectionPromises.execSqlIterator(connection, request, {rowType: "ArrayRow"});
      for await (const _row of iterator) {
         assertType<TypeEqual<typeof _row, ArrayRow>>(); }}

   // Test rowCount for non-query SQL with execSql().
   {  const sql = `delete from ${tempTableName}`;
      const request = new Tedious.Request(sql, dummyCallback);
      const result = await ConnectionPromises.execSql(connection, request);
      assert(result.rowCount == 3); }

   // Clean up.
   {  const sql = `drop table ${tempTableName}`;
      const request = new Tedious.Request(sql, dummyCallback);
      await ConnectionPromises.execSql(connection, request); }}

suite("ConnectionPromises", () => {
   const connection = new Tedious.Connection(connectionConfig);
   before(() => ConnectionPromises.connect(connection));
   after(() => ConnectionPromises.close(connection));
   test("basic functionality", () => testBasic(connection)); });
