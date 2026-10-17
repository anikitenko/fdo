require('reflect-metadata');
const crypto = require('node:crypto');
const {X509CertificateGenerator, BasicConstraintsExtension} = require('@peculiar/x509');

async function certificateFixture(label = 'root') {
    const algorithm = {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1])};
    const keys = await crypto.webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const certificate = await X509CertificateGenerator.createSelfSigned({
        name: 'CN=Certificate Storage Test', serialNumber: crypto.randomBytes(16).toString('hex'),
        notBefore: new Date(Date.now() - 60000), notAfter: new Date(Date.now() + 86400000 * 365),
        keys, signingAlgorithm: algorithm, extensions: [new BasicConstraintsExtension(true, undefined, true)],
    }, crypto.webcrypto);
    return {id: `SHA256://${crypto.createHash('sha256').update(certificate.toString('pem')).digest('base64')}`,
        label, cert: certificate.toString('pem'), createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000 * 365).toISOString(), imported: true,
        key: crypto.createPrivateKey({key: Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey)), type: 'pkcs8', format: 'der'}).export({type: 'pkcs1', format: 'pem'})};
}
module.exports = {certificateFixture};
