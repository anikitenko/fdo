import {normalizeVirtualWorkspacePath, normalizeVirtualWorkspaceContent} from '../../src/utils/plugins/virtualWorkspacePaths';
import {getFullPathOfFileFolder} from '../../src/components/editor/utils/getFullPathOfFileFolder';

test.each([
    ['//shared//website-check-ui.ts', '/shared/website-check-ui.ts'],
    ['shared/website-check-ui.ts', '/shared/website-check-ui.ts'],
    ['\\shared\\website-check-ui.ts', '/shared/website-check-ui.ts'],
    ['/src/../shared/./website-check-ui.ts', '/shared/website-check-ui.ts'],
    ['/', '/'],
])('normalizes workspace path %s', (input, expected) => {
    expect(normalizeVirtualWorkspacePath(input)).toBe(expected);
});

test.each([
    ['/', 'folder', false, '/'],
    ['/shared/', 'folder', false, '/shared/'],
    ['/shared/', 'folder', true, '/'],
    ['/shared/nested/', 'folder', true, '/shared/'],
    ['/shared/ui.ts', 'file', false, '/shared/'],
    ['/index.ts', 'file', true, '/'],
])('gets directory prefix for %s (%s, rename=%s)', (path, type, same, expected) => {
    expect(getFullPathOfFileFolder(path, type, same)).toBe(expected);
});

test('preserves empty content and accepts identical legacy aliases', () => {
    expect(normalizeVirtualWorkspaceContent({'//shared/ui.ts': '', '/shared/ui.ts': ''}))
        .toEqual({'/shared/ui.ts': ''});
});
