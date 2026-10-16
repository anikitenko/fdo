export const RESPONSIVE_PRESETS = [480, 768, 1024];
const validWidth = width => Number.isInteger(width) && width >= 1 && width <= 10000;

export function validBreakpoint(value) {
    if (value == null) return true;
    if (typeof value === 'number') return validWidth(value);
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.every(key => ['min', 'max'].includes(key) && validWidth(value[key])) &&
        (value.min === undefined || value.max === undefined || value.min <= value.max);
}

export function breakpointKey(value) {
    if (value == null) return 'all';
    if (typeof value === 'number') return 'max:' + value;
    return value.min === undefined ? 'max:' + value.max : value.max === undefined ? 'min:' + value.min : `range:${value.min}:${value.max}`;
}
export const sameBreakpoint = (left, right) => breakpointKey(left) === breakpointKey(right);
export function compareBreakpoints(left, right) {
    const a = typeof left === 'number' ? {max: left} : left;
    const b = typeof right === 'number' ? {max: right} : right;
    const kind = value => value.min === undefined ? 0 : value.max === undefined ? 1 : 2;
    return kind(a) - kind(b) || (a.min ?? a.max) - (b.min ?? b.max) || (a.max ?? 0) - (b.max ?? 0);
}
export const breakpointOptionValue = value => typeof value === 'number' ? String(value) : breakpointKey(value);
export function breakpointLabel(value) {
    if (value == null) return 'All widths';
    if (typeof value === 'number' || value.min === undefined) return `At ${typeof value === 'number' ? value : value.max}px and narrower`;
    return value.max === undefined ? `At ${value.min}px and wider` : `Between ${value.min}px and ${value.max}px`;
}
export function breakpointParams(value) {
    if (typeof value === 'number') return `(max-width: ${value}px)`;
    return [value.min !== undefined ? `(min-width: ${value.min}px)` : '', value.max !== undefined ? `(max-width: ${value.max}px)` : ''].filter(Boolean).join(' and ');
}
export function breakpointPreviewWidth(value) {
    if (typeof value === 'number') return value;
    return value.min === undefined ? value.max : value.max === undefined ? value.min : Math.floor((value.min + value.max) / 2);
}
export function breakpointBoundaryPreviews(value) {
    if (value == null || typeof value === 'number' || value.min === undefined) return [];
    const bounds = value.max === undefined ? [] : [{width: value.min, label: 'Preview lower bound'},
        ...(value.max > value.min ? [{width: value.max, label: 'Preview upper bound'}] : [])];
    return [...bounds, {width: value.min - 1, label: 'Preview below'}, ...(value.max !== undefined ? [{width: value.max + 1, label: 'Preview above'}] : [])]
        .filter(item => validWidth(item.width));
}

// Normalize only inclusive whole-pixel comparisons. Strict bounds cannot be
// rounded to integers: a viewport may have a fractional CSS-pixel width.
function widthCondition(part) {
    let match = /^\(\s*(min|max)-width\s*:\s*(\d+)px\s*\)$/i.exec(part);
    if (match) return {[match[1].toLowerCase()]: Number(match[2])};
    match = /^\(\s*width\s*(<=|>=)\s*(\d+)px\s*\)$/i.exec(part);
    if (match) return {[match[1] === '<=' ? 'max' : 'min']: Number(match[2])};
    match = /^\(\s*(\d+)px\s*(<=|>=)\s*width\s*\)$/i.exec(part);
    if (match) return {[match[2] === '<=' ? 'min' : 'max']: Number(match[1])};
    match = /^\(\s*(\d+)px\s*(<=|>=)\s*width\s*(<=|>=)\s*(\d+)px\s*\)$/i.exec(part);
    if (!match || match[2] !== match[3]) return null;
    return match[2] === '<=' ? {min: Number(match[1]), max: Number(match[4])} : {min: Number(match[4]), max: Number(match[1])};
}

export function mediaBreakpointOf(node) {
    if (node?.type !== 'atrule' || node.name.toLowerCase() !== 'media') return null;
    const parts = node.params.trim().split(/\s+and\s+/i);
    if (parts.length > 2) return null;
    const value = {};
    for (const part of parts) {
        const condition = widthCondition(part);
        if (!condition || Object.keys(condition).some(key => Object.hasOwn(value, key))) return null;
        Object.assign(value, condition);
    }
    if (!validBreakpoint(value)) return null;
    return value.min === undefined ? value.max : value;
}
export function cssContainers(root, breakpoint) {
    return breakpoint == null ? [root] : root.nodes.filter(node => {
        const existing = mediaBreakpointOf(node);
        return existing != null && sameBreakpoint(existing, breakpoint);
    });
}
export function breakpointInputError(value, label = 'maximum') {
    if (typeof value !== 'string' || !value) return `Enter a ${label} viewport width, for example 600.`;
    if (!/^\d+$/.test(value)) return 'Use a whole number of pixels without units, spaces or decimals, for example 600.';
    if (!validWidth(Number(value))) return 'Choose a width from 1 to 10000 pixels.';
    return '';
}
export function breakpointFormError(kind, first, last) {
    if (!['max', 'min', 'range'].includes(kind)) return 'Choose a supported responsive rule type.';
    const firstError = breakpointInputError(first, kind === 'max' ? 'maximum' : 'minimum');
    if (firstError) return firstError;
    if (kind !== 'range') return '';
    const lastError = breakpointInputError(last);
    if (lastError) return lastError;
    return Number(first) <= Number(last) ? '' : 'Minimum width must be less than or equal to maximum width.';
}
export function breakpointFromInput(kind, first, last) {
    return kind === 'max' ? Number(first) : kind === 'min' ? {min: Number(first)} : {min: Number(first), max: Number(last)};
}
