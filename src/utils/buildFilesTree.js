import path from "node:path";
import * as fs from "node:fs";

export function buildFilesTreeWithRoot(dirPath, rootName) {
    return {
        name: rootName,  // Custom root name
        type: "folder",
        children: [buildFilesTree(dirPath)], // Nested actual directory structure
    };
}

export function buildFilesTree(dirPath, relativePath = "node_modules") {
    const stats = fs.statSync(dirPath);

    const tree = {
        name: path.basename(dirPath),
        type: stats.isDirectory() ? "folder" : "file",
        path: relativePath
    };

    if (stats.isDirectory()) {
        tree.children = fs.readdirSync(dirPath).map((child) =>
            buildFilesTree(path.join(dirPath, child), `${relativePath}/${child}`)
        );
    } else {
        // Optionally, detect language by file extension
        const ext = path.extname(dirPath);
        if (ext === ".ts" || ext === ".tsx") {
            tree.language = "typescript";
        } else if (ext === ".js" || ext === ".mjs") {
            tree.language = "javascript";
        } else if (ext === ".json") {
            tree.language = "json";
        } else if (ext === ".md") {
            tree.language = "markdown";
        } else if (ext === ".xml") {
            tree.language = "xml";
        }
        const data = fs.readFileSync(dirPath,
            { encoding: 'utf8', flag: 'r' });
        tree.content = data
    }

    return tree;
}

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
