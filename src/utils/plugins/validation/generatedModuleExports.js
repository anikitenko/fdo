import {parse} from '@babel/parser';

const parserOptions = {sourceType: 'module', allowUndeclaredExports: true,
    plugins: ['typescript', 'jsx', 'decorators-legacy']};
const syntaxShape = node => JSON.stringify(node, (key, value) =>
    ['start', 'end', 'loc', 'extra', 'leadingComments', 'innerComments', 'trailingComments'].includes(key) ? undefined : value);

function isSelfForwarder(node) {
    if (node.async || node.generator || node.body?.directives?.length || node.body?.body.length !== 1
        || node.params.some(param => param.type !== 'Identifier' || param.optional)) return false;
    const statement = node.body.body[0];
    const call = statement.type === 'ReturnStatement' && statement.argument;
    return call?.type === 'CallExpression' && !call.optional && !call.typeParameters && !call.typeArguments
        && call.callee.type === 'Identifier' && call.callee.name === node.id.name
        && call.arguments.length === node.params.length
        && call.arguments.every((arg, index) => arg.type === 'Identifier' && arg.name === node.params[index].name);
}

// Remove only a redundant module-level export wrapper around a single real
// implementation. No regex source edits, competing bodies, signature guesses,
// import rewrites, or changes to the retained implementation are permitted.
export function normalizeGeneratedModuleExports({path = '', content = ''}) {
    const unchanged = {content, names: []};
    if (!/\.[cm]?[jt]sx?$/i.test(path) || typeof content !== 'string') return unchanged;
    let ast;
    try { ast = parse(content, {...parserOptions, errorRecovery: true}); }
    catch { return unchanged; }
    if (!ast.errors.some(error => error.reasonCode === 'VarRedeclaration')) return unchanged;
    const groups = new Map();
    for (const statement of ast.program.body) {
        const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        if (node?.type !== 'FunctionDeclaration' || !node.id || !node.body) continue;
        const group = groups.get(node.id.name) || [];
        group.push({node, statement});
        groups.set(node.id.name, group);
    }
    const edits = [];
    const names = [];
    for (const [name, group] of groups) {
        if (group.length !== 2) continue;
        const wrappers = group.filter(({node, statement}) => statement.type === 'ExportNamedDeclaration' && isSelfForwarder(node));
        if (wrappers.length !== 1) continue;
        const wrapper = wrappers[0];
        const implementation = group.find(item => item !== wrapper);
        if (isSelfForwarder(implementation.node) || implementation.node.async || implementation.node.generator) continue;
        const signature = node => syntaxShape({params: node.params, typeParameters: node.typeParameters, returnType: node.returnType});
        if (signature(wrapper.node) !== signature(implementation.node)) continue;
        edits.push({start: wrapper.statement.start, end: wrapper.statement.end, text: ''});
        if (implementation.statement.type !== 'ExportNamedDeclaration') {
            edits.push({start: implementation.node.start, end: implementation.node.start, text: 'export '});
        }
        names.push(name);
    }
    if (!edits.length) return unchanged;
    let normalized = content;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
        normalized = normalized.slice(0, edit.start) + edit.text + normalized.slice(edit.end);
    }
    // Remaining collisions, duplicate exports and unrelated syntax
    // errors must still go through the bounded model repair, unchanged.
    try { parse(normalized, parserOptions); }
    catch { return unchanged; }
    return {content: normalized, names};
}
