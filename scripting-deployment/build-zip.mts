// Builds a ZIP file from files and directories, using the ZIP writer of Node.js (node:zlib).
// The resulting archive can be read by node:vfs / ZipProvider.
//
// Usage: node build-zip.mts <output.zip> <file-or-directory>...
// Example: node build-zip.mts tedious-plus.zip package.json node_modules

import fs from "node:fs";
import path from "node:path";
import {createWriteStream} from "node:fs";
import {pipeline} from "node:stream/promises";
import {ZipEntry, createZipArchive} from "node:zlib";

// Files and directories not needed at runtime.
const excludedDirNames = new Set([".bin"]);
const excludedFileSuffixes = [".ts", ".mts", ".cts", ".map"];

function isExcludedFile (name: string) : boolean {
   return excludedFileSuffixes.some(s => name.endsWith(s));
}

// Returns the paths of all files below `p`, relative to the current directory, with "/" as separator.
function collectFiles (p: string, files: string[]) : void {
   const stat = fs.lstatSync(p);
   if (stat.isSymbolicLink()) {                            // symlinks are not supported by ZipProvider
      return;
   }
   if (stat.isDirectory()) {
      if (excludedDirNames.has(path.basename(p))) {
         return;
      }
      for (const name of fs.readdirSync(p).sort()) {
         collectFiles(path.join(p, name), files);
      }
      return;
   }
   if (stat.isFile() && !isExcludedFile(path.basename(p))) {
      files.push(p.split(path.sep).join("/"));
   }
}

async function main() {
   const [outputPath, ...inputs] = process.argv.slice(2);
   if (!outputPath || !inputs.length) {
      console.error("Usage: node build-zip.mts <output.zip> <file-or-directory>...");
      process.exit(2);
   }
   const files: string[] = [];
   for (const input of inputs) {
      collectFiles(path.normalize(input), files);
   }
   const entries: ZipEntry[] = [];
   for (const file of files) {
      const stat = fs.statSync(file);
      entries.push(await ZipEntry.create(file, fs.readFileSync(file), {modified: stat.mtime}));
   }
   await pipeline(createZipArchive(entries), createWriteStream(outputPath));
   console.log(`${outputPath}: ${entries.length} files, ${fs.statSync(outputPath).size} bytes`);
}

await main();
