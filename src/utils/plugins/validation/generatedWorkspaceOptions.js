import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
import {resolveGeneratedImport} from './generatedWorkspaceImports';
const traverse = traverseModule.default || traverseModule;
const unwrap = node => ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression'].includes(node?.type) ? unwrap(node.expression) : node;

// Check statically known required option fields across workspace modules. Leave
// uncertain unions/generics/dynamic objects to TypeScript; never invent values.
export function validateGeneratedWorkspaceOptions(files, {sources = files, writablePaths} = {}) {
    const modules = new Map();
    const paths = new Set(sources.map(file => file.path));
    for (const file of sources) {
        if (!/\.[cm]?tsx?$/.test(file.path)) continue;
        try {
            const ast = parse(file.content, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
            let scope;
            traverse(ast, {Program(p) {scope = p.scope; p.stop();}});
            modules.set(file.path, {ast, scope});
        } catch { /* Syntax/binding errors are reported by source validation. */ }
    }
    const resolve = (file, name, seen = new Set(), owners = new Set()) => {
        owners.add(file);
        const key = `${file}:${name}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const module = modules.get(file);
        if (!module) return null;
        for (const statement of module.ast.program.body) {
            if (statement.type === 'ImportDeclaration') {
                const imported = statement.specifiers.find(item => item.local.name === name && item.type === 'ImportSpecifier');
                if (imported) return resolve(resolveGeneratedImport(file, statement.source.value, paths), imported.imported.name || imported.imported.value, seen, owners);
            }
            if (statement.type === 'ExportNamedDeclaration') {
                const exported = statement.specifiers.find(item => (item.exported?.name || item.exported?.value) === name);
                if (exported) return resolve(statement.source ? resolveGeneratedImport(file, statement.source.value, paths) : file, exported.local.name, seen, owners);
            }
            const declaration = statement.declaration || statement;
            if (declaration.id?.name === name) return {file, node: declaration};
            if (declaration.type === 'VariableDeclaration') {
                const item = declaration.declarations.find(item => item.id?.name === name);
                if (item && !item.id.typeAnnotation && module.scope.getBinding(name)?.constant) return {file, node: item.init};
            }
        }
        return null;
    };
    const fields = (file, type, seen = new Set(), owners = new Set()) => {
        owners.add(file);
        if (!type) return null;
        if (type.type === 'TSTypeReference' && type.typeName.type === 'Identifier' && !type.typeArguments) {
            const resolved = resolve(file, type.typeName.name, new Set(), owners);
            if (!resolved) return null;
            const key = `${resolved.file}:${resolved.node.start}`;
            if (seen.has(key)) return null;
            const next = new Set([...seen, key]);
            return fields(resolved.file, resolved.node, next, owners);
        }
        if (type.type === 'TSTypeAliasDeclaration' && !type.typeParameters) return fields(file, type.typeAnnotation, seen, owners);
        if (type.type === 'TSInterfaceDeclaration' && !type.typeParameters) {
            const own = fields(file, type.body, seen, owners);
            if (!own) return null;
            for (const parent of type.extends || []) {
                if (parent.expression.type !== 'Identifier' || parent.typeArguments) return null;
                const inherited = fields(file, {type: 'TSTypeReference', typeName: parent.expression}, seen, owners);
                if (!inherited) return null;
                inherited.forEach(name => own.add(name));
            }
            return own;
        }
        if (type.type === 'TSIntersectionType') {
            const parts = type.types.map(part => fields(file, part, seen, owners));
            return parts.every(Boolean) ? new Set(parts.flatMap(part => [...part])) : null;
        }
        if (!['TSTypeLiteral', 'TSInterfaceBody'].includes(type.type)) return null;
        const required = new Set();
        for (const member of type.members || type.body) {
            if (member.type === 'TSIndexSignature') continue;
            if (!['TSPropertySignature', 'TSMethodSignature'].includes(member.type) || member.computed) return null;
            if (!member.optional) required.add(member.key.name || member.key.value);
        }
        return required;
    };
    const objectKeys = (node, scope, seen = new Set()) => {
        node = unwrap(node);
        if (node?.type === 'Identifier') {
            const binding = scope.getBinding(node.name);
            if (!binding || seen.has(binding) || !binding.constant) return null;
            // CSS modules expose indexed style maps, not named renderer options.
            if (binding.path.isImportDefaultSpecifier() && /\.css$/.test(binding.path.parent.source.value)) return new Set();
            if (!binding.path.isVariableDeclarator()) return null;
            if (binding.referencePaths.some(reference => {
                let member = reference;
                while (member.parentPath?.isMemberExpression() && member.parentPath.node.object === member.node) member = member.parentPath;
                return member.parentPath?.isAssignmentExpression() && member.parentPath.node.left === member.node
                    || member.parentPath?.isUpdateExpression()
                    || member.parentPath?.isUnaryExpression({operator: 'delete'});
            })) return null;
            return objectKeys(binding.path.node.init, binding.path.scope, new Set([...seen, binding]));
        }
        if (node?.type !== 'ObjectExpression') return null;
        const keys = new Set();
        for (const property of node.properties) {
            if (property.type === 'SpreadElement') {
                const spread = objectKeys(property.argument, scope, seen);
                if (!spread) return null;
                spread.forEach(key => keys.add(key));
            } else {
                if (property.computed && !['StringLiteral', 'NumericLiteral'].includes(property.key.type)) return null;
                keys.add(property.key.name || property.key.value);
            }
        }
        return keys;
    };
    const errors = [];
    for (const file of files) {
        const module = modules.get(file.path);
        if (!module) continue;
        traverse(module.ast, {CallExpression(p) {
            if (p.node.callee.type !== 'Identifier' || p.node.arguments.some(arg => arg.type === 'SpreadElement')) return;
            const binding = p.scope.getBinding(p.node.callee.name);
            if (!binding?.path.isImportSpecifier()) return;
            const target = resolveGeneratedImport(file.path, binding.path.parent.source.value, paths);
            const name = binding.path.node.imported.name || binding.path.node.imported.value;
            const functionOwners = new Set();
            const resolved = resolve(target, name, new Set(), functionOwners);
            if (!resolved || !['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression'].includes(resolved.node?.type)) return;
            const overloads = modules.get(resolved.file).ast.program.body.some(statement => {
                const node = statement.declaration || statement;
                return node.type === 'TSDeclareFunction' && node.id?.name === resolved.node.id?.name;
            });
            if (overloads || resolved.node.typeParameters) return;
            resolved.node.params.forEach((parameter, index) => {
                if (!p.node.arguments[index]) return;
                const parameterNode = parameter.type === 'AssignmentPattern' ? parameter.left : parameter;
                const contractOwners = new Set(functionOwners);
                const expected = fields(resolved.file, parameterNode.typeAnnotation?.typeAnnotation, new Set(), contractOwners);
                // A staged file may not repair an unrelated completed caller
                // and contract. Final validation (no writablePaths) checks all.
                if (writablePaths && !writablePaths.includes(file.path)
                    && !writablePaths.some(path => contractOwners.has(path))) return;
                if (!expected?.size) return;
                const actual = objectKeys(p.node.arguments[index], p.scope);
                if (!actual) return;
                const missing = [...expected].filter(key => !actual.has(key));
                const correction = writablePaths && !writablePaths.includes(file.path)
                    ? `The caller is retained and immutable in this scoped repair. Writable module(s): ${writablePaths.join(', ')}. Reconcile the contract with the retained caller and implementation while preserving required behavior. Do not make required input optional or invent defaults merely to silence this mismatch. If the correction requires editing the caller or function implementation outside this scope, report those concrete owners instead of changing an unrelated type.`
                    : 'Pass a complete options object matching that contract; a CSS map or type cast cannot supply missing fields. Preserve required behavior and existing consumers; do not suppress this error with casts or weaken required properties.';
                if (missing.length) errors.push(`${file.path}:${p.node.loc.start.line}:${p.node.loc.start.column + 1}: ${p.node.callee.name} argument ${index + 1} is missing required option fields: ${missing.join(', ')}. The parameter contract is declared in ${resolved.file}. ${correction}`);
            });
        }});
    }
    return errors;
}
