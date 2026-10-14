import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;

// Preserve a just-created result's concrete type instead of reading it through
// a nullable state interface. This is a refactor, not a null assertion/default.
export function repairConcreteStateResult({path = '', content = ''}) {
    const unchanged = {content, repaired: false};
    if (!/\.[cm]?tsx?$/.test(path)) return unchanged;
    try {
        const options = {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']};
        const ast = parse(content, options);
        const names = new Set();
        traverse(ast, {Identifier(p) { names.add(p.node.name); }});
        const edits = [];
        traverse(ast, {BlockStatement(block) {
            const statements = block.get('body');
            for (let i = 0; i < statements.length - 1; i++) {
                const assignment = statements[i].node;
                const callStatement = statements[i + 1].node;
                const expression = assignment.type === 'ExpressionStatement' && assignment.expression;
                if (expression?.type !== 'AssignmentExpression' || expression.operator !== '='
                    || expression.left.type !== 'Identifier' || expression.right.type !== 'ObjectExpression') continue;
                const stateName = expression.left.name;
                const binding = statements[i].scope.getBinding(stateName);
                if (!binding?.path.isVariableDeclarator() || !binding.path.node.id.typeAnnotation) continue;
                const call = callStatement.type === 'ExpressionStatement' && callStatement.expression;
                if (call?.type !== 'CallExpression' || call.callee.type !== 'Identifier' || call.arguments.length !== 1) continue;
                const argument = call.arguments[0];
                if (argument.type !== 'MemberExpression' || argument.computed || argument.object.type !== 'Identifier'
                    || argument.object.name !== stateName || argument.property.type !== 'Identifier') continue;
                const propertyName = argument.property.name;
                const properties = expression.right.properties;
                // The concrete field must be the last write, with no later
                // spread/accessor that could replace it or change its value.
                const property = properties.at(-1);
                if (property?.type !== 'ObjectProperty' || property.computed || property.key.name !== propertyName
                    || property.value.type !== 'ObjectExpression'
                    || property.value.properties.some(item => item.type !== 'ObjectProperty' || item.computed)) continue;
                let local = 'nextPluginState';
                for (let suffix = 2; names.has(local); suffix++) local = `nextPluginState${suffix}`;
                names.add(local);
                const indent = content.slice(content.lastIndexOf('\n', assignment.start) + 1, assignment.start).match(/^[ \t]*/)[0];
                const object = content.slice(expression.right.start, expression.right.end);
                edits.push({start: assignment.start, end: assignment.end,
                    text: `const ${local} = ${object} satisfies typeof ${stateName};\n${indent}${stateName} = ${local};`});
                edits.push({start: argument.object.start, end: argument.object.end, text: local});
            }
        }});
        let result = content;
        for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
        if (edits.length) parse(result, options);
        return {content: result, repaired: edits.length > 0};
    } catch { return unchanged; }
}
