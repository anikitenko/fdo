// Canonical keys are shared by host edits, inspector choices and the fixed preview bridge.
const INTERACTIONS = ['hover', 'focus', 'focus-visible', 'active'];
const LABELS = ['Hover', 'Focus', 'Focus visible', 'Active'];
export const CSS_STATES = [{value: 'base', label: 'Base'},
    ...[1, 2, 3, 4].flatMap(size => Array.from({length: 15}, (_, index) => index + 1)
        .filter(mask => INTERACTIONS.filter((_, index) => mask & (1 << index)).length === size)
        .map(mask => ({value: INTERACTIONS.filter((_, index) => mask & (1 << index)).join(':'),
            label: LABELS.filter((_, index) => mask & (1 << index)).join(' + ')})))];

// Deliberately excludes selector lists, attributes, combinators and pseudo functions.
export function parseStateSelector(selector) {
    const match = /^\.([\w-]+)((?::(?:hover|focus-visible|focus|active))*)$/.exec(selector.trim());
    if (!match) return null;
    const tokens = match[2] ? match[2].slice(1).split(':') : [];
    if (new Set(tokens).size !== tokens.length) return null;
    return {classKey: match[1], state: INTERACTIONS.filter(value => tokens.includes(value)).join(':') || 'base', tokens};
}

export function matchesStateSelector(selector, classKey, state) {
    const parsed = parseStateSelector(selector);
    return parsed?.classKey === classKey && parsed.state === state;
}

// Split only lists whose every branch belongs to the supported simple grammar.
// Commas in functions/attributes cannot pass that grammar, so these lists stay
// read-only. Keep repeated equivalent branches visible to ambiguity checks.
export function matchingStateSelectors(selector, classKey, state) {
    const branches = selector.split(',').map(branch => branch.trim());
    if (!branches.every(branch => parseStateSelector(branch))) return [];
    return branches.filter(branch => matchesStateSelector(branch, classKey, state));
}

export function previewStateTokens(state) {
    const tokens = state === 'base' ? [] : state.split(':');
    if (tokens.includes('focus-visible') && !tokens.includes('focus')) tokens.push('focus');
    return INTERACTIONS.filter(token => tokens.includes(token)).join(' ');
}
