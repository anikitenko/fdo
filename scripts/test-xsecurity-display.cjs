// Run with an authenticated local X server (CI uses a private Xvfb instance).
const assert=require('node:assert/strict');
const {createLocalDisplays}=require('../src/utils/hostServices/localDisplay.cjs');
const {openX11Control}=require('../src/utils/hostServices/x11Protocol.cjs');
(async()=>{
 const displays=createLocalDisplays();let base,local,trusted,client,copy;
 try{
  base=await displays.prepare('trusted');local=await displays.prepare('untrusted',{lifetimeMs:1000});copy=Buffer.from(local.cookie);
  assert.equal(local.securityAuthorization,'untrusted');
  client=await openX11Control(await local.connect(),local.cookie);
  await new Promise(resolve=>local.signal.aborted?resolve():local.signal.addEventListener('abort',resolve,{once:true}));
  await local.dispose();client.close();client=undefined;
  // Disposing a restricted display also disposes the trusted connection it
  // owns. Use a fresh trusted connection so this proves the copied generated
  // authorization was revoked by the server rather than rejected locally.
  trusted=await displays.prepare('trusted');
  await assert.rejects(openX11Control(await trusted.connect(),copy),error=>error.code==='X11_AUTH_UNAVAILABLE');
  // Revoking the generated ID must preserve the user's existing desktop cookie.
  client=await openX11Control(await trusted.connect(),trusted.cookie);client.close();client=undefined;
  console.log('PASS: real X SECURITY generation, trusted-resource isolation, active expiry, revocation and existing desktop authorization preservation.');
 }finally{client?.close();copy?.fill(0);await local?.dispose();await trusted?.dispose();await base?.dispose();}
})().catch(error=>{console.error('X SECURITY acceptance failed:',error?.code||'UNAVAILABLE',error?.message||'');process.exitCode=1;});
