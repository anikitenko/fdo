const path = require('path');
const fs = require('fs');
const { app, dialog } = require('electron');

const protectedFolders = ['Downloads', 'Documents', 'Desktop'];

function resolveUserPath(inputPath) {
    const home = app.getPath('home');
    const expandedPath = inputPath.startsWith('~')
        ? path.join(home, inputPath.slice(1))
        : inputPath;

    return path.resolve(expandedPath);
}

function isProtectedPath(fullPath) {
    return protectedFolders.some(folder => {
        const protectedDir = app.getPath(folder.toLowerCase());
        const relative = path.relative(protectedDir, fullPath);
        return (
            !relative.startsWith('..') &&
            !path.isAbsolute(relative)
        );
    });
}

async function checkPathAccess(inputPath) {
    const resolvedPath = resolveUserPath(inputPath);
    const isProtected = isProtectedPath(resolvedPath);
    const platform = process.platform;

    if (platform === 'darwin' && isProtected) {
        try {
            fs.accessSync(resolvedPath, fs.constants.R_OK);
        } catch (err) {
            dialog.showErrorBox(
                'Permission Denied',
                `The application does not have access to:\n${resolvedPath}\n\nPlease grant access in System Settings > Privacy & Security.`
            );
        }
    }

    return {
        resolvedPath,
        isProtected,
        platform
    };
}

module.exports = {
    resolveUserPath,
    isProtectedPath,
    checkPathAccess
};