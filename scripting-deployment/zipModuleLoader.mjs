// Generic preload module: mounts ZIP files and adds them to the module resolution path.
// Each ZIP contains a `node_modules` directory at its root.
// ZIP files are specified via query parameters of the --import URL (?zip=a.zip&zip=b.zip)
// and/or via the NODE_ZIP_PATH environment variable (separated by path.delimiter).
// Relative ZIP paths are resolved relative to this loader file.

import path from "node:path";
import {createRequire, registerHooks} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {create, ZipProvider} from "node:vfs";
import {ZipFile} from "node:zlib";

const debugLevel = 0;
const loaderDir = path.dirname(fileURLToPath(import.meta.url));
const mountRootUrls = [];

function mountZip (zipPath) {
   const archive = ZipFile.openSync(path.resolve(loaderDir, zipPath));
   const zipFs = create(new ZipProvider(archive));
   zipFs.mount();
   mountRootUrls.push(zipFs.mountPointURL + "/");
   if (debugLevel > 0) {
      console.log(`${zipPath} mounted to ${zipFs.mountPointURL}.`); }}

const isBare = (s) => !/^(\.{0,2}\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(s);

function resolve (specifier, context, nextResolve) {
   if (debugLevel > 0) {
      console.log("resolve: ", specifier);
      console.log(context); }
   try {
      return nextResolve(specifier, context); }
    catch (e) {
      const isNotFound = e?.code == "ERR_MODULE_NOT_FOUND" || e?.code == "MODULE_NOT_FOUND";
      if (!isNotFound || !isBare(specifier)) {
         throw e; }
      for (const rootUrl of mountRootUrls) {
         if (context.parentURL?.startsWith(rootUrl)) {
            continue; }
         try {
            if (e.code == "MODULE_NOT_FOUND") {                              // CommonJS resolver failed, i.e. require()
               const p = createRequire(rootUrl + "package.json").resolve(specifier);
               return {url: pathToFileURL(p).href, shortCircuit: true}; }
            const parentURL = rootUrl + "package.json";
            if (debugLevel > 0) {
               console.log(`Trying to resolve "${specifier}" with parentUrl "${parentURL}".`); }
            return nextResolve(specifier, {...context, parentURL}); }
          catch (err2) {
            if (debugLevel > 0) {
               console.log("Ignored error from sub-resolver: ", err2); }}}
      throw e; }}

function install() {
   if (debugLevel > 0) {
      console.log("zipModuleLoader install."); }
   const zipPaths = [
      ...new URL(import.meta.url).searchParams.getAll("zip"),
      ...(process.env.NODE_ZIP_PATH ?? "").split(path.delimiter).filter(Boolean) ];
   zipPaths.forEach(mountZip);
   registerHooks({resolve}); }

if (debugLevel > 0) {
   console.log("zipModuleLoader root."); }
install();
