/** @jest-environment node */
const {execFileSync}=require('node:child_process');
const path=require('node:path');
test('bundled host provider negotiates actual SSH PTY/X11 and substitutes only host-held local authorization',()=>{
 const output=execFileSync(process.execPath,[path.resolve('tests/fixtures/ssh-terminal-loopback.cjs')],{encoding:'utf8',timeout:15000});
 expect(output).toContain('PASS: real loopback SSH');expect(output).toContain('Local X server is simulated');
},20000);
