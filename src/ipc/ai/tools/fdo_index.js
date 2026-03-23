import fs from "fs";
import path from "path";
import { app } from "electron";
import { buildSemanticEmbedding, SEMANTIC_VECTOR_SIZE } from "./fdo_semantic.js";

const PROJECT_ROOT = path.resolve(process.cwd());
const INDEX_VERSION = 4;
const ALLOWED_EXTENSIONS = new Set([
    ".md",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".json",
    ".yaml",
    ".yml",
    ".html",
    ".css",
]);
const EXCLUDED_DIRS = new Set([
    ".git",
    "dist",
    "node_modules",
]);
const MAX_FILE_BYTES = 256 * 1024;
const INDEX_ROOTS = ["docs", "src"];
const INDEX_ROOT_SIGNATURE = JSON.stringify({
    roots: INDEX_ROOTS,
    extensions: Array.from(ALLOWED_EXTENSIONS).sort(),
    excludedDirs: Array.from(EXCLUDED_DIRS).sort(),
    maxFileBytes: MAX_FILE_BYTES,
    semanticVectorSize: SEMANTIC_VECTOR_SIZE,
});

let memoryIndex = null;

function getIndexDir() {
    try {
        if (app && typeof app.getPath === "function") {
            const sessionData = app.getPath("sessionData");
            if (sessionData) {
                return path.join(sessionData, "fdo-ai");
            }
        }
    } catch {
        // fall through to workspace-local fallback for non-Electron/test contexts
    }

    return path.join(PROJECT_ROOT, ".fdo-cache");
}

function getIndexPath() {
    return path.join(getIndexDir(), "fdo-ai-index-v1.json");
}

function ensureIndexDir() {
    fs.mkdirSync(getIndexDir(), { recursive: true });
}

function relativeSource(fullPath) {
    return path.relative(PROJECT_ROOT, fullPath) || fullPath;
}

function walkFiles(dirPath, files = []) {
    if (!fs.existsSync(dirPath)) return files;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            walkFiles(fullPath, files);
            continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) continue;

        const stat = fs.statSync(fullPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        files.push({ fullPath, stat });
    }

    return files;
}

function buildTitle(source = "") {
    const base = path.basename(source, path.extname(source));
    return base.replace(/[-_]+/g, " ").trim() || source;
}

function extensionToLanguage(ext = "") {
    const map = {
        ".md": "markdown",
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".json": "json",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".html": "html",
        ".css": "css",
    };
    return map[ext] || ext.replace(/^\./, "") || "text";
}

function inferSourceType(source = "", ext = "", content = "") {
    const lowerSource = String(source || "").toLowerCase();
    const lowerContent = String(content || "").toLowerCase();

    if (ext === ".md") return "docs";
    if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
        if (lowerSource.endsWith("package.json") || lowerSource.includes("manifest")) return "plugin_manifest";
        if (lowerSource.includes("schema")) return "schema";
        if (lowerSource.includes("config") || lowerSource.includes("settings")) return "config";
        return "schema";
    }
    if (lowerSource.includes("/tools/") || lowerContent.includes("tool") && lowerContent.includes("scope")) return "tooling";
    if (lowerSource.includes("prompt") || lowerContent.includes("system prompt")) return "prompt";
    if (lowerSource.includes("settings") || lowerSource.includes("config")) return "config";
    return "code";
}

