const prefix = 'fdo.archivedDraft.';
export function archivedDrafts(storage, id) {
    const drafts = [];
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try {const item = JSON.parse(storage.getItem(key)); if (item.id === id && typeof item.data === 'string' && typeof item.createdAt === 'string') drafts.push({...item, key});} catch { /* Ignore unrelated/corrupt archives. */ }
    }
    return drafts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function archiveDraftAndRelease(storage, id) {
    const source = `sandbox_${id}`, data = storage.getItem(source);
    if (data === null) throw new Error('This draft has already been released.');
    const key = prefix + id + '.' + crypto.randomUUID();
    const archive = JSON.stringify({id, createdAt: new Date().toISOString(), data});
    storage.setItem(key, archive);
    if (storage.getItem(key) !== archive) throw new Error('Could not verify the draft backup. The ID was not released.');
    if (storage.getItem(source) !== data) throw new Error('The draft changed while being archived. Close its editor and try again.');
    storage.removeItem(source);
    return key;
}
export function restoreArchivedDraft(storage, id, key) {
    if (!key.startsWith(prefix)) throw new Error('Invalid draft archive.');
    const archive = JSON.parse(storage.getItem(key));
    if (archive.id !== id || typeof archive.data !== 'string') throw new Error('Invalid draft archive.');
    if (storage.getItem(`sandbox_${id}`) !== null) throw new Error('A current draft already uses this ID. Resume it instead.');
    storage.setItem(`sandbox_${id}`, archive.data);
    if (storage.getItem(`sandbox_${id}`) !== archive.data) throw new Error('Could not restore this draft. The archive was kept.');
    // Keep the archive as a recovery copy, including after a later release.
}
