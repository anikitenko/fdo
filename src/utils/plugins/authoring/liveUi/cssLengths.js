const units = ['px', 'rem', 'em', '%', 'ch', 'ex', 'vw', 'vh', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh', 'cm', 'mm', 'in', 'pt', 'pc', 'q'];
const spacing = /^(?:margin|padding)(?:-(?:top|right|bottom|left|inline(?:-start|-end)?|block(?:-start|-end)?))?$/;
const offsets = /^(?:top|right|bottom|left|inset(?:-(?:inline|block)(?:-start|-end)?)?)$/;
const dimensions = /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|gap|row-gap|column-gap|font-size)$/;
const borders = /^(?:border(?:-(?:top|right|bottom|left|inline(?:-start|-end)?|block(?:-start|-end)?))?-width|outline-width|outline-offset|border-radius|border-(?:top|bottom)-(?:left|right)-radius|border-(?:start|end)-(?:start|end)-radius|letter-spacing|word-spacing)$/;

export function lengthPropertyOptions(property) {
    if (typeof property !== 'string' || ![spacing, offsets, dimensions, borders].some(pattern => pattern.test(property))) return null;
    const negative = /^margin(?:-|$)/.test(property) || offsets.test(property) || ['outline-offset', 'letter-spacing', 'word-spacing'].includes(property);
    const percentage = !borders.test(property) || /radius$/.test(property) || property === 'word-spacing';
    return {negative, units: units.filter(unit => percentage || unit !== '%')};
}

// A widget may edit only one literal dimension, never evaluate a CSS expression
// or silently collapse a multi-value shorthand. Unitless zero is a CSS length.
export function parseCssLength(property, value) {
    const options = lengthPropertyOptions(property);
    if (!options || typeof value !== 'string') return null;
    const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([a-z]+|%)?$/i.exec(value.trim());
    if (!match) return null;
    const amount = Number(match[1]), unit = (match[2] || 'px').toLowerCase();
    if (!Number.isFinite(amount) || (!match[2] && amount !== 0) || (!options.negative && amount < 0) || !options.units.includes(unit)) return null;
    return {amount, unit};
}

export function formatCssLength(property, amount, unit) {
    const options = lengthPropertyOptions(property);
    if (typeof amount !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(amount) || !options?.units.includes(unit)) return null;
    const number = Number(amount);
    if (!Number.isFinite(number) || (!options.negative && number < 0)) return null;
    return String(number) + unit;
}
