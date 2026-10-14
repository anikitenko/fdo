import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;

// Follow referenced bindings from the failing node:test callback, including
// fixtures and local helper functions. Return null when locations are uncertain.
export function failingTestImports(source, lines) {
    if (!lines?.length) return null;
    try {
        const ast = parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx']});
        const callbacks = [];
        let hasHooks = false;
        traverse(ast, {CallExpression(p) {
            const callee = p.get('callee');
            if (!callee.isIdentifier()) return;
            const binding = p.scope.getBinding(callee.node.name)?.path;
            if (binding?.isImportSpecifier() && binding.parent.source.value === 'node:test'
                && ['before', 'beforeEach', 'after', 'afterEach'].includes(binding.node.imported.name)) hasHooks = true;
            if (!binding?.isImportSpecifier() || binding.parent.source.value !== 'node:test'
                || !['test', 'it'].includes(binding.node.imported.name)) return;
            const callback = p.get('arguments').find(arg => arg.isFunctionExpression() || arg.isArrowFunctionExpression());
            if (callback) callbacks.push({call: p, callback});
        }});
        if (hasHooks) return null;
        const selected = lines.map(line => callbacks.filter(({call}) => call.node.loc.start.line <= line && call.node.loc.end.line >= line)
            .sort((a, b) => (a.call.node.end - a.call.node.start) - (b.call.node.end - b.call.node.start))[0]?.callback);
        if (selected.some(value => !value)) return null;
        const imports = new Set();
        const seen = new Set();
        const inspect = p => {
            if (!p?.node || seen.has(p.node)) return;
            seen.add(p.node);
            const reference = ref => {
                const binding = ref.scope.getBinding(ref.node.name);
                if (!binding) return;
                if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier() || binding.path.isImportNamespaceSpecifier()) {
                    imports.add(binding.path.parent.source.value);
                } else {
                    // Mutable bindings may be initialized by hooks outside the
                    // callback. Fall back rather than omit those dependencies.
                    if (!binding.constant) throw new Error('Mutable test dependency');
                    inspect(binding.path);
                }
            };
            if (p.isReferencedIdentifier()) reference(p);
            p.traverse({ReferencedIdentifier: reference});
        };
        selected.forEach(inspect);
        return imports;
    } catch { return null; }
}
