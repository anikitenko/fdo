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
    monaco.typescript.typescriptDefaults.setCompilerOptions.mockClear();
    monaco.typescript.javascriptDefaults.setCompilerOptions.mockClear();
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
    virtualFS.fs.create(v1.version, [{ id: '/a.ts', active: true }]);

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
    virtualFS.fs.create(v1.version, []);

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

  test('getLatestContent and getModel recover from disposed Monaco models', () => {
    const model = createModel('/index.ts', 'export const value = 1;');
    model.dispose();

    expect(() => virtualFS.getLatestContent()).not.toThrow();
    expect(virtualFS.getLatestContent()['/index.ts']).toBe('export const value = 1;');

    const recoveredModel = virtualFS.getModel('/index.ts');
    expect(recoveredModel).toBeTruthy();
    expect(recoveredModel.isDisposed()).toBe(false);
    expect(recoveredModel.getValue()).toBe('export const value = 1;');
  });

  test('createFile refreshes Monaco project graph by default', () => {
    const uri = monaco.Uri.file('/new-file.ts');
    const model = monaco.editor.createModel('export const v = 1;', 'typescript', uri);

    virtualFS.createFile('/new-file.ts', model);

    expect(monaco.typescript.typescriptDefaults.setCompilerOptions).toHaveBeenCalled();
    expect(monaco.typescript.javascriptDefaults.setCompilerOptions).toHaveBeenCalled();
  });

  test('createFile can skip Monaco project graph refresh for bulk restores', () => {
    const uri = monaco.Uri.file('/restored.ts');
    const model = monaco.editor.createModel('export const restored = true;', 'typescript', uri);

    virtualFS.createFile('/restored.ts', model, { suppressCompilerRefresh: true });

    expect(monaco.typescript.typescriptDefaults.setCompilerOptions).not.toHaveBeenCalled();
    expect(monaco.typescript.javascriptDefaults.setCompilerOptions).not.toHaveBeenCalled();
  });

  test('fallback SDK typings include operator response helpers and response types', async () => {
    window.electron = window.electron || {};
    window.electron.fs = {
      getNodeModules: jest.fn().mockResolvedValue({success: true, files: []}),
    };
    window.electron.sdk = {
      getTypes: jest.fn().mockResolvedValue({success: true, files: []}),
    };

    await virtualFS.fs.setupNodeModules();

    const fallbackTypes = virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/index.d.ts');
    expect(fallbackTypes).toContain('createPrivilegedActionCorrelationId');
    expect(fallbackTypes).toContain('createPrivilegedActionBackendRequest');
    expect(fallbackTypes).toContain('requestPrivilegedAction');
    expect(fallbackTypes).toContain('createScopedProcessExecActionRequest');
    expect(fallbackTypes).toContain('requestScopedProcessExec');
    expect(fallbackTypes).toContain('createScopedWorkflowRequest');
    expect(fallbackTypes).toContain('requestScopedWorkflow');
    expect(fallbackTypes).toContain('getOperatorToolPreset');
    expect(fallbackTypes).toContain('listOperatorToolPresets');
    expect(fallbackTypes).toContain('createOperatorToolCapabilityPreset');
    expect(fallbackTypes).toContain('createOperatorToolActionRequest');
    expect(fallbackTypes).toContain('requestOperatorTool');
    expect(fallbackTypes).toContain('createCapabilityBundle');
    expect(fallbackTypes).toContain('createFilesystemCapabilityBundle');
    expect(fallbackTypes).toContain('createProcessCapabilityBundle');
    expect(fallbackTypes).toContain('describeCapability');
    expect(fallbackTypes).toContain('parseMissingCapabilityError');
    expect(fallbackTypes).toContain('isPrivilegedActionSuccessResponse');
    expect(fallbackTypes).toContain('isPrivilegedActionErrorResponse');
    expect(fallbackTypes).toContain('unwrapPrivilegedActionResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionSuccessResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionErrorResponse');
    expect(fallbackTypes).toContain('export type ScopedWorkflowProcessStepResultData');
    expect(fallbackTypes).toContain('export type ScopedWorkflowStepResult');
    expect(fallbackTypes).toContain('export type ScopedWorkflowResult');
    expect(fallbackTypes).toContain('export type ScopedWorkflowSummary');
  });
});
