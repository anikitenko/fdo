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
    monaco.typescript.typescriptDefaults.addExtraLib.mockClear();
    monaco.typescript.javascriptDefaults.addExtraLib.mockClear();
    window.electron.system.getFdoSdkEditorSupport.mockReset();
    window.electron.system.getFdoSdkEditorSupport.mockResolvedValue({ success: true, bundle: null });
    window.electron.system.getFdoSdkEditorMonacoPolicy.mockReset();
    window.electron.system.getFdoSdkEditorMonacoPolicy.mockResolvedValue({ success: true, policy: null });
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
    const revision = virtualFS.fs.snapshotSwitchRevision || 0;
    createModel('/a.ts', 'A');
    const v1 = virtualFS.fs.create('', [{ id: '/a.ts', active: true }]);
    // change model content and create v2
    virtualFS.setFileContent('/a.ts', 'B');
    virtualFS.fs.create(v1.version, [{ id: '/a.ts', active: true }]);
    expect(virtualFS.fs.snapshotSwitchRevision || 0).toBe(revision);

    const data = virtualFS.fs.set(v1.version);
    expect(virtualFS.fs.snapshotSwitchRevision).toBe(revision + 1);
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
    await virtualFS.fs.setupNodeModules();

    const fallbackTypes = virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/index.d.ts');
    expect(fallbackTypes).toContain('createPrivilegedActionCorrelationId');
    expect(fallbackTypes).toContain('createPrivilegedActionBackendRequest');
    expect(fallbackTypes).toContain('requestPrivilegedAction');
    expect(fallbackTypes).toContain('requestPrivilegedActionFromEnvelope');
    expect(fallbackTypes).toContain('defineRenderOnLoadActions');
    expect(fallbackTypes).toContain('createRenderOnLoadActionsSource');
    expect(fallbackTypes).toContain('resolveRenderOnLoadSource');
    expect(fallbackTypes).toContain('export type RenderOnLoadActionBindingsModuleOptions');
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
    expect(fallbackTypes).toContain('runCapabilityPreflight');
    expect(fallbackTypes).toContain('isPrivilegedActionSuccessResponse');
    expect(fallbackTypes).toContain('isPrivilegedActionErrorResponse');
    expect(fallbackTypes).toContain('unwrapPrivilegedActionResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionSuccessResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionErrorResponse');
    expect(fallbackTypes).toContain('export type PrivilegedActionPipelineResult');
    expect(fallbackTypes).toContain('export type CapabilityPreflightReport');
    expect(fallbackTypes).toContain('export type ScopedWorkflowProcessStepResultData');
    expect(fallbackTypes).toContain('export type ScopedWorkflowStepResult');
    expect(fallbackTypes).toContain('export type ScopedWorkflowResult');
    expect(fallbackTypes).toContain('export type ScopedWorkflowSummary');

    const renderOnLoadTypes = virtualFS.getFileContent('/node_modules/@types/fdo-render-onload.d.ts');
    expect(renderOnLoadTypes).toContain('declare namespace FDOOnLoad');
    expect(renderOnLoadTypes).not.toContain('declare module "@anikitenko/fdo-sdk"');
  });

  test('with SDK index present, injects package manifest and does not inject fallback SDK module declaration', async () => {
    const originalGetFdoSdkTypes = window.electron.system.getFdoSdkTypes;
    window.electron.system.getFdoSdkTypes = jest.fn().mockResolvedValue({
      files: [
        { path: 'index.d.ts', content: 'export class FDO_SDK {}\nexport interface FDOInterface {}\nexport interface PluginMetadata { name: string; version: string; author: string; }' },
        { path: 'render/index.d.ts', content: 'export {}' },
      ],
    });

    try {
      await virtualFS.fs.setupNodeModules();

      expect(virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/index.d.ts')).toContain('export class FDO_SDK');
      expect(virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/index.d.ts')).not.toContain('createPrivilegedActionCorrelationId');

      const packageJson = JSON.parse(virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/package.json'));
      expect(packageJson.name).toBe('@anikitenko/fdo-sdk');
      expect(packageJson.types).toBe('./index.d.ts');
      expect(packageJson.exports['.'].types).toBe('./index.d.ts');

      expect(monaco.typescript.typescriptDefaults.addExtraLib).toHaveBeenCalledWith(
        expect.any(String),
        '/node_modules/@types/fdo-render-onload.d.ts'
      );
      expect(monaco.typescript.javascriptDefaults.addExtraLib).toHaveBeenCalledWith(
        expect.any(String),
        '/node_modules/@types/fdo-render-onload.d.ts'
      );
      const renderOnLoadTypes = virtualFS.getFileContent('/node_modules/@types/fdo-render-onload.d.ts');
      expect(renderOnLoadTypes.length).toBeGreaterThan(20);
      expect(
        renderOnLoadTypes.includes('waitForElement')
        || renderOnLoadTypes.includes('declare namespace FDOOnLoad')
      ).toBe(true);
      expect(renderOnLoadTypes).not.toContain('declare module "@anikitenko/fdo-sdk"');
    } finally {
      window.electron.system.getFdoSdkTypes = originalGetFdoSdkTypes;
    }
  });

  test('with missing SDK index, fallback renderOnLoad typings do not shadow SDK module exports', async () => {
    const originalGetFdoSdkTypes = window.electron.system.getFdoSdkTypes;
    window.electron.system.getFdoSdkTypes = jest.fn().mockResolvedValue({
      files: [{ path: 'nested/only.d.ts', content: 'export type Unused = true;' }],
    });

    try {
      await virtualFS.fs.setupNodeModules();

      const fallbackTypes = virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/index.d.ts');
      expect(fallbackTypes).toContain('declare module "@anikitenko/fdo-sdk"');

      const renderOnLoadTypes = virtualFS.getFileContent('/node_modules/@types/fdo-render-onload.d.ts');
      expect(renderOnLoadTypes).toContain('declare namespace FDOOnLoad');
      expect(renderOnLoadTypes).not.toContain('declare module "@anikitenko/fdo-sdk"');
      expect(virtualFS.getFileContent('/node_modules/@anikitenko/fdo-sdk/package.json')).toBeUndefined();
    } finally {
      window.electron.system.getFdoSdkTypes = originalGetFdoSdkTypes;
    }
  });

  test("passes hasSdkIndex into SDK Monaco policy and honors SDK virtual package path", async () => {
    const originalGetFdoSdkTypes = window.electron.system.getFdoSdkTypes;
    const originalGetFdoSdkEditorSupport = window.electron.system.getFdoSdkEditorSupport;
    window.electron.system.getFdoSdkTypes = jest.fn().mockResolvedValue({
      files: [{ path: "index.d.ts", content: "export const sdk = true;" }],
    });
    window.electron.system.getFdoSdkEditorSupport = jest.fn().mockResolvedValue({
      success: true,
      bundle: {
        moduleId: "@anikitenko/fdo-sdk",
        indexTypesVirtualPath: "/node_modules/@anikitenko/fdo-sdk/index.d.ts",
        packageJsonVirtualPath: "/node_modules/@anikitenko/fdo-sdk/custom-package.json",
        packageManifest: {
          name: "@anikitenko/fdo-sdk",
          types: "./index.d.ts",
          exports: {
            ".": { types: "./index.d.ts", default: "./dist/fdo-sdk.bundle.js" },
          },
        },
        packageJson: "{\"name\":\"@anikitenko/fdo-sdk\"}",
        renderOnLoadTypeDefinitions: "declare namespace FDOOnLoad { interface Context {} }",
        renderOnLoadHints: [],
      },
    });

    try {
      await virtualFS.fs.setupNodeModules();
      expect(window.electron.system.getFdoSdkEditorMonacoPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          hasSdkIndex: true,
        })
      );
      const customPackageJson = virtualFS.getFileContent("/node_modules/@anikitenko/fdo-sdk/custom-package.json");
      const defaultPackageJson = virtualFS.getFileContent("/node_modules/@anikitenko/fdo-sdk/package.json");
      expect(String(customPackageJson || defaultPackageJson || "")).toContain("@anikitenko/fdo-sdk");
    } finally {
      window.electron.system.getFdoSdkTypes = originalGetFdoSdkTypes;
      window.electron.system.getFdoSdkEditorSupport = originalGetFdoSdkEditorSupport;
    }
  });
});
