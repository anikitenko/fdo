import "reflect-metadata";
import crypto from 'node:crypto';
import {X509Certificate as ParsedCertificate, KeyUsagesExtension, KeyUsageFlags, ExtendedKeyUsageExtension} from '@peculiar/x509';
import {verifyCertificateChain} from './certificateChain';

export function certificatePems(text) {
    const pems = String(text).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!pems?.length) throw new Error('Select a PEM certificate or leaf-first certificate chain.');
    return pems;
}
export function validateRegistryAnchor(pem, expectedFingerprint) {
    const cert = new crypto.X509Certificate(pem);
    const expected = String(expectedFingerprint).replace(/:/g, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected) || cert.fingerprint256.replace(/:/g, '').toLowerCase() !== expected)
        throw new Error('Registry root fingerprint does not match the independently trusted SHA-256 fingerprint.');
    if (!cert.ca || !cert.checkIssued(cert) || !cert.verify(cert.publicKey)) throw new Error('Registry trust anchor must be a self-signed CA.');
    verifyCertificateChain([cert], [pem]);
    return cert;
}
export function validateRegistryCertificate(chainPem, anchorPem) {
    const chain = certificatePems(chainPem).map(pem => new crypto.X509Certificate(pem));
    verifyCertificateChain(chain, Array.isArray(anchorPem) ? anchorPem : [anchorPem]);
    const leaf = chain[0], parsed = new ParsedCertificate(leaf.raw);
    const usage = parsed.getExtension(KeyUsagesExtension), extended = parsed.getExtension(ExtendedKeyUsageExtension);
    if (leaf.ca || !usage || !(usage.usages & KeyUsageFlags.digitalSignature) || !extended?.usages.includes('1.3.6.1.5.5.7.3.3'))
        throw new Error('Developer certificate must be a non-CA code-signing certificate.');
    const bits = leaf.publicKey.asymmetricKeyDetails?.modulusLength;
    if (leaf.publicKey.asymmetricKeyType !== 'rsa' || bits < 2048 || bits > 4096) throw new Error('Use an RSA developer key between 2048 and 4096 bits.');
    return leaf;
}
export function validateRegistryIdentity(chainPem, keyPem, anchorPem) {
    const leaf = validateRegistryCertificate(chainPem, anchorPem);
    if (!leaf.checkPrivateKey(crypto.createPrivateKey(keyPem))) throw new Error('Private key does not match developer certificate.');
    return leaf;
}
export function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
// The ZIP carries both files. The signed metadata binds the exact path and
// SHA-256 digest of every source file, including the inert .fdoignore file.
export function signRegistryFiles(files, chainPem, keyPem, anchorPem) {
    const leaf = validateRegistryIdentity(chainPem, keyPem, anchorPem);
    const payloadFiles = Object.fromEntries(Object.entries(files).filter(([name]) => !['fdo.meta.json','fdo.signature'].includes(name)));
    const metadata = {
        format: 'fdo-registry-v1',
        hashAlgorithm: 'sha256',
        signatureAlgorithm: 'RSASSA-PKCS1-v1_5',
        signedAt: new Date().toISOString(),
        signerFingerprint: crypto.createHash('sha256').update(leaf.publicKey.export({type:'spki',format:'der'})).digest('hex'),
        files: Object.fromEntries(Object.keys(payloadFiles).sort().map(name => [name, crypto.createHash('sha256').update(payloadFiles[name]).digest('hex')])),
    };
    const signature = crypto.sign('sha256', Buffer.from(stableStringify(metadata)), {key: keyPem, padding: crypto.constants.RSA_PKCS1_PADDING});
    return {...payloadFiles, 'fdo.meta.json': Buffer.from(JSON.stringify(metadata,null,2)+'\n'), 'fdo.signature': signature};
}
