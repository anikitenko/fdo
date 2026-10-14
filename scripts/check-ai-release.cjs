const fs = require('node:fs');
const {sourceFingerprint, evaluateAiReleaseGate} = require('./lib/ai-release-gate.cjs');
try {
    const file = process.argv[2];
    if (!file || process.argv.length !== 3) throw new Error('Usage: node scripts/check-ai-release.cjs <reliability-summary.json>');
    const result = evaluateAiReleaseGate(JSON.parse(fs.readFileSync(file, 'utf8')), {fingerprint: sourceFingerprint()});
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ready ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
