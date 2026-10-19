/** @jest-environment node */
import "reflect-metadata";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {X509CertificateGenerator, BasicConstraintsExtension, KeyUsagesExtension, KeyUsageFlags} from "@peculiar/x509";
import {Certs} from "../../src/utils/system/certs";
import {verifyCertificateChain} from "../../src/utils/system/certificateChain";
import {certificateStorage} from "../../src/utils/persistence/certificateStorage";
import {openCertificateDatabase} from "../../src/utils/persistence/certificateDatabase.cjs";

jest.mock("../../src/utils/persistence/certificateStorage", () => ({certificateStorage: {list: jest.fn(), put: jest.fn(), putIfLabelMissing: jest.fn(), update: jest.fn(), remove: jest.fn(), privateKey: jest.fn()}}));
jest.mock("../../src/utils/desktop/NotificationCenter", () => ({NotificationCenter: {addNotification: jest.fn()}}));
jest.mock("../../src/utils/filesystem/safeReadFileSync", () => ({safeReadFileSync: jest.fn((...args) => require("node:fs").readFileSync(...args))}));

const algorithm = {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1])};
let root, rootKeys, leaf, leafKeys, pluginDir, database;

async function certificate(name, keys, issuer, signingKey, extensions = [], dates = {}) {
    return X509CertificateGenerator.create({
        subject: name, issuer, publicKey: keys.publicKey, signingKey,
        signingAlgorithm: algorithm, notBefore: new Date(Date.now() - 60000),
        notAfter: new Date(Date.now() + 86400000), extensions, ...dates,
    }, crypto.webcrypto);
}

beforeAll(async () => {
    rootKeys = await crypto.webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    leafKeys = await crypto.webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    root = await certificate("CN=Test Root", rootKeys, "CN=Test Root", rootKeys.privateKey, [
        new BasicConstraintsExtension(true, 0, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.digitalSignature, true),
    ]);
    leaf = await certificate("CN=Developer", leafKeys, root.subject, rootKeys.privateKey);
});
beforeEach(() => {
    pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-certs-"));
    fs.writeFileSync(path.join(pluginDir, "index.js"), "export default 1;");
    database = openCertificateDatabase(path.join(pluginDir, '..', path.basename(pluginDir) + '.sqlite'), {
        encrypt: key => Buffer.from(key), decrypt: data => data.toString(),
    });
    for (const name of Object.keys(certificateStorage)) certificateStorage[name].mockImplementation(database[name]);
});
afterEach(() => {
    database.close();
    fs.rmSync(path.join(pluginDir, '..', path.basename(pluginDir) + '.sqlite'), {force: true});
    fs.rmSync(pluginDir, {recursive: true, force: true});
});

async function entry(cert, key, label = "test") {
    const der = await crypto.webcrypto.subtle.exportKey("pkcs8", key);
    return {cert: cert.toString("pem"), key: crypto.createPrivateKey({key: Buffer.from(der), format: "der", type: "pkcs8"}).export({type: "pkcs1", format: "pem"}), label, id: label};
}

test("generates a usable root CA and persists its matching private key", async () => {
    await Certs.generateRootCA("generated");
    const saved = database.list('root')[0];
    const cert = new crypto.X509Certificate(saved.cert);
    expect(cert.ca).toBe(true);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey(crypto.createPrivateKey(database.privateKey(saved.id)))).toBe(true);
    expect(Certs.daysUntilExpiry(saved.cert)).toBeGreaterThan(364);
    expect(Certs.signPlugin(pluginDir, "generated")).toEqual({success: true});
    expect(await Certs.verifyPlugin(pluginDir)).toMatchObject({success: true, commonName: {value: "FDO Root CA"}});
}, 30000);

test("verifies the legacy RSA/SHA-256 format and rejects content or signature tampering", async () => {
    const signer = await entry(root, rootKeys.privateKey);
    database.put(signer);
    expect(Certs.signPlugin(pluginDir, "test")).toEqual({success: true});
    const signature = fs.readFileSync(path.join(pluginDir, "fdo.signature"));
    const digest = Certs.hashPluginDir(pluginDir);
    expect(crypto.verify("sha256", digest, signer.cert, signature)).toBe(true);
    expect(Certs.verifyPluginSignature(pluginDir, signature.toString("base64"), signer.cert, {})).toMatchObject({success: true});
    expect(await Certs.verifyPlugin(pluginDir)).toMatchObject({success: true});
    const tampered = Buffer.from(signature); tampered[0] ^= 1;
    expect(Certs.verifyPluginSignature(pluginDir, tampered, signer.cert, {}).success).toBe(false);
    fs.writeFileSync(path.join(pluginDir, "index.js"), "tampered");
    expect((await Certs.verifyPlugin(pluginDir)).success).toBe(false);
});

