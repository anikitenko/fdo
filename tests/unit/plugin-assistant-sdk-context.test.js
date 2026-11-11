/** @jest-environment node */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {readEvaluationSdkContext, EVALUATION_SDK_DECLARATIONS} = require('../../scripts/lib/plugin-assistant-sdk-context.cjs');

test('evaluation supplies actual installed bridge, lifecycle and render helper declarations', () => {
    const context = readEvaluationSdkContext(path.resolve('node_modules/@anikitenko/fdo-sdk/dist/@types'));
    expect(context).toMatch(/createBackendReq:\s*\(type: string/);
    expect(context).toMatch(/registerHandler/);
    expect(context).toMatch(/export type RenderOnLoadOutput\s*=/);
    expect(context).toMatch(/function defineRenderOnLoadActions\(options:/);
    expect(context).toContain('SDK declaration: FDOInterface.d.ts');
    expect(EVALUATION_SDK_DECLARATIONS).toContain('ambient/fdo-host.d.ts');
});

test('missing installed declaration fails instead of silently providing incomplete evidence', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-sdk-evaluation-'));
    try {
        fs.writeFileSync(path.join(root, 'index.d.ts'), 'export {};');
        expect(() => readEvaluationSdkContext(root)).toThrow('PluginRegistry.d.ts');
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});

test('new SDK decorator declarations are included when installed without requiring them from older SDKs', () => {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-sdk-decorator-evidence-'));
    try {
        for(const name of EVALUATION_SDK_DECLARATIONS) {
            const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'export {};');
        }
        expect(readEvaluationSdkContext(root)).not.toContain('SDK declaration: decorators/Registration.d.ts');
        fs.mkdirSync(path.join(root,'decorators'),{recursive:true});
        fs.writeFileSync(path.join(root,'decorators/Registration.d.ts'),'export declare function handler(name?:string):MethodDecorator;');
        const context=readEvaluationSdkContext(root);
        expect(context).toContain('SDK declaration: decorators/Registration.d.ts');
        expect(context).toContain('handler(name?:string):MethodDecorator');
    }finally {fs.rmSync(root,{recursive:true,force:true});}
});
