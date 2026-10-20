const fs = require("node:fs");
const path = require("node:path");

function chmodIfPresent(targetPath, mode = 0o755) {
    if (!targetPath || !fs.existsSync(targetPath)) {
        return false;
    }

    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) {
        return false;
    }

    const currentMode = stat.mode & 0o777;
    if ((currentMode & 0o111) === 0o111) {
        return false;
    }

    fs.chmodSync(targetPath, mode);
    return true;
}

function getResourcesDir(appOutDir) {
    const directResources = path.join(appOutDir, "resources");
    if (fs.existsSync(directResources)) {
        return directResources;
    }

    const macResources = path.join(appOutDir, "Contents", "Resources");
    if (fs.existsSync(macResources)) {
        return macResources;
    }

    if (fs.existsSync(appOutDir)) {
        const apps=fs.readdirSync(appOutDir).filter(name=>name.endsWith('.app'));
        if(apps.length===1) {
            const bundled=path.join(appOutDir,apps[0],'Contents','Resources');
            if(fs.existsSync(bundled))return bundled;
        }
    }

    return directResources;
}

function fixCodexPermissions(resourcesDir) {
    const unpackedRoot = path.join(resourcesDir, "app.asar.unpacked", "dist", "main", "node_modules", "@openai");
    if (!fs.existsSync(unpackedRoot)) {
        return [];
    }

    const updated = [];
    const platformPackages = fs.readdirSync(unpackedRoot).filter((name) => name.startsWith("codex-"));

    for (const platformPackage of platformPackages) {
        const vendorRoot = path.join(unpackedRoot, platformPackage, "vendor");
        if (!fs.existsSync(vendorRoot)) {
            continue;
        }

        for (const triple of fs.readdirSync(vendorRoot)) {
            const tripleRoot = path.join(vendorRoot, triple);
            for (const codexName of ["codex", "codex.exe"]) {
                const codexBinary = path.join(tripleRoot, "codex", codexName);
                if (chmodIfPresent(codexBinary)) {
                    updated.push(codexBinary);
                }
            }

            for (const rgName of ["rg", "rg.exe"]) {
                const rgBinary = path.join(tripleRoot, "path", rgName);
                if (chmodIfPresent(rgBinary)) {
                    updated.push(rgBinary);
                }
            }
        }
    }

    return updated;
}

function fixEsbuildPermissions(resourcesDir) {
    const unpackedRoot = path.join(resourcesDir, "app.asar.unpacked", "dist", "main", "node_modules", "@esbuild");
    if (!fs.existsSync(unpackedRoot)) {
        return [];
    }

    const updated = [];
    const platformPackages = fs.readdirSync(unpackedRoot);

    for (const platformPackage of platformPackages) {
        const platformRoot = path.join(unpackedRoot, platformPackage);
        if (!fs.statSync(platformRoot).isDirectory()) {
            continue;
        }

        for (const binaryName of ["esbuild", "esbuild.exe"]) {
            const esbuildBinary = path.join(platformRoot, "bin", binaryName);
            if (chmodIfPresent(esbuildBinary)) {
                updated.push(esbuildBinary);
            }
        }
    }

    return updated;
}

function fixTypeScriptPermissions(resourcesDir) {
    const root = path.join(resourcesDir, "app.asar.unpacked", "dist", "main", "node_modules", "@typescript");
    if (!fs.existsSync(root)) return [];
    const updated = [];
    for (const name of fs.readdirSync(root)) {
        for (const executable of ["tsc", "tsc.exe"]) {
            const binary = path.join(root, name, "lib", executable);
            if (chmodIfPresent(binary)) updated.push(binary);
        }
    }
    return updated;
}

function resolveSymlink(linkPath) {
    return path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
}

function isInsideBundle(child, root) {
    const relative = path.relative(root, child);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function repairBundledGitSymlinks(gitRoot) {
    if (!gitRoot || !fs.existsSync(gitRoot)) return [];
    const coreGit = path.join(gitRoot, "libexec", "git-core", "git");
    const binGit = path.join(gitRoot, "bin", "git");
    const fallbackGit = fs.existsSync(coreGit) ? coreGit : fs.existsSync(binGit) ? binGit : null;
    if (!fallbackGit) return [];

    const repaired = [];
    const links = [];
    const walk = (directory) => {
        for (const name of fs.readdirSync(directory)) {
            const entry = path.join(directory, name);
            let stat;
            try {stat = fs.lstatSync(entry);} catch {continue;}
            if (stat.isDirectory()) walk(entry);
            else if (stat.isSymbolicLink()) links.push(entry);
        }
    };
    walk(gitRoot);

    for (const entry of links) {
        let targetPath;
        try {targetPath = resolveSymlink(entry);} catch {continue;}
        const link = fs.readlinkSync(entry);
        if (fs.existsSync(targetPath) && isInsideBundle(targetPath, gitRoot) && !path.isAbsolute(link)) continue;

        const directory = path.dirname(entry);
        const base = path.basename(entry);
        fs.unlinkSync(entry);

        if (path.basename(directory) === "git-core" && base !== "git" && fs.existsSync(coreGit)) {
            fs.symlinkSync("git", entry);
            repaired.push(entry);
            continue;
        }
        if (base === "git" && directory.endsWith(`${path.sep}bin`) && fs.existsSync(coreGit)) {
            fs.symlinkSync(path.join("..", "libexec", "git-core", "git"), entry);
            repaired.push(entry);
            continue;
        }

        const shared = path.join(gitRoot, "share", "git-core", base);
        if (fs.existsSync(shared)) {
            fs.symlinkSync(path.relative(directory, shared), entry);
            repaired.push(entry);
            continue;
        }

        if (directory.includes(`${path.sep}git-core${path.sep}`) || path.basename(directory) === "git-core") {
            fs.symlinkSync(path.relative(directory, fallbackGit), entry);
            repaired.push(entry);
            continue;
        }

        throw new Error(`Unable to repair bundled Git symlink: ${entry}`);
    }
    return repaired;
}

function fixGitPermissions(resourcesDir) {
    const root=path.join(resourcesDir,'git'), updated=[];
    for(const directory of ['bin','libexec/git-core']) {
        const folder=path.join(root,directory);
        if(!fs.existsSync(folder))continue;
        for(const name of fs.readdirSync(folder)) {
            const file=path.join(folder,name);
            if(fs.lstatSync(file).isSymbolicLink())continue;
            if(chmodIfPresent(file))updated.push(file);
        }
    }
    return updated;
}

module.exports = async function afterPack(context) {
    const resourcesDir = getResourcesDir(context.appOutDir);
    const gitRoot = path.join(resourcesDir, "git");
    const repairedLinks = repairBundledGitSymlinks(gitRoot);
    const updated = [
        ...fixCodexPermissions(resourcesDir),
        ...fixEsbuildPermissions(resourcesDir),
        ...fixTypeScriptPermissions(resourcesDir),
        ...fixGitPermissions(resourcesDir),
    ];

    if (repairedLinks.length > 0) {
        console.log("[afterPack] Repaired bundled Git symlinks:");
        for (const entry of repairedLinks) {
            console.log(`  - ${entry}`);
        }
    }
    if (updated.length > 0) {
        console.log("[afterPack] Repaired bundled executable permissions:");
        for (const entry of updated) {
            console.log(`  - ${entry}`);
        }
    }
};

module.exports.fixGitPermissions = fixGitPermissions;
module.exports.repairBundledGitSymlinks = repairBundledGitSymlinks;
