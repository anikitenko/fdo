import {SDK_COMPONENT_ADAPTERS} from './sdkComponentCatalog';
import {describeActionCatalog} from './actionLifecycle';
import {createHtmlLiteralMapper} from './htmlLiteralPreview';
import {previewRegExp, replacePreviewString} from './stringPreview';
import {describeSdkSlots} from './sdkSlotEdits';
import {describeSdkOpeners} from './sdkOverlayOpeners';
import {describeToastActions} from './sdkToastActions';
import {parse} from '@babel/parser';
import path from 'node:path';
import {compileCssStyleModule} from '../../../esbuild/plugins/cssStyleModule';
import {decodePreviewText, describeCssStyle} from './sourceEdits';
import {describeAttributes} from './attributeEdits';
import {describeButtonActions} from './actionBindings';
import {describeStructure} from './structuralEdits';
import {describeLocalActions} from './localActions';
import {describeSdkAsyncActions,sdkAsyncActionCatalog} from './sdkAsyncActions';
import {describeClassNames} from './styleAssignments';
import {describeInputKinds} from './inputKinds';
import {describeStyleAssignments} from './styleAssignments';
import {describeSdkInsertions} from './sdkComponentInsertion';
import {describeSdkComponent} from './sdkComponentEdits';
import {isolationReason} from './styleIsolation';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const legacyMethods = {DOM: ['createElement', 'createClassFromStyle', 'renderHTML'], DOMText: ['createPText'], DOMNested: ['createBlockDiv']};
const reviewedDomClasses = new Set(['DOM', 'DOMText', 'DOMNested', 'DOMInput', 'DOMSemantic']);

