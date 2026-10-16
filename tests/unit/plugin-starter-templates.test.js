/** @jest-environment node */
import path from 'node:path';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {PLUGIN_TEMPLATES} from '../../src/utils/plugins/authoring/pluginTemplateCatalog';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {runPluginWorkspaceTests} from '../../src/utils/plugins/runtime/pluginTestRunner';
jest.mock('electron', () => ({app: {getPath: () => require('node:os').tmpdir()}}));
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle', () => ({
    getHostPluginNodeModulesPath: () => require('node:path').resolve('node_modules'),
    ensureExecutableEsbuildBinary: () => {},
    loadHostEsbuild: () => require('esbuild'),
}));

test.each(PLUGIN_TEMPLATES)('$title scaffolds type-safe code and passes its own real node:test suite', async template => {
    const files = createPluginTemplateFiles({name: 'starter-test', displayName: 'Team "A" <Tools>', template: template.value});
    expect(files['/SKILL.md']).toContain('## Modules and contracts');
    expect(files['/styles.css']).toContain('.shell');
    expect(files['/styles.ts']).toBeUndefined();
    expect(files['/render.tsx']).toContain("import styles from './styles.css'");
    const check = typecheckPluginWorkspace(files, path.resolve('node_modules'));
    expect(check.diagnostics).toEqual([]);
    expect(check.warnings).toEqual([]);
    const result = await runPluginWorkspaceTests(files);
    expect(result.output).not.toMatch(/Missing .*style/);
    expect({success: result.success, error: result.error, ...(result.success ? {} : {output: result.output})}).toEqual({success: true, error: null});
    expect(result.results.length).toBeGreaterThanOrEqual(2);
}, 30000);
