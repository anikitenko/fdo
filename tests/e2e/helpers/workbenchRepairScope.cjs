const {parse} = require('@babel/parser');
const path = require('node:path').posix;
const {summarizeTestFailures} = require('./testFailureSummary.cjs');
const source = /\.[cm]?[jt]sx?$/;
const testFile = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

// Scope only the unambiguous tests-only case. Follow implementation imports,
// keeping tests immutable. Unknown owners/syntax do not grant a guessed scope.
function workbenchTestRepairPaths(state) {
    if (!state.compiled.success || !state.runtimeContract.passed || !state.rubric.passed
        || state.problems?.length || state.testRun.success || state.testRun.skipped) return [];
    const files = state.files || {};
    const summary = summarizeTestFailures(state.testRun.output || state.testRun.error, 12000, files);
    const roots = [...summary.matchAll(/^test in (\/.+?) \(compiled location:/gm)].map(match => match[1]);
    const count = Number(/^Failed test diagnostics: (\d+)/.exec(summary)?.[1]);
    if (!roots.length || roots.length !== count) return [];
    const visited = new Set();
    const targets = new Set();
    const visit = file => {
        if (visited.has(file)) return;
        visited.add(file);
        const ast = parse(files[file], {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
        for (const node of ast.program.body) {
            if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
                || !node.source || node.importKind === 'type' || node.exportKind === 'type') continue;
            const specifier = node.source.value;
            if (!specifier.startsWith('.')) continue;
            const base = path.resolve(path.dirname(file), specifier);
            if (/\.css$/.test(base)) continue;
            const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '/index.ts', '/index.tsx'].map(ext => base + ext)];
            const target = candidates.find(candidate => typeof files[candidate] === 'string');
            if (!target || !source.test(target)) throw new Error('Unresolved implementation dependency');
            if (!testFile.test(target)) targets.add(target);
            visit(target);
        }
    };
    try { [...new Set(roots)].forEach(visit); } catch { return []; }
    return [...targets];
}
module.exports = {workbenchTestRepairPaths};
