/** @jest-environment node */
import {applyVisualEdit} from '../../src/components/live-ui/utils/applyVisualEdit';
import {liveUiWorkspacePayload} from '../../src/utils/plugins/authoring/liveUi/workspaceState';

let workspace, base, storage, validate, canCommit;
beforeEach(() => {
    let version = 'start', count = 0;
    workspace = {sandboxName: 'sandbox_a', pluginName: 'A', files: {'/render.tsx': {content: 'before'}}, tabs: {get: () => []},
        notifications: {addToQueue: jest.fn()}, setFileContent: jest.fn((file, content) => {workspace.files[file].content = content;}),
        fs: {versions: {start: {}}, version_current: 'start', version_latest: 'start', version: () => ({version: workspace.fs.version_current}), list: () => [],
            create: jest.fn((prev, _tabs, options = {}) => {
                version = options.replaceVersion || 'snapshot-' + (++count);
                workspace.fs.versions[version] = {prev, ...(options.liveUiGroup ? {liveUiGroup: options.liveUiGroup} : {}),
                    content: Object.entries(workspace.files).map(([id, entry]) => ({id, content: entry.content}))};
                workspace.fs.version_current = version; workspace.fs.version_latest = version; return {version};})}};
    base = liveUiWorkspacePayload(workspace);
    storage = {getItem: jest.fn(() => 'original'), setItem: jest.fn(), removeItem: jest.fn()};
    validate = jest.fn(async () => ({success: true})); canCommit = jest.fn(async () => true);
});
const apply = () => applyVisualEdit({workspace, base, patch: {file: '/render.tsx', before: 'before', after: 'after', description: 'Change text'}, storage, validate, canCommit});

test('validated edits receive before/after snapshots and record current-source context', async () => {
    const result = await apply();
    expect(result).toMatchObject({status: 'applied', restorePoint: 'snapshot-1', snapshot: 'snapshot-2'});
    expect(workspace.files['/render.tsx'].content).toBe('after');
    expect(validate.mock.invocationCallOrder[0]).toBeLessThan(workspace.fs.create.mock.invocationCallOrder[0]);
    expect(workspace.fs.snapshotSwitchRevision).toBe(1);
    expect(storage.setItem).toHaveBeenCalledWith('fdo:plugin-ai-history:v1:sandbox_a', expect.stringContaining('Use current workspace files'));
});
test('validation failures leave files and snapshots unchanged and can be retried', async () => {
    validate.mockResolvedValueOnce({success: false, error: 'Build failed'});
    expect(await apply()).toMatchObject({status: 'error', message: 'Build failed'});
    expect(workspace.fs.create).not.toHaveBeenCalled();
    expect(workspace.files['/render.tsx'].content).toBe('before');
    expect((await apply()).status).toBe('applied');
});
test('edits or restore during validation are conflicts, not overwritten', async () => {
    validate.mockImplementation(async () => {workspace.fs.version_current = 'restored'; return {success: true};});
    expect((await apply()).status).toBe('conflict');
    expect(workspace.setFileContent).not.toHaveBeenCalled();
});
test('expired authorization prevents a late validation result from changing files', async () => {
    canCommit.mockResolvedValue(false);
    expect((await apply()).status).toBe('cancelled');
    expect(workspace.fs.create).not.toHaveBeenCalled();
});
test.each([1, 2])('snapshot persistence failure at step %i rolls back source and snapshot pointers', async step => {
    const original = workspace.fs.create.getMockImplementation();
    let calls = 0;
    workspace.fs.create.mockImplementation(() => ++calls === step ? {version: 'failed', error: 'quota'} : original());
    expect((await apply()).status).toBe('error');
    expect(workspace.files['/render.tsx'].content).toBe('before');
    expect(workspace.fs.version_current).toBe('start');
    expect(workspace.fs.versions).toEqual({start: {}});
    expect(storage.setItem).toHaveBeenCalledWith('sandbox_a', 'original');
});

const designChange = (designSession, text, keepCheckpoint = false) => applyVisualEdit({workspace,
    base: liveUiWorkspacePayload(workspace), patch: {file: '/render.tsx', before: workspace.files['/render.tsx'].content, after: text, description: 'Change text'},
    storage, validate, canCommit, designSession, keepCheckpoint});
