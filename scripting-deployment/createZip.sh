#!/bin/bash

if [ ! -d "node_modules" ]; then echo 'Directory "node_modules" does not exist.'; exit 9; fi

node --disable-warning=ExperimentalWarning build-zip.mts tedious-plus.zip package.json node_modules
