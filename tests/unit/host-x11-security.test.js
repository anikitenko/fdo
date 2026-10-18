/** @jest-environment node */
const {createRestrictedDisplay}=require('../../src/utils/hostServices/x11Security.cjs');
const {openX11Control,querySecurity}=require('../../src/utils/hostServices/x11Protocol.cjs');
const {securityServer}=require('../fixtures/x11SecurityServer.cjs');
async function fixture(run,behavior){const server=await securityServer(behavior);try{await run(server);}finally{await server.close();}}
test('generates a distinct untrusted authorization, verifies hidden extensions and trusted-pixmap denial, then revokes only its own ID',()=>fixture(async server=>{
 const local=await createRestrictedDisplay(server.base);
 expect(local.securityAuthorization).toBe('untrusted');expect(local.isCurrent()).toBe(true);expect(server.authorizations.size).toBe(1);
 expect(server.requests.some(request=>request.opcode===73&&request.restricted)).toBe(true);expect(server.pixmaps.size).toBe(0);
 const client=await openX11Control(await local.connect(),local.cookie);expect(await querySecurity(client)).toMatchObject({present:false,opcode:0});client.close();
 await local.dispose();await local.dispose();expect(server.authorizations.size).toBe(0);expect(local.cookie).toEqual(Buffer.alloc(16));expect(local.isCurrent()).toBe(false);
 expect(server.requests.filter(request=>request.opcode===145&&request.minor===2)).toHaveLength(1);
}),15000);
test.each([{missingExtension:true},{trustedAuthorization:true},{exposedSecurity:true},{readsTrustedPixmap:true}])('rejects missing or ineffective X SECURITY isolation: %j',behavior=>fixture(async server=>{
 await expect(createRestrictedDisplay(server.base)).rejects.toMatchObject({code:'X11_UNSUPPORTED'});expect(server.authorizations.size).toBe(0);
},behavior),15000);
test('absolute expiry closes consumers and explicitly revokes even when authorization is in use',()=>fixture(async server=>{
 const local=await createRestrictedDisplay(server.base,{lifetimeMs:1000});
 const client=await openX11Control(await local.connect(),local.cookie);expect(client.closed).toBe(false);
 await new Promise(resolve=>local.signal.addEventListener('abort',resolve,{once:true}));await local.dispose();
 expect(server.authorizations.size).toBe(0);expect(local.isCurrent()).toBe(false);await expect(local.connect()).rejects.toMatchObject({code:'X11_AUTH_UNAVAILABLE'});
}),15000);
test('a dropped control connection invalidates forwarding and recovers only to revoke the owned authorization',()=>fixture(async server=>{
 const local=await createRestrictedDisplay(server.base);const authorization=[...server.authorizations.values()][0];authorization.issuer.destroy();
 await new Promise(resolve=>local.signal.addEventListener('abort',resolve,{once:true}));await local.dispose();expect(server.authorizations.size).toBe(0);
}),15000);

test('revocation before generation prevents new authorization; revocation during generation cleans up its late reply',async()=>{
 for(const phase of ['version','generation'])await fixture(async server=>{
  const authorize=()=>{if(server.requests.some(request=>request.opcode===145&&request.minor===(phase==='version'?0:1)))throw Object.assign(new Error('Denied'),{code:'ACCESS_DENIED'});};
  await expect(createRestrictedDisplay(server.base,{authorize})).rejects.toMatchObject({code:'ACCESS_DENIED'});
  expect(server.authorizations.size).toBe(0);
  expect(server.requests.some(request=>request.opcode===145&&request.minor===1)).toBe(phase==='generation');
 });
},15000);
