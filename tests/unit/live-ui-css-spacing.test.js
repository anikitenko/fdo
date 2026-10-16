/** @jest-environment node */
import {formatCssSpacing, isCssSpacingSide, parseCssSpacing} from '../../src/utils/plugins/authoring/liveUi/cssSpacing';

test.each([
    ['8px', ['8px', '8px', '8px', '8px']],
    ['8px 1rem', ['8px', '1rem', '8px', '1rem']],
    ['8px 1rem 0', ['8px', '1rem', '0', '1rem']],
    ['8px 1rem 0 10%', ['8px', '1rem', '0', '10%']],
])('expands physical spacing %s without converting any units', (value, expected) => {
    expect(parseCssSpacing('padding', value)).toEqual(expected);
    expect(formatCssSpacing('padding', expected)).toBe(value);
});
test('margin supports auto/negative sides, while padding rejects both', () => {
    expect(parseCssSpacing('margin', '-2px auto')).toEqual(['-2px', 'auto', '-2px', 'auto']);
    expect(formatCssSpacing('margin', ['0', 'auto', '12px', 'auto'])).toBe('0 auto 12px');
    expect(parseCssSpacing('padding', '-2px 0')).toBeNull();
    expect(parseCssSpacing('padding', 'auto')).toBeNull();
    expect(isCssSpacingSide('margin', ' auto ')).toBe(true);
    expect(isCssSpacingSide('padding', '1px 2px')).toBe(false);
});
test.each(['var(--gap)', 'calc(1rem + 2px)', 'inherit', 'revert-layer', '1px /* comment */ 2px',
    '1px 2px 3px 4px 5px', '1px / 2px', '1px !important', '1', '', '1px; color:red'])('preserves unsupported shorthand %s as text', value => {
    expect(parseCssSpacing('padding', value)).toBeNull();
});
test('changing one side retains the other three and compresses only identical strings', () => {
    const sides = parseCssSpacing('padding', '4px 8px');
    sides[3] = '2rem';
    expect(formatCssSpacing('padding', sides)).toBe('4px 8px 4px 2rem');
    expect(formatCssSpacing('padding', ['0', '0px', '0', '0px'])).toBe('0 0px');
    for (const sides of [[], ['1px'], ['1px', '2px', '3px', ''], ['1px', '2px', '3px', 'var(--gap)']])
        expect(formatCssSpacing('padding', sides)).toBeNull();
    expect(formatCssSpacing('margin-inline', ['0', '0', '0', '0'])).toBeNull();
    expect(parseCssSpacing('border-radius', '4px')).toBeNull();
});
