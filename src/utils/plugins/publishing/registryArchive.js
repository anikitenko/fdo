import {PUBLISHING_EXCLUSIONS} from './publishingSourcePolicy';
import fs from 'node:fs/promises';
import path from 'node:path';
import {getIgnoreInstance} from '../../filesystem/getIgnoreInstance';
import {getAllFilesWithIgnorance} from '../../filesystem/getAllFilesWithIgnorance';
import {certificateStorage} from '../../persistence/certificateStorage';
import {registryIdentityLifecycle} from '../../system/registryIdentity';
import {officialRegistry} from '../../system/officialRegistry';
import {organizationRegistries} from '../../system/organizationRegistries';
import {registryCertificateSelection} from '../../system/certificateDisplay';
import {signRegistryFiles} from '../../system/registrySigning';
import {exportArchive} from '../exporting/exportArchive';
import {checkPublishingFiles, requirePublishingFiles} from './publishingCheck';
import {MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES, MAX_FILE_BYTES} from './registryPolicy/source-archive';

export async function readPublishingSource(directory) {
    const ignore = await getIgnoreInstance(directory, [], {includeDist: true});
    ignore.add(PUBLISHING_EXCLUSIONS);
    const paths = await getAllFilesWithIgnorance(directory, relative => !ignore.ignores(relative.replace(/\\/g, '/')));
    if (paths.length > 998) throw new Error('Registry archives allow at most 1,000 files including signing files.');
    let total = 0;
    const files = {};
    for (const file of paths) {
        const stat = await fs.lstat(file);
        if (!stat.isFile()) throw new Error('Only regular source files can be published.');
        total += stat.size;
        if (stat.size > MAX_FILE_BYTES || total > MAX_EXPANDED_BYTES) throw new Error('Registry source exceeds the 1 MiB per-file or 32 MiB total limit.');
        files[path.relative(directory, file).split(path.sep).join('/')] = await fs.readFile(file);
    }
    return files;
}

export async function checkPublishingDirectory(directory) {
    try {return checkPublishingFiles(await readPublishingSource(directory));}
    catch (error) {return {valid: false, errors: [error.message], notes: []};}
}

export async function createRegistryArchive(directory, signerId) {
    const files = await readPublishingSource(directory);
    const report = requirePublishingFiles(files); // Fail before Keychain or online signing operations.
    const {id, scope} = registryCertificateSelection(signerId) || {id: signerId, scope: 'registry'};
    const entry = certificateStorage.list(scope).find(cert => cert.id === id && cert.kind === 'developer' && cert.hasPrivateKey);
    if (!entry) throw new Error('Choose an imported registry developer certificate. Run fdo sign list.');
    const {registry, lifecycle} = scope === 'org' ? organizationRegistries.forCertificate({...entry, scope}) : {registry: officialRegistry, lifecycle: registryIdentityLifecycle};
    const identity = await lifecycle.ensureIdentity(entry);
    const trust = await registry.trust();
    const signed = signRegistryFiles(files, identity.chainPem, certificateStorage.privateKey(identity.id, scope), trust.anchors);
    if (Object.values(signed).reduce((sum, bytes) => sum + bytes.length, 0) > MAX_EXPANDED_BYTES) throw new Error('Signed source exceeds 32 MiB.');
    const archive = await exportArchive(signed);
    if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('Signed ZIP exceeds the registry 10 MiB archive limit.');
    return {archive, report, signerId: identity.id, scope};
}

export async function writeRegistryArchive(directory, signerId, output) {
    const exists = await fs.lstat(output).then(() => true, error => {
        if (error.code !== 'ENOENT') throw error;
        return false;
    });
    if (exists) throw Object.assign(new Error(`Output already exists: ${output}`), {code: 'EEXIST'});
    const result = await createRegistryArchive(directory, signerId);
    // Exclusive creation prevents overwriting an existing archive or following a symlink.
    await fs.writeFile(output, result.archive, {flag: 'wx', mode: 0o600});
    certificateStorage.update(result.signerId, {lastUsedAt: new Date().toISOString()}, result.scope);
    return {path: output, signerId: result.signerId, bytes: result.archive.length, report: result.report};
}
