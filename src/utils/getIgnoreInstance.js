import path from "path";
import fs from "fs/promises";
import ignore from "ignore";

export async function getIgnoreInstance(pluginDir, dataContent) {
    const ignoreFileFromData = dataContent.find(file => file.path === "/.fdoignore");

    let lines = [];

    if (ignoreFileFromData) {
        lines = ignoreFileFromData.content.split(/\r?\n/).filter(Boolean);
    } else {
        try {
            const ignoreFilePath = path.join(pluginDir, ".fdoignore");
            const content = await fs.readFile(ignoreFilePath, "utf-8");
            lines = content.split(/\r?\n/).filter(Boolean);
        } catch (err) {
            // File doesn't exist or can't be read — ignore silently
        }
    }

    const ig = ignore();
    ig.add(lines);

    const distIncluded = dataContent.some(file => file.path === "dist" || file.path.startsWith("/dist/"));
    if (!distIncluded) {
        ig.add("dist/");
    }

    return ig;
}