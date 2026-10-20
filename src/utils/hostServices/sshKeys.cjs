const crypto = require('node:crypto');
const {utils} = require('ssh2');

function sshString(value) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const out = Buffer.allocUnsafe(4 + body.length);
    out.writeUInt32BE(body.length, 0);
    body.copy(out, 4);
    return out;
}

function encodeOpenSSHPrivate(keyObject) {
    const type = keyObject.asymmetricKeyType;
    if (type === 'rsa') return keyObject.export({type: 'pkcs1', format: 'pem'});
    if (type === 'ec') return keyObject.export({type: 'sec1', format: 'pem'});
    if (type !== 'ed25519') throw new Error(`Unsupported SSH key type: ${type}`);
    const jwk = keyObject.export({format: 'jwk'});
    const pub = Buffer.from(jwk.x, 'base64url');
    const seed = Buffer.from(jwk.d, 'base64url');
    if (pub.length !== 32 || seed.length !== 32) throw new Error('Unexpected Ed25519 key length');
    const name = Buffer.from('ssh-ed25519');
    const publicKey = Buffer.concat([sshString(name), sshString(pub)]);
    const privateBody = Buffer.concat([sshString(name), sshString(pub), sshString(Buffer.concat([seed, pub]))]);
    const check = crypto.randomBytes(4);
    let inner = Buffer.concat([check, check, privateBody, sshString('')]);
    const pad = (8 - (inner.length % 8)) % 8;
    const padding = Buffer.alloc(pad);
    for (let index = 0; index < pad; index += 1) padding[index] = index + 1;
    inner = Buffer.concat([inner, padding]);
    const none = sshString('none');
    const nkeys = Buffer.alloc(4);
    nkeys.writeUInt32BE(1, 0);
    const blob = Buffer.concat([
        Buffer.from('openssh-key-v1\0'), none, none, sshString(Buffer.alloc(0)), nkeys, sshString(publicKey), sshString(inner),
    ]);
    const body = blob.toString('base64').replace(/(.{70})/g, '$1\n').replace(/\n$/,'');
    return `-----BEGIN OPENSSH PRIVATE KEY-----\n${body}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

function parsedSsh2Key(material, passphrase) {
    const parsed = utils.parseKey(material, passphrase);
    return parsed instanceof Error ? parsed : Array.isArray(parsed) ? parsed[0] : parsed;
}

function toSsh2PrivateKey(material, passphrase) {
    const parsed = parsedSsh2Key(material, passphrase);
    if (!(parsed instanceof Error)) return typeof material === 'string' ? material : Buffer.from(material).toString();
    const key = crypto.createPrivateKey(passphrase ? {key: material, passphrase} : material);
    return encodeOpenSSHPrivate(key);
}

function prepareSshCredentials(credentials) {
    if (!credentials?.privateKey) return credentials;
    const original = credentials.privateKey;
    credentials.privateKey = toSsh2PrivateKey(original, credentials.passphrase);
    if (credentials.privateKey !== original) credentials.passphrase = undefined;
    return credentials;
}

function generateEd25519() {
    const {privateKey} = crypto.generateKeyPairSync('ed25519');
    const pem = encodeOpenSSHPrivate(privateKey);
    const parsed = parsedSsh2Key(pem);
    if (parsed instanceof Error) throw parsed;
    return {private: pem, publicSSH: parsed.getPublicSSH()};
}

module.exports = {encodeOpenSSHPrivate, toSsh2PrivateKey, prepareSshCredentials, generateEd25519};
