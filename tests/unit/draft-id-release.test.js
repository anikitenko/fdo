import {archiveDraftAndRelease, archivedDrafts, restoreArchivedDraft} from '../../src/components/editor/utils/draftIdRelease';
beforeEach(() => localStorage.clear());
test('archives the exact workspace before releasing and restores without overwriting a current draft', () => {
    localStorage.setItem('sandbox_tools', 'COMPRESSED_DRAFT');
    const archive = archiveDraftAndRelease(localStorage, 'tools');
    expect(localStorage.getItem('sandbox_tools')).toBeNull();
    expect(archivedDrafts(localStorage, 'tools')).toEqual([expect.objectContaining({data: 'COMPRESSED_DRAFT', key: archive})]);
    restoreArchivedDraft(localStorage, 'tools', archive);
    expect(localStorage.getItem('sandbox_tools')).toBe('COMPRESSED_DRAFT');
    expect(() => restoreArchivedDraft(localStorage, 'tools', archive)).toThrow('already uses');
    expect(localStorage.getItem(archive)).not.toBeNull();
});
test('quota failures leave the original draft untouched', () => {
    const storage = {getItem: jest.fn(() => 'ORIGINAL'), setItem: jest.fn(() => {throw new Error('Quota exceeded');}), removeItem: jest.fn()};
    expect(() => archiveDraftAndRelease(storage, 'tools')).toThrow('Quota exceeded');
    expect(storage.removeItem).not.toHaveBeenCalled();
});
test('does not delete a workspace that changes while it is being archived', () => {
    const map = new Map([['sandbox_tools', 'ORIGINAL']]);
    const storage = {getItem: key => map.get(key) ?? null, setItem: (key, value) => {map.set(key, value); map.set('sandbox_tools', 'NEWER');}, removeItem: jest.fn()};
    expect(() => archiveDraftAndRelease(storage, 'tools')).toThrow('draft changed');
    expect(storage.removeItem).not.toHaveBeenCalled();
});
