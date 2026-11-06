/** @jest-environment node */
jest.mock('../../scripts/check-bundled-host-runtime.cjs',()=>jest.fn(async()=>{}));
jest.mock('../../scripts/legal/inventory.cjs',()=>({generate:jest.fn(options=>{
    if(options.release)throw new Error('Strict legal review is pending.');
    if(!options.electronNoticesPath)throw new Error('Target runtime has not been extracted.');
    return {status:{releaseReady:false,pending:[{id:'publication-rights',status:'pending'}]}};
})}));
test('tagged package preparation reports pending reviews without invoking the optional strict audit',async()=>{
    const previous=process.env.RELEASE_PUBLISH;process.env.RELEASE_PUBLISH='true';
    try {
        const prepare=require('../../scripts/prepare-package.cjs');
        const context={appDir:'/project',appOutDir:'/project/release/linux-unpacked',electronPlatformName:'linux',arch:'x64'};
        await expect(prepare(context)).resolves.toBeUndefined();
        expect(require('../../scripts/legal/inventory.cjs').generate).not.toHaveBeenCalled();
        const afterExtract=require('../../scripts/prepare-package-legal.cjs');
        expect(afterExtract(context)).toMatchObject({status:{releaseReady:false,pending:[{id:'publication-rights',status:'pending'}]}});
    } finally {
        if(previous===undefined)delete process.env.RELEASE_PUBLISH;else process.env.RELEASE_PUBLISH=previous;
    }
});
