'use strict';
module.exports = async function preparePackage(context) {
    await require('./check-bundled-host-runtime.cjs')(context);
    const root=context.appDir || context.packager?.info?.appDir;
    const arch=typeof context.arch==='string'?context.arch:require('electron-builder').Arch[context.arch];
    return require('./legal/inventory.cjs').generate({root,platform:context.electronPlatformName,arch});
};
