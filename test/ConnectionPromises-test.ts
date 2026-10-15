import test from "node:test";
import * as Tedious from "tedious";
import * as ConnectionPromises from "../src/ConnectionPromises.ts";
import {assert} from "../src/Utils.ts";
import {dummyCallback} from "../src/TediousFixes.ts";
import {connectionConfig} from "./Config.ts";
import "./ExitWatchdog.ts";

// Tests the basic functionality of the ConnectionPromises module.
async function testBasic (connection: Tedious.Connection) {
   console.log("ConnectionPromises basic test started.");

   const tempTableName = "tempTediousPlusTest1";

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
      assert(result.rowCount == 3);
      assert(result.metadata.length == 2);
      assert(result.rows.length == 3);
      assert(result.rows[0].length == 2);
      assert(result.rows[1][0] == 2);
      assert(result.rows[1][1] == 'two'); }

   // Test execSqlIterator().
   {  const sql = `select * from ${tempTableName} order by i`;
      const request = new Tedious.Request(sql, dummyCallback);
      const iterator = ConnectionPromises.execSqlIterator(connection, request);
      let rowCount = 0;
      for await (const row of iterator) {
         rowCount++;
         assert(row.length == 2);
         assert(row[0] == rowCount);
         assert(row[1] == ["one", "two", "three"][rowCount - 1]);
         assert(iterator.metadata.length == 2); }
      assert(rowCount == 3); }

   // Test rowCount for non-query SQL with execSql().
   {  const sql = `delete from ${tempTableName}`;
      const request = new Tedious.Request(sql, dummyCallback);
      const result = await ConnectionPromises.execSql(connection, request);
      assert(result.rowCount == 3); }

   // Clean up.
   {  const sql = `drop table ${tempTableName}`;
      const request = new Tedious.Request(sql, dummyCallback);
      await ConnectionPromises.execSql(connection, request); }

   console.log("ConnectionPromises basic test completed."); }

async function main() {
   console.log("ConnectionPromises tests started.");

   const connection = new Tedious.Connection(connectionConfig);
   try {
      await ConnectionPromises.connect(connection);
      await testBasic(connection); }
    finally {
      await ConnectionPromises.close(connection); }

   console.log("ConnectionPromises tests completed."); }

test("ConnectionPromises test", main);
