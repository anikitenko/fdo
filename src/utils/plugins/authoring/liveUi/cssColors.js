export const isColorProperty = property => typeof property === 'string' &&
    (property === 'color' || property.endsWith('-color') || ['fill', 'stroke'].includes(property));
const clamp = (value, maximum = 1) => Math.min(maximum, Math.max(0, value));
const byteHex = value => Math.round(value).toString(16).padStart(2, '0');
const number = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(value);
function rgbColor(value) {
    const match = /^rgba?\(([^()]*)\)$/i.exec(value);
    if (!match) return null;
    let channels, alpha;
    if (match[1].includes(',')) {
        const parts = match[1].split(',').map(part => part.trim());
        if (![3, 4].includes(parts.length)) return null;
        channels = parts.slice(0, 3); alpha = parts[3];
    } else {
        const parts = match[1].trim().split(/\s*\/\s*/);
        if (parts.length > 2) return null;
        channels = parts[0].split(/\s+/); alpha = parts[1];
    }
    if (channels.length !== 3 || !channels.every(number) || (alpha !== undefined && !number(alpha))) return null;
    const bytes = channels.map(channel => clamp(channel.endsWith('%') ? parseFloat(channel) * 255 / 100 : parseFloat(channel), 255));
    return {hex: '#' + bytes.map(byteHex).join(''), alpha: alpha === undefined ? 1 : clamp(parseFloat(alpha) / (alpha.endsWith('%') ? 100 : 1))};
}

// Text is authoritative: normalization is only for the picker swatch. Advanced
// and context-dependent expressions remain untouched until an explicit choice.
export function parseCssColor(value, document) {
    if (typeof value !== 'string') return null;
    value = value.trim();
    const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value);
    if (hex) {
        const digits = hex[1].length < 5 ? [...hex[1]].map(char => char + char).join('') : hex[1];
        return {hex: '#' + digits.slice(0, 6).toLowerCase(), alpha: digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1};
    }
    if (value.toLowerCase() === 'transparent') return {hex: '#000000', alpha: 0};
    const rgb = rgbColor(value);
    if (rgb) return rgb;
    if (!document?.defaultView || !/^(?:[a-z]+|hsla?\([\d\s.,%+\-/degtunra]+\))$/i.test(value) ||
        /^(currentcolor|inherit|initial|unset|revert|revert-layer)$/i.test(value)) return null;
    const node = document.createElement('span');
    node.style.setProperty('color', value, 'important');
    if (!node.style.color) return null;
    node.style.setProperty('display', 'none', 'important');
    try {
        (document.body || document.documentElement).appendChild(node);
        return rgbColor(document.defaultView.getComputedStyle(node).color);
    } finally {node.remove();}
}
export function formatPickerColor(hex, alpha) {
    return alpha >= 1 ? hex : hex + byteHex(clamp(alpha) * 255);
}
