const fs = require('node:fs');
const path = require('node:path');
const {Arch} = require('builder-util');

// Require the native TypeScript compiler for each packaged architecture.
module.exports = async function checkTypeScriptRuntime(context) {
    const platform = context.electronPlatformName;
    const arch = typeof context.arch === 'string' ? context.arch : Arch[context.arch];
    const architectures = arch === 'universal' && platform === 'darwin' ? ['x64', 'arm64'] : [arch];
    if (!['darwin', 'linux', 'win32'].includes(platform) || architectures.some(value => !['x64', 'arm64'].includes(value))) {
        throw new Error(`FDO supports macOS, Windows and Linux on x64/arm64; unsupported packaging target ${platform}/${arch}.`);
    }
    for (const architecture of architectures) {
        const typeScriptBinary = path.join(context.appDir, 'dist', 'main', 'node_modules', '@typescript',
            `typescript-${platform}-${architecture}`, 'lib', platform === 'win32' ? 'tsc.exe' : 'tsc');
        if (!fs.existsSync(typeScriptBinary)) {
            throw new Error(`Missing TypeScript native compiler for ${platform}/${architecture}. Stage @typescript/typescript-${platform}-${architecture} before packaging.`);
        }
    }
};
