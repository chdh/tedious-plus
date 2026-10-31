import {suite, test, before, after} from "node:test";
import * as NodeAssert from "node:assert";
import * as Tedious from "tedious";
import {ConnectionPlus, type ArrayRow, type ObjectRow} from "../src/Index.ts";
import {assert, toBareObject} from "../src/utils/Utils.ts";
import {connectionConfig} from "./Config.ts";
import {assertType, type TypeEqual} from "./TestUtils.ts";
import "./ExitWatchdog.ts";

// Tests the basic functionality of the ConnectionPlus class.
async function testBasic (conn: ConnectionPlus) {
   const tempTableName = "#tempTediousPlusTestConnPlus";

   // Test execSql() without parameters.
   {  const sql = `
         drop table if exists ${tempTableName};
         create table ${tempTableName} (i int, s varchar(50));
         insert into ${tempTableName} values (1, 'abc'), (2, 'def');`;
      await conn.execSql(sql); }

   // Test execSql() with parameters.
   {  const sql1 = `insert into ${tempTableName} values (@p1, @p2)`;
      const params = {p1: 4, p2: null};
      await conn.execSql(sql1, {params});

      const sql2 = `insert into ${tempTableName} values (@a, @b)`;
      const paramValues = [3, "ghi"];
      await conn.execSql(sql2, {paramValues});

      const paramDefs = {
         p1: {type: Tedious.TYPES.Int, value: 5},
         p2: {type: Tedious.TYPES.NVarChar, value: "jkl"} };
      await conn.execSql(sql1, {paramDefs});

      const paramDefArray = [
         {name: "p1", type: Tedious.TYPES.Int, value: 6},
         {name: "p2", type: Tedious.TYPES.NVarChar, value: "mno"} ];
      await conn.execSql(sql1, {paramDefArray}); }

   // Test queryRows().
   {  const rows = await conn.queryRows(`select * from ${tempTableName} order by i`);
      assertType<TypeEqual<typeof rows, ObjectRow[]>>();
      const expectedRows = [
         {i: 1, s: "abc"},
         {i: 2, s: "def"},
         {i: 3, s: "ghi"},
         {i: 4, s: null},
         {i: 5, s: "jkl"},
         {i: 6, s: "mno"} ];
      const expectedRowsBare = expectedRows.map(toBareObject);
      NodeAssert.deepStrictEqual(rows, expectedRowsBare); }
   {  const rows = await conn.queryRows(`select * from ${tempTableName} order by i`, {rowType: "ArrayRow"});
      assertType<TypeEqual<typeof rows, ArrayRow[]>>();
      const expectedRows = [
         [1, "abc"],
         [2, "def"],
         [3, "ghi"],
         [4, null],
         [5, "jkl"],
         [6, "mno"] ];
      NodeAssert.deepStrictEqual(rows, expectedRows); }

   // Test queryScalar():
   {  const value = await conn.queryScalar(`select s from ${tempTableName} where i = 1`);
      assertType<TypeEqual<typeof value, any>>();
      assert(value === "abc"); }
   {  const value: string = await conn.queryScalar(`select s from ${tempTableName} where i = 1`, {dataType: "string"});
      assertType<TypeEqual<typeof value, string>>();
      assert(value === "abc"); }
   {  const value: string | null = await conn.queryScalar(`select s from ${tempTableName} where i = 1`, {dataType: "string|null"});
      assertType<TypeEqual<typeof value, string | null>>();
      assert(value === "abc"); }
   {  const value: string | null = await conn.queryScalar(`select s from ${tempTableName} where i = 0`, {dataType: "string|null"});
      assertType<TypeEqual<typeof value, string | null>>();
      assert(value === null); }
   {  const value = await conn.queryScalar(`select 1`, {dataType: "unknown"});
      assertType<TypeEqual<typeof value, unknown>>();
      assert(value === 1); }
   {  const expectedError = new Error(`The query returned no value or NULL, which does not match the data type "string".`);
      await NodeAssert.rejects(f, expectedError);
      async function f() {
         const _value = await conn.queryScalar(`select s from ${tempTableName} where i = 4`, {dataType: "string"});
         assertType<TypeEqual<typeof _value, string>>(); }}

   // Test queryIterator():
   {  const sql = `select * from ${tempTableName} order by i`;
      const iterator = conn.queryIterator(sql);
      let rowCount = 0;
      for await (const row of iterator) {
         assertType<TypeEqual<typeof row, ObjectRow>>();
         rowCount++;
         assert(row.i == rowCount);
         assert(row.s === ["abc", "def", "ghi", null, "jkl", "mno"][rowCount - 1]);
         assert(iterator.metadata.length == 2); }
      assert(rowCount == 6); }

   // Verify that the iterator returns the correct row type at compile-time.
   {  const iterator = conn.queryIterator("select 1", {rowType: "ArrayRow"});
      for await (const _row of iterator) {
         assertType<TypeEqual<typeof _row, ArrayRow>>(); }}

   // Test execSql() rowCount.
   {  const rowCount = await conn.execSql(`delete from ${tempTableName} where i <= 2`);
      assert(rowCount == 2); }

   // Clean up.
   await conn.execSql(`drop table ${tempTableName}`); }

// Verifies that a type argument without the corresponding `rowType` or `dataType` option is rejected at compile-time.
// This function is never called. It is only checked by the compiler and exported to avoid an "unused" error.
export async function testTypeArgWithoutOptions (conn: ConnectionPlus) {
   // @ts-expect-error -- type argument without rowType option
   await conn.query<"ArrayRow">("select 1");
   // @ts-expect-error -- type argument without rowType option
   await conn.queryRows<"ArrayRow">("select 1");
   // @ts-expect-error -- type argument without dataType option
   await conn.queryScalar<"string">("select 'abc'");
   // @ts-expect-error -- type argument without rowType option
   void conn.queryIterator<"ArrayRow">("select 1"); }

suite("ConnectionPlus", () => {
   const conn = new ConnectionPlus(connectionConfig);
   before(() => conn.open());
   after(() => conn.close());
   test("basic functionality", () => testBasic(conn)); });
