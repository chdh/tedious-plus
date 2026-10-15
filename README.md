# tedious-plus

This package provides promises, an `AsyncIterator` and conveniences for [Tedious](https://github.com/tediousjs/tedious),
the SQL Server driver for Node.js.

This is an unofficial add-on package. It is not affiliated with the Tedious project.

**Status:** Early version. The API is incomplete and may change.

## Features

Implemented so far:

- Some promisified connection functions.
- **`AsyncRowIterator`:** Reads the result rows of a Tedious `Request` with a `for await` loop.

Planned:

- Promisified versions of all database operations that a typical application needs.
- More utility and convenience functions.
- A connection pool.

## API layers

The API of this package is organized in layers. Each layer builds on the layer below it.
The layers can be combined, and the Tedious API can still be used directly where needed.

- **`AsyncRowIterator`** (lowest layer): An `AsyncIterator` for the result rows of a Tedious `Request`.
- **`ConnectionPromises`**: Promisified functions for a Tedious `Connection`, e.g. `connect()`,
  `execSql()` and `execSqlIterator()`. They take Tedious `Connection` and `Request` objects as
  parameters.
- **`ConnectionPlus`** (highest layer, planned): A class that wraps a Tedious connection and provides
  convenient methods. Most applications will only need this layer.

## Usage

```js
import * as Tedious from "tedious";
import {ConnectionPromises} from "tedious-plus";

const connection = new Tedious.Connection({
   server: "localhost",
   authentication: {
      type: "default",
      options: {userName: "myUser", password: "myPassword"}
   },
   options: {database: "myDatabase"}
});

await ConnectionPromises.connect(connection);
try {
   const request = new Tedious.Request("select name from sys.databases", () => {});
   const iterator = ConnectionPromises.execSqlIterator(connection, request);
   for await (const row of iterator) {
      console.log(row);
   }
} finally {
   await ConnectionPromises.close(connection);
}
```

## Modules

<!-- API-MODULES:START -->

| Module | Description |
| ------ | ------ |
| [AsyncRowIterator](https://github.com/chdh/tedious-plus/wiki/AsyncRowIterator) | This module provides an `AsyncIterator` for reading the result rows of a Tedious `Request`. |
| [ConnectionPromises](https://github.com/chdh/tedious-plus/wiki/ConnectionPromises) | Promisified wrappers for the methods of the Tedious `Connection` class. |
| [Index](https://github.com/chdh/tedious-plus/wiki/Index) | Main package exports. |
| [TediousUtils](https://github.com/chdh/tedious-plus/wiki/TediousUtils) | Tedious-specific utilities. |

<!-- API-MODULES:END -->
