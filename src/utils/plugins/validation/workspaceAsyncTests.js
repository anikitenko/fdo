import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;

// node:test awaits an async callback. Repair only this known runner boundary,
// never arbitrary functions whose return type or callers could change.
export function repairAsyncTestCallbacks({path = '', content = ''}) {
    const unchanged = {content, repaired: false};
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return unchanged;
    try {
        const options = {sourceType: 'module', plugins: ['typescript', 'jsx']};
        const ast = parse(content, {...options, errorRecovery: true});
        if (!ast.errors.length || ast.errors.some(error => error.reasonCode !== 'AwaitNotInAsyncContext')) return unchanged;
        const callbacks = new Map();
        traverse(ast, {AwaitExpression(p) {
            const fn = p.getFunctionParent();
            if (!fn || fn.node.async || fn.node.generator
                || !['ArrowFunctionExpression', 'FunctionExpression'].includes(fn.node.type)) return;
            const call = fn.parentPath;
            if (!call.isCallExpression() || call.node.arguments.at(-1) !== fn.node || call.getFunctionParent()) return;
            const callee = call.get('callee');
            if (!callee.isIdentifier()) return;
            const binding = call.scope.getBinding(callee.node.name)?.path;
            if (!binding || binding.parent.source?.value !== 'node:test' || binding.parent.importKind === 'type') return;
            if (!binding.isImportDefaultSpecifier() && !(binding.isImportSpecifier()
                && ['test', 'it'].includes(binding.node.imported.name) && binding.node.importKind !== 'type')) return;
            callbacks.set(fn.node.start, fn.node);
        }});
        let result = content;
        for (const start of [...callbacks.keys()].sort((a, b) => b - a)) {
            result = result.slice(0, start) + 'async ' + result.slice(start);
        }
        if (!callbacks.size) return unchanged;
        // Accept only a completely parseable correction. Remaining illegal
        // awaits or unrelated syntax belong to normal bounded model repair.
        parse(result, options);
        return {content: result, repaired: true};
    } catch { return unchanged; }
}
