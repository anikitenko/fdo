import {parse} from '@babel/parser';
import postcss from 'postcss';

const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
// TypeScript's NodeNext convention writes './module.js' for a './module.ts'
// source. When the literal path is absent, substitution candidates map the
// written extension onto its TypeScript counterpart before giving up.
const jsFamily = /\.(?:[cm]?js|jsx)$/i;
const substitutions = base => jsFamily.test(base)
    ? extensions.map(ext => base.replace(jsFamily, ext)) : [];
const normalize = path => {
    const parts = [];
    for (const part of path.split('/')) {
        if (part === '..') parts.pop();
        else if (part && part !== '.') parts.push(part);
    }
    return `/${parts.join('/')}`;
};

// Match the virtual workspace resolver without accessing disk or evaluating source.
export function resolveGeneratedTarget(importer, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
    return normalize(specifier.startsWith('/') ? specifier : `${importer.slice(0, importer.lastIndexOf('/'))}/${specifier}`);
}

export function resolveGeneratedImport(importer, specifier, paths) {
    const base = resolveGeneratedTarget(importer, specifier);
    if (base === null) return null;
    // The literal path and extension-appended candidates stay ahead of
    // substitution, so a real .js file still wins over a sibling .ts.
    return [base, ...extensions.map(ext => base + ext), ...substitutions(base),
        ...extensions.map(ext => `${base}/index${ext}`)]
        .find(path => paths.has(path)) || null;
}

// Resolve the relative import the way the virtual builder does (for diagnostics only).
function relativeFrom(importer, target) {
    const dir = importer.slice(0, importer.lastIndexOf('/'));
    if (target.startsWith(`${dir}/`)) return `./${target.slice(dir.length + 1)}`;
    const dirParts = dir.split('/').filter(Boolean);
    const targetParts = target.split('/').filter(Boolean);
    let i = 0;
    while (i < dirParts.length && i < targetParts.length - 1 && dirParts[i] === targetParts[i]) i++;
    return `${'../'.repeat(dirParts.length - i)}${targetParts.slice(i).join('/')}`;
}

function analyze({path, content}) {
    const imports = [], exports = new Set();
    let unknownExports = false;
    if (/\.css$/i.test(path)) {
        postcss.parse(content).walkAtRules('import', rule => {
            const specifier = /^(?:url\(\s*)?["']([^"']+)["']/.exec(rule.params)?.[1];
            if (specifier) imports.push({specifier, names: []});
        });
        return {imports, exports: null}; // CSS becomes a generated style map.
    }
    if (!/\.[cm]?[jt]sx?$/i.test(path)) return {imports, exports: null};
    const ast = parse(content, {sourceType: 'unambiguous', allowUndeclaredExports: true,
        plugins: ['typescript', 'jsx', 'decorators-legacy']});
    const binding = node => {
        if (!node) return;
        if (node.type === 'Identifier') exports.add(node.name);
        else if (node.type === 'ObjectPattern') node.properties.forEach(item => binding(item.value || item.argument));
        else if (node.type === 'ArrayPattern') node.elements.forEach(binding);
        else if (node.type === 'RestElement') binding(node.argument);
        else if (node.type === 'AssignmentPattern') binding(node.left);
    };
    for (const node of ast.program.body) {
        if (node.type === 'ImportDeclaration') imports.push({specifier: node.source.value,
            names: node.specifiers.flatMap(item => item.type === 'ImportDefaultSpecifier' ? ['default']
                : item.type === 'ImportSpecifier' ? [item.imported.name || item.imported.value] : [])});
        if (node.type === 'ExportDefaultDeclaration') exports.add('default');
        if (node.type === 'ExportAllDeclaration') {
            unknownExports = true;
            imports.push({specifier: node.source.value, names: []});
        }
        if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration?.id) binding(node.declaration.id);
            node.declaration?.declarations?.forEach(item => binding(item.id));
            node.specifiers.forEach(item => exports.add(item.exported.name || item.exported.value));
            if (node.source) imports.push({specifier: node.source.value, names: node.specifiers
                .filter(item => item.type === 'ExportSpecifier').map(item => item.local.name || item.local.value)});
        }
        if (node.type === 'TSExportAssignment') unknownExports = true;
    }
    // CommonJS export shape is dynamic. Leave its semantic checks to the compiler.
    if (/\b(?:module\s*\.\s*exports|exports\s*[.\[])/.test(content)) unknownExports = true;
    return {imports, exports: unknownExports ? null : exports};
}

