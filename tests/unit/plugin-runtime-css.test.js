/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import {createRuntimeCssPlugin} from '../../src/utils/plugins/runtime/pluginRuntimeBundle';

jest.mock('electron', () => ({app: {isPackaged: false}}));

let root;
beforeEach(async () => {root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-runtime-css-'));});
afterEach(async () => {await fs.rm(root, {recursive: true, force: true});});
async function write(name, contents) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, contents);
}
async function compile() {
    return build({entryPoints: [path.join(root, 'index.js')], bundle: true, platform: 'node', format: 'cjs', write: false,
        logLevel: 'silent', plugins: [createRuntimeCssPlugin(root)]});
}

test('startup CSS preserves relative imports, descendants, states and responsive styles as a JavaScript map', async () => {
    await write('index.js', "import styles from './styles.css'; export default styles;");
    await write('styles/base.css', '.shell {color: red} .shell .card {padding: 12px} .shell:hover {color: blue}');
    await write('styles.css', '@import "./styles/base.css"; .shell {display: grid} @media (max-width: 600px) {.shell {display: block}}');
    const result = await compile();
    const context = {module: {exports: {}}, exports: {}};
    vm.runInNewContext(result.outputFiles[0].text, context);
    const styles = context.module.exports.default;
    expect(styles.shell.color).toBe('red');
    expect(styles.shell.display).toBe('grid');
    expect(styles.shell[' .card'].padding).toBe('12px');
    expect(styles.shell['&:hover'].color).toBe('blue');
    expect(styles.shell['@media (max-width: 600px)'].display).toBe('block');
    expect(result.outputFiles).toHaveLength(1);
});

test.each([
    ['missing import', '@import "./missing.css";', /CSS import not found/],
    ['cyclic import', '@import "./styles.css";', /Circular CSS import/],
])('startup CSS rejects a %s instead of silently producing an empty map', async (_, css, error) => {
    await write('index.js', "import styles from './styles.css'; export default styles;");
    await write('styles.css', css);
    await expect(compile()).rejects.toThrow(error);
});
