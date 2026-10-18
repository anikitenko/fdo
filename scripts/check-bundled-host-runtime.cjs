const fs = require('node:fs');
const path = require('node:path');
const checkCodex = require('./check-bundled-codex-runtime.cjs');

module.exports = async function checkHostRuntime(context) {
    const appDir = context.appDir || context.packager?.info?.appDir;
    await checkCodex({...context, appDir});
    // SSH uses the portable JavaScript implementation, never a system ssh binary.
    for (const [name, entry] of [['ssh2', 'lib/index.js'], ['asn1', 'lib/index.js'], ['safer-buffer', 'safer.js'], ['bcrypt-pbkdf', 'index.js'], ['tweetnacl', 'nacl-fast.js']]) {
        if (!fs.existsSync(path.join(appDir, 'dist', 'main', 'node_modules', name, entry))) {
            throw new Error(`Missing bundled SSH runtime dependency ${name}. Build the host before packaging.`);
        }
    }
    if (!fs.existsSync(path.join(appDir, 'dist', 'main', 'gitSshHelper.cjs'))) throw new Error('Missing bundled Git SSH helper. Build the host before packaging.');
    const architecture=typeof context.arch==='string'?context.arch:require('electron-builder').Arch[context.arch];
    for(const entry of ['typescript/package.json','typescript/dist/api/sync/api.js','typescript/dist/api/fs.js','@types/node/index.d.ts','undici-types/index.d.ts',
        ...['lib.d.ts','lib.es2022.d.ts','lib.dom.d.ts'].map(name=>`@typescript/typescript-${context.electronPlatformName}-${architecture}/lib/${name}`)]) {
        if(!fs.existsSync(path.join(appDir,'dist/main/node_modules',entry)))throw new Error(`Missing bundled typechecker dependency ${entry}. Build the host before packaging.`);
    }
    await require('./stage-bundled-git.cjs').stage({...context,appDir});
};
