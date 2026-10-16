import {parseCssLength} from './cssLengths';

export const SPACING_SIDES = ['Top', 'Right', 'Bottom', 'Left'];
export const isSpacingShorthand = property => property === 'margin' || property === 'padding';
export const isCssSpacingSide = (property, value) => isSpacingShorthand(property) && typeof value === 'string' &&
    ((property === 'margin' && value.trim() === 'auto') || parseCssLength(property, value) !== null);

// CSS's 1/2/3/4-value expansion. Deliberately does not evaluate variables,
// functions, comments or CSS-wide keywords, whose meaning spans the shorthand.
export function parseCssSpacing(property, value) {
    if (!isSpacingShorthand(property) || typeof value !== 'string' || !value.trim()) return null;
    const parts = value.trim().split(/\s+/);
    if (parts.length > 4 || !parts.every(part => isCssSpacingSide(property, part))) return null;
    const first = parts[0];
    const second = parts[1] ?? first;
    return [first, second, parts[2] ?? first, parts[3] ?? second];
}

export function formatCssSpacing(property, sides) {
    if (!isSpacingShorthand(property) || !Array.isArray(sides) || sides.length !== 4 || !sides.every(side => typeof side === 'string')) return null;
    const values = sides.map(side => side.trim());
    if (!values.every(side => isCssSpacingSide(property, side))) return null;
    const [top, right, bottom, left] = values;
    return (right !== left ? values : top !== bottom ? values.slice(0, 3) : top !== right ? values.slice(0, 2) : values.slice(0, 1)).join(' ');
}
