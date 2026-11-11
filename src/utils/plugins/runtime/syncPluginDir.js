import ensureAndWrite from "../../filesystem/ensureAndWrite";
import fs from "fs/promises";
import path from "path";
import {getIgnoreInstance} from "../../filesystem/getIgnoreInstance";
import {getAllFilesWithIgnorance} from "../../filesystem/getAllFilesWithIgnorance";

export async function syncPluginDir(pathToDir, dataContent, directories = []) {
    const ig = await getIgnoreInstance(pathToDir, dataContent);

    const expectedPaths = new Set(dataContent.map(file => path.join(pathToDir, file.path)));

    const directoryPaths = directories.map(directory => {
        const relative = String(directory).replace(/^[/\\]+/, '');
        const fullPath = path.resolve(pathToDir, relative);
        if (!relative || !fullPath.startsWith(path.resolve(pathToDir) + path.sep)) throw new Error('Directory must be inside the plugin workspace.');
        return fullPath;
    });
    const existingDirectories = [];
    const existingFiles = await getAllFilesWithIgnorance(pathToDir, (relativePath) => {
        return !ig.ignores(relativePath);
    }, pathToDir, directory => existingDirectories.push(directory));

    for (const filePath of existingFiles) {
        if (!expectedPaths.has(filePath)) {
            await fs.unlink(filePath);
        }
    }

    for (const file of dataContent) {
        const fullPath = path.join(pathToDir, file.path);
        await ensureAndWrite(fullPath, file.content);
    }
    // Remove empty remnants after moves/deletions, keeping ignored trees.
    for (const directory of existingDirectories.sort((a, b) => b.length - a.length)) {
        await fs.rmdir(directory).catch(error => {if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error;});
    }
    for (const directory of directoryPaths) await fs.mkdir(directory, {recursive: true});
}
