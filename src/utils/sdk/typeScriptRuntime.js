import path from 'node:path';
import fs from 'node:fs';

export function loadTypeScriptRuntime(requireRuntime) {
    const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}/package.json`;
    const nativeBinary = path.join(path.dirname(requireRuntime.resolve(platformPackage)), 'lib', process.platform === 'win32' ? 'tsc.exe' : 'tsc')
        .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    try {fs.accessSync(nativeBinary, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);} catch {
        throw new Error('The native TypeScript compiler is missing or not executable. Rebuild FDO with npm run build:main.');
    }
    return {
        ...requireRuntime('typescript/unstable/sync'),
        ...requireRuntime('typescript/unstable/fs'),
        nativeBinary,
    };
}
