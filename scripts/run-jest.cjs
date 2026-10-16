#!/usr/bin/env node
'use strict';

const {spawnSync} = require('node:child_process');
// Babel 8 and TypeScript 7 publish ESM. Keep FDO's tests in CommonJS while
// letting Jest load their dependencies through its native ESM implementation.
const result = spawnSync(process.execPath, [
    '--experimental-vm-modules', require.resolve('jest/bin/jest'), ...process.argv.slice(2),
], {stdio: 'inherit', env: process.env});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
