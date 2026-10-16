/** @jest-environment node */
import {formatPickerColor, isColorProperty, parseCssColor} from '../../src/utils/plugins/authoring/liveUi/cssColors';

test.each([
    ['#abc', '#aabbcc', 1], ['#abcd', '#aabbcc', 221 / 255], ['#123456', '#123456', 1],
    ['#12345680', '#123456', 128 / 255], ['#ABCDEF', '#abcdef', 1],
    ['rgb(12, 34, 56)', '#0c2238', 1], ['rgba(12,34,56,.5)', '#0c2238', .5],
    ['rgb(100% 0% 50% / 25%)', '#ff0080', .25], ['rgb(-10 300 0 / 200%)', '#00ff00', 1],
    ['transparent', '#000000', 0],
])('reads literal %s without rewriting its source', (source, hex, alpha) => {
    expect(parseCssColor(source)).toEqual({hex, alpha});
});
test.each(['var(--brand)', 'currentColor', 'inherit', 'initial', 'unset', 'revert-layer', 'oklch(70% .2 20)', 'linear-gradient(red,blue)', '#ab', '#gggggg', 'rgb(1 2)', 'rgb(1 2 3 / 1 / 2)', 'url(x)', '', null])('keeps expressions and unsupported values as text: %s', value => {
    expect(parseCssColor(value)).toBeNull();
});
test('picker output preserves transparency and emits one supported CSS color', () => {
    expect(formatPickerColor('#336699', 1)).toBe('#336699');
    expect(formatPickerColor('#336699', .5)).toBe('#33669980');
    expect(formatPickerColor('#336699', 0)).toBe('#33669900');
});
test('offers only color declarations rather than replacing shorthand images and shadows', () => {
    for (const property of ['color', 'background-color', 'border-color', 'border-inline-start-color', 'outline-color', 'fill', 'stroke', '--brand-color']) expect(isColorProperty(property)).toBe(true);
    for (const property of ['background', 'background-image', 'box-shadow', 'padding', 'opacity', '', undefined]) expect(isColorProperty(property)).toBe(false);
});
