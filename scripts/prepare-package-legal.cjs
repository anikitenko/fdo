'use strict';
const path=require('node:path');

module.exports=function preparePackageLegal(context) {
    const root=context.appDir || context.packager?.info?.appDir;
    const arch=typeof context.arch==='string'?context.arch:require('electron-builder').Arch[context.arch];
    const platform=context.electronPlatformName;
    const runtimeRoot=platform==='darwin' || platform==='mas'
        ? path.join(context.appOutDir,context.packager.info.framework.distMacOsAppName,'Contents','Resources')
        : context.appOutDir;
    return require('./legal/inventory.cjs').generate({root,platform,arch,
        electronNoticesPath:path.join(runtimeRoot,'LICENSES.chromium.html')});
};
