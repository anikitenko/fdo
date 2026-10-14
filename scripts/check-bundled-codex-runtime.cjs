const fs = require('node:fs');
const path = require('node:path');
const {Arch} = require('builder-util');

// Fail packaging rather than ship an app that falls back to a developer's separate CLI.
module.exports = async function checkBundledCodexRuntime(context) {
    const platform = context.electronPlatformName;
    const arch = typeof context.arch === 'string' ? context.arch : Arch[context.arch];
    const architectures = arch === 'universal' && platform === 'darwin' ? ['x64', 'arm64'] : [arch];
    if (!['darwin', 'linux', 'win32'].includes(platform) || architectures.some(value => !['x64', 'arm64'].includes(value))) {
        throw new Error(`FDO integrated Codex supports macOS, Windows and Linux on x64/arm64; unsupported packaging target ${platform}/${arch}.`);
    }
    for (const architecture of architectures) {
        const packageName = `codex-${platform}-${architecture}`;
        const vendor = path.join(context.appDir, 'dist', 'main', 'node_modules', '@openai', packageName, 'vendor');
        const executable = platform === 'win32' ? 'codex.exe' : 'codex';
        const hostExecutable = platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host';
        const present = fs.existsSync(vendor) && fs.readdirSync(vendor).some(triple => ['bin', 'codex'].some(dir =>
            fs.existsSync(path.join(vendor, triple, dir, executable)) && fs.existsSync(path.join(vendor, triple, dir, hostExecutable))));
        if (!present) throw new Error(`Missing integrated Codex runtime or code-mode helper for ${platform}/${architecture}. Build with dependencies installed on the target OS/architecture, or stage @openai/${packageName} under dist/main/node_modules/@openai before packaging. FDO will not use an external Codex CLI as a fallback.`);
    }
};
