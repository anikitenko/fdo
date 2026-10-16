import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {getFilesTree} from '../filesystem/getFilesTree';
import {buildFdoSdkKnowledgeIndex} from './fdoSdkKnowledge';
import {installedSdkKnowledgeIdentity, readInstalledAuthoringContracts} from './installedAuthoringContracts';

let fdoSdkKnowledgeCache = {
    sourcePath: "",
    index: null,
};

function pickExistingDirectory(paths = []) {
    for (const candidate of paths) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch (_) {
            // Ignore unreadable candidates and continue with next path.
        }
    }
    return "";
}

function resolveFdoSdkPackagePath() {
    const isDev = !app.isPackaged;
    const candidates = isDev
        ? [
            path.join(process.cwd(), 'node_modules', '@anikitenko', 'fdo-sdk'),
            path.join(__dirname, '..', '..', 'node_modules', '@anikitenko', 'fdo-sdk'),
            path.join(__dirname, '..', '..', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk'),
        ]
        : [
            path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anikitenko', 'fdo-sdk'),
        ];

    return pickExistingDirectory(candidates) || candidates[0];
}

export function resolveFdoSdkDistPath() {
    const packagePath = resolveFdoSdkPackagePath();
    const isDev = !app.isPackaged;
    const candidates = [
        path.join(packagePath, 'dist'),
        ...(isDev
            ? [path.join(__dirname, '..', '..', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk', 'dist')]
            : [path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'main', 'node_modules', '@anikitenko', 'fdo-sdk', 'dist')]),
    ];

    return pickExistingDirectory(candidates) || candidates[0];
}

function getFilesTreeSafe(basePath, targetPath, filter = null) {
    try {
        const files = getFilesTree(basePath, targetPath);
        return typeof filter === "function" ? files.filter(filter) : files;
    } catch (_) {
        return [];
    }
}

export function getCachedFdoSdkKnowledgeIndex() {
    const packagePath = resolveFdoSdkPackagePath();
    const distPath = resolveFdoSdkDistPath();
    const sourcePath = installedSdkKnowledgeIdentity(packagePath, distPath);
    if (fdoSdkKnowledgeCache.index && fdoSdkKnowledgeCache.sourcePath === sourcePath) {
        return fdoSdkKnowledgeCache.index;
    }

    const topLevelDocsFilter = (file) => /README|CHANGELOG|package\.json/i.test(file.path);
    const files = [
        ...getFilesTreeSafe(distPath, '@types'),
        ...getFilesTreeSafe(packagePath, '.', topLevelDocsFilter),
        ...getFilesTreeSafe(packagePath, 'docs'),
        ...getFilesTreeSafe(packagePath, 'examples'),
        ...getFilesTreeSafe(distPath, 'docs'),
        ...readInstalledAuthoringContracts(packagePath).files,
    ];
    const index = buildFdoSdkKnowledgeIndex(files);
    fdoSdkKnowledgeCache = {
        sourcePath,
        index,
    };
    return index;
}
