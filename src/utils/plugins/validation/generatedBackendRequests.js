import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const literal = node => {
    const value = node?.type === 'StringLiteral' ? node.value
        : node?.type === 'TemplateLiteral' && !node.expressions.length ? node.quasis[0].value.cooked : undefined;
    return value?.includes('__fdo_template_hole_') ? undefined : value;
};

// Check syntax, not source spelling: shorthand, quoted keys, property order,
// and large content objects all represent the same backend request envelope.
export function hasInvalidBackendRequest(source) {
    let invalid = false;
    const inspect = (source, depth = 0) => {
        if (depth > 4 || !source.includes('createBackendReq')) return;
        let ast;
        try {
            ast = parse(source, {sourceType: 'unambiguous', plugins: ['typescript', 'jsx'], allowReturnOutsideFunction: true});
        } catch { return; } // Source syntax diagnostics are owned by the syntax validator.
        traverse(ast, {
            CallExpression(path) {
                const {callee, arguments: args} = path.node;
                if (callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier'
                    || callee.object.name !== 'window'
                    || (callee.computed ? literal(callee.property) : callee.property.name) !== 'createBackendReq') return;
                const message = literal(args[0]);
                if (args.length < 2 || (message !== undefined && message !== 'UI_MESSAGE')) {
                    invalid = true;
                    return;
                }
                const envelope = args[1];
                if (envelope.type !== 'ObjectExpression') {
                    // Dynamic values need runtime/type checking. Reject only
                    // values whose shape is statically known to be wrong.
                    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'ArrayExpression'].includes(envelope.type)) invalid = true;
                    return;
                }
                const keys = new Set(envelope.properties.filter(prop => prop.type !== 'SpreadElement' && !prop.computed)
                    .map(prop => prop.key.name ?? prop.key.value));
                const dynamic = envelope.properties.some(prop => prop.type === 'SpreadElement' || prop.computed);
                if (!dynamic && (!keys.has('handler') || !keys.has('content'))) invalid = true;
            },
            TemplateLiteral(path) {
                // renderOnLoad commonly returns JavaScript as a template string.
                // Inspect decoded code without executing generated expressions.
                // Preserve surrounding function/block syntax across interpolations.
                // Holes stand for unknown values, never executed generated code.
                if (path.node.expressions.length) inspect(path.node.quasis.map((quasi, index) =>
                    (quasi.value.cooked || '') + (index < path.node.expressions.length ? `__fdo_template_hole_${index}__` : '')).join(''), depth + 1);
                for (const quasi of path.node.quasis) inspect(quasi.value.cooked || '', depth + 1);
            },
            StringLiteral(path) {
                inspect(path.node.value, depth + 1);
            },
        });
    };
    inspect(String(source || ''));
    return invalid;
}
