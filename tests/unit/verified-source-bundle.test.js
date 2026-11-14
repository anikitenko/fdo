/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {createVerifiedSourcePlugin} from '../../src/utils/plugins/security/verifiedSourceBundle';
let home;
beforeEach(async()=>{home=await fs.mkdtemp(path.join(os.tmpdir(),'verified-runtime-'));});afterEach(async()=>{await fs.rm(home,{recursive:true,force:true});});
const hash=source=>createHash('sha256').update(source).digest('hex');
async function compile(files){return build({entryPoints:[path.join(home,'index.ts')],bundle:true,write:false,platform:'node',logLevel:'silent',plugins:[createVerifiedSourcePlugin(home,files,path.resolve('node_modules'))]});}
test('builds the signed source graph and rejects a change between verification and compilation',async()=>{
    await fs.writeFile(path.join(home,'index.ts'),'export const value=1;');const files={'index.ts':hash('export const value=1;')};
    expect((await compile(files)).outputFiles).toHaveLength(1);
    await fs.writeFile(path.join(home,'index.ts'),'export const value=2;');await expect(compile(files)).rejects.toThrow(/changed before compilation/);
});
test('never executes an unsigned dist file referenced by otherwise signed source',async()=>{
    const source="import './dist/attack.js';";await fs.writeFile(path.join(home,'index.ts'),source);await fs.mkdir(path.join(home,'dist'));await fs.writeFile(path.join(home,'dist/attack.js'),'console.log("unsigned")');
    await expect(compile({'index.ts':hash(source)})).rejects.toThrow(/unsigned registry source/);
});
test('rejects a signed path replaced with an external symbolic link',async()=>{
    const source='export const value=1;';const external=home+'-external.ts';await fs.writeFile(external,source);await fs.symlink(external,path.join(home,'index.ts'));
    try{await expect(compile({'index.ts':hash(source)})).rejects.toThrow(/escaped/);}finally{await fs.rm(external);}
});
