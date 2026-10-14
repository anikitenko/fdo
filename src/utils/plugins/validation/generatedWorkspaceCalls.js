import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {resolveGeneratedImport} from './generatedWorkspaceImports';

const traverse = traverseModule.default || traverseModule;

// Conservative checks for two runtime/TypeScript defects that syntax-only
// compilation accepts. This is not a replacement for a TypeScript checker.
export function validateGeneratedWorkspaceCalls(files, {sources = files, writablePaths} = {}) {
    const modules = new Map();
    for (const file of sources) {
        if (!/\.[cm]?[jt]sx?$/.test(file.path)) continue;
        try {
            const ast = parse(file.content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
            let scope;
            traverse(ast, {Program(path) { scope = path.scope; path.stop(); }});
            modules.set(file.path, {ast, scope});
        } catch { /* Source validation reports syntax errors separately. */ }
    }
    const paths = new Set(sources.map(file => file.path));
    const signature = (modulePath, name, visited = new Set()) => {
        const key = `${modulePath}:${name}`;
        if (visited.has(key)) return null;
        visited.add(key);
        const module = modules.get(modulePath);
        if (!module) return null;
        let local = name;
        let declaration;
        for (const node of module.ast.program.body) {
            if (node.type === 'ExportDefaultDeclaration' && name === 'default') {
                if (node.declaration.type === 'Identifier') local = node.declaration.name;
                else declaration = node.declaration;
            }
            if (node.type !== 'ExportNamedDeclaration') continue;
            for (const specifier of node.specifiers) {
                if ((specifier.exported?.name || specifier.exported?.value) !== name) continue;
                if (node.source) return signature(resolveGeneratedImport(modulePath, node.source.value, paths), specifier.local.name, visited);
                local = specifier.local.name;
            }
        }
        const binding = module.scope.getBinding(local);
        if (binding && !binding.constant) return null;
        declaration ||= binding?.path.node;
        // Explicit variable types and overloads may deliberately accept more
        // arguments than the implementation. Leave those to TypeScript.
        if (module.ast.program.body.some(node => {
            const item = node.declaration || node;
            return item.type === 'TSDeclareFunction' && item.id?.name === local;
        })) return null;
        if (declaration?.type === 'VariableDeclarator') {
            if (declaration.id.typeAnnotation) return null;
            declaration = declaration.init;
        }
        return ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(declaration?.type)
            && declaration.params.length === 0 ? {modulePath, name} : null;
    };
    const errors = [];
    for (const file of files) {
        const module = modules.get(file.path);
        if (!module) continue;
        const report = (node, message) => errors.push(`${file.path}:${node.loc.start.line}:${node.loc.start.column + 1}: ${message}`);
        traverse(module.ast, {
            AssignmentExpression(path) {
                const left = path.node.left;
                if (left.type !== 'MemberExpression' || left.computed || left.property.name !== 'lastIndex'
                    || left.object.type !== 'Identifier') return;
                const binding = path.scope.getBinding(left.object.name);
                if (!binding?.constant || binding.path.node.type !== 'VariableDeclarator') return;
                const init = binding.path.node.init;
                let flags;
                if (init?.type === 'RegExpLiteral') flags = init.flags;
                else if (init?.type === 'NewExpression' && init.callee.name === 'RegExp' && !path.scope.getBinding('RegExp')
                    && init.arguments[1]?.type === 'StringLiteral') flags = init.arguments[1].value;
                if (flags !== undefined && !/[gy]/.test(flags)) report(path.node,
                    `${left.object.name}.lastIndex is ignored because its regex has neither g nor y flags. A scanning loop can repeat the first match forever. Use a global/sticky regex or advance through a sliced input, preserving the intended matching behavior.`);
            },
            NewExpression(path) {
                if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'DOM' && !path.scope.getBinding('DOM')) {
                    report(path.node, 'DOM is not defined. Import { DOM } from "@anikitenko/fdo-sdk" before constructing it; retain the existing renderer implementations.');
                }
            },
            CallExpression(path) {
                if (!/\.[cm]?tsx?$/.test(file.path) || !path.node.arguments.length || path.node.arguments.some(arg => arg.type === 'SpreadElement')
                    || path.node.callee.type !== 'Identifier') return;
                const binding = path.scope.getBinding(path.node.callee.name);
                if (!binding?.constant || !['ImportSpecifier', 'ImportDefaultSpecifier'].includes(binding.path.type)) return;
                const imported = binding.path.node;
                const source = binding.path.parent.source.value;
                const target = resolveGeneratedImport(file.path, source, paths);
                const name = imported.type === 'ImportDefaultSpecifier' ? 'default' : imported.imported.name || imported.imported.value;
                if (!signature(target, name)) return;
                const repair = writablePaths && !writablePaths.includes(file.path) && writablePaths.includes(target)
                    ? `The caller is retained and immutable. Implement its required argument contract in ${target}, preserving the requested behavior; do not change the retained caller.`
                    : 'Use its existing zero-argument interface; preserve the dependency and required styling in the caller. Do not discard side effects from argument expressions.';
                report(path.node, `${path.node.callee.name} from ${target} declares zero parameters, but this call supplies ${path.node.arguments.length}. ${repair}`);
            },
        });
    }
    return errors;
}
