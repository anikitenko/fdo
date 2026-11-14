/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
let root;
beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'registry-pin-'));for(const dir of ['scripts','src/config','bin'])fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.copyFileSync(path.resolve('scripts/sync-registry-trust.cjs'),path.join(root,'scripts/sync-registry-trust.cjs'));
    fs.writeFileSync(path.join(root,'bin/aws'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.FAKE_ARGS,JSON.stringify(process.argv.slice(2)));process.stdout.write(process.env.FAKE_STACK);\n`,{mode:0o700});
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
function run(outputs){const response={Stacks:[{Outputs:Object.entries(outputs).map(([OutputKey,OutputValue])=>({OutputKey,OutputValue}))}]};return execFileSync(process.execPath,[path.join(root,'scripts/sync-registry-trust.cjs')],{encoding:'utf8',stdio:'pipe',env:{...process.env,PATH:path.join(root,'bin')+path.delimiter+process.env.PATH,FAKE_STACK:JSON.stringify(response),FAKE_ARGS:path.join(root,'args.json')}});}
test('bootstraps the release pin from authenticated CloudFormation output, never from HTTPS trust on first use',()=>{
    run({RegistryUrl:'https://registry.example.test',RegistryRootFingerprint256:'ab'.repeat(32)});
    expect(JSON.parse(fs.readFileSync(path.join(root,'src/config/officialRegistry.json'),'utf8'))).toEqual({certificateUrl:'https://registry.example.test/api/v1/registry/certificate',trustUrl:'https://registry.example.test/api/v1/registry/trust',rootFingerprint256:'ab'.repeat(32)});
    expect(JSON.parse(fs.readFileSync(path.join(root,'args.json'),'utf8')).slice(0,2)).toEqual(['cloudformation','describe-stacks']);
});
test.each([{RegistryUrl:'https://registry.example.test'}, {RegistryUrl:'http://registry.example.test',RegistryRootFingerprint256:'ab'.repeat(32)}])('refuses incomplete or insecure bootstrap output',outputs=>{
    expect(()=>run(outputs)).toThrow();expect(fs.existsSync(path.join(root,'src/config/officialRegistry.json'))).toBe(false);
});
