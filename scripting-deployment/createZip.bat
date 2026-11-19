@echo off

if not exist "node_modules" echo Directory "node_modules" does not exist. & exit /b 9

node --disable-warning=ExperimentalWarning build-zip.mts tedious-plus.zip package.json node_modules
