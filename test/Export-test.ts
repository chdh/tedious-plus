import {suite, test, before, after} from "node:test";
import * as NodeAssert from "node:assert";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import {ConnectionPlus} from "../src/Index.ts";
import {assert} from "../src/utils/Utils.ts";
import {connectionConfig} from "./Config.ts";
import "./ExitWatchdog.ts";

const tempTableName = "#tempTediousPlusTestExport";

// Creates a temporary table with one column for each data type.
// Nullable and non-nullable variants are used, because SQL Server sends nullable columns with different
// data types (e.g. `IntN` instead of `BigInt`, `DateTimeN` instead of `DateTime`).
// The first row contains values, the second row contains NULL values in the nullable columns.
async function createTestTable (conn: ConnectionPlus) {
   const sql = `
      drop table if exists ${tempTableName};
      create table ${tempTableName} (
         id                   int                  not null,
         colBit               bit                  null,
         colInt               int                  null,
         colBigint            bigint               not null,
         colBigintNull        bigint               null,
         colDecimal           decimal(10, 2)       null,
         colFloat             float                null,
         colNvarchar          nvarchar(20)         null,
         colDatetime          datetime             not null,
         colDatetimeNull      datetime             null,
         colSmalldatetime     smalldatetime        not null,
         colSmalldatetimeNull smalldatetime        null,
         colDate              date                 null,
         colTime              time(3)              null,
         colDatetime2         datetime2(3)         null,
         colDatetimeoffset    datetimeoffset(3)    null,
         colVarbinary         varbinary(10)        null,
         colRowversion        rowversion);
      insert into ${tempTableName} (
         id, colBit, colInt, colBigint, colBigintNull, colDecimal, colFloat, colNvarchar,
         colDatetime, colDatetimeNull, colSmalldatetime, colSmalldatetimeNull,
         colDate, colTime, colDatetime2, colDatetimeoffset, colVarbinary)
      values (
         1, 1, 123, 9007199254740993, -1, 123.45, 1.5, N'äb"c',
         '2026-11-16T12:34:56.500', '2026-11-16T12:34:56.500', '2026-11-16T12:34:00', '2026-11-16T12:34:00',
         '2026-11-16', '12:34:56.789', '2026-11-16T12:34:56.789', '2026-11-16T12:34:56.789+02:00', 0x0102ABFF),
      (
         2, null, null, 0, null, null, null, null,
         '2026-11-16T00:00:00', null, '2026-11-16T00:00:00', null,
         null, null, null, null, null);`;
   await conn.execSql(sql); }

// Verifies that the file contains one JSON line for each of the expected values.
async function verifyFileContent (filePath: string, expectedValues: unknown[]) {
   const content = await NodeFs.readFile(filePath, "utf8");
   const expectedLines = expectedValues.map(e => JSON.stringify(e) + "\n");
   const expectedContent = expectedLines.join("");
   NodeAssert.strictEqual(content, expectedContent); }

// Tests the conversion of the column values of all supported data types, with the default object row shape.
async function testValueConversion (conn: ConnectionPlus, tempDir: string) {
   await createTestTable(conn);
   const filePath = NodePath.join(tempDir, "values.jsonl");
   const rowCount = await conn.exportQuery(`select * from ${tempTableName} order by id`, {
      columns: {omitRowversion: true},
      output:  {type: "file", path: filePath} });
   assert(rowCount == 2);
   const expectedRows = [
      {  id:                   1,
         colBit:               true,
         colInt:               123,
         colBigint:            {$bigint: "9007199254740993"},
         colBigintNull:        {$bigint: "-1"},
         colDecimal:           123.45,
         colFloat:             1.5,
         colNvarchar:          'äb"c',
         colDatetime:          "2026-11-16T12:34:56.500Z",
         colDatetimeNull:      "2026-11-16T12:34:56.500Z",
         colSmalldatetime:     "2026-11-16T12:34:00.000Z",
         colSmalldatetimeNull: "2026-11-16T12:34:00.000Z",
         colDate:              "2026-11-16",
         colTime:              "12:34:56.789",
         colDatetime2:         "2026-11-16T12:34:56.789Z",
         colDatetimeoffset:    "2026-11-16T10:34:56.789Z",
         colVarbinary:         "0102abff" },
      {  id:                   2,
         colBit:               null,
         colInt:               null,
         colBigint:            {$bigint: "0"},
         colBigintNull:        null,
         colDecimal:           null,
         colFloat:             null,
         colNvarchar:          null,
         colDatetime:          "2026-11-16T00:00:00.000Z",
         colDatetimeNull:      null,
         colSmalldatetime:     "2026-11-16T00:00:00.000Z",
         colSmalldatetimeNull: null,
         colDate:              null,
         colTime:              null,
         colDatetime2:         null,
         colDatetimeoffset:    null,
         colVarbinary:         null }];
   await verifyFileContent(filePath, expectedRows);
   await conn.execSql(`drop table ${tempTableName}`); }

// Tests the array row shape with the header line, and the case-insensitive ordering of the columns by name.
async function testArrayRowShape (conn: ConnectionPlus, tempDir: string) {
   const filePath = NodePath.join(tempDir, "arrays.jsonl");
   const rowCount = await conn.exportQuery("select 2 as b, 1 as A, 3 as c", {
      columns: {orderByName: true},
      format:  {type: "jsonl", rowShape: "array"},
      output:  {type: "file", path: filePath} });
   assert(rowCount == 1);
   const expectedLines = [
      ["A", "b", "c"],
      [1, 2, 3] ];
   await verifyFileContent(filePath, expectedLines); }

suite("Export", () => {
   const conn = new ConnectionPlus(connectionConfig);
   let tempDir: string;
   before(async () => {
      const tempDirPrefix = NodePath.join(NodeOs.tmpdir(), "tedious-plus-test-");
      tempDir = await NodeFs.mkdtemp(tempDirPrefix);
      await conn.open(); });
   after(async () => {
      await conn.close();
      await NodeFs.rm(tempDir, {recursive: true, force: true}); });
   test("value conversion", () => testValueConversion(conn, tempDir));
   test("array row shape", () => testArrayRowShape(conn, tempDir)); });
