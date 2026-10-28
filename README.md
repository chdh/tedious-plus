# tedious-plus

This package provides promises, an `AsyncIterator` and conveniences for [Tedious](https://github.com/tediousjs/tedious),
the SQL Server driver for Node.js.

This is an unofficial add-on package. It is not affiliated with the Tedious project.

**NPM package:** [tedious-plus](https://www.npmjs.com/package/tedious-plus)<br>
**Status:** Early version. The API is incomplete and may change.

## Features

Implemented so far:

- **`ConnectionPlus`:** A wrapper class for a Tedious connection with promise-based methods:
  - `execSql()` for SQL code that does not return a result set.
  - `query()`, `queryRows()` and `queryScalar()` for queries whose result is buffered in memory.
  - `queryIterator()` for processing large result sets row by row with a `for await` loop.
- **SQL parameters:** Parameters can be passed as an object (e.g. `{params: {id: 123}}`) or as an array
  of values. The SQL data types are derived from the values. Alternatively, full parameter definitions
  with explicit data types can be passed.
- **Row formats:** Result rows can be returned as objects, arrays, `Map`s or in the original Tedious format.
- **`AsyncRowIterator`:** Reads the result rows of a Tedious `Request` with a `for await` loop.
  The request is paused when the rows are processed more slowly than they arrive, and canceled when the
  loop is exited early.
- **`ConnectionPromises`:** Promisified versions of the Tedious `Connection` methods `connect()`, `close()`,
  `execSql()` and `execSqlBatch()`.
- Support for `await using` declarations, to close connections and terminate iterations automatically.
- A fatal connection error does not crash the process, even when the application has not registered
  an `error` listener.

Planned:

- Promisified versions of the remaining database operations that a typical application needs.
- More utility and convenience functions.
- A connection pool.

## Installation

```
npm install tedious tedious-plus
```

Requirements:

- Node.js 24 or later.
- Tedious 20.3.3 or later (peer dependency).
- The Tedious connection options `useColumnNames`, `rowCollectionOnDone` and `rowCollectionOnRequestCompletion`
  are not supported.

## API layers

The API of this package is organized in layers. Each layer builds on the layer below it.
The layers can be combined, and the Tedious API can still be used directly where needed.

- **`ConnectionPlus`** (highest layer): A class that wraps a Tedious connection and provides
  convenient methods. Most applications will only need this layer.
- **`ConnectionPromises`**: Promisified functions for a Tedious `Connection`, e.g. `connect()`,
  `execSql()` and `execSqlIterator()`. They take Tedious `Connection` and `Request` objects as
  parameters.
- **`AsyncRowIterator`** (lowest layer): An `AsyncIterator` for the result rows of a Tedious `Request`.

In addition, the module `AsyncReader` provides `AsyncIteratorReader`, which reads the values of an
iterator procedurally with `await reader.read()`, as an alternative to a `for await` loop.

## Usage

```ts
import {type ConnectionConfiguration} from "tedious";
import {ConnectionPlus} from "tedious-plus";

const connectionConfig: ConnectionConfiguration = {
   server: "localhost",
   authentication: {
      type: "default",
      options: {userName: "myUser", password: "myPassword"}
   },
   options: {database: "myDatabase"}
};

await using conn = new ConnectionPlus(connectionConfig);
await conn.open();
const iterator = conn.queryIterator("select name from sys.databases");
for await (const row of iterator) {
   console.log(row);
}
```

SQL parameters and a single result value:

```ts
await conn.execSql("insert into t1 (id, name) values (@id, @name)",
   {params: {id: 123, name: "abc"}});
const name = await conn.queryScalar("select name from t1 where id = @id",
   {params: {id: 123}, dataType: "string"});
```

More examples can be found in the [examples](https://github.com/chdh/tedious-plus/tree/main/examples) directory.

## Modules

<!-- API-MODULES:START -->

| Module | Description |
| ------ | ------ |
| [AsyncReader](https://github.com/chdh/tedious-plus/wiki/AsyncReader) | This module provides an `AsyncReader` interface for procedural reading of a sequence of values, and adapters to convert between async iterables and async readers. |
| [AsyncRowIterator](https://github.com/chdh/tedious-plus/wiki/AsyncRowIterator) | This module provides an `AsyncIterator` for reading the result rows of a Tedious `Request`. |
| [ConnectionPlus](https://github.com/chdh/tedious-plus/wiki/ConnectionPlus) | This module provides an enhanced `Connection` for communicating with the database server. |
| [ConnectionPromises](https://github.com/chdh/tedious-plus/wiki/ConnectionPromises) | Promisified wrappers for the methods of the Tedious `Connection` class. |
| [Index](https://github.com/chdh/tedious-plus/wiki/Index) | Main package exports. |
| [TediousUtils](https://github.com/chdh/tedious-plus/wiki/TediousUtils) | Types and utility functions for result set rows, metadata, value data types and SQL parameters. |

<!-- API-MODULES:END -->
