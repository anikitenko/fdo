/** @jest-environment node */
import 'reflect-metadata';
import crypto from 'node:crypto';
import {X509CertificateGenerator, BasicConstraintsExtension, KeyUsagesExtension, KeyUsageFlags, ExtendedKeyUsageExtension} from '@peculiar/x509';
import {certificatePems, validateRegistryAnchor, validateRegistryIdentity, signRegistryFiles, stableStringify} from '../../src/utils/system/registrySigning';

const algorithm={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256',modulusLength:2048,publicExponent:new Uint8Array([1,0,1])};
let root, issuer, leaf, key, otherKey, chain;
beforeAll(async()=>{
    const keys=await Promise.all([0,1,2,3].map(()=>crypto.webcrypto.subtle.generateKey(algorithm,true,['sign','verify'])));
    const issue=(subject,issuerName,publicKeys,signingKeys,extensions)=>X509CertificateGenerator.create({subject,issuer:issuerName,publicKey:publicKeys.publicKey,signingKey:signingKeys.privateKey,signingAlgorithm:algorithm,serialNumber:crypto.randomBytes(16).toString('hex'),notBefore:new Date(Date.now()-60000),notAfter:new Date(Date.now()+86400000),extensions},crypto.webcrypto);
    const ca=[new BasicConstraintsExtension(true,undefined,true),new KeyUsagesExtension(KeyUsageFlags.keyCertSign,true)];
    root=await issue('CN=Root','CN=Root',keys[0],keys[0],ca);
    issuer=await issue('CN=Issuer',root.subject,keys[1],keys[0],ca);
    leaf=await issue('CN=Account',issuer.subject,keys[2],keys[1],[new BasicConstraintsExtension(false),new KeyUsagesExtension(KeyUsageFlags.digitalSignature),new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.3'])]);
    const pem=async pair=>crypto.createPrivateKey({key:Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8',pair.privateKey)),type:'pkcs8',format:'der'}).export({type:'pkcs8',format:'pem'});
    key=await pem(keys[2]);otherKey=await pem(keys[3]);chain=leaf.toString('pem')+'\n'+issuer.toString('pem');
});
test('requires an independently pinned root fingerprint',()=>{
    const fingerprint=new crypto.X509Certificate(root.toString('pem')).fingerprint256;
    expect(validateRegistryAnchor(root.toString('pem'),fingerprint).ca).toBe(true);
    expect(()=>validateRegistryAnchor(root.toString('pem'),'00'.repeat(32))).toThrow(/fingerprint/);
});
test('validates registry issuer chain, usage and matching private key',()=>{
    expect(validateRegistryIdentity(chain,key,root.toString('pem')).ca).toBe(false);
    expect(()=>validateRegistryIdentity(chain,otherKey,root.toString('pem'))).toThrow(/does not match/);
    expect(()=>validateRegistryIdentity(leaf.toString('pem'),key,root.toString('pem'))).toThrow(/trusted issuer/);
    expect(()=>validateRegistryIdentity(root.toString('pem'),key,root.toString('pem'))).toThrow(/code-signing/);
    expect(certificatePems(chain)).toHaveLength(2);
});
test('embeds signing metadata, a signer fingerprint and a signature over every exported path and digest',()=>{
    const files={'package.json':Buffer.from('{"name":"test-utils"}'),'index.ts':Buffer.from('source'),'.fdoignore':Buffer.from('dist/'),'fdo.signature':Buffer.from('obsolete')};
    const signed=signRegistryFiles(files,chain,key,root.toString('pem'));
    const metadata=JSON.parse(signed['fdo.meta.json'].toString());
    expect(metadata.format).toBe('fdo-registry-v1');
    expect(metadata.signerFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata).not.toHaveProperty('developerCert');
    expect(signed['fdo.meta.json'].includes(Buffer.from('BEGIN CERTIFICATE'))).toBe(false);
    expect(Object.keys(metadata.files)).toEqual(['.fdoignore','index.ts','package.json']);
    expect(metadata.files['index.ts']).toBe(crypto.createHash('sha256').update(files['index.ts']).digest('hex'));
    expect(crypto.verify('sha256',Buffer.from(stableStringify(metadata)),leaf.toString('pem'),signed['fdo.signature'])).toBe(true);
    metadata.files['renamed.ts']=metadata.files['index.ts'];delete metadata.files['index.ts'];
    expect(crypto.verify('sha256',Buffer.from(stableStringify(metadata)),leaf.toString('pem'),signed['fdo.signature'])).toBe(false);
    expect(Object.values(signed).some(content=>content.includes(Buffer.from('PRIVATE KEY')))).toBe(false);
    expect(stableStringify({z:[{b:1,a:2}],a:true})).toBe('{"a":true,"z":[{"a":2,"b":1}]}');
});
