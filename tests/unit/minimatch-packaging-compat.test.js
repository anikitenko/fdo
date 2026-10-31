/** @jest-environment node */
import {afterEach, beforeEach, expect, test} from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

// Use native Node resolution to exercise the installed CJS/ESM export conditions,
// including ASAR resolution used by electron-builder rather than Jest mocks.
const nativeRequire = createRequire(path.resolve('package.json'));
let root;
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-packaging-match-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));

test('local dependencies retain their real package identities for security scanners', () => {
    const project = nativeRequire('./package.json');
    for (const [name, spec] of Object.entries({...project.dependencies, ...project.devDependencies})) {
        if (!spec.startsWith('file:')) continue;
        const manifest = JSON.parse(fs.readFileSync(path.resolve(spec.slice(5), 'package.json'), 'utf8'));
        expect({declared: name, actual: manifest.name}).toEqual({declared: name, actual: name});
    }
});

test('legacy callable matching, named helpers and defaults share the patched engine', () => {
    const matcher = nativeRequire('minimatch');
    expect(nativeRequire('minimatch-patched/package.json').version).toBe('11.0.3');
    expect(matcher('nested/file.js', '**/*.js')).toBe(true);
    expect(matcher('nested/file.js', '**/*.map')).toBe(false);
    expect(matcher.minimatch('nested/file.js', '**/*.{js,ts}')).toBe(true);
    expect(matcher.match(['a.js', 'b.md'], '*.js')).toEqual(['a.js']);
    expect(matcher.defaults({dot: true})('.env', '*')).toBe(true);
    expect(new matcher.Minimatch('**/*.node', {dot: true}).match('build/addon.node')).toBe(true);
});

test('native ESM consumers receive the upstream named exports', () => {
    const script = `import {minimatch, Minimatch} from 'minimatch';
import {glob} from 'glob';
const files = await glob('package.json', {cwd: process.cwd()});
console.log(JSON.stringify({matches: minimatch('a.ts', '*.ts'),
    nested: new Minimatch('**/*.js').match('src/a.js'), files}));`;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', script], {cwd: process.cwd(), encoding: 'utf8'});
    expect(JSON.parse(result)).toEqual({matches: true, nested: true, files: ['package.json']});
});

test.each(['modern', 'electron-builder'])('%s ASAR consumer retains native-file unpack rules', async consumer => {
    const asar = consumer === 'modern' ? nativeRequire('@electron/asar')
        : createRequire(nativeRequire.resolve('app-builder-lib/package.json'))('@electron/asar');
    const source = path.join(root, 'source'), archive = path.join(root, 'app.asar');
    fs.mkdirSync(path.join(source, 'build'), {recursive: true});
    fs.writeFileSync(path.join(source, 'index.js'), 'module.exports = 1;');
    fs.writeFileSync(path.join(source, 'build/addon.node'), 'native fixture');
    await asar.createPackageWithOptions(source, archive, {unpack: '**/*.node'});
    expect(asar.extractFile(archive, 'index.js').toString()).toBe('module.exports = 1;');
    expect(asar.statFile(archive, 'build/addon.node').unpacked).toBe(true);
    expect(fs.readFileSync(archive + '.unpacked/build/addon.node', 'utf8')).toBe('native fixture');
});

test('universal-packaging directory comparison retains include/exclude filters', () => {
    const left = path.join(root, 'left'), right = path.join(root, 'right');
    for (const directory of [left, right]) {
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, 'entry.js'), 'same');
    }
    fs.writeFileSync(path.join(right, 'ignored.js'), 'excluded');
    fs.writeFileSync(path.join(right, 'style.css'), 'not included');
    const result = nativeRequire('dir-compare').compareSync(left, right, {
        compareContent: true, includeFilter: '*.js', excludeFilter: 'ignored.js',
    });
    expect(result.same).toBe(true);
});

test('builder patterns and legacy file lists retain their exclusions', () => {
    const {FileMatcher} = nativeRequire('app-builder-lib/out/fileMatcher');
    const filter = new FileMatcher(root, path.join(root, 'out'), value => value, ['**/*', '!**/*.map']).createFilter();
    const stat = {isDirectory: () => false};
    expect(filter(path.join(root, 'dist/index.js'), stat)).toBe(true);
    expect(filter(path.join(root, 'dist/index.js.map'), stat)).toBe(false);
    fs.writeFileSync(path.join(root, 'keep.js'), 'keep');
    fs.writeFileSync(path.join(root, 'skip.js'), 'skip');
    const {FileList} = nativeRequire('filelist');
    const files = new FileList();
    files.include(path.join(root, '*.js'));
    files.exclude(path.join(root, 'skip.*'));
    expect(files.toArray()).toEqual([path.join(root, 'keep.js')]);
});
