const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../third_party/gcm-files.json');

// Dugite extracts GCM directly into Git's helper directory. MinGit installs
// the Windows binaries alongside Git's DLLs and relocates the GCM notice.
function gcmPaths(platform, arch) {
    if (platform !== 'win32') return manifest.files[platform].map(name => 'libexec/git-core/' + name);
    const prefix = arch === 'arm64' ? 'clangarm64' : 'mingw64';
    return [
        ...manifest.files.win32.filter(name => name !== 'NOTICE').map(name => prefix + '/bin/' + name),
        ...['LICENSE', 'README.md', 'NOTICE'].map(name => prefix + '/doc/git-credential-manager/' + name),
        prefix + '/share/doc/git-doc/git-credential-manager.html',
    ];
}

function removeBundledGcm(root, platform, arch) {
    for (const name of gcmPaths(platform, arch)) fs.rmSync(path.join(root, name), {force: true});
    if (platform !== 'win32') return;
    const prefix = arch === 'arm64' ? 'clangarm64' : 'mingw64';
    for (const name of ['etc/gitconfig', prefix + '/etc/gitconfig']) {
        const config = path.join(root, name);
        if (!fs.existsSync(config)) continue;
        const previous = fs.readFileSync(config, 'utf8');
        let credentialSection = false;
        const updated = previous.split(/(?<=\n)/).filter(line => {
            if (/^\s*\[/.test(line)) credentialSection = /^\s*\[credential(?:\s|\])/i.test(line);
            return !(credentialSection && /^\s*helper\s*=\s*manager(?:-core)?\s*$/i.test(line));
        }).join('');
        if (updated !== previous) fs.writeFileSync(config, updated);
    }
}

module.exports = {gcmPaths, removeBundledGcm};
