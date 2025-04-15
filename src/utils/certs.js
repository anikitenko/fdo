import forge from "node-forge"
import {settings} from "./store";
import * as os from "node:os";
import crypto from 'crypto';
import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";

export const Certs = {
    EXPIRY_THRESHOLD_DAYS: 90,
    IS_WIN() {
        return typeof process !== 'undefined' && process.platform === 'win32'
    },
    LINE_END() {
        return this.IS_WIN() ? '\r\n' : '\n'
    },

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
            {name: 'commonName', value: 'FDO Root CA'},
            {name: 'organizationName', value: 'FDO'},
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            {name: 'basicConstraints', cA: true},
            {name: 'keyUsage', keyCertSign: true, digitalSignature: true},
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
                imported: false
            });
        } else {
            const root = roots.find((root) => root.label === label);
            if (root) {
                root.key = keyPem;
                root.cert = certPem;
                root.id = id;
                root.identity = identity;
                root.createdAt = now.toISOString();
                root.expiresAt = cert.validity.notAfter.toISOString();
                root.lastUsedAt = now.toISOString();
                root.imported = false;
            }
        }

        settings.set('certificates.root', roots);

        console.log(`✅ Root certificate created and added as identity: ${identity}`);
    },

    setLabel(id, newName) {
        const roots = settings.get('certificates.root') || [];
        const root = roots.find((root) => root.id === id);
        if (root) {
            root.label = newName;
        }
        settings.set('certificates.root', roots);
    },

    export(id) {
        const roots = settings.get('certificates.root') || [];
        const root = roots.find((root) => root.id === id);
        if (root) {
            return {
                cert: root.cert,
            };
        }
        return null;
    },

    async import(file) {
        try {
            const filePath = path.resolve(file);
            const pem = fs.readFileSync(filePath, "utf-8");

            // Validate that it's a valid certificate
            const cert = forge.pki.certificateFromPem(pem);
            if (!cert || !cert.validity || !cert.publicKey) {
                return {success: false, error: "Invalid certificate format"}
            }

            // Optionally check if it's expired
            const now = new Date();
            if (cert.validity.notAfter <= now) {
                return {success: false, error: "Certificate is expired"}
            }

            // Calculate SHA256 fingerprint
            const sha256 = crypto.createHash("sha256").update(pem).digest("base64");
            const id = `SHA256://${sha256}`;

            const roots = settings.get("certificates.root") || [];

            const existingRoot = roots.find((root) => root.id === id);
            if (existingRoot) {
                return {success: false, error: "Certificate already exists"}
            }

            const entry = {
                cert: pem,
                id,
                label: "imported",
                createdAt: now.toISOString(),
                expiresAt: cert.validity.notAfter.toISOString(),
                lastUsedAt: now.toISOString(),
                imported: true
            }

            roots.push(entry);

            settings.set("certificates.root", roots);

            return {success: true}
        } catch (err) {
            return {success: false, error: "Failed to import certificate: " + err.message}
        }
    },

    loadIgnorePatterns(pluginDir) {
        const ignoreFile = path.join(pluginDir, ".fdoignore");
        if (!fs.existsSync(ignoreFile)) return null;

        const content = fs.readFileSync(ignoreFile, "utf-8");
        const ig = ignore();
        ig.add(content.split(/\r?\n/).filter(Boolean));
        return ig;
    },

    hashPluginDir(pluginDir) {
        const hash = crypto.createHash("sha256");
        const ig = this.loadIgnorePatterns(pluginDir);

        const walk = (dir) => {
            fs.readdirSync(dir).forEach((file) => {
                const fullPath = path.join(dir, file);
                const relPath = path.relative(pluginDir, fullPath);

                // Always ignore meta + sig files
                if (["fdo.meta.json", "fdo.signature", ".fdoignore"].includes(file)) return;
                // Skip ignored files
                if (ig && ig.ignores(relPath)) return;

                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    walk(fullPath);
                } else {
                    const content = fs.readFileSync(fullPath);
                    hash.update(content);
                }
            });
        };

        walk(pluginDir);
        return hash.digest();
    },

    signPlugin(pluginDir, signerLabel) {
        const roots = settings.get("certificates.root") || [];
        const certEntry = roots.find(cert => cert.label === signerLabel);

        if (!certEntry || !certEntry.key) {
            return {success: false, error: "Signer not found or missing private key"}
        }

        const privateKey = forge.pki.privateKeyFromPem(certEntry.key);
        const hash = this.hashPluginDir(pluginDir);

        const md = forge.md.sha256.create();
        md.update(hash.toString("binary"));

        const signature = privateKey.sign(md);

        const normalizedCert = certEntry.cert.trim().replace(/\r\n/g, '\n');
        const fingerprint = crypto.createHash("sha256").update(normalizedCert).digest("base64");

        // Save signature and metadata
        fs.writeFileSync(path.join(pluginDir, "fdo.signature"), Buffer.from(signature, "binary"));
        fs.writeFileSync(
            path.join(pluginDir, "fdo.meta.json"),
            JSON.stringify({
                fingerprint: {
                    algo: "SHA256",
                    value: fingerprint
                },
                label: certEntry.label,
                identity: certEntry.identity,
                signedAt: new Date().toISOString()
            }, null, 2) + this.LINE_END()
        );

        return {success: true}
    },

    verifyPluginSignature(pluginDir) {
        try {
            const metaPath = path.join(pluginDir, "fdo.meta.json");
            const sigPath = path.join(pluginDir, "fdo.signature");

            if (!fs.existsSync(metaPath) || !fs.existsSync(sigPath)) {
                return {success: false, error: "Missing signature or metadata file."};
            }

            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const signatureBuffer = fs.readFileSync(sigPath);

            if (
                typeof meta.fingerprint?.value !== "string" ||
                meta.fingerprint.algo?.toLowerCase() !== "sha256"
            ) {
                return {
                    success: false,
                    error: "Invalid or unsupported fingerprint format in metadata.",
                };
            }

            const allCerts = [
                ...(settings.get("certificates.root") || []),
                // ...(settings.get("certificates.org") || []),
                // ...(settings.get("certificates.registry") || []),
            ];

            const matchedCert = allCerts.find((cert) => {
                const normalizedCert = cert.cert.trim().replace(/\r\n/g, '\n');
                const fingerprint = crypto
                    .createHash("sha256")
                    .update(normalizedCert)
                    .digest("base64");
                return fingerprint === meta.fingerprint.value;
            });

            if (!matchedCert) {
                return {success: false, error: "Signer certificate not found."};
            }

            // Hash plugin content (excluding signature + meta)
            const pluginHash = this.hashPluginDir(pluginDir);
            const md = forge.md.sha256.create();
            md.update(pluginHash.toString("binary"));

            const certObj = forge.pki.certificateFromPem(matchedCert.cert);
            const now = new Date();
            if (certObj.validity.notAfter <= now) {
                return {
                    success: false,
                    error: `Certificate expired on ${certObj.validity.notAfter.toISOString()}.`,
                };
            }
            const publicKey = certObj.publicKey;

            // Verify signature (must decode to binary if it was saved as Buffer)
            const isValid = publicKey.verify(
                md.digest().bytes(),
                signatureBuffer.toString("binary")
            );

            if (!isValid) {
                return {
                    success: false,
                    error: "Invalid signature. The plugin may have been modified after signing. Consider using of .fdoignore or deploy from editor again"
                };
            }

            matchedCert.lastUsedAt = new Date().toISOString();

            const updatedCerts = allCerts.map(cert =>
                cert.id === matchedCert.id ? matchedCert : cert
            );
            settings.set("certificates.root", updatedCerts);

            return {
                success: true,
                signer: matchedCert,
            };
        } catch (err) {
            return {
                success: false,
                error: `Verification failed: ${err.message}`,
            };
        }
    },
}