/** @jest-environment node */
const {test,expect}=require('@jest/globals');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const webpack=require('../../webpack.main.config');

test('main build repairs copied Git, HTTPS transport and LFS executables before they can be launched',()=>{
    if(process.platform==='win32')return;
    const output=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-git-build-modes-'));
    try {
        const files=['git/bin/git','git/libexec/git-core/git-remote-http','git/libexec/git-core/git-remote-https','git/libexec/git-core/git-lfs'];
        for(const relative of files){const file=path.join(output,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'#!/bin/sh\nprintf "runtime-ready"\n',{mode:0o644});}
        expect(()=>execFileSync(path.join(output,files[0]))).toThrow();
        const callbacks=[];
        const compiler={options:{output:{path:output}},hooks:{afterEmit:{tap:(name,callback)=>{if(name==='BundledExecutablePermissions')callbacks.push(callback);}}}};
        // Exercise the actual configured build hook, not just its chmod helper.
        for(const plugin of webpack.plugins)if(plugin.apply&&plugin.constructor===Object)plugin.apply(compiler);
        expect(callbacks).toHaveLength(1);callbacks[0]();
        for(const relative of files)expect(execFileSync(path.join(output,relative),{encoding:'utf8'})).toBe('runtime-ready');
        // Subsequent incremental builds keep executable files runnable too.
        callbacks[0]();expect(execFileSync(path.join(output,files[2]),{encoding:'utf8'})).toBe('runtime-ready');
    }finally{fs.rmSync(output,{recursive:true,force:true});}
});
