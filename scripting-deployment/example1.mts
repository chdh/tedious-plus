import {ConnectionPlus} from "tedious-plus";
import {connectionConfig} from "./config.mts";

await using conn = new ConnectionPlus(connectionConfig);
await conn.open();
const rows = await conn.queryRows("select name from sys.databases");
console.log(rows);
