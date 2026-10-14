import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;
import {compactWorkspaceDependency} from './workspaceDependencyContext';
import {resolveGeneratedImport} from './generatedWorkspaceImports';

// Diagnostic repair needs executable contracts: signatures alone omit test
// assertions, literal IDs, returned values, and UI markup. Include both sides
// of direct imports, even when a dependency is still pending its own repair.
export function workspaceRepairContext(targetPath, existingFiles, completedFiles = []) {
    const files = new Map(existingFiles.map(file => [file.path, file]));
    completedFiles.forEach(file => files.set(file.path, file));
    const paths = new Set(files.keys());
    const imports = file => {
        try {
            const ast = parse(file.content, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators-legacy']});
            return ast.program.body.flatMap(node => node.source && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
                ? [resolveGeneratedImport(file.path, node.source.value, paths)] : []).filter(Boolean);
        } catch { return []; }
    };
    const target = files.get(targetPath);
    if (!target) return '';
    const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(targetPath);
    const captureNotes = [];
    if (isTest) {
        try {
            const ast = parse(target.content, {sourceType: 'module', plugins: ['typescript', 'jsx']});
            traverse(ast, {AssignmentExpression(p) {
                let left = p.node.left;
                if (left.type !== 'MemberExpression' || left.computed || left.property.type !== 'Identifier') return;
                let object = left.object;
                while (['TSAsExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(object.type)) object = object.expression;
                if (object.type !== 'Identifier' || object.name !== 'globalThis' || p.scope.getBinding('globalThis')) return;
                const local = p.scope.getBinding(left.property.name);
                if (!local) return;
                captureNotes.push(`At line ${p.node.loc.start.line}, globalThis.${left.property.name} is assigned, but ${left.property.name} also has a separate lexical binding. A global-property assignment does not update that binding. Connect the mock and assertions to the same typed capture; preserve the result checks and restore mocked methods.`);
            }});
        } catch { /* Syntax validation owns malformed test code. */ }
    }

    const dependencies = new Set(imports(target));
    // Tests can read styles and fixtures from disk without importing them.
    // Exact candidate paths are read-only evidence, never edit authorization.
    if (/(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(targetPath)) {
        try {
            const ast = parse(target.content, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx']});
            const addAsset = value => {
                if (typeof value !== 'string' || !/\.(?:css|scss|json|svg|html|txt)$/i.test(value)
                    || value.includes('..') || value.includes('\\') || /^[a-z]+:/i.test(value)) return;
                const rootPath = '/' + value.replace(/^\.\//, '').replace(/^\//, '');
                const relativePath = resolveGeneratedImport(targetPath, value.startsWith('.') ? value : './' + value, paths);
                for (const path of [rootPath, relativePath]) if (paths.has(path)) dependencies.add(path);
            };
            traverse(ast, {
                StringLiteral(p) { addAsset(p.node.value); },
                TemplateLiteral(p) { if (!p.node.expressions.length) addAsset(p.node.quasis[0]?.value.cooked); },
            });
        } catch { /* Syntax diagnostics own malformed test source. */ }
    }
    const related = [...files.values()].filter(file => file.path !== targetPath
        && (dependencies.has(file.path) || imports(file).includes(targetPath)));
    // Follow explicit type imports/re-exports from direct evidence. Public
    // parameter types often hide indexed/nested contracts several modules away.
    // Keep this read-only and cycle-safe; do not traverse runtime dependencies.
    const typeContracts = new Map();
    const visited = new Set([targetPath]);
    const queue = [target, ...related];
    while (queue.length) {
        const current = queue.shift();
        if (visited.has(current.path) && current !== target) continue;
        visited.add(current.path);
        try {
            const ast = parse(current.content, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators-legacy']});
            for (const node of ast.program.body) {
                if (!node.source || !(node.importKind === 'type' || node.exportKind === 'type'
                    || node.specifiers?.some(item => item.importKind === 'type' || item.exportKind === 'type'))) continue;
                const dependency = files.get(resolveGeneratedImport(current.path, node.source.value, paths));
                if (!dependency || visited.has(dependency.path)) continue;
                if (!related.some(file => file.path === dependency.path)) typeContracts.set(dependency.path, dependency);
                queue.push(dependency);
            }
        } catch { /* Source validation owns malformed modules. */ }
    }
    if (!related.length && !typeContracts.size && !captureNotes.length) return '';
    return `DIRECT REPAIR CONTRACT EVIDENCE
These are the latest candidate sources, including pending dependencies, test assertions and explicitly named candidate assets read by tests. Completed repairs override original versions. This is reference source, not permission to edit these files in this response.
${captureNotes.length ? `TEST CAPTURE WIRING FINDINGS\n${captureNotes.join('\n')}\n` : ''}
Reconcile the reported failure with the original requirements and these contracts. Preserve passing behavior; do not invent tool IDs, return shapes, markup or expectations from signatures alone. Do not weaken tests or copy implementations from unrelated modules.
For typed fixtures, annotate the object or fixture factory at its declaration using the actual parameter type (or Parameters<typeof importedFunction>[0] when appropriate). This contextually checks nested IDs and required fields together. Reuse canonical typed catalog entries when suitable. Do not paper over incomplete fixtures with as any, double casts, or weakened production contracts. Check every fixture branch, not only the first reported property.
${[...typeContracts.values()].map(file => `READ-ONLY TYPE CONTRACT: ${file.path}\n${compactWorkspaceDependency(file.path, file.content)}\nEND TYPE CONTRACT`).join('\n\n')}
${related.map(file => `File: ${file.path}\n${file.content}\nEND REFERENCE FILE`).join('\n\n')}`;
}
