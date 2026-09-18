const {pluginHeading} = require('../e2e/helpers/pluginHeading.cjs');
const recorded = require('../fixtures/ai/rename-prop-heading.json');
const {BLANK_TEMPLATE_MAIN, BLANK_TEMPLATE_RENDER} = require('../../src/components/editor/utils/virtualTemplates');

test('accepts the actual live response passing metadata.name to the heading', () => {
  expect(pluginHeading(recorded)).toBe('Quasar Quill');
});
test('also accepts a hard-coded heading', () => {
  expect(pluginHeading({'/index.ts': BLANK_TEMPLATE_MAIN('Quasar Quill'), '/render.tsx': BLANK_TEMPLATE_RENDER().replace('`My Plugin`', '`Quasar Quill`')})).toBe('Quasar Quill');
});
test('rejects missing name wiring even though the entry contains the renamed metadata', () => {
  const files = {...recorded, '/index.ts': recorded['/index.ts'].replace('name: metadata.name,', '')};
  expect(() => pluginHeading(files)).toThrow('Missing render prop: name');
});
test('detects the wrong value being passed into an otherwise correct render module', () => {
  const files = {...recorded, '/index.ts': recorded['/index.ts'].replace('name: metadata.name,', 'name: "Wrong heading",')};
  expect(pluginHeading(files)).toBe('Wrong heading');
});
test('does not evaluate arbitrary generated JavaScript', () => {
  const files = {...recorded, '/index.ts': recorded['/index.ts'].replace('name: metadata.name,', 'name: process.exit(1),')};
  expect(() => pluginHeading(files)).toThrow('Unsupported heading expression: CallExpression');
});
