const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function sourceFingerprint(root = process.cwd()) {
    const hash = crypto.createHash('sha256');
    const visit = relative => {
        const absolute = path.join(root, relative);
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink()) throw new Error(`Release evidence cannot fingerprint symlink: ${relative}`);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
        } else { hash.update(relative).update('\0').update(fs.readFileSync(absolute)).update('\0'); }
    };
    for (const entry of ['src', 'scripts', 'tests', 'package.json', 'package-lock.json',
        'playwright.config.js', 'playwright.live-ai.config.js', 'webpack.main.config.js',
        'webpack.preload.config.js', 'webpack.renderer.config.js', 'webpack.rules.js'].sort()) visit(entry);
    return hash.digest('hex');
}

// An engineering release gate, not a statistical reliability guarantee.
function evaluateAiReleaseGate(report, {fingerprint, now = Date.now()} = {}) {
    const reasons = [];
    const runs = Array.isArray(report?.runs) ? report.runs : [];
    if (!fingerprint || report?.sourceFingerprint !== fingerprint) reasons.push('Evidence does not match the current source fingerprint.');
    const completed = Date.parse(report?.completedAt);
    if (!Number.isFinite(completed) || completed > now || now - completed > 7 * 86400000) reasons.push('Live evidence must be completed within the last seven days.');
    if (report?.complete !== true || report?.plannedRuns !== runs.length || report?.passed !== true) reasons.push('The complete planned live matrix must pass.');
    if (runs.length < 6) reasons.push('At least six live runs are required.');
    if (new Set(runs.map(run => run.id)).size !== runs.length) reasons.push('Run IDs must be unique.');
    const providers = new Map();
    for (const run of runs) {
        if (run.passed !== true || run.exitCode !== 0 || run.signal || run.skippedTests !== 0
            || !(run.plannedTests > 0) || run.executedTests !== run.plannedTests
            || !run.scenarios?.some(title => /Web Tools Workbench.*realistic user request/i.test(title))) reasons.push(`Run ${run.id || '(missing ID)'} lacks a complete successful realistic-user Workbench result.`);
        if (!run.provider || !run.model || !run.seed) { reasons.push('Every run must identify provider, model and seed.'); continue; }
        const seeds = providers.get(run.provider) || new Set();
        seeds.add(run.seed);
        providers.set(run.provider, seeds);
    }
    if (providers.size < 2 || [...providers.values()].some(seeds => seeds.size < 3)) reasons.push('Require at least two providers, each with at least three distinct seeds.');
    return {ready: reasons.length === 0, reasons: [...new Set(reasons)], runs: runs.length};
}

module.exports = {sourceFingerprint, evaluateAiReleaseGate};
