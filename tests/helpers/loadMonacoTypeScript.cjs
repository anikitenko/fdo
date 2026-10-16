const fs = require('node:fs');
const path = require('node:path');

// Exercise the compiler actually shipped by the installed Monaco release.
module.exports = function loadMonacoTypeScript() {
    const services = path.resolve('node_modules/monaco-editor/esm/vs/languages/features/typescript/lib/typescriptServices.js');
    const source = fs.readFileSync(services, 'utf8').replace(/export \{[^}]+};\s*$/, 'return typescript;');
    return new Function(source)();
};