// Deliberately interpret a small expression language. Never eval/transpile/run
// workspace code, module initialization, plugin constructors or backend handlers.
export async function createStaticUiPreview(files, sdk, componentContract, domContract) {
    const methods = Object.fromEntries(Object.entries(legacyMethods).map(([name, entries]) => [name, new Set(entries)]));
    if (/^1\.\d+\.\d+$/.test(domContract?.contractVersion || '')) {
        for (const definition of domContract.classes || []) {
            if (!reviewedDomClasses.has(definition.name) || typeof sdk[definition.name] !== 'function') continue;
            methods[definition.name] ||= new Set();
            for (const method of definition.methods || []) {
                if (method.staticPreviewSafe === true && ['html-string', 'class-name-string'].includes(method.returnKind)
                    && !forbidden.has(method.name)) methods[definition.name].add(method.name);
            }
        }
    }
    const literalHtml = createHtmlLiteralMapper(files);
    let currentFile = '/index.ts';
    let operations = 0;
    let processedCharacters = 0;
    let depth = 0;
    const modules = new Map(), instances = new WeakMap(), css = new Map();
    let previewCollector;
    const sdkEntries = new WeakMap();
    const styleSources = new WeakMap(), classSources = new Map(), styleCalls = new WeakMap(), elements = [];
    const evaluated = new WeakMap(), elementCalls = new Map(), cssBindings = new Map(), renderedDomInstances = new WeakMap(), styleOptionsCache = new Map();
    const fail = (node, message) => {
        const error = new Error(message);
        error.location = {path: currentFile, line: node?.loc?.start.line || 1, column: (node?.loc?.start.column || 0) + 1};
        throw error;
    };
    const key = (value, node) => {
        if (typeof value !== 'string' && typeof value !== 'number') fail(node, 'Only string/number property names are supported.');
        if (forbidden.has(String(value))) fail(node, 'Prototype access is not supported in preview.');
        return value;
    };
    const check = (value, node) => {
        if (typeof value === 'string' && value.length > 500000) fail(node, 'Preview output exceeds 500 KB.');
        if (typeof value === 'string' && (processedCharacters += value.length) > 5000000) fail(node, 'Preview text-processing budget exceeded.');
        if (Array.isArray(value) && value.length > 1000) fail(node, 'Preview arrays are limited to 1,000 items.');
        return value;
    };
    const inspectSdkInput = (value, node, nesting = 0) => {
        if (++operations > 20000 || nesting > 40) fail(node, 'Preview input budget exceeded.');
        if (value && typeof value === 'object') {
            if (instances.has(value) || value.kind === 'function' || value.kind === 'sdk') fail(node, 'SDK preview arguments must be plain data, not callbacks or instances.');
            for (const entry of Object.values(value)) inspectSdkInput(entry, node, nesting + 1);
        } else check(value, node);
    };
    const resolve = (from, specifier, node) => {
        if (!specifier.startsWith('.')) fail(node, `Preview does not execute package import ${specifier}.`);
        const base = path.posix.resolve(path.posix.dirname(from), specifier);
        const found = [base, ...['.ts', '.tsx', '.js', '/index.ts'].map(ext => base + ext)].find(p => Object.hasOwn(files, p));
        if (!found) fail(node, `Missing preview dependency ${specifier}.`);
        return found;
    };
    const functionValue = (node, scope) => ({kind: 'function', node, scope, file: currentFile});
    const bind = (pattern, value, scope) => {
        if (pattern.type === 'Identifier') scope.set(pattern.name, value);
        else if (pattern.type === 'AssignmentPattern') bind(pattern.left, value === undefined ? evaluate(pattern.right, scope) : value, scope);
        else if (pattern.type === 'ArrayPattern') {
            if (!Array.isArray(value)) fail(pattern, 'Preview tuple bindings require an array.');
            pattern.elements.forEach((element, index) => {if (element) bind(element, value[index], scope);});
        }
        else if (pattern.type === 'ObjectPattern') {
            for (const prop of pattern.properties) {
                if (prop.type !== 'ObjectProperty' || prop.computed) fail(prop, 'This parameter pattern is not supported.');
                const name = key(prop.key.name ?? prop.key.value, prop);
                bind(prop.value, value?.[name], scope);
            }
        } else fail(pattern, 'This parameter pattern is not supported.');
    };
    const invoke = (fn, args, node) => {
        if (fn?.kind !== 'function') fail(node, 'Only source-mapped local render helpers can be called.');
        if (++depth > 40) fail(node, 'Preview call depth exceeded.');
        const previous = currentFile;
        currentFile = fn.file;
        try {
            const scope = new Map(fn.scope);
            fn.node.params.forEach((param, index) => bind(param, args[index], scope));
            if (fn.node.body.type !== 'BlockStatement') return evaluate(fn.node.body, scope);
            const run = (statement, blockScope, nesting = 0) => {
                if (++operations > 20000 || nesting > 40) fail(statement, 'Preview statement budget exceeded.');
                if (statement.type === 'VariableDeclaration') {
                    if (statement.kind === 'var' && nesting > 0) fail(statement, 'Use block-scoped declarations in preview branches.');
                    for (const declaration of statement.declarations) bind(declaration.id, evaluate(declaration.init, blockScope), blockScope);
                } else if (statement.type === 'ReturnStatement') return {value: evaluate(statement.argument, blockScope)};
                else if (statement.type === 'IfStatement') {
                    const branch = evaluate(statement.test, blockScope) ? statement.consequent : statement.alternate;
                    if (branch) return run(branch, blockScope, nesting + 1);
                } else if (statement.type === 'BlockStatement') {
                    const local = new Map(blockScope);
                    for (const child of statement.body) {
                        const result = run(child, local, nesting + 1);
                        if (result) return result;
                    }
                }
                else if (statement.type === 'ExpressionStatement' && statement.expression.type === 'CallExpression'
                    && statement.expression.callee.type === 'MemberExpression' && !statement.expression.callee.computed
                    && statement.expression.callee.property.name === 'collectStylesFrom') evaluate(statement.expression, blockScope);
                else if (!['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'EmptyStatement'].includes(statement.type)) fail(statement, `Preview does not execute ${statement.type}.`);
            };
            for (const statement of fn.node.body.body) {
                const result = run(statement, scope);
                if (result) return result.value;
            }
        } finally { currentFile = previous; depth--; }
    };
    const lookup = (name, scope, node) => {
        if (!scope.has(name)) fail(node, `Dynamic value '${name}' needs a supported preview adapter.`);
        let value = scope.get(name);
        if (value?.kind === 'lazy') {
            scope.set(name, {kind: 'resolving'});
            value = value.read();
            scope.set(name, value);
        }
        if (value?.kind === 'resolving') fail(node, 'Circular preview dependency.');
        return value;
    };
    const evaluate = (node, scope) => {
        const value = evaluateExpression(node, scope);
        if (node) evaluated.set(node, value);
        return value;
    };
    const evaluateExpression = (node, scope) => {
        if (++operations > 20000) fail(node, 'Preview expression budget exceeded.');
        if (!node) return undefined;
        let value;
        switch (node.type) {
            case 'StringLiteral': return literalHtml.literal(node, currentFile, node.value);
            case 'NumericLiteral': case 'BooleanLiteral': return node.value;
            case 'NullLiteral': return null;
            case 'UnaryExpression':
                if (node.operator === '!') return !evaluate(node.argument, scope);
                if (node.operator === '-' || node.operator === '+') {
                    const operand = evaluate(node.argument, scope);
                    if (typeof operand !== 'number') fail(node, 'Preview numeric operators require a number.');
                    return node.operator === '-' ? -operand : operand;
                }
                break;
            case 'Identifier': return node.name === 'undefined' ? undefined : lookup(node.name, scope, node);
            case 'ThisExpression': return lookup('this', scope, node);
            case 'TSAsExpression': case 'TSNonNullExpression': case 'ParenthesizedExpression': return evaluate(node.expression, scope);
            case 'TemplateLiteral': return check(literalHtml.template(node,currentFile,node.expressions.map(expression=>evaluate(expression,scope))),node);
            case 'ArrayExpression': return check(node.elements.map(item => evaluate(item, scope)), node);
            case 'ObjectExpression': {
                value = Object.create(null);
                for (const prop of node.properties) {
                    if (prop.type === 'SpreadElement') {
                        const source = evaluate(prop.argument, scope);
                        if (!source || typeof source !== 'object' || instances.has(source) || source.kind === 'function') fail(prop, 'Only plain property maps can be spread in preview.');
                        for (const [name, entry] of Object.entries(source)) value[key(name, prop)] = entry;
                        continue;
                    }
                    if (prop.type !== 'ObjectProperty') fail(prop, 'Object methods are not supported in preview.');
                    value[key(prop.computed ? evaluate(prop.key, scope) : prop.key.name ?? prop.key.value, prop)] = evaluate(prop.value, scope);
                }
                return value;
            }
            case 'ArrowFunctionExpression': case 'FunctionExpression': return functionValue(node, scope);
            case 'RegExpLiteral': return previewRegExp(node.pattern, node.flags, message => fail(node, message));
            case 'ConditionalExpression': return evaluate(evaluate(node.test, scope) ? node.consequent : node.alternate, scope);
            case 'LogicalExpression': {
                const left = evaluate(node.left, scope);
                if (node.operator === '||') return left || evaluate(node.right, scope);
                if (node.operator === '&&') return left && evaluate(node.right, scope);
                if (node.operator === '??') return left ?? evaluate(node.right, scope);
                break;
            }
            case 'BinaryExpression': {
                const left = evaluate(node.left, scope), right = evaluate(node.right, scope);
                if (node.operator === '+') return check(typeof left === 'string' || typeof right === 'string' ? literalHtml.concatenate([left,right]) : left + right, node);
                if (node.operator === '===') return left === right;
                if (node.operator === '!==') return left !== right;
                break;
            }
            case 'MemberExpression': {
                const object = evaluate(node.object, scope), name = key(node.computed ? evaluate(node.property, scope) : node.property.name, node);
                if (object && Object.hasOwn(object, name)) return object[name];
                if (name === 'length' && (typeof object === 'string' || Array.isArray(object))) return object.length;
                return undefined;
            }
            case 'NewExpression': {
                const ctor = evaluate(node.callee, scope);
                if (ctor?.kind !== 'sdk' || !Object.hasOwn(methods, ctor.name)) fail(node, 'Only supported SDK DOM helpers can be constructed.');
                const args = node.arguments.map(arg => evaluate(arg, scope));
                args.forEach(arg => inspectSdkInput(arg, node));
                const instance = new sdk[ctor.name](...args);
                instances.set(instance, ctor.name);
                sdkEntries.set(instance, ctor.entry);
                // SDK 1.6 allows an isolated owner shared by trusted helpers.
                // The preview owns this collector; legacy global sheets must not
                // leak between plugins or concurrent preview requests.
                if (typeof sdk.DOM?.prototype.collectStylesFrom === 'function') {
                    previewCollector ||= new sdk.DOM().collectStylesFrom();
                    previewCollector.collectStylesFrom(instance);
                }
                return instance;
            }
            case 'CallExpression': {
                const args = node.arguments.map(arg => evaluate(arg, scope));
                if (node.callee.type === 'Identifier' && node.callee.name === 'String') {
                    const input = args[0];
                    if (input !== null && typeof input === 'object') fail(node, 'Object coercion is not supported.');
                    return String(input);
                }
                if (node.callee.type === 'MemberExpression') {
                    const object = evaluate(node.callee.object, scope);
                    const name = key(node.callee.computed ? evaluate(node.callee.property, scope) : node.callee.property.name, node);
                    const sdkClass = instances.get(Object(object));
                    if (sdkClass && name === 'collectStylesFrom') {
                        if (typeof object.collectStylesFrom !== 'function') fail(node, 'The installed SDK does not support isolated style collectors.');
                        if (args.some(arg => !instances.has(Object(arg)))) fail(node, 'Style collectors accept only supported preview-owned SDK helpers.');
                        object.collectStylesFrom(...args);
                        return object;
                    }
                    if (sdkClass && methods[sdkClass].has(name)) {
                        args.forEach(arg => inspectSdkInput(arg, node));
                        if (sdkClass === 'DOM' && name === 'createElement') {
                            const id = `element-${elements.length + 1}`;
                            const activeBindings = (cssBindings.get(currentFile) || []).filter(binding => {
                                const dependency = path.posix.resolve(path.posix.dirname(currentFile), binding.source);
                                return css.has(dependency) && lookup(binding.local, scope, node) === css.get(dependency);
                            });
                            const optionsKey = JSON.stringify([currentFile, activeBindings]);
                            if (!styleOptionsCache.has(optionsKey)) {
                                const options = [];
                                for (const binding of activeBindings) {
                                    const dependency = path.posix.resolve(path.posix.dirname(currentFile), binding.source);
                                    const map = css.get(dependency);
                                    for (const key of Object.keys(map)) if (options.length < 200 && /^[\w-]+$/.test(key) && !forbidden.has(key) && map[key] && typeof map[key] === 'object') {
                                        options.push({file: dependency, key, binding: binding.local});
                                    }
                                }
                                styleOptionsCache.set(optionsKey, options);
                            }
                            const styleOptions = styleOptionsCache.get(optionsKey);
                            const styleSheets = activeBindings.map(binding => ({file: path.posix.resolve(path.posix.dirname(currentFile), binding.source), binding: binding.local}));
                            const classProperty = node.arguments[1]?.properties?.find(property => property.type === 'ObjectProperty' && !property.computed && ['class', 'className'].includes(property.key.name ?? property.key.value));
                            const classSource = classProperty && styleCalls.get(classProperty.value);
                            elementCalls.set(id, {node, file: currentFile, attributes: args[1] || {}, scope, scopeValues: new Map(scope), styleOptions, styleSheets, classSource, dom: object});
                            const literal = node.arguments[2];
                            const plainText = args.length === 3 && typeof args[2] === 'string' && !/[<>]/.test(args[2]) &&
                                (literal?.type === 'StringLiteral' || (literal?.type === 'TemplateLiteral' && literal.expressions.length === 0));
                            elements.push({id, tag: String(args[0]), label: String(args[0]) + (plainText ? ' · ' + decodePreviewText(args[2]).slice(0, 60) : args[1]?.['data-role'] ? ' · ' + args[1]['data-role'] : ''),
                                location: {path: currentFile, line: node.loc.start.line, column: node.loc.start.column + 1, endLine: node.loc.end.line, endColumn: node.loc.end.column + 1},
                                text: plainText ? {file: currentFile, start: literal.start, end: literal.end, value: decodePreviewText(args[2])} : null,
                                classNames: String(args[1]?.class || args[1]?.className || '').split(/\s+/).filter(Boolean)});
                            args[1] = {...args[1], 'data-fdo-ui-id': id};
                        }
                        const output = check(object[name](...args), node);
                        if (sdkClass === 'DOM' && name === 'renderHTML' && typeof args[0] === 'string') {
                            literalHtml.wrap(args[0], output);
                            const emitted = renderedDomInstances.get(object) || new Set();
                            for (const match of args[0].matchAll(/\bdata-fdo-ui-id="([^"]+)"/g)) emitted.add(match[1]);
                            renderedDomInstances.set(object, emitted);
                        }
                        if (name === 'createClassFromStyle' && styleSources.has(args[0])) {
                            const entries = classSources.get(output) || [];
                            const source = styleSources.get(args[0]);
                            styleCalls.set(node, source);
                            if (!entries.some(item => item.file === source.file && item.key === source.key)) entries.push(source);
                            classSources.set(output, entries);
                        }
                        return output;
                    }
                    if (name === 'includes' && (typeof object === 'string' || Array.isArray(object))) {
                        if (args.length > 2 || args[1] !== undefined && typeof args[1] !== 'number') fail(node, 'Preview includes requires a numeric start position.');
                        if (typeof object === 'string') {
                            if (args[0] !== null && typeof args[0] === 'object') fail(node, 'Preview string includes requires a primitive search value.');
                            const search = String(args[0]);
                            check(object, node); check(search, node);
                            return object.includes(search, args[1]);
                        }
                        if ((operations += object.length) > 20000) fail(node, 'Preview expression budget exceeded.');
                        return object.includes(args[0], args[1]);
                    }
                    if (Array.isArray(object) && name === 'join') {
                        if (object.some(item => item !== null && typeof item === 'object')) fail(node, 'Preview join requires primitive values.');
                        const separator = args[0] === undefined ? ',' : String(args[0]);
                        if (object.reduce((sum, item) => sum + String(item ?? '').length, 0) + separator.length * Math.max(0, object.length - 1) > 500000) fail(node, 'Preview output exceeds 500 KB.');
                        const parts = [];
                        object.forEach((entry,index)=>{if(index) parts.push(separator);parts.push(entry ?? '');});
                        return check(literalHtml.concatenate(parts), node);
                    }
                    if (Array.isArray(object) && name === 'map') return object.map((item, i) => invoke(args[0], [item, i], node));
                    if (typeof object === 'string' && ['replace', 'replaceAll'].includes(name)) {
                        if (args.length !== 2) fail(node, 'Preview replacement requires a search and replacement.');
                        const copies = [];
                        const output = check(replacePreviewString(object, args[0], args[1], {all: name === 'replaceAll', reject: message => fail(node, message),
                            invoke: (fn, values) => invoke(fn, values, node), onCopy: copy => copies.push(copy), tick: () => {if (++operations > 20000) fail(node, 'Preview replacement expression budget exceeded.');}}), node);
                        literalHtml.replace(object,output,copies);
                        return output;
                    }
                    fail(node, `Method '${name}' is outside the read-only preview subset.`);
                }
                const callable = evaluate(node.callee, scope);
                if (callable?.kind === 'sdk' && Object.values(SDK_COMPONENT_ADAPTERS).includes(callable.name)) {
                    const definition = /^1\.\d+\.\d+$/.test(componentContract?.contractVersion || '') && componentContract.components?.find(item => item.create === callable.name);
                    if (!definition || SDK_COMPONENT_ADAPTERS[definition.identity] !== callable.name || definition.preview?.markupOnly !== true || definition.preview?.handlers !== false || definition.preview?.backendExecution !== false || !instances.has(args[0]) || instances.get(args[0]) !== 'DOM' || args.length !== 2) fail(node, `SDK component ${callable.name} requires a dedicated Live UI source adapter with a supported installed component contract. Mount functions and handlers cannot run in static preview.`);
                    inspectSdkInput(args[1], node);
                    const id = 'element-' + (elements.length + 1);
                    const output = check(sdk[callable.name](...args), node);
                    if (typeof output !== 'string' || !output.includes('data-fdo-component="' + definition.identity + '"')) fail(node, 'SDK component did not return its declared markup identity.');
                    const tag = /^\s*<([a-z][a-z0-9-]*)\b/i.exec(output)?.[1];
                    if (!tag) fail(node, 'SDK component did not return a markup root.');
                    const element = {id, tag, label: definition.name + (args[1]?.title ? ' · ' + String(args[1].title).slice(0, 60) : ''),
                        location: {path: currentFile, line: node.loc.start.line, column: node.loc.start.column + 1, endLine: node.loc.end.line, endColumn: node.loc.end.column + 1},
                        classNames: [], text: null,
                        sdkComponent: describeSdkComponent(node, currentFile, definition, args[1], files[currentFile], files)};
                    elementCalls.set(id, {node, file: currentFile, attributes: {}, scope, scopeValues: new Map(scope), dom: args[0]});
                    elements.push(element);
                    return output.replace(/^(\s*<[a-z][a-z0-9-]*)\b/i, '$1 data-fdo-ui-id="' + id + '"');
                }
                return check(invoke(callable, args, node), node);
            }
            default: break;
        }
        fail(node, `Unsupported preview expression: ${node.type}. Use the IDE to inspect this code.`);
    };
    const load = file => {
        if (modules.has(file)) return modules.get(file);
        const previous = currentFile; currentFile = file;
        try {
            const ast = parse(files[file], {sourceType: 'module', plugins: ['typescript', 'jsx']});
            const scope = new Map(), exports = new Map();
            const module = {scope, exports, ast}; modules.set(file, module);
            const defer = read => ({kind: 'lazy', read: () => {const old = currentFile; currentFile = file; try { return read(); } finally {currentFile = old;}}});
            for (const statement of ast.program.body) {
                if (statement.type === 'ImportDeclaration') {
                    if (statement.importKind === 'type') continue;
                    for (const spec of statement.specifiers) {
                        if (spec.importKind === 'type') continue;
                        const imported = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.imported?.name;
                        if (spec.type === 'ImportDefaultSpecifier' && statement.source.value.startsWith('.') && statement.source.value.endsWith('.css')) {
                            const bindings = cssBindings.get(file) || [];
                            bindings.push({local: spec.local.name, source: statement.source.value});
                            cssBindings.set(file, bindings);
                        }
                        scope.set(spec.local.name, defer(() => {
                            if (['@anikitenko/fdo-sdk', '@anikitenko/fdo-sdk/ui'].includes(statement.source.value)) return {kind: 'sdk', name: imported, entry: statement.source.value};
                            const dependency = resolve(file, statement.source.value, statement);
                            if (dependency.endsWith('.css')) return css.get(dependency);
                            const target = load(dependency);
                            return lookup(target.exports.get(imported), target.scope, statement);
                        }));
                    }
                    continue;
                }
                const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
                if (declaration?.type === 'FunctionDeclaration') {
                    scope.set(declaration.id.name, functionValue(declaration, scope));
                    if (statement.type === 'ExportNamedDeclaration') exports.set(declaration.id.name, declaration.id.name);
                } else if (declaration?.type === 'VariableDeclaration') {
                    for (const variable of declaration.declarations) {
                        if (variable.id.type !== 'Identifier') continue;
                        scope.set(variable.id.name, defer(() => evaluate(variable.init, scope)));
                        if (statement.type === 'ExportNamedDeclaration') exports.set(variable.id.name, variable.id.name);
                    }
                }
                // Module initialization and class constructors are never executed.
            }
            return module;
        } finally {currentFile = previous;}
    };
    try {
        for (const file of Object.keys(files).filter(file => file.endsWith('.css'))) {
            currentFile = file;
            const source = await compileCssStyleModule(files, file);
            const map = JSON.parse(source.slice('export default '.length, -1));
            css.set(file, map);
            for (const [key, value] of Object.entries(map)) if (/^[\w-]+$/.test(key) && value && typeof value === 'object') styleSources.set(value, {file, key});
        }
        currentFile = '/index.ts';
        const main = load('/index.ts');
        const plugin = main.ast.program.body.map(node => node.declaration || node).find(node => node.type === 'ClassDeclaration' && node.body.body.some(member => member.type === 'ClassMethod' && member.key.name === 'render'));
        if (!plugin) fail(null, 'No supported plugin class render() was found in /index.ts.');
        const self = Object.create(null);
        main.scope.set('this', self);
        for (const member of plugin.body.body) {
            if (member.type === 'ClassProperty' && member.key.type === 'Identifier' && member.value) {
                try {self[key(member.key.name, member)] = evaluate(member.value, main.scope);} catch { /* Dynamic state stays unsupported. */ }
            }
        }
        const metadata = plugin.body.body.find(member => member.type === 'ClassMethod' && member.kind === 'get' && member.key.name === 'metadata');
        if (metadata) self.metadata = invoke(functionValue(metadata, main.scope), [], metadata);
        const render = plugin.body.body.find(member => member.type === 'ClassMethod' && member.key.name === 'render');
        const html = invoke(functionValue(render, main.scope), [], render);
        if (typeof html !== 'string') fail(render, 'The supported render path must return an HTML string.');
        const styleCache = new Map();
        for (const element of elements) {
            const directSource = elementCalls.get(element.id)?.classSource;
            element.styles = element.classNames.flatMap(className => (classSources.get(className) || []).filter(source => !directSource || (source.file === directSource.file && source.key === directSource.key)).map(source => {
                const cacheKey = source.file + ':' + source.key;
                if (!styleCache.has(cacheKey)) styleCache.set(cacheKey, {...describeCssStyle(files, source.file, source.key), copyStyle: css.get(source.file)?.[source.key]});
                return styleCache.get(cacheKey);
            }));
        }
        describeStructure(files, elements, elementCalls, evaluated, html);
        describeSdkSlots(elements, elementCalls, evaluated);
        describeSdkInsertions(files, elements, elementCalls, html, componentContract, sdkEntries);
        describeStyleAssignments(elements, elementCalls, renderedDomInstances);
        const actions=describeButtonActions(files, elements, elementCalls, main.ast, plugin);
        describeSdkAsyncActions(files,elements,actions);
        const localTargets=describeLocalActions(files,elements,elementCalls,html,actions);
        describeSdkOpeners(files,elements,elementCalls,!!actions,localTargets?.targets || []);
        describeToastActions(files,elements,elementCalls,!!actions,html);
        describeAttributes(files, elements, elementCalls);
        describeClassNames(files,elements,elementCalls);
        describeInputKinds(files,elements,elementCalls);
        for (const element of elements) element.styles = element.styles.map(style => ({...style, isolationReason: isolationReason(element, style)}));
        const literal = literalHtml.describe(html,elements);
        elements.push(...literal.elements);
        return {status: 'ready', html:literal.html, elements, actions:[...describeActionCatalog(files,elements,actions,main.ast,plugin),...sdkAsyncActionCatalog(elements)], message: 'Select an element to inspect its source. Backend actions are disabled.'};
    } catch (error) {
        return {status: 'unsupported', html: '', message: error.message, location: error.location || {path: currentFile, line: error.loc?.line || 1, column: (error.loc?.column || 0) + 1}};
    }
}
