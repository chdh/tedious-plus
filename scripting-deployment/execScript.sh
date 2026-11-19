#!/bin/bash

scriptDir="$(cd "$(dirname "$0")" && pwd)"
export NODE_ZIP_PATH="$scriptDir/tedious-plus.zip"
exec node --experimental-vfs --disable-warning=ExperimentalWarning --import="$scriptDir/zipModuleLoader.mjs" "$@"
