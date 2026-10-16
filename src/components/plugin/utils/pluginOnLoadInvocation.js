import {parse} from '@babel/parser';

// The SDK transports either a function expression or an already invoked script
// expression. Evaluate both inside the view lifecycle, and never call a script's
// returned cleanup as if it were its initializer.
export function pluginOnLoadInvocation(source) {
    if (source == null || source === '') return 'return undefined;';
    const prefix = 'const __fdoOnLoad = ';
    const ast = parse(prefix + source, {sourceType:'script'});
    const statement = ast.program.body[0];
    const expression = statement?.type === 'VariableDeclaration' && statement.declarations.length === 1 ? statement.declarations[0].init : null;
    if (ast.program.body.length !== 1 || !expression) throw new Error('Plugin renderOnLoad must provide one function or script expression.');
    const code = String(source).slice(expression.start - prefix.length, expression.end - prefix.length);
    return ['FunctionExpression', 'ArrowFunctionExpression'].includes(expression.type)
        ? 'const initialize = (' + code + '); return initialize();'
        : 'return (' + code + ');';
}