test("rejects a PKCS#1 signature with extra nested DigestAlgorithm elements", async () => {
    const signer = await entry(root, rootKeys.privateKey);
    const digest = crypto.createHash("sha256").update(Certs.hashPluginDir(pluginDir)).digest();
    // SHA-256 DigestInfo containing an extra NULL in its AlgorithmIdentifier.
    // This is the malformed structure accepted by the vulnerable Forge verifier.
    const malformedDigestInfo = Buffer.concat([
        Buffer.from("3033300f0609608648016503040201050005000420", "hex"), digest,
    ]);
    const signature = crypto.privateEncrypt({key: signer.key, padding: crypto.constants.RSA_PKCS1_PADDING}, malformedDigestInfo);
    expect(Certs.verifyPluginSignature(pluginDir, signature, signer.cert, {}).success).toBe(false);
});

test("imports a matching key and rejects mismatched keys", async () => {
    const signer = await entry(root, rootKeys.privateKey);
    const file = path.join(pluginDir, "identity.pem");
    fs.writeFileSync(file, signer.cert + "\n" + signer.key);
    expect(await Certs.import(file)).toEqual({success: true});
    const other = await entry(leaf, leafKeys.privateKey);
    fs.writeFileSync(file, signer.cert + "\n" + other.key);
    expect(await Certs.import(file)).toMatchObject({success: false, error: "Private key does not match certificate"});
});

test("validates developer signatures to the actual trusted issuer", async () => {
    database.put(await entry(root, rootKeys.privateKey, "root"));
    database.put(await entry(leaf, leafKeys.privateKey, "developer"));
    expect(Certs.signPlugin(pluginDir, "developer")).toEqual({success: true});
    database.remove("developer");
    expect(await Certs.verifyPlugin(pluginDir)).toMatchObject({success: true, signer: {label: "root"}, commonName: {value: "Developer"}});
});

test("rejects untrusted chains, invalid issuers, expired certificates, and path length violations", async () => {
    const native = cert => new crypto.X509Certificate(cert.toString("pem"));
    expect(verifyCertificateChain([native(leaf)], [root.toString("pem")]).fingerprint256).toBe(native(root).fingerprint256);
    expect(() => verifyCertificateChain([native(leaf)], [])).toThrow("trusted issuer");
    expect(() => verifyCertificateChain([native(leaf)], [root.toString("pem")], new Date(Date.now() + 2 * 86400000))).toThrow("validity");
    const forged = await certificate("CN=Forged", leafKeys, root.subject, leafKeys.privateKey);
    expect(() => verifyCertificateChain([native(forged)], [root.toString("pem")])).toThrow("trusted issuer");
    const intermediate = await certificate("CN=Intermediate", leafKeys, root.subject, rootKeys.privateKey, [new BasicConstraintsExtension(true, undefined, true)]);
    const nestedLeaf = await certificate("CN=Nested", leafKeys, intermediate.subject, leafKeys.privateKey);
    expect(() => verifyCertificateChain([native(nestedLeaf), native(intermediate)], [root.toString("pem")])).toThrow("path length");
    const nonCaLeaf = await certificate("CN=Nested", leafKeys, leaf.subject, leafKeys.privateKey);
    expect(() => verifyCertificateChain([native(nonCaLeaf), native(leaf)], [root.toString("pem")])).toThrow("issuer");
});


test('first-use certificate creation preserves an existing identity', async () => {
    const existing = await entry(root, rootKeys.privateKey, 'root');database.put(existing);
    expect(await Certs.generateRootCA('root', false, {onlyIfMissing:true,notify:false})).toBe(false);
    expect(database.list('root')).toHaveLength(1);
    expect(database.list('root')[0].id).toBe(existing.id);
});

test('atomic first-use insertion cannot replace another process identity with the same label', async () => {
    const existing = await entry(root, rootKeys.privateKey, 'root');
    expect(database.putIfLabelMissing(existing)).toBe(true);
    expect(database.putIfLabelMissing({...existing,id:'concurrent-root'})).toBe(false);
    expect(database.list('root')).toHaveLength(1);
    expect(database.list('root')[0].id).toBe(existing.id);
});
