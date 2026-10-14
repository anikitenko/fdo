import {readPluginAcceptanceCriteria, validatePluginAcceptanceCriteria} from '../../src/utils/plugins/authoring/pluginAcceptanceCriteria';
const criterion = {id: 'json', description: 'Formats JSON', testFile: '/json.test.ts', testName: 'formats JSON'};
const guide = criteria => ({path: '/SKILL.md', content: '<!-- fdo-acceptance -->\n~~~json\n' + JSON.stringify(criteria) + '\n~~~'});
test('acceptance criteria preserve approved descriptions and test identities', () => {
    expect(readPluginAcceptanceCriteria(guide([criterion]).content)).toEqual([criterion]);
    expect(validatePluginAcceptanceCriteria([guide([criterion]), {path: '/json.test.ts', content: 'import {test} from "node:test"; test("formats JSON", () => {});'}])).toEqual([]);
});
test.each([
    'import {test} from "node:test"; test.skip("formats JSON", () => {});',
    'import {test} from "node:test"; test("formats JSON", {skip: true}, () => {});',
    'function test() {} test("formats JSON", () => {});',
    'import {test} from "node:test"; function neverCalled() {test("formats JSON", () => {});}',
])('does not count skipped, shadowed or uncalled declarations as acceptance tests', content => {
    expect(validatePluginAcceptanceCriteria([guide([criterion]), {path: '/json.test.ts', content}])).toHaveLength(1);
});
test('rejects duplicate criteria and invalid test paths', () => {
    expect(() => readPluginAcceptanceCriteria(guide([criterion, criterion]).content)).toThrow();
    expect(() => readPluginAcceptanceCriteria(guide([{...criterion, testFile: '/../outside.test.ts'}]).content)).toThrow();
    expect(validatePluginAcceptanceCriteria([guide([criterion])])[0]).toContain('/SKILL.md:');
});

test('malformed or removed approved criteria cannot silently become a legacy workspace', () => {
    expect(() => readPluginAcceptanceCriteria('<!-- fdo-acceptance -->\n~~~json\n[')).toThrow('Malformed');
    expect(validatePluginAcceptanceCriteria([{path: '/SKILL.md', content: '<!-- fdo-sdk-fingerprint: abc -->'}])[0]).toContain('no acceptance criteria');
});

test('per-file validation catches missing approved tests without requiring pending files', () => {
    const second = {...criterion, id: 'favorites-persist', testFile: '/tests/social-registry.test.ts', testName: 'load and save favorites round-trip'};
    const files = [guide([criterion, second]), {path: second.testFile, content: 'import {test} from "node:test"; test("social preview", () => {});'}];
    const errors = validatePluginAcceptanceCriteria(files, {testFile: second.testFile});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('load and save favorites round-trip');
    expect(validatePluginAcceptanceCriteria(files, {testFile: '/unrelated.ts'})).toEqual([]);
    expect(validatePluginAcceptanceCriteria(files)).toHaveLength(2);
});

test('reports every invalid acceptance field with its criterion position', () => {
    const invalid = [criterion, {...criterion, description: '', testName: 12, testFile: 'tests/behavior.ts'}, null];
    expect(() => readPluginAcceptanceCriteria(guide(invalid).content)).toThrow('Acceptance criterion 2: description must be a non-empty string.');
    const [error] = validatePluginAcceptanceCriteria([guide(invalid)]);
    expect(error).toContain('Acceptance criterion 2: testName must be a non-empty string.');
    expect(error).toContain('Acceptance criterion 2: duplicate id "json"');
    expect(error).toContain('absolute virtual test path such as /tests/behavior.test.ts');
    expect(error).toContain('Acceptance criterion 3: expected an object');
});

test.each(['describe', 'suite'])('identifies an imported describe suite named like the required test (%s)', localName => {
    const content = `import {describe as ${localName}, it} from 'node:test';
${localName}('formats JSON', () => { it('renders a label', () => {}); });`;
    const errors = validatePluginAcceptanceCriteria([guide([criterion]), {path: criterion.testFile, content}]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('at line 2; this is a describe suite');
    expect(errors[0]).toContain('Required behavior: Formats JSON');
    expect(errors[0]).toContain('renders a label');
    expect(errors[0]).toContain('Do not merely rename describe to test');
});

test('a matching suite does not prevent an actual approved test from satisfying the criterion', () => {
    const content = `import {describe, test} from 'node:test';
describe('formats JSON', () => {});
test('formats JSON', () => { JSON.parse('{}'); });`;
    expect(validatePluginAcceptanceCriteria([guide([criterion]), {path: criterion.testFile, content}])).toEqual([]);
});

test('does not report unrelated or locally shadowed describe calls as node:test suites', () => {
    const content = `import {describe} from 'node:test';
describe('other suite', () => {});
function helper(describe) { describe('formats JSON', () => {}); }`;
    const [error] = validatePluginAcceptanceCriteria([guide([criterion]), {path: criterion.testFile, content}]);
    expect(error).not.toContain('this is a describe suite');
});
