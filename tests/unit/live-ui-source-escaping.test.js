/** @jest-environment node */
import {parseExpression} from '@babel/parser';
import {escapeUnsafeJsChars} from '../../src/utils/plugins/authoring/liveUi/serializedJsLiteral';
import {describeHandlerEdits} from '../../src/utils/plugins/authoring/liveUi/handlerEdits';

test.each([
    'Quoted "label" and \'apostrophe\'',
    'C:\\tools\\new\\file',
    'first\nsecond\r\nthird\t\b\f\0',
    'literal \\n \\u003C \\" escapes',
    '</script><script>alert("x")</script> & /',
    'Unicode é 🔐\u2028separator\u2029end',
    {key: 'quoted"key', label: 'line\nbreak', nested: ['\\path', '</script>'], enabled: true},
])('serialized values keep their exact value after source embedding: %p', value => {
    const encoded = escapeUnsafeJsChars(JSON.stringify(value));
    expect(JSON.parse(encoded)).toEqual(value);
    expect(() => parseExpression(encoded)).not.toThrow();
    expect(encoded).not.toMatch(/[<>\u2028\u2029]/);
});

const callback = '({element}) => {\n  // Keep executable syntax and string escapes.\n  if (element) element.textContent = "a\\nb\\\\c<>/";\n}';
test.each([
    ['arrow', 'handle: ' + callback, callback],
    ['function', 'handle: function ({element}) {\n  if (element) element.textContent="a\\nb";\n}', 'function ({element}) {\n  if (element) element.textContent="a\\nb";\n}'],
    ['serialized callback', 'handle: ' + JSON.stringify(callback), callback],
    ['method', 'async handle({element}) {\n  if (element) element.textContent="a\\nb";\n}', 'async function ({element}) {\n  if (element) element.textContent="a\\nb";\n}'],
])('extracts %s without applying string-content escapes to executable code', (_kind, property, expected) => {
    const source = '({' + property + '})';
    const object = parseExpression(source), node = object.properties[0];
    const result = describeHandlerEdits({'/actions.ts': source}, '/actions.ts', object, new Map([['handle', node]]), []);
    expect(result.handlers.get('handle')).toMatchObject({functionSource: expected, editReason: ''});
    expect(() => parseExpression(result.handlers.get('handle').functionSource)).not.toThrow();
});
