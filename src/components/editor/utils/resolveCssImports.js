import path from 'path';

const isStyleObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Stylesheets compose declarations, not entire selector objects. Later files
// override conflicting declarations while retaining base, state and media rules.
export function mergeCssStyleMaps(...maps) {
    const result = {};
    for (const map of maps) {
        for (const [key, value] of Object.entries(map)) {
            if (key.startsWith('@import')) continue;
            const previous = Object.hasOwn(result, key) ? result[key] : undefined;
            Object.defineProperty(result, key, {
                value: isStyleObject(previous) && isStyleObject(value) ? mergeCssStyleMaps(previous, value) : value,
                enumerable: true, configurable: true, writable: true,
            });
        }
    }
    // A state selector may live in a different file from its base class.
    // Attach it once the imported maps have supplied that base class.
    for (const [key, value] of Object.entries(result)) {
        const match = /^([\w-]+)([:\[].*|\s+.+)$/.exec(key);
        if (!match || !Object.hasOwn(result, match[1]) || !isStyleObject(result[match[1]]) || !isStyleObject(value)) continue;
        const suffix = key.includes(' ') ? match[2] : `&${match[2]}`;
        result[match[1]] = mergeCssStyleMaps(result[match[1]], {[suffix]: value});
        delete result[key];
    }
    return result;
}

export async function resolveCssImports(classMap, basePath, latestContent, extractCssStyles, ancestors = new Set(), cache = new Map()) {
    if (ancestors.has(basePath)) throw new Error(`Circular CSS import: ${[...ancestors, basePath].join(' -> ')}`);
    if (ancestors.size >= 64) throw new Error(`CSS import nesting exceeds 64 files at ${basePath}`);
    const chain = new Set([...ancestors, basePath]);
    let result = {};

    for (const key of Object.keys(classMap)) {
        if (!key.startsWith('@import')) continue;
        const match = /^@import\s+(['"])(\.{1,2}\/[^'"\\]+\.css)\1\s*$/i.exec(key);
        if (!match) throw new Error(`Unsupported CSS import in ${basePath}: use a quoted relative .css path without URL, media or layer qualifiers.`);
        const virtualImportPath = path.posix.resolve(path.posix.dirname(basePath), match[2]);
        if (!Object.hasOwn(latestContent, virtualImportPath) || typeof latestContent[virtualImportPath] !== 'string') {
            throw new Error(`CSS import not found: ${virtualImportPath} (imported by ${basePath})`);
        }
        // Track ancestors, not all visited files: a shared dependency imported
        // by two branches must participate in each branch's declaration order.
        if (!cache.has(virtualImportPath)) {
            const nestedMap = extractCssStyles(latestContent[virtualImportPath]);
            const nestedResolved = await resolveCssImports(nestedMap, virtualImportPath, latestContent, extractCssStyles, chain, cache);
            cache.set(virtualImportPath, mergeCssStyleMaps(nestedResolved, nestedMap));
        }
        // Cache completed modules within this resolution only. Reuse their map
        // in each import position without re-expanding a diamond dependency tree.
        result = mergeCssStyleMaps(result, cache.get(virtualImportPath));
    }
    return result;
}
