// Common fallback for non-browser callers. The inspector discovers the running
// Chromium CSSOM; this seed list is not a complete CSS property inventory.
export const VISUAL_CSS_PROPERTIES = [
    'color', 'background', 'background-color', 'padding', 'margin', 'gap',
    'border-radius', 'font-size', 'font-weight', 'line-height', 'border',
    'width', 'max-width', 'min-height', 'display', 'flex-direction', 'flex-wrap',
    'align-items', 'justify-content', 'grid-template-columns', 'row-gap', 'column-gap',
    'height', 'min-width', 'max-height', 'box-sizing', 'text-align', 'overflow', 'white-space',
];

export function isVisualCssProperty(property) {
    return typeof property === 'string' && property.length <= 160 && !['constructor', 'prototype'].includes(property) &&
        /^(?:-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*|--[A-Za-z_][A-Za-z0-9_-]*)$/.test(property);
}
export const normalizeCssProperty = property => property.startsWith('--') ? property : property.toLowerCase();

// Discover the CSSOM of the bundled Chromium instead of claiming a frozen list
// is the CSS standard. Computed style adds longhands; the prototype adds shorthands.
export function browserCssProperties(environment = globalThis) {
    const element = environment.document?.documentElement;
    const css = environment.CSS;
    if (!element || typeof css?.supports !== 'function') return [...VISUAL_CSS_PROPERTIES];
    const style = element.style;
    const names = new Set(VISUAL_CSS_PROPERTIES);
    for (const name of Array.from(environment.getComputedStyle?.(element) || [])) if (!name.startsWith('--')) names.add(name);
    let prototype = style;
    while (prototype && prototype !== Object.prototype) {
        for (let name of Object.getOwnPropertyNames(prototype)) {
            if (/^\d+$/.test(name) || name.startsWith('--')) continue;
            name = name === 'cssFloat' ? 'float' : name.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
            if (name.startsWith('webkit-')) name = '-' + name;
            names.add(name);
        }
        prototype = Object.getPrototypeOf(prototype);
    }
    return [...names].filter(name => isVisualCssProperty(name) && css.supports(name, 'initial')).sort();
}

const searchGroups = [
    [/^(background|color|opacity|fill|stroke)/, 'Color and background', 'background bg colour transparent paint'],
    [/^(margin|padding|gap|row-gap|column-gap)/, 'Spacing', 'spacing space distance inside outside gutter'],
    [/radius/, 'Corners', 'round rounded corners curve'],
    [/^(font|text|line-height|letter|word)/, 'Typography', 'text font typography size letters words'],
    [/^(align|justify|place)/, 'Alignment', 'align alignment center centre horizontal vertical flex grid'],
    [/^(flex|grid|display|order)/, 'Layout', 'layout flex grid row column arrange direction'],
    [/^(width|height|min-|max-|inline-size|block-size|aspect)/, 'Size', 'size width height dimensions minimum maximum'],
    [/^(position|top|right|bottom|left|inset|z-index)/, 'Position', 'position offset layer stacking'],
    [/^(border|outline|box-shadow)/, 'Borders and effects', 'border outline shadow edge stroke'],
    [/^(animation|transition|transform)/, 'Motion', 'animation transition transform rotate scale move'],
    [/^(overflow|scroll|overscroll)/, 'Overflow and scrolling', 'overflow scroll clip scrolling'],
];
export function cssPropertyInfo(name) {
    const group = searchGroups.find(([pattern]) => pattern.test(name));
    return {group: group?.[1] || 'CSS property', keywords: group?.[2] || ''};
}
const compact = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function subsequenceScore(query, value) {
    let at = 0, gaps = 0, last = -1;
    for (const char of query) {
        const next = value.indexOf(char, at);
        if (next < 0) return Infinity;
        gaps += last < 0 ? next : next - last - 1;
        last = next; at = next + 1;
    }
    return gaps + value.length / 100;
}
const hintPreferences = {
    spacing: ['gap', 'padding', 'margin', 'row-gap', 'column-gap', 'letter-spacing', 'word-spacing'],
    round: ['border-radius'], rounded: ['border-radius'], corners: ['border-radius'], roundcorners: ['border-radius'],
    bgcol: ['background-color'], bgcolor: ['background-color'],
    center: ['align-items', 'justify-content', 'text-align', 'place-items'],
    centre: ['align-items', 'justify-content', 'text-align', 'place-items'],
    bold: ['font-weight'], italic: ['font-style'], underline: ['text-decoration', 'text-decoration-line'],
    transparency: ['opacity'], size: ['width', 'height', 'font-size'],
};
export function filterCssProperties(query, items) {
    const words = query.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean), needle = compact(query);
    if (!words.length) return [...items].sort((a, b) => Number(b.existing) - Number(a.existing) || a.name.localeCompare(b.name));
    return items.map(item => {
        const name = compact(item.name);
        const searchable = (item.name + ' ' + item.group + ' ' + item.keywords).toLowerCase();
        let score = name === needle ? -100 : item.name.startsWith(query.toLowerCase()) ? -50 : name.includes(needle) ? -20 + name.indexOf(needle) : Infinity;
        score = Math.min(score, subsequenceScore(needle, name));
        const preferred = hintPreferences[needle]?.indexOf(item.name) ?? -1;
        if (preferred >= 0) score = Math.min(score, -35 + preferred);
        if (words.every(word => searchable.includes(word))) score = Math.min(score, 10 + item.name.length / 100);
        return {item, score};
    }).filter(match => Number.isFinite(match.score)).sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name)).map(match => match.item);
}

const valuePresets = {
    display: ['block', 'flex', 'grid', 'inline-block', 'none'],
    'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
    'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
    'align-items': ['stretch', 'center', 'flex-start', 'flex-end', 'baseline'],
    'justify-content': ['flex-start', 'center', 'flex-end', 'space-between', 'space-around'],
    'text-align': ['left', 'center', 'right', 'start', 'end'],
    'box-sizing': ['border-box', 'content-box'],
    position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
    overflow: ['visible', 'hidden', 'auto', 'scroll', 'clip'],
    'white-space': ['normal', 'nowrap', 'pre-wrap', 'pre-line'],
    'grid-template-columns': ['1fr', 'repeat(2, minmax(0, 1fr))', 'repeat(3, minmax(0, 1fr))'],
};
export function cssValuePresets(property) {return valuePresets[property] || [];}
