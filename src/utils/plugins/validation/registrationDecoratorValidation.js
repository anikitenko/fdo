import {parse} from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse = traverseModule.default || traverseModule;
const reserved = new Set(['constructor','prototype','__proto__','then']);
const literal = node => node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' ? node.value : undefined;

// Diagnose only statically certain registration errors. Dynamic options and
// inherited metadata remain owned by SDK/typechecking; never rewrite names.
export function validateRegistrationDecorators(file, {runtimeExports = []} = {}) {
    let ast;
    try { ast = parse(file.content, {sourceType:'unambiguous',plugins:['typescript','jsx','decorators-legacy']}); }
    catch { return []; }
    const errors = [], classes = new WeakMap(), methods = new WeakMap();
    const fail = (path, message) => errors.push(`${file.path}:${path.node.loc?.start.line || 1}: SDK_REGISTRATION_DECORATOR: ${message}`);
    function importedName(path) {
        if (path.isIdentifier()) {
            const binding = path.scope.getBinding(path.node.name)?.path;
            return binding?.isImportSpecifier() && binding.parent.source.value === '@anikitenko/fdo-sdk'
                && binding.parent.importKind !== 'type' && binding.node.importKind !== 'type'
                ? binding.node.imported.name || binding.node.imported.value : null;
        }
        if (path.isMemberExpression() && !path.node.computed && path.get('object').isIdentifier()) {
            const binding = path.scope.getBinding(path.node.object.name)?.path;
            return binding?.isImportNamespaceSpecifier() && binding.parent.source.value === '@anikitenko/fdo-sdk'
                && binding.parent.importKind !== 'type' ? path.node.property.name : null;
        }
        return null;
    }
    traverse(ast, {Decorator(path) {
        const expression = path.get('expression');
        const kind = importedName(expression.isCallExpression() ? expression.get('callee') : expression);
        if (!['handler','sharedFunction'].includes(kind) || !runtimeExports.includes(kind)) return;
        if (!expression.isCallExpression()) {fail(path,`Use the @${kind}(...) decorator factory, not @${kind}.`);return;}
        const method = path.parentPath.node;
        if (method.type !== 'ClassMethod' || method.kind !== 'method' || method.static) {fail(path,'Registration decorators support instance methods only, not classes, fields, static methods or accessors.');return;}
        const used = methods.get(method) || new Set();
        if (used.has(kind)) fail(path,`Duplicate @${kind} on one method.`);
        used.add(kind);methods.set(method,used);
        const owner = path.findParent(parent => parent.isClass())?.node;
        if (!owner) return;
        const state = classes.get(owner) || {handlers:new Set(),services:new Map()};
        classes.set(owner,state);
        const methodName = !method.computed && method.key.type === 'Identifier' ? method.key.name : literal(method.key);
        const args = expression.node.arguments;
        if (kind === 'handler') {
            const name = args.length ? literal(args[0]) : methodName;
            if (name === undefined) return;
            if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9._-]{0,127}$/.test(name) || reserved.has(name) || /^__(sdk|host)\./.test(name)) fail(path,'A handler needs a non-reserved string name. Use @handler() or @handler("public.alias").');
            else if (state.handlers.has(name)) fail(path,`Duplicate decorated handler alias "${name}" in this class.`);
            else state.handlers.add(name);
            return;
        }
        const options = args[0];
        if (options?.type !== 'ObjectExpression' || options.properties.some(property => property.type !== 'ObjectProperty' || property.computed)) return;
        const fields = new Map(options.properties.map(property => [property.key.name || property.key.value,property.value]));
        const service = literal(fields.get('service')), version = literal(fields.get('version')), description = literal(fields.get('description'));
        if (service !== undefined && (typeof service !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(service))) fail(path,'sharedFunction.service must be a valid service name, not a provider ID or capability ID.');
        if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 9999)) fail(path,'sharedFunction.version must be an integer service major between 1 and 9999.');
        if (description !== undefined && (typeof description !== 'string' || !description.trim() || description.length > 1000)) fail(path,'sharedFunction.description must be nonempty text (at most 1000 characters).');
        const name = fields.has('method') ? literal(fields.get('method')) : methodName;
        if (name !== undefined && (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || reserved.has(name))) fail(path,'A shared function needs a non-reserved exported method name.');
        if (typeof service !== 'string' || typeof version !== 'number') return;
        const key = `${service}.v${version}`;
        const group = state.services.get(key) || {methods:new Set(),description};
        if (description !== undefined && group.description !== undefined && description !== group.description) fail(path,`Decorated service "${key}" must use the same description on every method.`);
        if (name !== undefined && group.methods.has(name)) fail(path,`Duplicate shared method "${key}.${name}".`);
        group.methods.add(name);state.services.set(key,group);
    }});
    return errors;
}
