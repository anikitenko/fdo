import fs from "fs/promises";
import path from "path";

export async function getAllFilesWithIgnorance(dir, include, baseDir = dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        let files = [];

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath);

            if (!include(relativePath)) continue;

            if (entry.isDirectory()) {
                const subFiles = await getAllFilesWithIgnorance(fullPath, include, baseDir);
                files = files.concat(subFiles);
            } else if (entry.isFile()) {
                files.push(fullPath);
            }
        }

        return files;
    } catch (err) {
        if (err.code === "ENOENT") {
            // Directory does not exist — return empty list
            return [];
        }
        throw err; // rethrow other unexpected errors
    }
}