test('100 design edits persist one working snapshot and preserve the original restore point', async () => {
    const session = {id: 'visual-session'};
    const first = await designChange(session, 'edit 1');
    const count = Object.keys(workspace.fs.versions).length;
    for (let i = 2; i <= 100; i++) {
        expect(await designChange(session, 'edit ' + i)).toMatchObject({status: 'applied', snapshot: first.snapshot, restorePoint: first.restorePoint, changes: i, grouped: true});
    }
    expect(Object.keys(workspace.fs.versions)).toHaveLength(count);
    expect(workspace.fs.versions[first.restorePoint].content[0].content).toBe('before');
    expect(workspace.fs.versions[first.snapshot].content[0].content).toBe('edit 100');
});
test('keeping a checkpoint seals the group; the next edit preserves it and creates one new working snapshot', async () => {
    const session = {id: 'visual-session'};
    const first = await designChange(session, 'first');
    const checkpoint = await designChange(session, 'milestone', true);
    expect(checkpoint).toMatchObject({snapshot: first.snapshot, checkpointKept: true});
    expect(session.group).toBeNull();
    const count = Object.keys(workspace.fs.versions).length;
    const next = await designChange(session, 'next');
    expect(next).toMatchObject({restorePoint: checkpoint.snapshot, grouped: false, changes: 1});
    expect(next.snapshot).not.toBe(checkpoint.snapshot);
    expect(Object.keys(workspace.fs.versions)).toHaveLength(count + 1);
    expect(workspace.fs.versions[checkpoint.snapshot].content[0].content).toBe('milestone');
});
test.each(['manual source', 'guide edit', 'restore', 'new session', 'branch'])('%s ends grouping without overwriting the previous working snapshot', async reason => {
    let session = {id: 'visual-session'};
    const first = await designChange(session, 'first');
    if (reason === 'manual source') workspace.files['/render.tsx'].content = 'manual';
    if (reason === 'guide edit') workspace.files['/SKILL.md'] = {content: 'new guide'};
    if (reason === 'restore') workspace.fs.snapshotSwitchRevision++;
    if (reason === 'new session') session = {id: 'new-session'};
    if (reason === 'branch') workspace.fs.versions.branch = {prev: first.snapshot};
    const next = await designChange(session, 'next');
    expect(next).toMatchObject({status: 'applied', grouped: false, changes: 1});
    expect(next.snapshot).not.toBe(first.snapshot);
    expect(workspace.fs.versions[first.snapshot].content[0].content).toBe('first');
});
test('failed persistence of a grouped edit restores its prior saved content and allows retry', async () => {
    const session = {id: 'visual-session'};
    const first = await designChange(session, 'first');
    const group = session.group;
    const original = workspace.fs.create.getMockImplementation();
    workspace.fs.create.mockImplementationOnce((...args) => ({...original(...args), error: 'quota'}));
    expect((await designChange(session, 'failed')).status).toBe('error');
    expect(workspace.files['/render.tsx'].content).toBe('first');
    expect(workspace.fs.versions[first.snapshot].content[0].content).toBe('first');
    expect(session.group).toBe(group);
    expect(await designChange(session, 'retry')).toMatchObject({status: 'applied', snapshot: first.snapshot, changes: 2});
});
test('a guide edit during validation is a conflict, including files not sent to the static preview', async () => {
    validate.mockImplementation(async () => {workspace.files['/SKILL.md'] = {content: 'manual guide change'}; return {success: true};});
    expect((await designChange({id: 'visual-session'}, 'after')).status).toBe('conflict');
    expect(workspace.fs.create).not.toHaveBeenCalled();
});
test('a multi-file draft validates once and persists every file in one snapshot transaction', async () => {
    workspace.files['/styles.css'] = {content: 'old css'};
    base = liveUiWorkspacePayload(workspace);
    const patches = [{file: '/render.tsx', before: 'before', after: 'new render', description: 'Two edits'}, {file: '/styles.css', before: 'old css', after: 'new css'}];
    const result = await applyVisualEdit({workspace, base, patch: patches[0], patches, storage, validate, canCommit});
    expect(result.status).toBe('applied');
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith({'/render.tsx': 'new render', '/styles.css': 'new css'});
    expect(workspace.fs.create).toHaveBeenCalledTimes(2);
    expect(workspace.files['/styles.css'].content).toBe('new css');
});
test('a partial multi-file write failure rolls back every file and snapshot', async () => {
    workspace.files['/styles.css'] = {content: 'old css'};
    base = liveUiWorkspacePayload(workspace);
    const patches = [{file: '/render.tsx', before: 'before', after: 'new render', description: 'Two edits'}, {file: '/styles.css', before: 'old css', after: 'new css'}];
    const setter = workspace.setFileContent.getMockImplementation();
    workspace.setFileContent.mockImplementation((file, value) => {if (value === 'new css') throw new Error('write failed'); setter(file, value);});
    expect((await applyVisualEdit({workspace, base, patch: patches[0], patches, storage, validate, canCommit})).status).toBe('error');
    expect(workspace.files['/render.tsx'].content).toBe('before');
    expect(workspace.files['/styles.css'].content).toBe('old css');
    expect(workspace.fs.versions).toEqual({start: {}});
    expect(storage.setItem).toHaveBeenCalledWith('sandbox_a', 'original');
});
test('persistence failure after a multi-file write restores all source files and stored history', async () => {
    workspace.files['/styles.css'] = {content: 'old css'};
    base = liveUiWorkspacePayload(workspace);
    const patches = [{file: '/render.tsx', before: 'before', after: 'new render', description: 'Two edits'}, {file: '/styles.css', before: 'old css', after: 'new css'}];
    const create = workspace.fs.create.getMockImplementation();
    workspace.fs.create.mockImplementationOnce(create).mockImplementationOnce((...args) => ({...create(...args), error: 'quota'}));
    expect((await applyVisualEdit({workspace, base, patch: patches[0], patches, storage, validate, canCommit})).status).toBe('error');
    expect(workspace.files['/render.tsx'].content).toBe('before');
    expect(workspace.files['/styles.css'].content).toBe('old css');
    expect(workspace.fs.versions).toEqual({start: {}});
    expect(storage.setItem).toHaveBeenCalledWith('sandbox_a', 'original');
});
