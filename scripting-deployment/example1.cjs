const {ConnectionPlus}   = require("tedious-plus");
const {connectionConfig} = require("./config.mts");

async function main() {
   await using conn = new ConnectionPlus(connectionConfig);
   await conn.open();
   const rows = await conn.queryRows("select name from sys.databases");
   console.log(rows);
}

main();
