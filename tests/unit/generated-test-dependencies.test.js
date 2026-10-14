import {failingTestImports} from '../../src/utils/plugins/validation/generatedTestDependencies';
const source = `import {it} from 'node:test';
import {analyzeHtml} from './html';
import {formatJson} from './json';
import {fixture} from './fixtures';
const helper = () => analyzeHtml(fixture);
it('HTML', () => { helper(); });
it('JSON', () => { formatJson('{}'); });`;
test('follows callback helpers and fixtures without unrelated imports', () => {
    expect([...failingTestImports(source, [6])].sort()).toEqual(['./fixtures', './html']);
    expect([...failingTestImports(source, [7])]).toEqual(['./json']);
});
test('unmapped locations and mutable hook state use the conservative fallback', () => {
    expect(failingTestImports(source, [99])).toBeNull();
    expect(failingTestImports(`import {it} from 'node:test';\nlet value; value = 2;\nit('state', () => value);`, [3])).toBeNull();
});
