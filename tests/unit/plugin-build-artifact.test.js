import {pluginBuildEntrypoint, pluginBuildSource} from '../../src/utils/plugins/runtime/pluginBuildArtifact';
const workspace=manifest=>({'/package.json':JSON.stringify(manifest),'/index.ts':'original source','/helper.js':'authored helper'});
test.each([
    [{source:'index.ts',main:'index.ts'},'dist/index.cjs'],
    [{source:'index.ts',main:'./index.ts'},'dist/index.cjs'],
    [{source:'index.ts',module:'index.ts',main:'dist/index.cjs'},'dist/index.cjs'],
    [{source:'index.ts',main:'helper.js'},'dist/index.cjs'],
    [{source:'index.ts',main:'dist/custom.cjs'},'dist/custom.cjs'],
    [{source:'index.ts',main:'../index.cjs'},'dist/index.cjs'],
    [{source:'index.ts',type:'module',main:'dist/index.js'},'dist/index.cjs'],
    [{source:'dist/index.cjs',main:'dist/index.cjs'},'dist/plugin-runtime-1.cjs'],
])('keeps runtime output separate from source for %j',(manifest,expected)=>expect(pluginBuildEntrypoint(workspace(manifest))).toBe(expected));

test.each([
    [{main: 'index.ts'}, 'index.ts'],
    [{main: './src/plugin.ts'}, 'src/plugin.ts'],
    [{main: 'src/plugin.tsx'}, 'src/plugin.tsx'],
    [{main: 'dist/index.cjs'}, 'index.ts'],
    [{source: './src/plugin.ts', main: 'dist/index.cjs'}, 'src/plugin.ts'],
])('detects source entry points consistently for %j', (manifest, expected) => {
    expect(pluginBuildSource(workspace(manifest))).toBe(expected);
});

test('keeps a genuinely prebuilt plugin on the prebuilt path', () => {
    expect(pluginBuildSource({'/package.json': JSON.stringify({main: 'index.cjs'}), '/index.cjs': 'module.exports = {};'})).toBeNull();
});

test('rejects an unsafe explicit source path', () => {
    expect(() => pluginBuildSource(workspace({source: '../outside.ts'}))).toThrow('inside the plugin');
});
