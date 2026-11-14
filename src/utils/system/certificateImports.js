import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {Certs} from './certs';
import {officialRegistry} from './officialRegistry';
import {keyFingerprint} from './registryTrust';
import {certificateStorage} from '../persistence/certificateStorage';
import {certificatePems, validateRegistryIdentity} from './registrySigning';

async function readCertificatePem(file) {
    if ((await fs.stat(file)).size > 128 * 1024) throw new Error('Certificate file is too large.');
    return fs.readFile(file, 'utf8');
}

export async function importDeveloperCertificateFiles(files) {
    if (!Array.isArray(files) || !files.length) throw new Error('Select the certificate chain and matching private key.');
    if (files.length > 8) throw new Error('Select the certificate chain and one private key (up to 8 files).');
    const contents = await Promise.all(files.map(readCertificatePem));
    const pems = contents.join('\n');
    const certificates = [...new Set(certificatePems(pems))];
    const keys = pems.match(/-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g) || [];
    if (keys.length !== 1) throw new Error('Select the developer certificate chain and exactly one matching private key together.');
    const parsed = certificates.map(pem => ({pem, cert: new crypto.X509Certificate(pem)}));
    const leaves = parsed.filter(entry => !entry.cert.ca);
    if (leaves.length !== 1) throw new Error('Select one developer certificate and its issuer chain.');
    // File-picker order is arbitrary: build a leaf-first chain from issuer signatures.
    const ordered = [leaves[0]];
    const remaining = parsed.filter(entry => entry !== leaves[0]);
    while (remaining.length) {
        const child = ordered[ordered.length - 1].cert;
        const index = remaining.findIndex(entry => child.checkIssued(entry.cert) && child.verify(entry.cert.publicKey));
        if (index < 0) throw new Error('The selected files contain unrelated certificates.');
        ordered.push(remaining.splice(index, 1)[0]);
    }
    const chainPem = ordered.map(entry => entry.pem).join('\n');
    const key = keys[0];
    const anchor = await officialRegistry.ensureAnchor();
    const trust = await officialRegistry.trust();
    const cert = validateRegistryIdentity(chainPem, key, trust.anchors);
    await officialRegistry.certificateStatus(keyFingerprint(cert.toString()));
    certificateStorage.put({
        id: cert.fingerprint256, label: cert.subject, cert: cert.toString(), key, kind: 'developer',
        chainPem: certificatePems(chainPem).join('\n'), anchorId: anchor?.id, createdAt: new Date().toISOString(),
        expiresAt: new Date(cert.validTo).toISOString(), imported: true,
    }, 'registry');
    return {success: true};
}

// Explicit root import: never infer a publication identity or switch import paths.
export async function importRootCertificate(file) {
    try {
        const pem = await readCertificatePem(file);
        const cert = new crypto.X509Certificate(pem);
        if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey))
            return {success: false, error: 'Select a self-signed root CA certificate. Use Import developer certificate for a developer identity.'};
        return await Certs.import(file);
    } catch (error) {return {success: false, error: error.message};}
}

