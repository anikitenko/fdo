import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { officialRegistry } from './officialRegistry';
import { stableStringify } from './registrySigning';
import { keyFingerprint } from './registryTrust';
import {validateSourceFiles} from '../plugins/publishing/registryPolicy/source-archive';

export async function verifyRegistryPluginDirectory(
    directory,
    metadata,
    signature,
    registry = officialRegistry,
) {
    if (
        metadata.format !== 'fdo-registry-v1' ||
        metadata.hashAlgorithm !== 'sha256' ||
        metadata.signatureAlgorithm !== 'RSASSA-PKCS1-v1_5' ||
        !metadata.files ||
        typeof metadata.files !== 'object' ||
        Array.isArray(metadata.files) ||
        Object.keys(metadata.files).length > 1000
    )
        throw new Error('Invalid registry signing metadata.');
    let bytes = 0;
    const remaining = new Set(Object.keys(metadata.files));
    const source = new Map();
    for (const file of remaining) {
        if (
            !file ||
            file.includes('\\') ||
            file.startsWith('/') ||
            file.split('/').some((part) => !part || part === '.' || part === '..') ||
            !/^[a-f0-9]{64}$/.test(metadata.files[file])
        )
            throw new Error('Unsafe signed plugin path or digest.');
    }
    async function visit(dir, relative = '') {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            const name = relative + entry.name;
            if (
                !relative &&
                [
                    'dist',
                    'build',
                    'node_modules',
                    '.git',
                    'fdo.meta.json',
                    'fdo.signature',
                    '.store.json',
                ].includes(entry.name)
            )
                continue;
            if (entry.isSymbolicLink())
                throw new Error('Registry plugin source contains a symbolic link.');
            if (entry.isDirectory()) {
                await visit(path.join(dir, entry.name), name + '/');
                continue;
            }
            if (!entry.isFile() || !remaining.has(name))
                throw new Error('Plugin contains unsigned source files.');
            const stat = await fs.stat(path.join(dir, entry.name));
            bytes += stat.size;
            if (stat.size > 1024 * 1024 || bytes > 32 * 1024 * 1024)
                throw new Error('Plugin exceeds source verification limits.');
            const contents = await fs.readFile(path.join(dir, entry.name));
            if (crypto.createHash('sha256').update(contents).digest('hex') !== metadata.files[name])
                throw new Error('Signed plugin source was modified.');
            source.set(name, contents.toString('utf8'));
            remaining.delete(name);
        }
    }
    await visit(directory);
    if (remaining.size) throw new Error('Signed plugin source files are missing.');
    // Registry publishing permits version in statically declared source metadata.
    // Derive identity with the same inert validator, using only hash-checked files.
    const {proposal} = validateSourceFiles(Buffer.alloc(0), source, undefined, true);
    const release = await registry.releaseStatus(proposal.pluginId, proposal.metadata.version);
    if (
        release.signerFingerprint !== metadata.signerFingerprint ||
        keyFingerprint(release.certificatePem) !== metadata.signerFingerprint ||
        stableStringify(release.signingMetadata) !== stableStringify(metadata)
    )
        throw new Error('Plugin does not match the published registry release.');
    if (
        !crypto.verify(
            'sha256',
            Buffer.from(stableStringify(metadata)),
            release.certificatePem,
            signature,
        )
    )
        throw new Error('Invalid registry plugin signature.');

    return {
        success: true,
        registry: true,
        identity: {pluginId: proposal.pluginId, version: proposal.metadata.version},
        verifiedFiles: metadata.files,
        commonName: {
            name: 'commonName',
            value: new crypto.X509Certificate(release.certificatePem).subject,
        },
        signer: { kind: 'registry', fingerprint: metadata.signerFingerprint },
    };
}
