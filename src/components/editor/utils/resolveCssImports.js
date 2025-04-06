import path from 'path'

export async function resolveCssImports(classMap, basePath, latestContent, extractCssStyles, seen = new Set()) {
    const result = {}

    for (const key in classMap) {
        if (!key.startsWith('@import')) continue

        const importPath = key.match(/['"](.+?)['"]/)[1]
        const virtualImportPath = path.posix.resolve(path.posix.dirname(basePath), importPath)

        if (seen.has(virtualImportPath)) continue
        seen.add(virtualImportPath)

        const raw = latestContent[virtualImportPath]
        if (!raw) {
            console.warn(`[FDO] Virtual CSS import not found: ${virtualImportPath}`)
            continue
        }

        const nestedMap = extractCssStyles(raw)
        const nestedResolved = await resolveCssImports(nestedMap, virtualImportPath, latestContent, extractCssStyles, seen)

        Object.assign(result, nestedResolved, nestedMap)
    }

    return result
}
