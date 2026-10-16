/** @jest-environment node */
import {runPluginWorkspaceTests} from '../../src/utils/plugins/runtime/pluginTestRunner';

jest.mock('electron', () => ({app: {getPath: () => require('node:os').tmpdir()}}));
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle', () => ({
    getHostPluginNodeModulesPath: () => require('node:path').resolve('node_modules'),
    ensureExecutableEsbuildBinary: () => {},
    loadHostEsbuild: () => require('esbuild'),
}));

test.each(['module', 'commonjs'])('runs real bundled tests under a %s workspace with nested ESM packages', async type => {
    const result = await runPluginWorkspaceTests({
        '/package.json': JSON.stringify({type}),
        '/tests/package.json': '{"type":"module"}',
        '/logic.ts': 'export const answer = 42;',
        '/root.test.ts': `import {test} from 'node:test'; import {strictEqual} from 'node:assert';
            import {answer} from './logic'; test('root', () => strictEqual(answer, 42));`,
        '/tests/nested.test.mjs': `import {test} from 'node:test'; import {strictEqual} from 'node:assert';
            import {readFileSync} from 'node:fs';
            test('nested asset and metadata', () => {
                strictEqual(readFileSync(new URL('./fixture.txt', import.meta.url), 'utf8'), 'fixture');
                strictEqual(JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).type, 'module');
            });`,
        '/tests/fixture.txt': 'fixture',
    });
    expect(result.output).not.toContain('require is not defined');
    expect(result).toMatchObject({success: true, skipped: false});
    expect(result.output).toContain('nested asset and metadata');
});

test('a bundled assertion failure still reports the original TypeScript location', async () => {
    const result = await runPluginWorkspaceTests({
        '/package.json': '{"type":"module"}',
        '/example.test.ts': `import {test} from 'node:test'; import {strictEqual} from 'node:assert';
            test('intentional failure', () => strictEqual(1, 2));`,
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('AssertionError');
    expect(result.output).toContain('/example.test.ts:');
});

test('returns passing and skipped test evidence with virtual file owners', async () => {
    const result = await runPluginWorkspaceTests({'/proof.test.ts': `import {test} from 'node:test';
        import assert from 'node:assert/strict';
        test('proves behavior', () => assert.equal(1 + 1, 2));
        test.skip('not evidence', () => {});`});
    expect(result.success).toBe(true);
    expect(result.results).toEqual(expect.arrayContaining([
        expect.objectContaining({file: '/proof.test.ts', name: 'proves behavior', passed: true, skipped: false}),
        expect.objectContaining({file: '/proof.test.ts', name: 'not evidence', skipped: true}),
    ]));
});

test('render tests consume imported CSS states and media rules using the deployment style-map contract', async () => {
    const result = await runPluginWorkspaceTests({
        '/styles/base.css': '.panel { color: red; } .panel:hover { color: blue; }',
        '/styles/theme.css': '@import "./base.css"; .panel { padding: 12px; } @media (max-width: 480px) { .panel { padding: 4px; } }',
        '/render.test.ts': `import {test} from 'node:test'; import assert from 'node:assert/strict';
            import {DOM} from '@anikitenko/fdo-sdk'; import styles from './styles/theme.css';
            test('CSS stays present in rendered output', () => {
                assert.equal(styles.panel.color, 'red');
                assert.equal(styles.panel['&:hover'].color, 'blue');
                assert.equal(styles.panel['@media (max-width: 480px)'].padding, '4px');
                const dom = new DOM();
                const html = dom.renderHTML(dom.createElement('section', {class: dom.createClassFromStyle(styles.panel)}, 'Panel'));
                assert.match(html, /:hover/); assert.match(html, /@media/); assert.match(html, /padding:12px|padding: 12px/);
            });`,
    });
    expect({success: result.success, ...(result.success ? {} : {output: result.output})}).toEqual({success: true});
});
