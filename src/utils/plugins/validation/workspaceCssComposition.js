import postcss from 'postcss';
import {resolveGeneratedImport} from './generatedWorkspaceImports';

// Combine host-scheduled compositions with known source imports. A completed
// root may import a pending leaf even before either has needed a split.
export function workspaceCssReachability({files = [], paths = [], compositions = new Map()}) {
    const graph = new Map([...compositions].map(([path, children]) => [path, new Set(children.map(child => child.path))]));
    const available = new Set(paths);
    for (const file of files) {
        if (!/\.css$/i.test(file.path)) continue;
        try {
            const dependencies = graph.get(file.path) || new Set();
            postcss.parse(file.content, {from: file.path}).walkAtRules('import', rule => {
                const specifier = /^(?:url\(\s*)?["']([^"']+)["']/.exec(rule.params)?.[1];
                const target = specifier && resolveGeneratedImport(file.path, specifier, available);
                if (target) dependencies.add(target);
            });
            graph.set(file.path, dependencies);
        } catch { /* Source validation owns malformed CSS diagnostics. */ }
    }
    const reaches = (path, target, seen = new Set()) => {
        if (path === target) return true;
        if (seen.has(path)) return false;
        seen.add(path);
        return [...(graph.get(path) || [])].some(child => reaches(child, target, seen));
    };
    return reaches;
}

export function relativeWorkspaceImport(importer, target) {
    const from = importer.split('/').slice(1, -1);
    const to = target.split('/').slice(1);
    while (from.length && to.length && from[0] === to[0]) {
        from.shift();
        to.shift();
    }
    const relative = [...from.map(() => '..'), ...to].join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
}

export function workspaceCssCompositionImports(path, helpers) {
    return helpers.map(helper => `@import "${relativeWorkspaceImport(path, helper.path)}";`).join('\n');
}

// Initial-plan files have no split-helper identity. Correct their relative CSS
// references only when the filename is unique across the entire known workspace
// and belongs to the approved plan. Existing unrelated files are never targets.
export function resolvePlannedWorkspaceCssImports({path, content, plannedPaths = [], paths = []}) {
    const available = [...new Set(paths)];
    const byName = new Map();
    for (const target of available) {
        const name = target.split('/').at(-1);
        const matches = byName.get(name) || [];
        matches.push(target);
        byName.set(name, matches);
    }
    const helpers = [...new Set(plannedPaths)].filter(target => target !== path
        && /\.css$/i.test(target) && byName.get(target.split('/').at(-1))?.length === 1)
        .map(path => ({path}));
    return resolveWorkspaceCssComposition({path, content, helpers, paths: available});
}

// A split's dependency identities belong to the host. Correct only a missing
// relative CSS reference whose filename identifies exactly one of those
// helpers. Never search the whole workspace by basename, override a resolving
// import, add files, change import ordering/conditions, or salvage partial CSS.
export function resolveWorkspaceCssComposition({path, content, helpers = [], paths = []}) {
    if (!path.endsWith('.css') || !helpers.length) return content;
    const available = new Set(paths);
    let root;
    try { root = postcss.parse(content, {from: path}); }
    catch { return content; } // Normal source validation reports syntax errors.
    let changed = false;
    root.walkAtRules('import', rule => {
        const match = /^(?:url\(\s*)?(["'])([^"']+)\1/.exec(rule.params);
        const specifier = match?.[2];
        if (!specifier || !/^\.\.?\//.test(specifier)
            || resolveGeneratedImport(path, specifier, available)) return;
        const candidates = helpers.filter(helper => available.has(helper.path)
            && helper.path !== path && helper.path.endsWith('.css')
            && helper.path.split('/').at(-1) === specifier.split('/').at(-1));
        if (candidates.length !== 1) return;
        const offset = match[0].indexOf(match[1]) + 1;
        rule.params = rule.params.slice(0, offset)
            + relativeWorkspaceImport(path, candidates[0].path)
            + rule.params.slice(offset + specifier.length);
        changed = true;
    });
    return changed ? root.toString() : content;
}

// Diagnose absent relative stylesheets without approving their paths or creating
// files. Only a later validated split inventory can authorize dependencies.
export function missingWorkspaceCssImports({path, content, paths = []}) {
    if (!/\.css$/i.test(path)) return [];
    try {
        const missing = new Set();
        const available = new Set(paths);
        postcss.parse(content, {from: path}).walkAtRules('import', rule => {
            const specifier = /^(?:url\(\s*)?["']([^"']+)["']/.exec(rule.params)?.[1];
            if (specifier && /^\.\.?\//.test(specifier) && /\.css$/i.test(specifier)
                && !resolveGeneratedImport(path, specifier, available)) missing.add(specifier);
        });
        return [...missing];
    } catch { return []; }
}
