// Moving an inline composition re-evaluates it at its destination. Admit only
// string composition, immutable primitive reads and known same-instance SDK calls.
// Helper calls, object reads and arbitrary expressions keep their original site.
export function inlineMoveDependencies(node, source, evaluated) {
    const dependencies = new Map();
    let budget = 2000;
    const read = (name, primitive = false) => {
        if (!source.scopeValues.has(name)) return false;
        const value = source.scopeValues.get(name);
        if (primitive && value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return false;
        dependencies.set(name, value);
        return true;
    };
    const visit = node => {
        if (!node || --budget < 0) return false;
        if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return true;
        if (node.type === 'Identifier') return read(node.name, true);
        if (node.type === 'ObjectExpression') return node.properties.every(property => property.type === 'ObjectProperty' && !property.computed && visit(property.value));
        if (node.type === 'BinaryExpression') return node.operator === '+' && typeof evaluated.get(node) === 'string' && visit(node.left) && visit(node.right);
        if (node.type !== 'CallExpression' || node.optional || node.callee.type !== 'MemberExpression' || node.callee.computed || node.callee.object.type !== 'Identifier') return false;
        const receiver = node.callee.object.name;
        if (source.scopeValues.get(receiver) !== source.dom || !read(receiver)) return false;
        if (node.callee.property.name === 'createElement') return node.arguments.length >= 2 && node.arguments.length <= 3 && node.arguments.every(visit);
        if (node.callee.property.name !== 'createClassFromStyle' || node.arguments.length !== 1) return false;
        const member = node.arguments[0];
        if (member.type !== 'MemberExpression' || member.object.type !== 'Identifier' || member.optional) return false;
        const key = member.computed ? member.property.type === 'StringLiteral' && member.property.value : member.property.name;
        return typeof key === 'string' && source.styleOptions.some(style => style.binding === member.object.name && style.key === key) && read(member.object.name);
    };
    return visit(node) ? dependencies : null;
}
export const dependenciesAvailable = (dependencies, destination) => [...dependencies].every(([name, value]) => destination.scopeValues.has(name) && Object.is(destination.scopeValues.get(name), value));
