import {failingTestImports} from './generatedTestDependencies';
import {parse} from '@babel/parser';
import {resolveGeneratedImport} from './generatedWorkspaceImports';

export const isGeneratedTestFile = path => /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);

// Translate bundled Node test locations back to unique virtual paths. Include
// direct implementation dependencies so assertion failures can repair behavior.
// Unmapped failures must stop rather than authorize a guessed workspace rewrite.
export function generatedWorkspaceTestDiagnostics(result, files) {
    const output = String(result?.output || result?.error || 'Test runner returned no successful result.').replace(/\x1b\[[0-9;]*m/g, '');
    const paths = new Set(files.map(file => file.path));
    const sourceOwners = new Set();
    const virtualSource = location => {
        const normalized = location.replace(/\\/g, '/');
        const source = normalized.includes('/workspace/') ? '/' + normalized.split('/workspace/').pop() : normalized;
        return paths.has(source) ? source : null;
    };
    const tests = files.filter(file => isGeneratedTestFile(file.path));
    const blocks = output.split(/\n(?=test at )/).slice(1);
    const diagnostics = new Map();
    const testLines = new Map();
    const startup = output.split(/\n(?=test at )/)[0];
    const causes = [...new Set(startup.match(/^(?:\w*Error:|\s*(?:ReferenceError|TypeError)[^\n]*:)[^\n]*/gm) || [])].slice(0, 8).join('\n');
    if (!blocks.length) return [`Candidate workspace tests failed: ${output.slice(0, 8000)}`];
    for (const block of blocks) {
        const location = /^test at (.+?):\d+:\d+/.exec(block)?.[1]?.replace(/\\/g, '/');
        const relative = location?.includes('/compiled/') ? location.split('/compiled/').pop() : location?.replace(/^\//, '');
        const matches = tests.filter(file => file.path === virtualSource(location || '') || ['.js', '.cjs'].some(extension => file.path.slice(1).replace(/\.[cm]?[jt]sx?$/, extension) === relative));
        if (matches.length !== 1) return [`Candidate workspace tests failed with unmapped locations: ${causes}\n${output.slice(-8000)}`];
        const file = matches[0];
        const line = virtualSource(location || '') === file.path ? Number(/^test at .+?:(\d+):\d+/.exec(block)?.[1]) : null;
        testLines.set(file.path, [...(testLines.get(file.path) || []), line]);
        let frameCount = 0;
        const detail = block.split('\n').flatMap(line => {
            if (!/^\s+at /.test(line)) return [line];
            const match = /(?:\(|\s)([^\s()]+):(\d+):(\d+)\)?$/.exec(line);
            const owner = match && virtualSource(match[1]);
            if (!owner) return [];
            if (!isGeneratedTestFile(owner)) sourceOwners.add(owner);
            return frameCount++ < 5 ? [line.replace(match[1], owner)] : [];
        }).join('\n').slice(0, 1600);
        const previous = diagnostics.get(file.path) || [];
        previous.push(detail);
        diagnostics.set(file.path, previous);
    }
    const errors = [...diagnostics].map(([path, details]) => {
        const budget = Math.max(160, Math.floor(6000 / details.length));
        const excerpts = details.map(detail => detail.length <= budget ? detail
            : detail.slice(0, Math.floor(budget * 0.7)) + '\n[assertion excerpt shortened]\n' + detail.slice(-Math.floor(budget * 0.3)));
        return `${path}: Generated tests failed (${details.length}). ${causes}\n${excerpts.join('\n\n')}`;
    });
    const dependencies = new Set(sourceOwners);
    for (const file of tests.filter(file => diagnostics.has(file.path))) {
        try {
            const lines = testLines.get(file.path);
            const selectedImports = lines?.every(Boolean) ? failingTestImports(file.content, lines) : null;
            const ast = parse(file.content, {sourceType: 'module', plugins: ['typescript', 'jsx']});
            for (const node of ast.program.body) {
                if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue;
                if (selectedImports && node.specifiers.length && !selectedImports.has(node.source.value)) continue;
                if (node.specifiers.length && node.specifiers.every(specifier => specifier.importKind === 'type')) continue;
                const target = resolveGeneratedImport(file.path, node.source.value, paths);
                if (target && !isGeneratedTestFile(target) && /\.[cm]?[jt]sx?$/.test(target)) dependencies.add(target);
            }
        } catch { /* Diagnostics still name the failing test. */ }
    }
    dependencies.forEach(path => errors.push(`${path}: Implementation referenced by a failing test or its stack; inspect the diagnostics above and correct implementation behavior where needed. Preserve meaningful assertions and unrelated behavior.`));
    return errors;
}
