import postcss from 'postcss';
import {resolveGeneratedImport} from './generatedWorkspaceImports';

// Attribute cycles to their members, not ancestors which merely import them.
// Callers may restrict subjects to the one file currently being generated.
export function validateGeneratedCssCycles(subjects, sources = subjects, {paths: plannedPaths = [], compositions = new Map()} = {}) {
    const paths = new Set([...plannedPaths, ...sources.map(file => file.path)]);
    // Planned parent imports are mandatory even before their source exists.
    // Checking only written imports accepts a helper's back edge too early.
    const graph = new Map([...compositions].map(([parent, helpers]) => [parent, helpers.map(helper => helper.path)]));
    for (const file of sources.filter(file => /\.css$/i.test(file.path))) {
        const edges = [...(graph.get(file.path) || [])];
        try {
            postcss.parse(file.content, {from: file.path}).walkAtRules('import', rule => {
                const specifier = /^(?:url\(\s*)?["']([^"']+)["']/.exec(rule.params)?.[1];
                const target = specifier && resolveGeneratedImport(file.path, specifier, paths);
                if (target && /\.css$/i.test(target)) edges.push(target);
            });
        } catch { /* Existing syntax validation owns malformed CSS. */ }
        graph.set(file.path, edges);
    }
    return subjects.filter(file => graph.has(file.path)).flatMap(file => {
        const visited = new Set();
        const find = (current, chain) => {
            if (visited.has(current)) return null;
            visited.add(current);
            for (const target of graph.get(current) || []) {
                if (target === file.path) return [...chain, target];
                const cycle = find(target, [...chain, target]);
                if (cycle) return cycle;
            }
            return null;
        };
        const cycle = find(file.path, [file.path]);
        return cycle ? [`${file.path}: Circular CSS import: ${cycle.join(' -> ')}. Remove the cyclic dependency while preserving required styles and cascade order; do not add files or delete styling to silence this error.`] : [];
    });
}
