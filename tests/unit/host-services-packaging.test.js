/** @jest-environment node */
const {expect, test} = require('@jest/globals');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const check = require('../../scripts/check-bundled-host-runtime.cjs');
const runtime = [['ssh2', 'lib/index.js'], ['asn1', 'lib/index.js'], ['safer-buffer', 'safer.js'], ['bcrypt-pbkdf', 'index.js'], ['tweetnacl', 'nacl-fast.js']];
test.each(['linux', 'win32', 'darwin'])('packaging %s requires every portable SSH runtime dependency', async platform => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-ssh-packaging-'));
    const modules = path.join(root, 'dist/main/node_modules');
    const file = name => {fs.mkdirSync(path.dirname(name), {recursive: true}); fs.writeFileSync(name, 'fixture');};
    try {
        const bin = path.join(modules, `@openai/codex-${platform}-x64/vendor/fixture/bin`);
        file(path.join(bin, platform === 'win32' ? 'codex.exe' : 'codex'));
        file(path.join(bin, platform === 'win32' ? 'codex-code-mode-host.exe' : 'codex-code-mode-host'));
        file(path.join(modules, `@typescript/typescript-${platform}-x64/lib`, platform === 'win32' ? 'tsc.exe' : 'tsc'));
        const context = {appDir: root, electronPlatformName: platform, arch: 'x64'};
        for (const [name, entry] of runtime) {
            await expect(check(context)).rejects.toThrow(`Missing bundled SSH runtime dependency ${name}`);
            file(path.join(modules, name, entry));
        }
        await expect(check(context)).rejects.toThrow('Missing bundled Git SSH helper');
        file(path.join(root, 'dist/main/gitSshHelper.cjs'));
        await expect(check(context)).rejects.toThrow('Missing bundled typechecker dependency');
        for(const entry of ['typescript/package.json','typescript/dist/api/sync/api.js','typescript/dist/api/fs.js','@types/node/index.d.ts','undici-types/index.d.ts'])file(path.join(modules,entry));
        for(const name of ['lib.d.ts','lib.es2022.d.ts','lib.dom.d.ts'])file(path.join(modules,`@typescript/typescript-${platform}-x64/lib`,name));
        const head=Buffer.alloc(256);
        if(platform==='linux'){head.set([127,69,76,70]);head.writeUInt16LE(62,18);}
        if(platform==='darwin'){head.writeUInt32LE(0xfeedfacf,0);head.writeUInt32LE(0x1000007,4);}
        if(platform==='win32'){head.set([77,90]);head.writeUInt32LE(64,60);head.writeUInt16LE(0x8664,68);}
        for(const entry of platform==='win32'?['cmd/git.exe','mingw64/libexec/git-core/git-lfs.exe']:['bin/git','libexec/git-core/git-lfs']){
            const filename=path.join(root,'dist/main/git-x64',entry);file(filename);fs.writeFileSync(filename,head);
        }
        await expect(check(context)).resolves.toBeUndefined();
        await expect(check({electronPlatformName: platform, arch: 'x64', packager: {info: {appDir: root}}})).resolves.toBeUndefined();
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
