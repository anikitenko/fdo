/** @jest-environment node */
import {formatCssLength, lengthPropertyOptions, parseCssLength} from '../../src/utils/plugins/authoring/liveUi/cssLengths';

test.each([
    ['padding', '12px', {amount: 12, unit: 'px'}],
    ['width', '50%', {amount: 50, unit: '%'}],
    ['margin-inline-start', '-.5rem', {amount: -.5, unit: 'rem'}],
    ['inset-block-end', '-2vh', {amount: -2, unit: 'vh'}],
    ['border-radius', '0', {amount: 0, unit: 'px'}],
    ['font-size', ' 1.25EM ', {amount: 1.25, unit: 'em'}],
    ['min-inline-size', '10dvw', {amount: 10, unit: 'dvw'}],
])('reads one literal %s length %s', (property, value, expected) => {
    expect(parseCssLength(property, value)).toEqual(expected);
});
test.each([
    ['padding', '4px 8px'], ['border-radius', '4px / 8px'], ['width', 'calc(100% - 2px)'],
    ['gap', 'var(--gap)'], ['height', 'auto'], ['font-size', 'inherit'],
    ['width', '4'], ['padding', '-2px'], ['border-width', '10%'],
    ['letter-spacing', '10%'], ['width', '1e2px'], ['width', '2unknown'],
    ['width', '2px!important'], ['width', 'NaNpx'], ['--size', '3px'],
    ['line-height', '1.5'], ['transform', '2px'], ['padding', ''],
])('preserves %s value %s for text editing', (property, value) => {
    expect(parseCssLength(property, value)).toBeNull();
});
test('formats only valid values for the property without silently changing units or sign', () => {
    expect(formatCssLength('margin', '-.5', 'rem')).toBe('-0.5rem');
    expect(formatCssLength('width', '50', '%')).toBe('50%');
    expect(formatCssLength('padding', '-1', 'px')).toBeNull();
    expect(formatCssLength('border-width', '10', '%')).toBeNull();
    for (const number of ['', ' ', '1e3', 'Infinity', '1; color:red', 'NaN']) expect(formatCssLength('width', number, 'px')).toBeNull();
    expect(formatCssLength('width', '1', 'px;')).toBeNull();
    expect(lengthPropertyOptions('outline-offset').negative).toBe(true);
    expect(lengthPropertyOptions('padding-inline').negative).toBe(false);
    expect(lengthPropertyOptions('background')).toBeNull();
});
