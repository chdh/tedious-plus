import {suite, test, before, after} from "node:test";
import {AsyncIteratorReader, ConnectionPlus} from "../src/Index.ts";
import {assert} from "../src/Utils.ts";
import {connectionConfig} from "./Config.ts";
import "./ExitWatchdog.ts";

// Tests the basic functionality of the AsyncIteratorReader class.
async function testBasic (conn: ConnectionPlus) {
   const sql = "select 1 as i union select 2 union select 3 union select 4 order by i";
   await using iterator = conn.queryIterator(sql);
   const reader = new AsyncIteratorReader(iterator);
   let rowCount = 0;
   for (let i = 0; i < 2; i++) {
      rowCount++;
      const row = await reader.read();
      assert(row != undefined);
      assert(row.i == rowCount); }
   for await (const row of reader) {
      rowCount++;
      assert(row.i == rowCount); }
   assert(rowCount == 4); }

// Runs the basic test several times with the same connection, to verify that the connection is
// ready for the next request after the reader has been closed.
async function testRepeated (conn: ConnectionPlus) {
   for (let i = 0; i < 3; i++) {
      await testBasic(conn); }}

suite("AsyncIteratorReader with DB access", () => {
   const conn = new ConnectionPlus(connectionConfig);
   before(() => conn.open());
   after(() => conn.close());
   test("basic functionality", () => testBasic(conn));
   test("repeated use of the connection", () => testRepeated(conn)); });
