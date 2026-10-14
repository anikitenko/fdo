import postcss from 'postcss';
import {mergeCssStyleMaps, attachCssConditionalRules} from './resolveCssImports';

// Parse real CSS nodes instead of rewriting CSS into JSON with regular
// expressions. Selector lists must be split without splitting commas inside
// :is(), attribute values, strings, or declaration functions.
export function extractCssStyles(cssString = '') {
    const root = postcss.parse(cssString);
    const readNodes = (nodes, nested = false) => {
        let result = {};
        const imports = {};
        for (const node of nodes || []) {
            if (node.type === 'decl') {
                result = mergeCssStyleMaps(result, {[node.prop]: node.value + (node.important ? ' !important' : '')});
            } else if (node.type === 'rule') {
                const body = readNodes(node.nodes, true);
                for (const selector of node.selectors) {
                    const key = nested ? selector.trim() : selector.trim().replace(/^\./, '');
                    // Preserve the existing .panel.active -> panel[&.active]
                    // contract even when the stylesheet has no base rule.
                    const compound = !nested && /^\.([\w-]+)\./.exec(selector.trim());
                    if (compound && !Object.hasOwn(result, compound[1])) result = mergeCssStyleMaps(result, {[compound[1]]: {}});
                    result = mergeCssStyleMaps(result, {[key]: body});
                }
            } else if (node.type === 'atrule') {
                const name = node.name.toLowerCase() === 'import' ? 'import' : node.name;
                const key = `@${name}${node.params ? ` ${node.params}` : ''}`;
                if (node.name.toLowerCase() === 'import') {
                    // Composition merging deliberately removes import metadata;
                    // retain it separately until resolveCssImports sees it.
                    Object.defineProperty(imports, key, {value: {}, enumerable: true, configurable: true});
                    continue;
                }
                const keyframes = /^(?:-\w+-)?keyframes$/i.test(node.name);
                const entry = {[key]: readNodes(node.nodes, nested || keyframes)};
                // Attach at the original source position, before imports are
                // merged. A final global pass could override a later file's
                // explicit conditional declarations with an earlier block.
                result = mergeCssStyleMaps(result, !nested && /^(media|supports|container)$/i.test(node.name)
                    ? attachCssConditionalRules(entry) : entry);
            }
        }
        return {...result, ...imports};
    };
    return readNodes(root.nodes);
}
