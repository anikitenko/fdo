import postcss from 'postcss';
import {resolveGeneratedImport} from './generatedWorkspaceImports';

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
