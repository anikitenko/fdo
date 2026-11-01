/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import webpack from 'webpack';

test('the appearance panel validator bundles for the browser without Node polyfills', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-ui-browser-'));
    try {
        const stats = await new Promise((resolve, reject) => webpack({
            mode: 'development', target: 'web', devtool: false,
            entry: path.resolve('src/utils/plugins/authoring/liveUi/sdkComponentAppearance.js'),
            output: {path: directory, filename: 'appearance.js', library: {type: 'commonjs2'}},
        }, (error, result) => error ? reject(error) : resolve(result)));
        expect(stats.toJson({all: false, errors: true}).errors).toEqual([]);
        const browser = {module: {exports: {}}};
        vm.runInNewContext(fs.readFileSync(path.join(directory, 'appearance.js'), 'utf8'), browser);
        expect(browser.module.exports.sdkAppearanceValueError('6px')).toBe('');
        expect(browser.module.exports.sdkAppearanceValueError('<style>')).not.toBe('');
    } finally {
        fs.rmSync(directory, {recursive: true, force: true});
    }
}, 20000);
