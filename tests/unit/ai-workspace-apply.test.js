import {applyAiWorkspaceFiles} from '../../src/components/editor/utils/applyAiWorkspaceFiles';

test('rolls back earlier writes and a newly created file when a later write partially fails', () => {
    const fs = new Map([['/a.ts', 'old'], ['/new.tsx', 'untouched']]);
    const write = jest.fn((path, content) => { fs.set(path, content); if (path === '/new.ts') throw new Error('write failed'); });
    expect(() => applyAiWorkspaceFiles({files: [{path: '/a.ts', content: 'new'}, {path: '/new.ts', content: 'partial'}],
        existingFiles: [...fs].map(([path, content]) => ({path, content})), write,
        remove: path => fs.delete(path), assertScope: () => {}})).toThrow('Original file contents were restored');
    expect([...fs]).toEqual([['/a.ts', 'old'], ['/new.tsx', 'untouched']]);
});

test('reports rollback failures with recovery guidance', () => {
    expect(() => applyAiWorkspaceFiles({files: [{path: '/a.ts', content: 'new'}],
        existingFiles: [{path: '/a.ts', content: 'old'}], write: () => {throw new Error('disk');},
        remove: jest.fn(), assertScope: () => {}})).toThrow('Restore the pre-apply snapshot');
});

test('does not roll back into a different workspace', () => {
    let switched = false;
    const write = jest.fn(() => {switched = true; throw new Error('switched');});
    const remove = jest.fn();
    expect(() => applyAiWorkspaceFiles({files: [{path: '/a.ts', content: 'new'}], existingFiles: [], write, remove,
        assertScope: () => {if (switched) throw new Error('changed');}})).toThrow('newly selected workspace');
    expect(write).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
});
