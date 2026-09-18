const {parse} = require('@babel/parser');
function walk(node, visit, method = '') {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ClassMethod') method = node.key.name || node.key.value || '';
  visit(node, method);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, method));
    else if (value && typeof value === 'object') walk(value, visit, method);
  }
}
function evaluatePluginCode(files, handler = 'inspectStatus') {
  const violations = [];
  let registered = false, returnsValue = false, uiRequest = false, instantiated = false, binding = false;
  let tests = 0, assertions = 0, testsRender = false, renderCalls = 0;
  for (const [path, content] of Object.entries(files)) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    let ast;
    try { ast = parse(content, {sourceType: 'module', plugins: ['typescript', 'jsx']}); }
    catch (error) { violations.push(`${path}: ${error.message}`); continue; }
    const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
    const testNames = new Set(), assertNames = new Set(), renderNames = new Set(), pluginClasses = new Set();
    walk(ast, node => {
      if (node.type === 'ImportDeclaration') {
        const source = node.source.value;
        if (/^(electron|@anikitenko\/fdo-sdk\/|(?:node:)?(?:fs|child_process)|[\/]|.*(?:src\/ipc|src\/main))/.test(source)) violations.push(`${path}: forbidden import ${source}`);
        if (isTest && source === 'node:test') node.specifiers.forEach(item => testNames.add(item.local.name));
        if (isTest && source === 'node:assert/strict') node.specifiers.forEach(item => assertNames.add(item.local.name));
        if (isTest && /^\.\/render(?:\.[jt]sx?)?$/.test(source)) { testsRender = true; node.specifiers.forEach(item => renderNames.add(item.local.name)); }
      }
      if (node.type === 'ClassDeclaration' && node.superClass?.name === 'FDO_SDK') pluginClasses.add(node.id?.name);
    });
    walk(ast, (node, method) => {
      if (node.type === 'NewExpression' && pluginClasses.has(node.callee?.name)) instantiated = true;
      if (!isTest && node.type === 'MemberExpression' && ['window', 'document'].includes(node.object?.name) && method !== 'renderOnLoad') violations.push(`${path}: browser API outside renderOnLoad`);
      if (!isTest && method === 'renderOnLoad' && node.type === 'ObjectExpression') {
        const props = Object.fromEntries(node.properties.filter(p => p.type === 'ObjectProperty').map(p => [p.key.name || p.key.value, p.value.value]));
        if (props.handler === handler && props.event === 'click' && typeof props.selector === 'string') binding = true;
      }
      if (node.type !== 'CallExpression') return;
      const name = node.callee?.property?.name;
      if (!isTest && name === 'registerHandler' && node.arguments[0]?.value === handler && method === 'init') {
        registered = true;
        const callback = node.arguments[1];
        if (callback?.type === 'ArrowFunctionExpression' && callback.body.type !== 'BlockStatement' && callback.body.name !== 'undefined') returnsValue = true;
        if (callback) walk(callback.body, child => { if (child.type === 'ReturnStatement' && child.argument && child.argument.name !== 'undefined') returnsValue = true; });
      }
      if (!isTest && name === 'createBackendReq' && method === 'renderOnLoad') {
        walk(node, child => { if (child.type === 'ObjectProperty' && (child.key.name || child.key.value) === 'handler' && child.value.value === handler) uiRequest = true; });
      }
      if (isTest && testNames.has(node.callee?.name)) tests++;
      if (isTest && renderNames.has(node.callee?.name)) renderCalls++;
      if (isTest && (assertNames.has(node.callee?.object?.name) || assertNames.has(node.callee?.name))) assertions++;
      if (node.callee?.name === 'require' && /electron|(?:^|:)fs|child_process|@anikitenko\/fdo-sdk\//.test(node.arguments[0]?.value || '')) violations.push(`${path}: forbidden require`);
    });
  }
  const checks = {registeredInInit: registered, handlerReturnsValue: returnsValue, matchingUiRequest: uiRequest, clickBinding: binding,
    pluginInstantiated: instantiated, renderTestsImported: testsRender, renderExercised: renderCalls > 0, atLeastTwoTests: tests >= 2, assertionsPresent: assertions >= 2};
  return {checks, violations, passed: Object.values(checks).every(Boolean) && !violations.length};
}
module.exports = {evaluatePluginCode};
