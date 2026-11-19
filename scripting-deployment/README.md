# Running `tedious-plus` scripts without `node_modules`

*Deploying scripts and all their dependencies as a single ZIP file*

How to run scripts that use `tedious-plus` on any machine with Node.js.
The scripts can be written in JavaScript (`.mjs`, `.cjs`) or TypeScript (`.mts`). TypeScript scripts are run
directly by the type stripping of Node.js, which supports only erasable TypeScript syntax.

1. Install [Node](https://nodejs.org) version 26.8 or later, with `npm`.
2. Download the files from this directory.
3. Install the required packages in the `node_modules` directory: `npm install`
4. Create the deployment ZIP file `tedious-plus.zip` from the files in the `node_modules` directory:
   `createZip.bat` or `./createZip.sh`
5. Delete the `node_modules` directory. (This step is optional).
6. Adjust the configuration in `config.mts`, or set the environment variables `TEDIOUS_PLUS_SCRIPT_SERVER`,
   `TEDIOUS_PLUS_SCRIPT_USERNAME`, `TEDIOUS_PLUS_SCRIPT_PASSWORD` and `TEDIOUS_PLUS_SCRIPT_DATABASE`.
7. Run the example script: `execScript example1.mts` or `./execScript.sh example1.mts`

To run scripts on a different machine, Node.js version 26.8 or later and the following files are required:

* `tedious-plus.zip`
* `zipModuleLoader.mjs`
* `execScript.bat` or `execScript.sh`
* `config.mts`
* Your own scripts
