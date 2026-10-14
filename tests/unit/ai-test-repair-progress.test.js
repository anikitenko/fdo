import {hasStrictTestRepairProgress} from '../../src/components/editor/utils/aiTestRepairProgress';
const result = (name, passed, extra = {}) => ({file: '/tools.test.ts', name, passed, ...extra});
const previous = [result('format', false), result('url', false), result('image', true)];
test('permits one caller-bounded repair for a strict reduction of executed failures', () => {
    expect(hasStrictTestRepairProgress(previous, [result('format', false), result('url', true), result('image', true)])).toBe(true);
});
test.each([
    previous,
    [result('format', false), result('url', true), result('image', false)],
    [result('format', false), result('image', true)],
    [result('format', false), result('url', true, {skipped: true}), result('image', true)],
    [result('format', false), result('renamed', true), result('image', true)],
    [], null,
    [result('format', false), result('url', true), result('image', true), result('format', false)],
])('rejects stagnant, regressed or incomparable evidence %#', current => {
    expect(hasStrictTestRepairProgress(previous, current)).toBe(false);
});
