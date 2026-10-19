/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scaffoldCliPlugin} from '../../src/utils/system/cliScaffold';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {PLUGIN_TEMPLATES} from '../../src/utils/plugins/authoring/pluginTemplateCatalog';
let root;
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-cli-scaffold-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
test.each(PLUGIN_TEMPLATES.map(item => item.value))('scaffolds the shared %s template into a new directory', template => {
    const directory = path.join(root, 'My Plugin');
    const result = scaffoldCliPlugin(directory, {template, displayName: 'My <Plugin>'});
    expect(result).toMatchObject({name: 'my-plugin', directory, template});
    const shared = createPluginTemplateFiles({name: 'my-plugin', displayName: 'My <Plugin>', template});
    for (const [file, content] of Object.entries(shared)) expect(fs.readFileSync(path.join(directory, file.slice(1)), 'utf8')).toBe(content);
    expect(fs.readdirSync(root)).toEqual(['My Plugin']);
});
test('accepts an existing empty directory and refuses files, populated directories and invalid options without modifying them', () => {
    const directory = path.join(root, 'existing');fs.mkdirSync(directory);
    scaffoldCliPlugin(directory, {name: 'example'});
    const original = fs.readFileSync(path.join(directory, 'index.ts'), 'utf8');
    expect(() => scaffoldCliPlugin(directory)).toThrow('new or empty');
    expect(fs.readFileSync(path.join(directory, 'index.ts'), 'utf8')).toBe(original);
    const file = path.join(root, 'file');fs.writeFileSync(file, 'keep');
    expect(() => scaffoldCliPlugin(file)).toThrow('new or empty');expect(fs.readFileSync(file, 'utf8')).toBe('keep');
    for (const options of [{name: '../escape'}, {template: 'unknown'}, {displayName: 'bad\nname'}]) expect(() => scaffoldCliPlugin(path.join(root, 'new'), options)).toThrow();
    expect(fs.existsSync(path.join(root, 'new'))).toBe(false);
});
(process.platform === 'win32' ? test.skip : test)('refuses a symlinked destination', () => {
    const target = path.join(root, 'target'), link = path.join(root, 'link');fs.mkdirSync(target);fs.symlinkSync(target, link);
    expect(() => scaffoldCliPlugin(link)).toThrow('new or empty');expect(fs.readdirSync(target)).toEqual([]);
});
test('failed writes leave the destination unchanged and remove staging files', () => {
    const directory = path.join(root, 'existing');fs.mkdirSync(directory);
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {throw new Error('disk full');});
    try {expect(() => scaffoldCliPlugin(directory)).toThrow('disk full');} finally {write.mockRestore();}
    expect(fs.readdirSync(directory)).toEqual([]);expect(fs.readdirSync(root)).toEqual(['existing']);
});

test('a failed final rename restores an existing empty directory and its mode', () => {
    const directory = path.join(root, 'existing');
    fs.mkdirSync(directory, {mode: 0o750});
    const previousMode = fs.statSync(directory).mode & 0o777;
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {throw new Error('rename failed');});
    try {expect(() => scaffoldCliPlugin(directory)).toThrow('rename failed');}
    finally {rename.mockRestore();}
    expect(fs.readdirSync(directory)).toEqual([]);
    expect(fs.statSync(directory).mode & 0o777).toBe(previousMode);
    expect(fs.readdirSync(root)).toEqual(['existing']);
});
