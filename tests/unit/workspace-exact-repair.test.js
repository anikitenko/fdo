import {applyWorkspaceExactRepair as apply, createAnchoredWorkspaceRepair} from '../../src/utils/plugins/validation/workspaceExactRepair';
const response = edits => JSON.stringify({edits});
test('applies replacements atomically against original offsets including deletion', () => {
    expect(apply('prefix alpha beta suffix', response([
        {before: 'alpha', after: 'beta longer'}, {before: 'beta', after: ''},
    ]))).toBe('prefix beta longer  suffix');
});
test.each([
    [{before: 'absent', after: 'x'}],
    [{before: 'a', after: 'x'}],
    [{before: 'alpha', after: 'x'}, {before: 'lpha', after: 'y'}],
    [{before: '', after: 'x'}],
    [{before: 'alpha', after: 'alpha'}],
    [{before: 'alpha', after: 'x', path: '/other.ts'}],
    [],
].map(edits => [edits]))('rejects unsafe or ineffective edits: %j', edits => {
    expect(() => apply('alpha alpha2', response(edits))).toThrow('Exact file repair rejected');
});
test('rejects path scope changes and oversized results', () => {
    expect(() => apply('original', JSON.stringify({path: '/other.ts', edits: [{before: 'original', after: 'x'}]}))).toThrow();
    expect(() => apply('x'.repeat(47999) + 'a', response([{before: 'a', after: 'longer'}]))).toThrow('size limit');
});

test.each([
    ['missing', 'alpha', 0, 'Copy the before text exactly'],
    ['alpha\nalpha', 'alpha', 2, 'starting at lines 1, 2'],
])('reports match count and correction context for %s', (source, before, matchCount, message) => {
    try { apply(source, response([{before, after: 'fixed'}])); throw new Error('Expected rejection'); }
    catch (error) {
        expect(error).toMatchObject({code: 'EXACT_REPAIR_MATCH', editIndex: 0, matchCount});
        expect(error.message).toContain(message);
    }
});


test('anchored correction selects duplicate lines explicitly and preserves adjacent source', () => {
    const repair = createAnchoredWorkspaceRepair('same\nsame\ntail');
    const id = 2;
    expect(repair.apply(JSON.stringify({edits: [{start: id, end: id, after: 'fixed'}]}))).toBe('same\nfixed\ntail');
});

test('anchored correction rejects stale, reversed and overlapping ranges atomically', () => {
    const repair = createAnchoredWorkspaceRepair('one\ntwo\nthree');
    const ids = [1, 2, 3];
    for (const edits of [
        [{start: 'stale:L1', end: ids[0], after: 'x'}],
        [{start: ids[2], end: ids[0], after: 'x'}],
        [{start: ids[0], end: ids[1], after: 'x'}, {start: ids[1], end: ids[2], after: 'y'}],
    ]) expect(() => repair.apply(JSON.stringify({edits}))).toThrow('Anchored file repair rejected');
});

test.each(['1', 'L1', 0, -1, 1.5, 3, null])('line ranges reject invalid start values: %j', start => {
    const repair = createAnchoredWorkspaceRepair('one\ntwo');
    expect(() => repair.apply(JSON.stringify({edits: [{start, end: 2, after: 'fixed'}]}))).toThrow('integer line numbers');
});

test('line replacement retains adjacent CRLF lines and final line without newline', () => {
    const repair = createAnchoredWorkspaceRepair('first\r\nsecond\r\nlast');
    expect(repair.apply(JSON.stringify({edits: [{start: 2, end: 2, after: 'changed'}]})))
        .toBe('first\r\nchanged\r\nlast');
});
