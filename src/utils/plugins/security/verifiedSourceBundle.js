import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const inside = (root, file) => {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
export async function readVerifiedSource(root, file, hashes) {
    const realRoot = await fs.realpath(root),
        realFile = await fs.realpath(file);
    const relative = path.relative(realRoot, realFile).split(path.sep).join('/');
    if (!inside(realRoot, realFile) || !Object.hasOwn(hashes, relative))
        throw new Error('Runtime compilation attempted to load unsigned registry source.');
    const stat = await fs.stat(realFile);
    if (stat.size > 1024 * 1024)
        throw new Error('Registry source file exceeds verification limits.');
    const bytes = await fs.readFile(realFile);
    if (createHash('sha256').update(bytes).digest('hex') !== hashes[relative])
        throw new Error('Registry source changed before compilation.');
    return bytes;
}
export function createVerifiedSourcePlugin(pluginHome, hashes, hostNodeModulesPath) {
    return {
        name: 'fdo-verified-registry-source',
        setup(build) {
            build.onLoad({ filter: /.*/ }, async (args) => {
                const home = await fs.realpath(pluginHome),
                    file = await fs.realpath(args.path);
                if (!inside(home, file)) {
                    const host = await fs.realpath(hostNodeModulesPath);
                    if (!inside(host, file))
                        throw new Error(
                            'Registry compilation escaped the verified source and host dependencies.',
                        );
                    return;
                }
                const contents = await readVerifiedSource(home, file, hashes);
                if (file.endsWith('.css')) return; // The CSS loader validates its complete workspace snapshot separately.
                const extension = path.extname(file).slice(1);
                if (!['ts', 'tsx', 'json'].includes(extension))
                    throw new Error('Unsupported executable registry source type.');
                return { contents, loader: extension };
            });
        },
    };
}
