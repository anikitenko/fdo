import "reflect-metadata";
import crypto from "node:crypto";
import {X509Certificate, BasicConstraintsExtension, KeyUsagesExtension, KeyUsageFlags} from "@peculiar/x509";

// Resolve an ordered leaf-first chain to an explicitly trusted certificate. All
// signature checks use Node/OpenSSL rather than JavaScript RSA implementations.
export function verifyCertificateChain(chain, trustedPems, now = new Date()) {
    if (!chain.length) throw new Error("Certificate chain is empty");
    const trusted = trustedPems.map(pem => new crypto.X509Certificate(pem));
    const path = [...chain];
    const last = path[path.length - 1];
    let anchor = trusted.find(cert => cert.fingerprint256 === last.fingerprint256);
    if (!anchor) {
        anchor = trusted.find(cert => last.checkIssued(cert) && last.verify(cert.publicKey));
        if (!anchor) throw new Error("Certificate chain has no trusted issuer");
        path.push(anchor);
    }

    const seen = new Set();
    for (let i = 0; i < path.length; i++) {
        const cert = path[i];
        if (seen.has(cert.fingerprint256)) throw new Error("Certificate chain contains a cycle");
        seen.add(cert.fingerprint256);
        if (new Date(cert.validFrom) > now || new Date(cert.validTo) <= now) {
            throw new Error("Certificate is outside its validity period");
        }
        const parsed = new X509Certificate(cert.raw);
        // Fail closed for critical extensions whose constraints we do not implement.
        const supportedCritical = new Set(["2.5.29.19", "2.5.29.15"]);
        if (parsed.extensions.some(ext => ext.critical && !supportedCritical.has(ext.type))) {
            throw new Error("Unsupported critical certificate extension");
        }
        if (i > 0) {
            const child = path[i - 1];
            if (!cert.ca || !child.checkIssued(cert) || !child.verify(cert.publicKey)) {
                throw new Error("Invalid certificate issuer or signature");
            }
            const usage = parsed.getExtension(KeyUsagesExtension);
            if (usage && !(usage.usages & KeyUsageFlags.keyCertSign)) {
                throw new Error("Issuer is not permitted to sign certificates");
            }
            const constraints = parsed.getExtension(BasicConstraintsExtension);
            const intermediates = path.slice(1, i).filter(item => item.subject !== item.issuer).length;
            if (constraints?.pathLength !== undefined && intermediates > constraints.pathLength) {
                throw new Error("Certificate chain exceeds issuer path length");
            }
        }
    }
    return anchor;
}
