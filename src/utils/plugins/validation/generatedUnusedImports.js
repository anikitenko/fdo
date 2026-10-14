import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';

const traverse = traverseModule.default || traverseModule;
const generate = generatorModule.default || generatorModule;

// Only remove unused import bindings. Keep module evaluation and all executable
// declarations intact; removing an unused local initializer could lose effects.
export function repairGeneratedUnusedImports({path, content}) {
    const unchanged = {content, names: []};
    if (!/\.[cm]?[jt]sx?$/.test(path || '')) return unchanged;
    try {
        const ast = parse(content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
        let dynamicScope = false;
        let hasJsx = false;
        traverse(ast, {JSXElement() { hasJsx = true; }, JSXFragment() { hasJsx = true; }, CallExpression({node}) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'eval') dynamicScope = true;
        }});
        if (dynamicScope) return unchanged;
        // Babel binding.referenced misses some TypeScript annotation positions.
        const referencedBindings = new Set();
        traverse(ast, {Identifier(identifierPath) {
            if (!identifierPath.findParent(parent => parent.isImportDeclaration())) {
                // Re-exporting from another module reads that module's export,
                // not a same-named local import in this file.
                if (identifierPath.parentPath.isExportSpecifier()
                    && identifierPath.parentPath.parentPath.node.source) return;
                const binding = identifierPath.scope.getBinding(identifierPath.node.name);
                if (binding) referencedBindings.add(binding);
            }
        }});
        const edits = [], names = [];
        traverse(ast, {ImportDeclaration(importPath) {
            const node = importPath.node;
            if (!node.specifiers.length) return;
            const retained = node.specifiers.filter(specifier => {
                // JSX factories can be implicit references in classic JSX output.
                if (hasJsx && (specifier.local.name === 'React'
                    || new RegExp('@jsx(?:Frag)?\\s+' + specifier.local.name + '(?:\\.|\\s|$)').test(content))) return true;
                const binding = importPath.scope.getBinding(specifier.local.name);
                if (!binding || binding.referenced || referencedBindings.has(binding)) return true;
                names.push(specifier.local.name);
                return false;
            });
            if (retained.length === node.specifiers.length) return;
            const hasRuntimeImport = node.importKind !== 'type' && node.specifiers.some(specifier => specifier.importKind !== 'type');
            const declaration = {...node, leadingComments: undefined, trailingComments: undefined};
            let replacement = retained.length || hasRuntimeImport
                ? generate({...declaration, specifiers: retained}).code : '';
            if (hasRuntimeImport && retained.length && retained.every(specifier => specifier.importKind === 'type')) {
                replacement += '\n' + generate({...declaration, specifiers: []}).code;
            }
            edits.push({start: node.start, end: node.end, replacement});
        }});
        for (const edit of edits.reverse()) content = content.slice(0, edit.start) + edit.replacement + content.slice(edit.end);
        return {content, names};
    } catch { return unchanged; }
}
