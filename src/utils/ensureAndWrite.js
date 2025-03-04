import { promises as fs } from "fs";
import path from "path";

async function ensureAndWrite(filePath, content) {
    const dir = path.dirname(filePath); // Extract directory path
    await fs.mkdir(dir, { recursive: true }); // Ensure directory exists
    await fs.writeFile(filePath, content, "utf8");
}

export default ensureAndWrite