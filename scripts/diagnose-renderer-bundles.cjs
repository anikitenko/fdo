// Record the JavaScript chunks injected into each production entry document.
// External static:// scripts are unchanged assets, excluded from these totals.
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(process.argv[2] || 'artifacts/desktop-performance/renderer-bundles.json');
const report = {generatedAt: new Date().toISOString(), notes: [
    'Uncompressed entry JavaScript bytes on disk; excludes static:// assets and lazy chunks.',
    'Bundle size is not a measurement of startup latency.',
], entries: {}};
for (const entry of ['index', 'plugin_host']) {
    const html = fs.readFileSync(`dist/renderer/${entry}.html`, 'utf8');
    const files = [...html.matchAll(/<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/g)]
        .map(match => match[1] || match[2] || match[3]).filter(file => !file.includes('://'));
    if (!files.length) throw new Error(`No entry chunks found for ${entry}`);
    const chunks = files.map(file => ({file, bytes: fs.statSync(path.join('dist/renderer', file)).size}));
    report.entries[entry] = {files: chunks, bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0)};
}
fs.mkdirSync(path.dirname(output), {recursive: true});
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
for (const [entry, result] of Object.entries(report.entries)) console.log(`${entry}: ${(result.bytes / 2 ** 20).toFixed(2)} MiB`);