// Completed modules' imports that resolve to a pending path: the exact names
// each immutable applied file pulls from it. A completed file is never
// regenerated, so these names are requirements on the pending file itself —
// surfacing them prevents an export mismatch that validation could otherwise
// only report after this file was generated.
export function inboundGeneratedImports(completedSources, targetPath, paths) {
    // CSS becomes a generated style map consumed through its default import;
    // it exposes no managed interface to enumerate.
    if (/\.css$/i.test(targetPath)) return [];
    const available = new Set(paths);
    const inbound = new Map();
    for (const file of completedSources) {
        if (file.path === targetPath) continue;
        let analyzed;
        try { analyzed = analyze(file); } catch { continue; } // The source parser owns parse failures.
        for (const {specifier, names} of analyzed.imports) {
            if (!names.length || (!specifier.startsWith('.') && !specifier.startsWith('/'))) continue;
            if (resolveGeneratedImport(file.path, specifier, available) !== targetPath) continue;
            const collected = inbound.get(file.path) || new Set();
            names.forEach(name => collected.add(name));
            inbound.set(file.path, collected);
        }
    }
    return [...inbound].map(([path, names]) => ({path, names: [...names]}));
}

// sources may include unchanged files. Validate only subjects; pending paths
// resolve successfully but their exports are checked once source is available.
export function validateGeneratedWorkspaceImports(subjects, {sources = subjects, paths, checkMissing = true} = {}) {
    const sourceMap = new Map(sources.map(file => [file.path, file]));
    const available = new Set(paths || sourceMap.keys());
    const cache = new Map();
    const read = file => {
        if (!cache.has(file.path)) {
            try { cache.set(file.path, analyze(file)); }
            catch { cache.set(file.path, {imports: [], exports: null}); } // Syntax validator owns parse failures.
        }
        return cache.get(file.path);
    };
    const errors = [];
    for (const file of subjects) {
        for (const {specifier, names} of read(file).imports) {
            if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
            const target = resolveGeneratedImport(file.path, specifier, available);
            if (!target) {
                if (checkMissing) {
                    // Name the resolved target and the legal alternatives: a
                    // corrective repair that only repeats the relative
                    // specifier cannot tell an invented path from a renamed
                    // plan entry. Facts only — nothing is inferred for the model.
                    const base = resolveGeneratedTarget(file.path, specifier);
                    // Models sometimes treat ".." as an escape to the workspace
                    // root. State both interpretations of that exact shape.
                    const rootEscape = /^(?:\.\.\/)+/.test(specifier)
                        ? resolveGeneratedImport(file.path, normalize(specifier.replace(/^(?:\.\.\/)+/, '')), available) : null;
                    const rootNote = rootEscape === file.path
                        ? ` A leading ".." is this file's parent directory, not the workspace root: the specifier names ${file.path} itself, and a file must never import itself.`
                        : rootEscape ? ` A leading ".." is this file's parent directory, not the workspace root: interpreted from the workspace root the specifier would be ${JSON.stringify(rootEscape)}, which is planned; from ${file.path} write ${JSON.stringify(relativeFrom(file.path, rootEscape))}.` : '';
                    const pool = (/\.css$/i.test(file.path) ? [...available].filter(path => path !== file.path && /\.css$/i.test(path))
                        : [...available].filter(path => path !== file.path)).sort();
                    const shown = pool.slice(0, 20);
                    // A directory specifier that failed resolution proves no
                    // index module exists inside it: the resolver tried every
                    // base and base/index candidate against this same pool.
                    // Name that fact and the planned files the directory
                    // actually holds, so the repair replaces the specifier
                    // with a concrete planned file instead of repeating it.
                    const children = pool.filter(path => path.startsWith(`${base}/`));
                    const directoryNote = children.length
                        ? ` ${JSON.stringify(base)} is a directory, not a module: no index module is planned inside it, and its planned files are ${children.slice(0, 6).join(', ')}${children.length > 6 ? ` (+${children.length - 6} more)` : ''}. Module imports must name a concrete planned file; import one of those files directly instead of the directory.`
                        : '';
                    // A wrong-depth specifier fails at its exact resolved path,
                    // but its ending may still match a planned file at another
                    // depth (a live failure wrote "../dashboard/theme.css" one
                    // level short of a planned "/features/dashboard/theme.css").
                    // When the ending names exactly one planned file, give the
                    // exact relative specifier to write, like the ".." notes.
                    // A bare specifier ("./categories/logic") carries no
                    // extension, so it can never end with a planned path that
                    // ends ".ts": when the tail has no extension, also compare
                    // against planned paths with their extension removed (a
                    // live repair wrote wrong-depth extensionless siblings of
                    // /features/categories/ and the note could not fire).
                    const tail = /^\.{1,2}(?:\/|$)/.test(specifier) ? specifier.replace(/^(\.{1,2}\/)+/, '')
                        : specifier.startsWith('/') ? specifier.slice(1) : '';
                    const tailMatches = tail ? pool.filter(path => path.endsWith(`/${tail}`)
                        || (!/\.[^/.]+$/.test(tail) && path.replace(/\.[^/.]+$/, '').endsWith(`/${tail}`))) : [];
                    const tailNote = tailMatches.length === 1
                        ? ` The specifier's ending ${JSON.stringify(tail)} matches the planned file ${JSON.stringify(tailMatches[0])}: from ${file.path} write ${JSON.stringify(relativeFrom(file.path, tailMatches[0]))}.`
                        : tailMatches.length > 1
                            ? ` The specifier's ending ${JSON.stringify(tail)} matches planned files: ${tailMatches.slice(0, 3).join(', ')}${tailMatches.length > 3 ? ` (+${tailMatches.length - 3} more)` : ''}. Name one of them directly with its full planned path.`
                            : '';
                    // The names an unresolved import pulls still have real
                    // homes — often this file itself — or provably none. A
                    // repair told only the bad path guesses where the names
                    // belong, and a live repair repointed them at a module
                    // that never exported them, trading one rejection for
                    // another in its only repair round.
                    const known = [...available].filter(path => sourceMap.has(path) && read(sourceMap.get(path)).exports !== null);
                    const shownNames = names.slice(0, 8);
                    const nameHomes = names.length ? ` The import pulls {${shownNames.join(', ')}}${names.length > shownNames.length ? ` (+${names.length - shownNames.length} more)` : ''}: ${shownNames.map(name => {
                        const found = known.filter(path => read(sourceMap.get(path)).exports.has(name));
                        return found.length === 1
                            ? `${name} is exported by ${JSON.stringify(found[0])}${found[0] === file.path ? ' (this file’s export list; this may be only a re-export, not a local declaration. Keep a real local definition if present and remove its redundant missing-file import; otherwise implement the required declaration here using actual consumers)' : ''}.`
                            : found.length > 1
                                ? `${name} is exported by ${found.slice(0, 3).map(path => JSON.stringify(path)).join(', ')}${found.length > 3 ? ` (+${found.length - 3} more)` : ''}.`
                                : `${name} is exported by no workspace file with a known interface.`;
                    }).join(' ')}` : '';
                    // When every pulled name has exactly one owner, the rejection
                    // can carry the corrective specifiers themselves: name → home
                    // with the relative path already computed. A live repair faced
                    // one import pulling names owned by two different modules —
                    // the single-path tail note could not express the split the
                    // repair needed — and kept every rejected import instead.
                    const homes = names.map(name => known.filter(path => read(sourceMap.get(path)).exports.has(name)));
                    const homeDirective = names.length && names.every(name => name !== 'default')
                        && homes.every(found => found.length === 1)
                        && homes.every(found => found[0] !== file.path)
                        ? ` The correct sources, by name: ${names.map((name, index) => `${name} from ${JSON.stringify(relativeFrom(file.path, homes[index][0]))}`).join(', ')} — rewrite the import so each name is pulled from exactly the file named for it.`
                        : '';
                    errors.push(`${file.path}: local import "${specifier}" resolves to ${JSON.stringify(base)}, which has no file in the workspace or approved plan.${directoryNote} Use an existing or planned dependency${shown.length ? `. Valid targets: ${shown.join(', ')}${pool.length > shown.length ? ` (+${pool.length - shown.length} more)` : ''}` : ''}.${nameHomes}${rootNote}${tailNote}${homeDirective}`);
                }
            } else if (target === file.path) {
                errors.push(`${file.path}: local import "${specifier}" resolves to this same file. Import the intended dependency instead; do not import or re-export the module itself.`);
            } else if (sourceMap.has(target)) {
                const declared = read(sourceMap.get(target)).exports;
                const missing = declared && names.filter(name => !declared.has(name));
                if (missing?.length) {
                    // Star re-exports and CommonJS set exports to null and skip
                    // this check entirely, so whenever it fires this list IS the
                    // dependency's complete public interface. State it, and name
                    // the completed module that exports a missing name when
                    // exactly one does: a repair told only what is wrong repeats
                    // the invented name.
                    const declaredShown = [...declared].slice(0, 12);
                    const declaredNote = declared.size
                        ? ` It exports ${declaredShown.join(', ')}${declared.size > declaredShown.length ? ` (+${declared.size - declaredShown.length} more)` : ''}.`
                        : ' It exports nothing.';
                    const ownerNotes = missing.slice(0, 3).map(name => {
                        if (name === 'default') return ' Use the intended dependency’s named export if it provides that interface; an unrelated module’s default export is not a substitute.';
                        const found = [...available].filter(path => path !== target
                            && sourceMap.has(path) && read(sourceMap.get(path)).exports?.has(name));
                        return found.length === 1
                            ? ` ${name} is exported by ${JSON.stringify(found[0])}.`
                            : found.length > 1
                                ? ` ${name} is exported by ${found.slice(0, 3).map(path => JSON.stringify(path)).join(', ')}${found.length > 3 ? ` (+${found.length - 3} more)` : ''}.`
                                : '';
                    }).join('');
                    errors.push(`${file.path}: ${target} does not export ${missing.join(', ')}.${declaredNote}${ownerNotes} Keep imports and the dependency's actual public interface consistent.`);
                }
            }
        }
    }
    return errors;
}

