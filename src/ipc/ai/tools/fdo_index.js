import fs from "fs";
import path from "path";
import { app } from "electron";
import { buildSemanticEmbedding, SEMANTIC_VECTOR_SIZE } from "./fdo_semantic.js";

const PROJECT_ROOT = path.resolve(process.cwd());
const INDEX_VERSION = 3;
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
const INDEX_ROOTS = ["docs", "src/components", "src/ipc", "src/utils"];
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

function unique(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
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

function readDocument(fullPath, stat) {
    const content = fs.readFileSync(fullPath, "utf8");
    const source = relativeSource(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const metadata = [".js", ".jsx", ".ts", ".tsx"].includes(ext)
        ? extractCodeMetadata(content, source)
        : null;
    return {
        source,
        title: buildTitle(source),
        ext,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        content,
        metadata,
        semanticEmbedding: buildSemanticEmbedding([
            { text: buildTitle(source), weight: 1.8 },
            { text: source, weight: 1.4 },
            { text: content.slice(0, 12000), weight: 1.0 },
            { text: [
                ...(metadata?.imports || []),
                ...(metadata?.symbols || []),
                ...(metadata?.components || []),
                ...(metadata?.handlers || []),
            ].join(" "), weight: 1.2 },
        ]),
    };
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
    const documents = currentFiles.map(({ fullPath, stat }) => readDocument(fullPath, stat));
    const manifest = Object.fromEntries(
        documents.map((doc) => [doc.source, { mtimeMs: doc.mtimeMs, size: doc.size }])
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
    const nextDocuments = [];
    let changedFiles = 0;

    for (const doc of index.documents || []) {
        const current = currentManifest.get(doc.source);
        if (!current) {
            changedFiles += 1;
            continue;
        }

        const sameMeta = doc.mtimeMs === current.stat.mtimeMs && doc.size === current.stat.size;
        if (sameMeta) {
            nextDocuments.push(doc);
        } else {
            nextDocuments.push(readDocument(current.fullPath, current.stat));
            changedFiles += 1;
        }
        currentManifest.delete(doc.source);
    }

    for (const { fullPath, stat } of currentManifest.values()) {
        nextDocuments.push(readDocument(fullPath, stat));
        changedFiles += 1;
    }

    const removedFiles = Math.max(0, (index.documents?.length || 0) + currentManifest.size - nextDocuments.length);
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
            removedFiles: Math.max(0, (index.documents?.length || 0) - nextDocuments.length),
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
