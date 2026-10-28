# AGENTS.md

This file provides guidance for AI agents when working with code in this repository.

## Project overview

This project is currently in development.
It aims to provide a wrapper for the Tedious package for accessing the SQL Server.

It will provide:

- Async / promisified functions for all database operations that a typical application needs.
- An `AsyncIterator` to process the rows resulting from a database query.
- Utility and convenience functions.
- A connection pool.

## Coding principles

- Prefer creating general purpose functions where appropriate instead of scrambling multiple
  functionalities into a single statement or a single function.
- Some functions that return a `Promise` are declared `async` even when they don't contain an `await`.
  This has the purpose that exceptions occurring synchronously within the function are wrapped
  into the returned promise and are not delivered synchronously.
- The `examples` directory must remain stand-alone. Users download it separately (see `examples/README.md`)
  and use the published `tedious-plus` package. Nothing in it may reference the rest of the project
  (no `paths` mappings to `../src`, no shared tsconfig, etc.), and the project's build and lint
  configuration must not reference it either.

## Code style

The codebase uses a distinctive, consistent style enforced partly by ESLint. Match it exactly:

- 3-space indentation; closing braces cuddled onto the last statement line (`return e; }`), never on their own line
- `if`/`else` bodies always braced, on the next line; `else` on a new line preceded by one space
- Module-level mutable state is declared with `var` (the `no-var` rule is off); locals use `const`/`let`
- Relative imports include the `.ts` extension (tsc's `rewriteRelativeImportExtensions` is enabled)
- File names are PascalCase (lint-enforced); aligned column formatting in declarations and interface comments
- No nested assignments (lint-enforced); explicit member accessibility required in classes
- Explicit `public`/`private` accessibility on all class members; `curly` bodies required.
- Interface fields are column-aligned.
- Groups of related consecutive assignments or declarations are column-aligned.
- A space is written between a function name and its parameter list, and before the colon of a
  return type: `function getIntArg (args: string[], argIndex: number) : number {`
- Continuation keywords (`else`, `catch`, `finally`) start a new line and are indented by one
  additional space, so that the closing brace of the preceding block remains appended to it.
- Sections within a module are introduced by a separator comment, padded with dashes to column 80.

## Documentation

- Document the normal use of the API. Don't document exotic special cases and edge-case behavior
  (e.g. what happens when an object is used twice or in an unusual order). Users can look into the
  source code of this open-source project in such cases.
- Avoid overdocumentation. Keep doc comments short and focused on what a typical user needs to know.

## Code reviews

The following known and accepted issues should not be reported in code reviews:

- ConnectionPromises.ts: `checkConnectionOptions()` is only called in `connect()` and not in the other
  functions.
- AsyncRowIterator.ts: The constructor accepts an explicit type argument without a matching `rowType` option
  (e.g. `new AsyncRowIterator<"ArrayRow">(request)`), which gives a wrong row type at runtime. A fix with a
  conditional rest parameter type was rejected as too complicated for the API. Only report it again if a
  newer TypeScript version allows a simple solution (e.g. constructor overloads with their own type parameters).
- ConnectionPromises.ts / AsyncRowIterator.ts: `RequestMonitor` and `RowIteratorController` contain similar
  code (event listeners, metadata and row handlers, request completion). Refactoring this duplication is
  deferred for now.
- README.md: The module table between the `API-MODULES:START` and `API-MODULES:END` markers is generated
  from the wiki pages by `node build.js updateWiki`. Don't edit it manually.
- Ignore the `wiki` and `apiDoc` directories.
