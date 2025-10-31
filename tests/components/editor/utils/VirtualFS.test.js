/**
 * Jest unit tests for VirtualFS snapshot system
 */
import monaco from 'monaco-editor';
import virtualFS from '../../../../src/components/editor/utils/VirtualFS';

// LZString is used inside VirtualFS; ensure it exists
import LZString from 'lz-string';

describe('VirtualFS snapshots', () => {
  beforeEach(() => {
    // Reset FS state
    virtualFS.notifications.reset();
    virtualFS.files = {};
    virtualFS.treeObject = [{ id: '/', label: '/', type: 'folder', isExpanded: true, childNodes: [] }];
    virtualFS.fs.versions = {};
    virtualFS.fs.version_current = 0;
    virtualFS.fs.version_latest = 0;
    virtualFS.pluginName = 'TestPlugin';
    virtualFS.sandboxName = 'sandbox_test';
    localStorage.clear();
  });

  const createModel = (path, content = 'hello') => {
    const uri = monaco.Uri.file(path);
    const model = monaco.editor.createModel(content, 'plaintext', uri);
    virtualFS.createFile(path, model);
    return model;
  };

  test('creates snapshot with metadata and persists to localStorage', () => {
    createModel('/index.ts', 'console.log(1)');
    createModel('/src/a.ts', 'export const a = 1');

    const result = virtualFS.fs.create('', []);

    expect(result.version).toBeTruthy();
    expect(virtualFS.fs.version_current).toBe(result.version);

    const stored = localStorage.getItem('sandbox_test');
    expect(stored).toBeTruthy();
    const unpacked = JSON.parse(LZString.decompress(stored));
    expect(unpacked.versions[result.version]).toBeTruthy();
    expect(unpacked.version_current).toBe(result.version);
  });

  test('list() returns newest-first ordering', () => {
    createModel('/a.ts', '1');
    const first = virtualFS.fs.create('', []);
    // mutate one file and create another snapshot later
    virtualFS.setFileContent('/a.ts', '2');
    const second = virtualFS.fs.create(first.version, []);

    const list = virtualFS.fs.list();
    expect(list[0].version).toBe(second.version);
    expect(list[1].version).toBe(first.version);
  });

  test('set(version) restores files and returns tabs', () => {
    createModel('/a.ts', 'A');
    const v1 = virtualFS.fs.create('', [{ id: '/a.ts', active: true }]);
    // change model content and create v2
    virtualFS.setFileContent('/a.ts', 'B');
    const v2 = virtualFS.fs.create(v1.version, [{ id: '/a.ts', active: true }]);

    const data = virtualFS.fs.set(v1.version);
    expect(data.tabs).toEqual([{ id: '/a.ts', active: true }]);
    expect(virtualFS.getFileContent('/a.ts')).toBe('A');
    expect(virtualFS.fs.version_current).toBe(v1.version);
  });

  test('renameVersion updates keys and persists', () => {
    createModel('/a.ts', 'A');
    const v1 = virtualFS.fs.create('', []);
    const ok = virtualFS.fs.renameVersion(v1.version, 'renamed-version');
    expect(ok).toBe(true);
    expect(virtualFS.fs.versions['renamed-version']).toBeTruthy();
    expect(virtualFS.fs.version_current).toBe('renamed-version');
    const stored = JSON.parse(LZString.decompress(localStorage.getItem('sandbox_test')));
    expect(stored.version_current).toBe('renamed-version');
  });

  test('deleteVersion prevents removing the only snapshot', () => {
    createModel('/a.ts', 'A');
    const v1 = virtualFS.fs.create('', []);
    const ok = virtualFS.fs.deleteVersion(v1.version);
    expect(ok).toBe(false);
  });

  test('deleteVersion removes snapshot and updates pointers', () => {
    createModel('/a.ts', 'A');
    const v1 = virtualFS.fs.create('', []);
    virtualFS.setFileContent('/a.ts', 'B');
    const v2 = virtualFS.fs.create(v1.version, []);

    const ok = virtualFS.fs.deleteVersion(v1.version);
    expect(ok).toBe(true);
    const list = virtualFS.fs.list();
    expect(list.find(v => v.version === v1.version)).toBeUndefined();
  });

  test('localStorage quota/persist error does not crash create()', () => {
    // Force persist error by monkey-patching setItem to throw
    const origSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };

    createModel('/a.ts', 'A');

    try {
      const result = virtualFS.fs.create('', []);
      // Should not throw and should return a result with version
      expect(result).toBeTruthy();
      expect(typeof result.version).toBe('string');
      // FS state should be updated with the new current version even if persistence failed
      expect(virtualFS.fs.version_current).toBe(result.version);
      // Persistence likely failed; sandbox key may not exist, which is acceptable for this test
      // Ensure the code didn't crash and internal state is consistent
      expect(Object.keys(virtualFS.fs.versions)).toContain(result.version);
    } finally {
      localStorage.setItem = origSetItem;
    }
  });
});
