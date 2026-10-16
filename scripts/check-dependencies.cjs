#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const deprecated = Object.entries(lock.packages).filter(([, pkg]) => pkg.deprecated);
if (deprecated.length) {
    for (const [location, pkg] of deprecated) {
        console.error(`${location}@${pkg.version}: ${pkg.deprecated}`);
    }
    process.exit(1);
}

// npm supplies its CLI path on every supported platform, avoiding shell quoting
// and npm.cmd differences on Windows. Include development dependencies in audit.
if (!process.env.npm_execpath) {
    console.error('Run this check with npm run check:dependencies.');
    process.exit(1);
}
for (const args of [['ls', '--all'], ['audit', '--include=dev', '--audit-level=low']]) {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
        cwd: root, stdio: args[0] === 'ls' ? 'pipe' : 'inherit', env: process.env,
    });
    if (result.error || result.status !== 0) {
        if (result.stdout) process.stderr.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        if (result.error) console.error(result.error.message);
        process.exit(result.status || 1);
    }
}
console.log('Dependency checks passed: valid tree, no deprecated packages, no known vulnerabilities.');
