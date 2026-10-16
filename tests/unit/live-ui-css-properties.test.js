/** @jest-environment node */
import {browserCssProperties, cssPropertyInfo, filterCssProperties, isVisualCssProperty} from '../../src/utils/plugins/authoring/liveUi/cssProperties';

test('browser discovery merges longhands, camel-case aliases, shorthands and supported vendor properties', () => {
    const prototype = {fontVariantLigatures: '', background: '', webkitAppearance: '', notAProperty: ''};
    const style = Object.create(prototype);
    const supported = new Set(['font-variant-ligatures', 'background', '-webkit-appearance', 'text-shadow']);
    const result = browserCssProperties({document: {documentElement: {style}},
        getComputedStyle: () => ['text-shadow', '--blueprint-variable'], CSS: {supports: property => supported.has(property)}});
    expect(result).toEqual(['-webkit-appearance', 'background', 'font-variant-ligatures', 'text-shadow']);
    expect(result).not.toContain('--blueprint-variable');
    expect(result).not.toContain('not-a-property');
});
test('fragment, abbreviation and semantic search rank useful properties first', () => {
    const items = ['border-radius', 'border-top-left-radius', 'background-color', 'font-size', 'font-weight', 'gap', 'text-spacing-trim', 'letter-spacing', '-webkit-border-horizontal-spacing', 'justify-content'].map(name => ({name, ...cssPropertyInfo(name)}));
    expect(filterCssProperties('round corners', items)[0].name).toBe('border-radius');
    expect(filterCssProperties('bg col', items)[0].name).toBe('background-color');
    expect(filterCssProperties('font size', items)[0].name).toBe('font-size');
    expect(filterCssProperties('bordr rad', items)[0].name).toBe('border-radius');
    expect(filterCssProperties('spacing', items)[0].name).toBe('gap');
    expect(filterCssProperties('bold', items)[0].name).toBe('font-weight');
    expect(filterCssProperties('not a real property xyz', items)).toEqual([]);
});
test('host property syntax accepts ordinary, vendor and case-sensitive custom properties without accepting source syntax', () => {
    for (const name of ['text-shadow', 'font-variant-ligatures', '-webkit-line-clamp', '--PanelGap']) expect(isVisualCssProperty(name)).toBe(true);
    for (const name of ['constructor', '__proto__', 'color; display', 'x{}', 'COLOR', 'background color', null]) expect(isVisualCssProperty(name)).toBe(false);
});
