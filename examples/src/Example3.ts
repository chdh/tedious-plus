// Example for data export.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ConnectionPlus} from "tedious-plus";
import {connectionConfig} from "./Config.ts";

async function main() {

   const tempDirPrefix = path.join(os.tmpdir(), "tedious-plus-example3-");
   const tempDir = await fs.mkdtemp(tempDirPrefix);

   const sql = "select name, database_id, create_date, is_auto_shrink_on from sys.databases order by name";

   await using conn = new ConnectionPlus(connectionConfig);
   await conn.open();

   // Export as JSON object lines.
   const filePathObj = path.join(tempDir, "example3-obj.jsonl");
   await conn.exportQuery(sql, {
         output: {type: "file", path: filePathObj} });

   // Export as JSON array lines.
   const filePathArr = path.join(tempDir, "example3-arr.jsonl");
   await conn.exportQuery(sql, {
         output: {type: "file", path: filePathArr},
         format: {type: "jsonl", rowShape: "array"} });

   // Export into ZIP file.
   const zipFilePath = path.join(tempDir, "example3.zip");
   await conn.exportQuery(sql, {
         output: {type: "zip", zipPath: zipFilePath, entryName: "objects.jsonl"} });

   // Add another entry to the ZIP file.
   await conn.exportQuery(sql, {
         output: {type: "zip", zipPath: zipFilePath, entryName: "arrays.jsonl", ifExists: "addEntry"},
         format: {type: "jsonl", rowShape: "array"} });

   console.log(`Export files written to "${tempDir}".`);

}

await main();