function unique(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function slugify(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "section";
}

function extractCodeMetadata(content = "", source = "") {
    const text = String(content || "");
    const lowerSource = String(source || "").toLowerCase();
    const imports = [];
    const symbols = [];
    const components = [];
    const handlers = [];

    for (const match of text.matchAll(/import\s+.*?\s+from\s+["']([^"']+)["']/g)) {
        imports.push(match[1]);
    }
    for (const match of text.matchAll(/(?:export\s+)?function\s+([A-Z_a-z][A-Z_a-z0-9]*)\s*\(/g)) {
        symbols.push(match[1]);
    }
    for (const match of text.matchAll(/(?:export\s+)?const\s+([A-Z_a-z][A-Z_a-z0-9]*)\s*=\s*(?:async\s*)?\(/g)) {
        symbols.push(match[1]);
    }
    for (const match of text.matchAll(/(?:export\s+)?const\s+([A-Z][A-Za-z0-9]*)\s*=\s*\(/g)) {
        components.push(match[1]);
        symbols.push(match[1]);
    }
    for (const match of text.matchAll(/ipcMain\.handle\(([^)]+)\)/g)) {
        handlers.push(match[1].replace(/["'`]/g, "").trim());
    }
    for (const match of text.matchAll(/window\.electron\.([A-Za-z0-9_$.]+)/g)) {
        handlers.push(match[1]);
    }

    return {
        imports: unique(imports).slice(0, 40),
        symbols: unique(symbols).slice(0, 40),
        components: unique(components).slice(0, 20),
        handlers: unique(handlers).slice(0, 20),
        codeKind: lowerSource.includes("src/components/")
            ? "component"
            : lowerSource.includes("src/ipc/")
                ? "ipc"
                : lowerSource.includes("src/utils/")
                    ? "utility"
                    : "code",
    };
}

function buildBaseMetadata(source, ext, stat, content) {
    return {
        path: source,
        sourceType: inferSourceType(source, ext, content),
        language: extensionToLanguage(ext),
        lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    };
}

function makeChunkDocument({
    source,
    title,
    ext,
    stat,
    content,
    section = "",
    lineStart = 1,
    lineEnd = 1,
    metadata = null,
}) {
    const baseMetadata = buildBaseMetadata(source, ext, stat, content);
    const mergedMetadata = {
        ...baseMetadata,
        ...(metadata || {}),
        section: section || metadata?.section || "",
        lineStart,
        lineEnd,
    };
    const chunkId = `${source}#${slugify(section || `${lineStart}-${lineEnd}`)}`;
    return {
        chunkId,
        source,
        title: section ? `${title} / ${section}` : title,
        ext,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        sourceType: mergedMetadata.sourceType,
        content,
        metadata: mergedMetadata,
        semanticEmbedding: buildSemanticEmbedding([
            { text: title, weight: 1.8 },
            { text: section, weight: 1.5 },
            { text: source, weight: 1.4 },
            { text: content.slice(0, 12000), weight: 1.0 },
            { text: [
                ...(mergedMetadata?.imports || []),
                ...(mergedMetadata?.symbols || []),
                ...(mergedMetadata?.components || []),
                ...(mergedMetadata?.handlers || []),
            ].join(" "), weight: 1.2 },
        ]),
    };
}

function chunkMarkdown(content = "", source = "", ext = "", stat) {
    const lines = String(content || "").split(/\r?\n/);
    const chunks = [];
    let currentHeading = "Overview";
    let currentStart = 1;
    let buffer = [];

    const flush = (endLine) => {
        const text = buffer.join("\n").trim();
        if (!text) return;
        chunks.push(makeChunkDocument({
            source,
            title: buildTitle(source),
            ext,
            stat,
            content: text,
            section: currentHeading,
            lineStart: currentStart,
            lineEnd: endLine,
        }));
    };

    lines.forEach((line, index) => {
        const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (heading) {
            flush(index);
            currentHeading = heading[2].trim();
            currentStart = index + 1;
            buffer = [line];
            return;
        }
        buffer.push(line);
    });

    flush(lines.length);
    return chunks;
}

function chunkStructured(content = "", source = "", ext = "", stat) {
    const text = String(content || "");
    const sections = [];

    if (ext === ".json") {
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                Object.entries(parsed).forEach(([key, value]) => {
                    sections.push({
                        section: key,
                        content: JSON.stringify({ [key]: value }, null, 2),
                    });
                });
            }
        } catch {
            // Fall back to line-based parsing below.
        }
    }

    if (!sections.length) {
        let currentKey = "root";
        let buffer = [];
        const flush = () => {
            const sectionText = buffer.join("\n").trim();
            if (!sectionText) return;
            sections.push({ section: currentKey, content: sectionText });
        };
        for (const line of text.split(/\r?\n/)) {
            const topLevelKey = line.match(/^([A-Za-z0-9_.-]+)\s*:/);
            if (topLevelKey && !line.startsWith("  ") && !line.startsWith("\t")) {
                flush();
                currentKey = topLevelKey[1];
                buffer = [line];
            } else {
                buffer.push(line);
            }
        }
        flush();
    }

    return sections.map((section, index) => makeChunkDocument({
        source,
        title: buildTitle(source),
        ext,
        stat,
        content: section.content,
        section: section.section,
        lineStart: index + 1,
        lineEnd: index + 1,
    }));
}

function findCodeBlocks(content = "") {
    const lines = String(content || "").split(/\r?\n/);
    const blocks = [];
    const matcher = /^(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)|^(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=|^\s*ipcMain\.handle\(([^)]+)\)/;

    let current = null;
    lines.forEach((line, index) => {
        const match = line.match(matcher);
        if (match) {
            if (current) {
                current.lineEnd = index;
                current.content = current.buffer.join("\n").trim();
                blocks.push(current);
            }
            current = {
                section: (match[1] || match[2] || match[3] || `block-${index + 1}`).replace(/["'`]/g, "").trim(),
                lineStart: index + 1,
                lineEnd: index + 1,
                buffer: [line],
            };
            return;
        }
        if (current) {
            current.buffer.push(line);
        }
    });

    if (current) {
        current.lineEnd = lines.length;
        current.content = current.buffer.join("\n").trim();
        blocks.push(current);
    }

    return blocks.filter((block) => block.content);
}

function chunkCode(content = "", source = "", ext = "", stat) {
    const metadata = extractCodeMetadata(content, source);
    const blocks = findCodeBlocks(content);
    if (!blocks.length) {
        return [makeChunkDocument({
            source,
            title: buildTitle(source),
            ext,
            stat,
            content,
            section: metadata.codeKind || "code",
            lineStart: 1,
            lineEnd: String(content || "").split(/\r?\n/).length,
            metadata,
        })];
    }

    return blocks.map((block) => makeChunkDocument({
        source,
        title: buildTitle(source),
        ext,
        stat,
        content: block.content,
        section: block.section,
        lineStart: block.lineStart,
        lineEnd: block.lineEnd,
        metadata,
    }));
}

function readDocuments(fullPath, stat) {
    const content = fs.readFileSync(fullPath, "utf8");
    const source = relativeSource(fullPath);
    const ext = path.extname(fullPath).toLowerCase();

    if (ext === ".md") {
        return chunkMarkdown(content, source, ext, stat);
    }
    if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
        return chunkStructured(content, source, ext, stat);
    }
    if ([".js", ".jsx", ".ts", ".tsx", ".html", ".css"].includes(ext)) {
        return chunkCode(content, source, ext, stat);
    }

    return [makeChunkDocument({
        source,
        title: buildTitle(source),
        ext,
        stat,
        content,
        section: "",
        lineStart: 1,
        lineEnd: String(content || "").split(/\r?\n/).length,
    })];
}

function readStoredIndex() {
    try {
        const indexPath = getIndexPath();
        if (!fs.existsSync(indexPath)) return null;
        const raw = fs.readFileSync(indexPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        return parsed;
    } catch {
        return null;
    }
}

function writeStoredIndex(index) {
    ensureIndexDir();
    fs.writeFileSync(getIndexPath(), JSON.stringify(index), "utf8");
}

function collectCurrentFiles() {
    const files = [];
    for (const root of INDEX_ROOTS) {
        const absRoot = path.join(PROJECT_ROOT, root);
        if (!fs.existsSync(absRoot)) continue;
        walkFiles(absRoot, files);
    }
    return files;
}

function buildFreshIndex() {
    const currentFiles = collectCurrentFiles();
    const documents = currentFiles.flatMap(({ fullPath, stat }) => readDocuments(fullPath, stat));
    const manifest = Object.fromEntries(
        currentFiles.map(({ fullPath, stat }) => [relativeSource(fullPath), { mtimeMs: stat.mtimeMs, size: stat.size }])
    );
    const index = {
        version: INDEX_VERSION,
        rootSignature: INDEX_ROOT_SIGNATURE,
        builtAt: new Date().toISOString(),
        documentCount: documents.length,
        manifest,
        documents,
    };
    writeStoredIndex(index);
    memoryIndex = index;
    return { index, diagnostics: { rebuilt: true, incremental: false, changedFiles: documents.length, removedFiles: 0 } };
}

function needsFullRebuild(index) {
    if (!index) return true;
    if (index.version !== INDEX_VERSION) return true;
    if (index.rootSignature !== INDEX_ROOT_SIGNATURE) return true;
    if (!Array.isArray(index.documents)) return true;
    if (!index.manifest || typeof index.manifest !== "object") return true;
    return false;
}

function refreshIndexIncrementally(index) {
    const currentFiles = collectCurrentFiles();
    const currentManifest = new Map(
        currentFiles.map(({ fullPath, stat }) => [relativeSource(fullPath), { fullPath, stat }])
    );
    const existingDocumentsBySource = new Map();
    for (const doc of index.documents || []) {
        if (!existingDocumentsBySource.has(doc.source)) {
            existingDocumentsBySource.set(doc.source, []);
        }
        existingDocumentsBySource.get(doc.source).push(doc);
    }
    const nextDocuments = [];
    let changedFiles = 0;

    for (const [source, docs] of existingDocumentsBySource.entries()) {
        const current = currentManifest.get(source);
        if (!current) {
            changedFiles += 1;
            continue;
        }

        const sampleDoc = docs[0];
        const sameMeta = sampleDoc.mtimeMs === current.stat.mtimeMs && sampleDoc.size === current.stat.size;
        if (sameMeta) {
            nextDocuments.push(...docs);
        } else {
            nextDocuments.push(...readDocuments(current.fullPath, current.stat));
            changedFiles += 1;
        }
        currentManifest.delete(source);
    }

    for (const { fullPath, stat } of currentManifest.values()) {
        nextDocuments.push(...readDocuments(fullPath, stat));
        changedFiles += 1;
    }

    const removedFiles = Math.max(0, existingDocumentsBySource.size - nextDocuments.reduce((acc, doc) => {
        acc.add(doc.source);
        return acc;
    }, new Set()).size);
    if (changedFiles === 0 && removedFiles === 0) {
        memoryIndex = index;
        return { index, diagnostics: { rebuilt: false, incremental: true, changedFiles: 0, removedFiles: 0 } };
    }

    const manifest = Object.fromEntries(
        nextDocuments.map((doc) => [doc.source, { mtimeMs: doc.mtimeMs, size: doc.size }])
    );
    const nextIndex = {
        version: INDEX_VERSION,
        rootSignature: INDEX_ROOT_SIGNATURE,
        builtAt: new Date().toISOString(),
        documentCount: nextDocuments.length,
        manifest,
        documents: nextDocuments,
    };
    writeStoredIndex(nextIndex);
    memoryIndex = nextIndex;
    return {
        index: nextIndex,
        diagnostics: {
            rebuilt: false,
            incremental: true,
            changedFiles,
            removedFiles,
        },
    };
}

export function ensureFdoIndex() {
    const base = memoryIndex || readStoredIndex();
    if (needsFullRebuild(base)) {
        return buildFreshIndex();
    }
    return refreshIndexIncrementally(base);
}

export function getFdoIndexDocuments() {
    const { index, diagnostics } = ensureFdoIndex();
    return {
        documents: Array.isArray(index?.documents) ? index.documents : [],
        diagnostics,
        indexMeta: {
            version: index?.version || INDEX_VERSION,
            builtAt: index?.builtAt || null,
            documentCount: index?.documentCount || 0,
            cacheDir: getIndexDir(),
            cachePath: getIndexPath(),
        },
    };
}

export function getFdoIndexLocation() {
    return {
        cacheDir: getIndexDir(),
        cachePath: getIndexPath(),
    };
}
