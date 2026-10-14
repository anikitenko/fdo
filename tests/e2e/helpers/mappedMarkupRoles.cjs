const {parse} = require('@babel/parser');
const path = require('node:path').posix;

// Recognize literal metadata arrays actually consumed by a template's map.
// Do not execute generated code or count role strings from comments/tests.
function mappedMarkupRoles(files) {
  const modules = new Map();
  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return;
    if (node.type) visit(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(item => walk(item, visit));
      else if (value && typeof value === 'object') walk(value, visit);
    }
  };
  const unwrap = node => ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(node?.type) ? unwrap(node.expression) : node;
  for (const [file, source] of Object.entries(files)) {
    if (!/\.[jt]sx?$/.test(file) || /(?:^|\/)__tests__\/|\.(?:test|spec)\.[jt]sx?$/.test(file)) continue;
    try {
      const ast = parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx']});
      const arrays = new Map(), imports = new Map();
      for (const statement of ast.program.body) {
        const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
        if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) {
          if (unwrap(item.init)?.type === 'ArrayExpression') arrays.set(item.id.name, unwrap(item.init));
        }
        if (statement.type === 'ImportDeclaration' && statement.source.value.startsWith('.')) {
          const base = path.resolve(path.dirname(file), statement.source.value);
          const target = [base, ...['.ts', '.tsx', '.js', '.jsx'].map(ext => base + ext)].find(candidate => files[candidate]);
          for (const spec of statement.specifiers) if (spec.type === 'ImportSpecifier') imports.set(spec.local.name, {target, name: spec.imported.name});
        }
      }
      modules.set(file, {ast, arrays, imports});
    } catch { /* The main rubric reports syntax errors. */ }
  }
  const roles = new Set();
  for (const module of modules.values()) walk(module.ast, node => {
    if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression' || node.callee.property.name !== 'map') return;
    const name = node.callee.object.name;
    const imported = module.imports.get(name);
    const array = module.arrays.get(name) || modules.get(imported?.target)?.arrays.get(imported?.name);
    const callback = node.arguments[0];
    if (!array || !['ArrowFunctionExpression', 'FunctionExpression'].includes(callback?.type) || callback.params[0]?.type !== 'Identifier') return;
    walk(callback.body, template => {
      if (template.type !== 'TemplateLiteral') return;
      template.expressions.forEach((expression, index) => {
        if (expression.type !== 'MemberExpression' || expression.computed || expression.object.name !== callback.params[0].name) return;
        if (!/data-role=["']$/.test(template.quasis[index].value.cooked || '') || !/^["']/.test(template.quasis[index + 1].value.cooked || '')) return;
        for (const element of array.elements) {
          const property = unwrap(element)?.properties?.find(item => item.type === 'ObjectProperty'
            && !item.computed && (item.key.name || item.key.value) === expression.property.name);
          if (property?.value.type === 'StringLiteral') roles.add(property.value.value);
        }
      });
    });
  });
  return roles;
}

module.exports = {mappedMarkupRoles};
