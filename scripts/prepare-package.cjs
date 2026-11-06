'use strict';
module.exports = async function preparePackage(context) {
    await require('./check-bundled-host-runtime.cjs')(context);
    // Legal inventory runs in afterExtract, once the target Electron runtime
    // and its notices actually exist. npm ci alone need not install its binary.
};
