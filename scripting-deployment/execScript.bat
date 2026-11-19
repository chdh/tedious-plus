@echo off & setlocal

set "NODE_ZIP_PATH=%~dp0tedious-plus.zip"
node --experimental-vfs --disable-warning=ExperimentalWarning --import="file:///%~dp0zipModuleLoader.mjs" %*
