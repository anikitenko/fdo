import forge from "node-forge"
import {settings} from "./store";
import * as os from "node:os";
import crypto from 'crypto';

export const Certs = {
    EXPIRY_THRESHOLD_DAYS: 90,

    daysUntilExpiry(certPem) {
        const cert = forge.pki.certificateFromPem(certPem);
        const notAfter = cert.validity.notAfter;
        return (notAfter - new Date()) / (1000 * 60 * 60 * 24);
    },

    generateRootCA(label = 'root', update = false) {
        console.log('🔐 Generating new FDO Root Certificate...');

        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();

        cert.publicKey = keys.publicKey;
        cert.serialNumber = Date.now().toString();
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

        const attrs = [
            { name: 'commonName', value: 'FDO Root CA' },
            { name: 'organizationName', value: 'FDO' },
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            { name: 'basicConstraints', cA: true },
            { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
        ]);

        cert.sign(keys.privateKey, forge.md.sha256.create());

        const certPem = forge.pki.certificateToPem(cert);
        const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

        // Calculate SHA256 fingerprint of cert PEM
        const sha256 = crypto.createHash('sha256').update(certPem).digest('base64');
        const id = `SHA256://${sha256}`;

        // Get system identity
        const user = os.userInfo().username;
        const host = os.hostname();
        const identity = `${user}@${host}`;

        const now = new Date();

        // Store as array of root certs
        const roots = settings.get('certificates.root') || [];

        if (!update) {
            roots.push({
                key: keyPem,
                cert: certPem,
                id,
                identity,
                label,
                createdAt: now.toISOString(),
                expiresAt: cert.validity.notAfter.toISOString(),
                lastUsedAt: now.toISOString(),
            });
        } else {
            const root = roots.find((root) => root.label === label);
            if (root) {
                root.key = keyPem;
                root.cert = certPem;
                root.id = id;
                root.identity = identity;
                root.label = label;
                root.createdAt = now.toISOString();
                root.expiresAt = cert.validity.notAfter.toISOString();
                root.lastUsedAt = now.toISOString();
            }
        }

        settings.set('certificates.root', roots);

        console.log(`✅ Root certificate created and added as identity: ${identity}`);
    }
}