const {parse} = require('@babel/parser');
const ast = code => parse(code, {sourceType: 'module', plugins: ['typescript', 'jsx']});
const unwrap = node => node?.type === 'TSAsExpression' || node?.type === 'TSNonNullExpression' ? unwrap(node.expression) : node;
// Evaluate only literal data flow. Never execute generated plugin code or load its imports.
function value(input, scope, self = {}) {
  const node = unwrap(input);
  if (!node) throw new Error('Missing heading value or render argument');
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return node.value;
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(property => {
    if (property.type !== 'ObjectProperty') throw new Error('Unsupported render object property');
    return [property.key.name || property.key.value, value(property.value, scope, self)];
  }));
  if (node.type === 'Identifier') {
    if (!Object.hasOwn(scope, node.name)) throw new Error(`Unresolved heading value: ${node.name}`);
    return scope[node.name]();
  }
  if (node.type === 'ThisExpression') return self;
  if (node.type === 'MemberExpression') {
    const object = value(node.object, scope, self);
    const key = node.computed ? value(node.property, scope, self) : node.property.name;
    if (!object || !Object.hasOwn(object, key)) throw new Error(`Missing heading property: ${key}`);
    return object[key];
  }
  if (node.type === 'TemplateLiteral') return node.quasis.reduce((text, part, index) => text + part.value.cooked + (node.expressions[index] ? value(node.expressions[index], scope, self) : ''), '');
  if (node.type === 'BinaryExpression' && node.operator === '+') return value(node.left, scope, self) + value(node.right, scope, self);
  throw new Error(`Unsupported heading expression: ${node.type}`);
}
function declarations(statements, scope, self) {
  for (const statement of statements) if (statement.type === 'VariableDeclaration') {
    for (const declaration of statement.declarations) if (declaration.id.type === 'Identifier') {
      scope[declaration.id.name] = () => value(declaration.init, scope, self);
    }
  }
}
function pluginHeading(files) {
  const index = ast(files['/index.ts']).program.body;
  const declaration = index.map(node => node.declaration || node).find(node => node.type === 'ClassDeclaration' && node.body.body.some(member => member.key?.name === 'render'));
  if (!declaration) throw new Error('Missing plugin render method');
  const members = declaration.body.body;
  const self = {}, scope = {};
  for (const member of members) if (member.type === 'ClassProperty' && member.value) {
    Object.defineProperty(self, member.key.name, {get: () => value(member.value, scope, self)});
  }
  const getter = members.find(member => member.kind === 'get' && member.key.name === 'metadata');
  if (getter) Object.defineProperty(self, 'metadata', {get: () => value(getter.body.body.find(node => node.type === 'ReturnStatement')?.argument, scope, self)});
  const render = members.find(member => member.key?.name === 'render');
  declarations(render.body.body, scope, self);
  const call = unwrap(render.body.body.find(node => node.type === 'ReturnStatement')?.argument);
  const imported = index.find(node => node.type === 'ImportDeclaration' && /^\.\/render(?:\.[jt]sx?)?$/.test(node.source.value));
  const specifier = imported?.specifiers.find(item => item.local.name === call?.callee?.name);
  if (call?.type !== 'CallExpression' || !specifier) throw new Error('Cannot resolve the plugin render call');
  const props = call.arguments.length ? value(call.arguments[0], scope, self) : {};
  const exported = specifier.imported?.name || 'default';
  const nodes = ast(files['/render.tsx']).program.body.map(node => node.declaration || node);
  let fn;
  for (const node of nodes) {
    if (node.type === 'FunctionDeclaration' && (node.id?.name === exported || exported === 'default')) fn = node;
    if (node.type === 'VariableDeclaration') fn ||= node.declarations.find(item => item.id.name === exported)?.init;
  }
  if (!fn?.body?.body) throw new Error('Cannot resolve exported render function');
  const locals = {};
  const param = fn.params[0];
  if (param?.type === 'Identifier') locals[param.name] = () => props;
  else if (param?.type === 'ObjectPattern') for (const property of param.properties) {
    const key = property.key?.name;
    const local = property.value?.name;
    if (!local) throw new Error('Unsupported render parameter');
    locals[local] = () => {
      if (!Object.hasOwn(props, key)) throw new Error(`Missing render prop: ${key}`);
      return props[key];
    };
  }
  declarations(fn.body.body, locals, {});
  const headings = [];
  for (const statement of fn.body.body) {
    const expressions = statement.type === 'VariableDeclaration' ? statement.declarations.map(item => item.init) : [statement.expression];
    for (const expression of expressions) if (expression?.type === 'CallExpression' && expression.callee?.property?.name === 'createHText' && value(expression.arguments[0], locals) === 1) {
      headings.push(value(expression.arguments[1], locals));
    }
  }
  if (headings.length !== 1) throw new Error(`Expected one resolvable h1 heading, found ${headings.length}`);
  return headings[0];
}
module.exports = {pluginHeading};
