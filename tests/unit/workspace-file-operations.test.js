import {planWorkspaceRename, validateWorkspaceDestination} from '../../src/components/editor/utils/workspaceFileOperations';

const content = {
    '/package.json': JSON.stringify({source: './index.ts', main: 'dist/index.cjs'}),
    '/index.ts': `import {ui} from './shared/ui'; export {ui} from './shared/ui.js'; const text = './shared/ui'; // ./shared/ui\nconst dynamic = import('./shared/ui'); const required = require('./shared/ui');`,
    '/shared/ui.ts': `import {theme} from '../theme'; export const ui = theme;`,
    '/theme.ts': 'export const theme = 1;',
    '/shared-other/keep.ts': 'export const keep = true;',
};

test('directory move updates inbound and outbound imports without editing strings or siblings', () => {
    const result = planWorkspaceRename(content, '/shared', '/src/widgets', true).content;
    expect(result['/index.ts']).toContain("from './src/widgets/ui'");
    expect(result['/index.ts']).toContain("from './src/widgets/ui.js'");
    expect(result['/index.ts']).toContain("import('./src/widgets/ui')");
    expect(result['/index.ts']).toContain("require('./src/widgets/ui')");
    expect(result['/index.ts']).toContain("const text = './shared/ui'; // ./shared/ui");
    expect(result['/src/widgets/ui.ts']).toContain("from '../../theme'");
    expect(result['/shared/ui.ts']).toBeUndefined();
    expect(result['/shared-other/keep.ts']).toBe(content['/shared-other/keep.ts']);
});

test('file rename preserves JavaScript import specifiers and updates package source', () => {
    const result = planWorkspaceRename(content, '/index.ts', '/src/main.ts', false).content;
    expect(JSON.parse(result['/package.json']).source).toBe('./src/main.ts');
    expect(result['/src/main.ts']).toContain("from '../shared/ui'");
});

test('directory index imports keep their extensionless form', () => {
    const result = planWorkspaceRename({'/index.ts': "export * from './feature';", '/feature/index.ts': 'export const x = 1;'}, '/feature', '/renamed', true).content;
    expect(result['/index.ts']).toBe("export * from './renamed';");
});

test('broken source blocks import updates with an actionable error, or can be moved unchanged', () => {
    const broken = {'/broken.ts': 'export const ='};
    expect(() => planWorkspaceRename(broken, '/broken.ts', '/moved.ts', false)).toThrow('turn off Update imports');
    expect(planWorkspaceRename(broken, '/broken.ts', '/moved.ts', false, false).content).toEqual({'/moved.ts': 'export const ='});
});

test.each(['/node_modules/foo.ts', '/dist/index.ts', '/', '../outside.ts', '/aux.ts', '/file?.ts', '/trailing.'])('rejects unsafe destination %s', value => {
    expect(() => validateWorkspaceDestination(value)).toThrow();
});
