import ensureAndWrite from "../../filesystem/ensureAndWrite";
import fs from "fs/promises";
import path from "path";
import {getIgnoreInstance} from "../../filesystem/getIgnoreInstance";
import {getAllFilesWithIgnorance} from "../../filesystem/getAllFilesWithIgnorance";

export async function syncPluginDir(pathToDir, dataContent) {
    const ig = await getIgnoreInstance(pathToDir, dataContent);

    const expectedPaths = new Set(dataContent.map(file => path.join(pathToDir, file.path)));

    const existingFiles = await getAllFilesWithIgnorance(pathToDir, (relativePath) => {
        return !ig.ignores(relativePath);
    });

    for (const filePath of existingFiles) {
        if (!expectedPaths.has(filePath)) {
            await fs.unlink(filePath);
        }
    }

    for (const file of dataContent) {
        const fullPath = path.join(pathToDir, file.path);
        await ensureAndWrite(fullPath, file.content);
    }
}
