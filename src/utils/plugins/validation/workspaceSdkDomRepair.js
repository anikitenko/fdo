import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;
const unwrap = node => ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node?.type)
    ? unwrap(node.expression) : node;

// Repair the invented global SDK constructor only when its instance uses both
// SDK-specific rendering methods. Keep calls, styles and return values intact.
function repairGlobalSdkDom({path = '', content = ''}) {
    const unchanged = {content, repaired: false};
    if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|spec)\./.test(path)) return unchanged;
    let ast;
    try { ast = parse(content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']}); }
    catch { return unchanged; }
    const names = new Set();
    const candidates = [];
    let writesGlobal = false;
    const globalDom = node => {
        node = unwrap(node);
        return node?.type === 'MemberExpression' && unwrap(node.object)?.type === 'Identifier'
            && unwrap(node.object).name === 'globalThis'
            && (node.computed ? node.property.type === 'StringLiteral' && node.property.value === 'DOM' : node.property.name === 'DOM');
    };
    try { traverse(ast, {
        Identifier(p) { names.add(p.node.name); },
        AssignmentExpression(p) { if (globalDom(p.node.left)) writesGlobal = true; },
        NewExpression(p) {
            if (!globalDom(p.node.callee) || p.scope.getBinding('globalThis') || p.node.arguments.length
                || !p.parentPath.isVariableDeclarator() || p.parentPath.node.id.type !== 'Identifier'
                || p.parentPath.node.id.typeAnnotation) return;
            const binding = p.scope.getBinding(p.parentPath.node.id.name);
            if (!binding?.constant) return;
            const methods = new Set(binding.referencePaths.flatMap(reference => {
                const member = reference.parentPath;
                return member.isMemberExpression() && member.node.object === reference.node && !member.node.computed
                    ? [member.node.property.name] : [];
            }));
            if (methods.has('createClassFromStyle') && methods.has('renderHTML')) candidates.push(p.node.callee);
        },
    }); } catch { return unchanged; } // Duplicate bindings belong to normal source validation.
    if (!candidates.length || writesGlobal) return unchanged;
    let alias = 'FdoSdkDOM';
    for (let suffix = 2; names.has(alias); suffix++) alias = `FdoSdkDOM${suffix}`;
    let result = content;
    for (const callee of candidates.sort((a, b) => b.start - a.start)) {
        result = result.slice(0, callee.start) + alias + result.slice(callee.end);
    }
    const insertion = ast.program.interpreter ? ast.program.interpreter.end + 1 : 0;
    result = result.slice(0, insertion) + `import { DOM as ${alias} } from "@anikitenko/fdo-sdk";\n` + result.slice(insertion);
    return {content: result, repaired: true};
}


export function repairWorkspaceSdkDom(file) {
    const globalRepair = repairGlobalSdkDom(file);
    let content = globalRepair.content;
    if (!/\.[cm]?[jt]sx?$/.test(file.path || '')) return globalRepair;
    try {
        const ast = parse(content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
        const edits = [];
        traverse(ast, {CallExpression(p) {
            const call = p.node;
            if (call.callee.type !== 'MemberExpression' || call.callee.computed
                || call.callee.property.name !== 'createElement' || call.arguments[1]?.type !== 'NullLiteral') return;
            let instance = call.callee.object;
            if (instance.type === 'Identifier') {
                const binding = p.scope.getBinding(instance.name);
                if (!binding?.constant || binding.path.node.type !== 'VariableDeclarator') return;
                instance = binding.path.node.init;
            }
            if (instance?.type !== 'NewExpression' || instance.callee.type !== 'Identifier') return;
            const binding = p.scope.getBinding(instance.callee.name);
            if (binding?.path.node.type !== 'ImportSpecifier' || binding.path.node.imported.name !== 'DOM'
                || binding.path.parent.source.value !== '@anikitenko/fdo-sdk') return;
            edits.push(call.arguments[1]);
        }});
        for (const node of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, node.start) + '{}' + content.slice(node.end);
        return {content, repaired: globalRepair.repaired || edits.length > 0};
    } catch { return globalRepair; }
}
