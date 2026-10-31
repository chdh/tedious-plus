// Example for using the ConnectionPlus class.

import {ConnectionPlus} from "tedious-plus";
import {connectionConfig} from "./Config.ts";

async function main() {

   // Create and open the database connection.
   await using conn = new ConnectionPlus(connectionConfig);
   await conn.open();

   //--- execSql() -------------------------------------------------------------

   // Create a temporary table.
   await conn.execSql("create table #temp1 (i int, s varchar(50), b bit)");

   // Insert a row using named parameters.
   await conn.execSql("insert into #temp1 values (@p1, @p2, @p3)", {
      params: {p1: 123, p2: "abc", p3: false}
   });

   // Insert a row using a value array and automatic parameter names.
   await conn.execSql("insert into #temp1 values (@a, @b, @c)", {
      paramValues: [456, "def", true]
   });

   //--- queryRows() -----------------------------------------------------------

   // List the rows as objects.
   const objectRows = await conn.queryRows("select * from #temp1");
   console.log(objectRows);
   // Output: [ { i: 123, s: 'abc', b: false }, { i: 456, s: 'def', b: true } ]

   // List the rows as arrays of values.
   const arrayRows = await conn.queryRows("select * from #temp1", {rowType: "ArrayRow"});
   console.log(arrayRows);
   // Output: [ [ 123, 'abc', false ], [ 456, 'def', true ] ]

   //--- queryIterator() -------------------------------------------------------

   // Iterate over the rows as objects.
   const iterator1 = conn.queryIterator("select * from #temp1");
   for await (const row of iterator1) {
      console.log(row);
      // Output:
      //    { i: 123, s: 'abc', b: false }
      //    { i: 456, s: 'def', b: true }
   }

   // Iterate over the rows as arrays.
   const iterator2 = conn.queryIterator("select * from #temp1", {rowType: "ArrayRow"});
   for await (const row of iterator2) {
      console.log(row);
      // Output:
      //    [ 123, 'abc', false ]
      //    [ 456, 'def', true ]
   }

   // Iterate over the rows of a query with a named parameter.
   const iterator3 = conn.queryIterator("select * from #temp1 where s = @s", {
      params: {s: "abc"}
   });
   for await (const row of iterator3) {
      console.log(row);
      // Output: { i: 123, s: 'abc', b: false }
   }

   //--- queryScalar() ---------------------------------------------------------

   // Retrieve a single value of type `any`.
   const v1 = await conn.queryScalar("select s from #temp1 where i = 123");
   console.log(v1);
   // Output: abc

   // Retrieve a single value, specify the data type of the result and use a parameter.
   const v2 = await conn.queryScalar("select s from #temp1 where i = @i", {
      dataType: "string",
      params: {i: 456}
   });
   console.log(v2);
   // Output: def

   //---------------------------------------------------------------------------

   // Clean up.
   await conn.execSql("drop table #temp1");

}

await main();
