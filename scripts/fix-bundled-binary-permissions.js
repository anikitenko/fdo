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

module.exports = async function afterPack(context) {
    const resourcesDir = getResourcesDir(context.appOutDir);
    const updated = [
        ...fixCodexPermissions(resourcesDir),
        ...fixEsbuildPermissions(resourcesDir),
    ];

    if (updated.length > 0) {
        console.log("[afterPack] Repaired bundled executable permissions:");
        for (const entry of updated) {
            console.log(`  - ${entry}`);
        }
    }
};
