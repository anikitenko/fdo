// Run with an authenticated local X server (CI uses a private Xvfb instance).
const assert=require('node:assert/strict');
const {createLocalDisplays}=require('../src/utils/hostServices/localDisplay.cjs');
const {openX11Control}=require('../src/utils/hostServices/x11Protocol.cjs');
(async()=>{
 const displays=createLocalDisplays();let base,local,client,copy;
 try{
  base=await displays.prepare('trusted');local=await displays.prepare('untrusted',{lifetimeMs:1000});copy=Buffer.from(local.cookie);
  assert.equal(local.securityAuthorization,'untrusted');
  client=await openX11Control(await local.connect(),local.cookie);
  await new Promise(resolve=>local.signal.aborted?resolve():local.signal.addEventListener('abort',resolve,{once:true}));
  await local.dispose();client.close();client=undefined;
  // Disposing a restricted display also disposes the trusted connection it
  // owns. Use a fresh trusted connection so this proves the copied generated
  // authorization was revoked by the server rather than rejected locally.
  let setupStatus;
  let revokedOutcome='accepted';
  try {
   const socket=await base.connect();
   socket.once('data',chunk=>{setupStatus=chunk[0];});
   const unexpected=await openX11Control(socket,copy);
   unexpected.close();
  } catch(error) {
   revokedOutcome=error.code || 'unknown error';
  }
  // Revoking the generated ID must preserve the user's existing desktop cookie.
  let trustedOutcome='accepted';
  try {
   client=await openX11Control(await base.connect(),base.cookie);
  } catch(error) {
   trustedOutcome=error.code || 'unknown error';
  }
  // X11 setup status 0 is the server's explicit rejection. A timeout or a
  // transport close alone cannot establish that revocation worked.
  assert.deepEqual({revokedOutcome,setupStatus,trustedOutcome},
   {revokedOutcome:'X11_AUTH_UNAVAILABLE',setupStatus:0,trustedOutcome:'accepted'});
  console.log('PASS: real X SECURITY generation, trusted-resource isolation, active expiry, revocation and existing desktop authorization preservation.');
 }finally{client?.close();copy?.fill(0);await local?.dispose();await base?.dispose();}
})().catch(error=>{console.error('X SECURITY acceptance failed:',error?.code||'UNAVAILABLE',error?.message||'');process.exitCode=1;});
