import {historyStorageKey, normalizeHistory, readHistory, writeHistory, buildHistoryContext} from '../../src/components/editor/utils/aiCodingAgentHistory';

beforeEach(() => localStorage.clear());
test('preserves snapshot associations and restore events in context', () => {
    const messages = [
        {role: 'user', content: 'Rename plugin', snapshot: 'before'},
        {role: 'assistant', content: 'Renamed', snapshot: 'before', appliedSnapshot: 'after'},
        {role: 'snapshot', content: 'Restored original files', snapshot: 'before'},
    ];
    writeHistory(localStorage, 'test', messages);
    expect(readHistory(localStorage, 'test')).toEqual(messages);
    const context = buildHistoryContext(messages);
    expect(context).toContain('applied as snapshot after');
    expect(context).toContain('Snapshot change [snapshot before]: Restored original files');
});
test('persists independently per plugin and tolerates corrupt storage', () => {
    const a = historyStorageKey('a');
    const b = historyStorageKey('b');
    writeHistory(localStorage, a, [{role: 'user', content: 'Keep the Azure selector'}]);
    expect(readHistory(localStorage, a)).toEqual([{role: 'user', content: 'Keep the Azure selector'}]);
    expect(readHistory(localStorage, b)).toEqual([]);
    localStorage.setItem(b, '{broken');
    expect(readHistory(localStorage, b)).toEqual([]);
    expect(historyStorageKey('')).toBeNull();
});
test('bounds stored history and excludes unexpected fields and roles', () => {
    const messages = Array.from({length: 80}, () => ({role: 'user', content: 'x'.repeat(21000), apiKey: 'not retained'}));
    const saved = normalizeHistory([...messages, {role: 'system', content: 'invalid'}]);
    expect(saved).toHaveLength(60);
    expect(saved[0]).toEqual({role: 'user', content: 'x'.repeat(20000)});
});
test('sends bounded recent context while excluding out-of-scope entries', () => {
    const messages = [{role: 'user', content: 'host secret'}, ...Array.from({length: 11}, (_, index) => ({role: 'assistant', content: `turn ${index} ` + 'x'.repeat(5000)}))];
    const context = buildHistoryContext(messages, text => !text.includes('host secret'));
    expect(context).not.toContain('host secret');
    expect(context).toContain('turn 10');
    expect(context.length).toBeLessThan(24500);
    expect(context).toContain('current files are authoritative');
});
