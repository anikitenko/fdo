import virtualFS from '../../../../src/components/editor/utils/VirtualFS';
import {createVirtualFile} from '../../../../src/components/editor/utils/createVirtualFile';

beforeEach(() => {
    virtualFS.resetWorkspaceState();virtualFS.notifications.reset();localStorage.clear();
    createVirtualFile('/package.json', JSON.stringify({source: 'index.ts', main: 'dist/index.cjs'}));
    createVirtualFile('/index.ts', "import {ui} from './shared/ui';");
    createVirtualFile('/shared/ui.ts', 'export const ui = 1;');
    createVirtualFile('/shared-other/keep.ts', 'export const keep = 2;');
    virtualFS.createFolder('/shared/empty');
});
afterEach(() => virtualFS.resetWorkspaceState());

test('rename moves a whole directory atomically and preserves tabs, empty directories and siblings', () => {
    virtualFS.tabs.add(virtualFS.getTreeObjectItemById('/shared/ui.ts'));
    virtualFS.rename(virtualFS.getTreeObjectItemById('/shared'), '/src/widgets');
    expect(virtualFS.getFileContent('/src/widgets/ui.ts')).toBe('export const ui = 1;');
    expect(virtualFS.getFileContent('/index.ts')).toContain("from './src/widgets/ui'");
    expect(virtualFS.getFileContent('/shared-other/keep.ts')).toContain('keep = 2');
    expect(virtualFS.getModel('/shared/ui.ts')).toBeNull();
    expect(virtualFS.getTreeObjectItemById('/shared')).toBeNull();
    expect(virtualFS.getDirectories()).toContain('/src/widgets/empty');
    expect(virtualFS.tabs.getActiveTabId()).toBe('/src/widgets/ui.ts');
});

test('conflicts and invalid moves leave source, tabs and tree intact', () => {
    const before = virtualFS.getLatestContent();
    const node = virtualFS.getTreeObjectItemById('/shared');
    for (const destination of ['/shared/inside', '/shared-other', '/index.ts/child']) {
        expect(() => virtualFS.rename(node, destination)).toThrow();
        expect(virtualFS.getLatestContent()).toEqual(before);
        expect(virtualFS.getTreeObjectItemById('/shared/empty')).toBeTruthy();
    }
});

test('deleting a directory removes only its own descendants and retains empty parents', () => {
    virtualFS.deleteFile('/shared');
    expect(virtualFS.getFileContent('/shared-other/keep.ts')).toContain('keep = 2');
    expect(virtualFS.getTreeObjectItemById('/shared')).toBeNull();
    expect(virtualFS.getTreeObjectItemById('/shared-other/keep.ts')).toBeTruthy();
    virtualFS.deleteFile('/shared-other/keep.ts');
    expect(virtualFS.getTreeObjectItemById('/shared-other')?.type).toBe('folder');
});

test('duplicate preserves originals, copies empty directories and never overwrites', () => {
    virtualFS.duplicate(virtualFS.getTreeObjectItemById('/shared'), '/copy');
    expect(virtualFS.getFileContent('/copy/ui.ts')).toBe(virtualFS.getFileContent('/shared/ui.ts'));
    expect(virtualFS.getDirectories()).toContain('/copy/empty');
    expect(() => virtualFS.duplicate(virtualFS.getTreeObjectItemById('/shared'), '/copy')).toThrow('already exists');
});

test('snapshot round trip keeps an empty directory and deletion has a recovery checkpoint', () => {
    virtualFS.setInitWorkspace('test', 'sandbox_file_operations');
    virtualFS.checkpointFileOperation();
    const snapshot = virtualFS.fs.version_current;
    virtualFS.deleteFile('/shared');
    virtualFS.fs.set(snapshot);
    expect(virtualFS.getDirectories()).toContain('/shared/empty');
    expect(virtualFS.getFileContent('/shared/ui.ts')).toContain('ui = 1');
});

test('closing an inactive tab does not move focus away from the active file', () => {
    virtualFS.tabs.add(virtualFS.getTreeObjectItemById('/index.ts'));
    virtualFS.tabs.add(virtualFS.getTreeObjectItemById('/shared/ui.ts'), false);
    virtualFS.tabs.removeById('/shared/ui.ts');
    expect(virtualFS.tabs.getActiveTabId()).toBe('/index.ts');
});
