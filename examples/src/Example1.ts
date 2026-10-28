// A very simple example as in the README.

import {ConnectionPlus} from "tedious-plus";
import {connectionConfig} from "./Config.ts";

await using conn = new ConnectionPlus(connectionConfig);
await conn.open();
const iterator = conn.queryIterator("select name from sys.databases");
for await (const row of iterator) {
   console.log(row);
}
