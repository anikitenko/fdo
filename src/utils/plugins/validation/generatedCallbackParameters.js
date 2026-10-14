import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

// Advisory code-quality findings for simple trailing parameters. They are not
// compilation failures: an input can be intentionally reserved by an interface.
export function validateGeneratedCallbackParameters({path, content}) {
    if (!/\.[cm]?tsx?$/i.test(path)) return [];
    const errors = [];
    try {
        const ast = parse(content, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators-legacy']});
        traverse(ast, {
            'ArrowFunctionExpression|FunctionExpression|FunctionDeclaration'(fn) {
                if (!fn.node.body) return;
                const callback = fn.parentPath.isCallExpression() && fn.parent.arguments.includes(fn.node);
                if (fn.node.params.some(param => param.type !== 'Identifier')) return;
                let implicitUse = false;
                fn.traverse({ReferencedIdentifier(ref) {
                    if (ref.node.name === 'arguments' || ref.node.name === 'eval') implicitUse = true;
                }});
                if (implicitUse) return;
                const parameters = fn.node.params.map(param => ({param, binding: fn.scope.getBinding(param.name)}));
                const lastUsed = parameters.reduce((last, {binding}, index) => !binding || binding.referenced ? index : last, -1);
                parameters.forEach(({param, binding}, index) => {
                    if (index <= lastUsed || !binding || param.name.startsWith('_')) return;
                    errors.push(`${path}:${param.loc.start.line}:${param.loc.start.column + 1}: ${callback ? 'Callback' : 'Function'} parameter '${param.name}' is declared but its value is never read. Inspect the function and its callers: use the input if required, or remove redundant parameters and update affected calls while preserving behavior. Do not add dummy reads or suppressions to hide this diagnostic.`);
                });
            },
        });
    } catch {
        // Syntax and unsupported scope shapes remain owned by their validators.
        return [];
    }
    return errors;
}
