import path from "node:path";
import * as fs from "node:fs";

export function getFilesTree(basePath, targetPath) {
    const absolutePath = path.resolve(basePath, targetPath);
    const filesList = [];

    function readDirRecursively(dir, relativeDir = "") {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const relativePath = path.join(relativeDir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                readDirRecursively(fullPath, relativePath);
            } else {
                filesList.push(`${relativePath}`);
            }
        }
    }

    readDirRecursively(absolutePath);
    return filesList;
}
