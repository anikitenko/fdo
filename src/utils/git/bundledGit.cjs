const fs = require('node:fs');
const path = require('node:path');
function layout(root, platform = process.platform, arch = process.arch) {
    const windows = platform === 'win32', mingw = arch === 'arm64' ? 'clangarm64' : arch === 'x64' ? 'mingw64' : 'mingw32';
    return {root, command:path.join(root, windows ? 'cmd/git.exe' : 'bin/git'),
        execPath:path.join(root, ...(windows ? [mingw] : []), 'libexec/git-core'),
        binPaths:windows ? [path.join(root,mingw,'bin'),path.join(root,'usr/bin'),path.join(root,'cmd')] : [path.join(root,'bin')]};
}
function bundledGit() {
    const roots = [process.resourcesPath && path.join(process.resourcesPath,'git'), path.join(__dirname,'git'), path.resolve(__dirname,'../../../node_modules/dugite/git')].filter(Boolean);
    const value = roots.map(root => layout(root)).find(candidate => fs.existsSync(candidate.command));
    if (!value) throw new Error('The bundled Git runtime is missing. Reinstall FDO or rebuild the host; a system Git installation is not required for GitOps.');
    if (process.env.FDO_E2E === '1' && process.env.FDO_E2E_BUNDLED_GIT_COMMAND) value.command=process.env.FDO_E2E_BUNDLED_GIT_COMMAND;
    return value;
}
function environment(base = process.env, value = bundledGit()) {
    const env = {...base, GIT_EXEC_PATH:value.execPath, PATH:[...value.binPaths,base.PATH || base.Path || ''].join(path.delimiter)};
    if (process.platform === 'linux') {env.PREFIX=value.root; env.GIT_SSL_CAINFO=path.join(value.root,'ssl/cacert.pem');}
    return env;
}
module.exports = {bundledGit,environment,layout};
