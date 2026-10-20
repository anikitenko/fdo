const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const metadata = require('../package.json');

function packagedExecutable(platform = process.platform, arch = process.arch, root = path.resolve(__dirname, '../release')) {
    const product = metadata.build.executableName || metadata.build.productName;
    let candidates;
    if (platform === 'darwin') candidates = [path.join(root, `mac-${arch}`, `${product}.app`, 'Contents/MacOS', product), path.join(root, 'mac', `${product}.app`, 'Contents/MacOS', product)];
    else if (platform === 'win32') candidates = [path.join(root, 'win-unpacked', `${product}.exe`), path.join(root, `win-${arch}-unpacked`, `${product}.exe`)];
    else if (platform === 'linux') candidates = [path.join(root, 'linux-unpacked', metadata.name), path.join(root, `linux-${arch}-unpacked`, metadata.name), path.join(root, 'linux-unpacked', product)];
    else throw new Error('Unsupported packaged-host test platform.');
    const executable = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!executable) throw new Error('Packaged FDO executable is missing. Run electron-builder --dir first.');
    return executable;
}
module.exports = {packagedExecutable};
if (require.main === module) {
    const executablePath = packagedExecutable();
    const manifest = require.resolve('playwright/package.json');
    const cli = path.join(path.dirname(manifest), require(manifest).bin.playwright);
    const result = spawnSync(process.execPath, [cli, 'test', 'tests/e2e/cli.spec.js', 'tests/e2e/host-services.spec.js', 'tests/e2e/remote-commands.spec.js', 'tests/e2e/ssh-terminal.spec.js', '--workers=1', '--retries=0', '--output=test-results-packaged-services'], {
        cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
        env: {...process.env, FDO_E2E_EXECUTABLE: executablePath, PLAYWRIGHT_HTML_OUTPUT_DIR: 'playwright-report-packaged-services'},
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
