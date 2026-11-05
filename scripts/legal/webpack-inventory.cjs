const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const portable = value => value.split(path.sep).join('/');

function packageForResource(filename, root) {
    if (!filename || !path.isAbsolute(filename)) return null;
    root = path.resolve(root);
    const relative = path.relative(root, filename.split('?')[0]);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    let directory = path.dirname(filename.split('?')[0]);
    if (!portable(directory).includes('/node_modules/') && !directory.startsWith(path.join(root, 'packages') + path.sep)) return null;
    while (directory !== path.dirname(directory)) {
        const file = path.join(directory, 'package.json');
        if (fs.existsSync(file)) {
            try {
                const bytes = fs.readFileSync(file), metadata = JSON.parse(bytes);
                if (metadata.name && metadata.version) return {root:portable(path.relative(root,directory)),name:metadata.name,version:metadata.version,packageJsonSha256:digest(bytes)};
            } catch { /* Continue past non-package or synthetic package metadata. */ }
        }
        directory = path.dirname(directory);
    }
    return null;
}

class WebpackDependencyInventory {
    constructor(name) {this.name = name;}
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('FdoDependencyInventory', compilation => {
            compilation.hooks.processAssets.tap({name:'FdoDependencyInventory',stage:compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT}, () => {
                const packages = new Map(), visited = new Set();
                const visit = module => {
                    if (visited.has(module)) return;visited.add(module);
                    const info = packageForResource(module.resource, compiler.context);
                    if (info) {
                        const current = packages.get(info.root) || {...info,modules:0};current.modules++;packages.set(info.root,current);
                    }
                    if (module.modules) for (const child of module.modules) visit(child);
                };
                for (const module of compilation.modules) visit(module);
                const inventory = {schemaVersion:1,compiler:this.name,packages:[...packages.values()].sort((a,b)=>a.root.localeCompare(b.root))};
                compilation.emitAsset(`legal-inputs/${this.name}.json`,new compiler.webpack.sources.RawSource(JSON.stringify(inventory,null,2)+'\n'));
            });
        });
    }
}
module.exports = {WebpackDependencyInventory,packageForResource};