// Correct only a wrong relative depth with one existing, fully known target.
// Do not redirect valid imports, select between candidates or invent exports.
export function repairGeneratedImportDepth(file, sources = []) {
    const unchanged = {content: file.content, repaired: false};
    if (!/\.[cm]?[jt]sx?$/.test(file.path)) return unchanged;
    const sourceMap = new Map(sources.map(source => [source.path, source]));
    const paths = new Set(sourceMap.keys());
    try {
        const parseOptions = {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']};
        const ast = parse(file.content, {...parseOptions, errorRecovery: true});
        if (ast.errors.some(error => error.reasonCode !== 'VarRedeclaration')) return unchanged;
        const localTypes = new Set(ast.program.body.map(node => node.declaration || node)
            .filter(node => ['TSTypeAliasDeclaration', 'TSInterfaceDeclaration'].includes(node?.type))
            .map(node => node.id.name));
        const edits = [];
        for (const node of ast.program.body) {
            if (node.type !== 'ImportDeclaration') continue;
            const specifier = node.source.value;
            if (!/^\.{1,2}\//.test(specifier) || resolveGeneratedImport(file.path, specifier, paths)) continue;
            if (node.specifiers.length && node.specifiers.every(item => item.type === 'ImportSpecifier'
                && (node.importKind === 'type' || item.importKind === 'type') && localTypes.has(item.local.name))) {
                // Type-only imports have no side effects. Remove one only when
                // each imported binding already has a concrete local type.
                edits.push({start: node.start, end: node.end, text: ''});
                continue;
            }
            const tail = specifier.replace(/^(\.{1,2}\/)+/, '');
            if (!tail || tail.split('/').some(part => part === '..' || part === '.')) continue;
            const candidates = [...paths].filter(path => path !== file.path &&
                (path.endsWith('/' + tail) || extensions.some(extension => path.endsWith('/' + tail + extension))));
            if (candidates.length !== 1) continue;
            const target = candidates[0];
            const declarations = analyze(sourceMap.get(target));
            const names = node.specifiers.map(item => item.type === 'ImportDefaultSpecifier' ? 'default'
                : item.type === 'ImportSpecifier' ? item.imported.name || item.imported.value : null);
            if (!names.length || names.some(name => !name) || declarations.unknownExports
                || !declarations.exports || names.some(name => !declarations.exports.has(name))) continue;
            edits.push({start: node.source.start, end: node.source.end, text: JSON.stringify(relativeFrom(file.path, target))});
        }
        let content = file.content;
        for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
        if (edits.length) parse(content, parseOptions);
        return {content, repaired: edits.length > 0};
    } catch { return unchanged; }
}
