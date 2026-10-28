/** @jest-environment node */
import {planPluginSupportEdit, reviewPluginSupportChange} from '../../src/utils/sdk/pluginSupportEditing';
import {prepareVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftEdits';
import {savedVisualDraft, restoreVisualDraft} from '../../src/utils/plugins/authoring/liveUi/draftRecovery';
import {pickLiveUiSources} from '../../src/utils/plugins/authoring/liveUi/workspaceState';

const host = {fdo: '3.4.5', sdk: '7.8.9', api: '2.3.4', features: {currentHostFeature: true}};
const manifest = {name: 'tools', scripts: {build: 'original'}, dependencies: {example: '1.0.0'}, fdo: {icon: 'cube', compatibility: {fdo: '>=3 <4'}}};
const files = () => ({'/package.json': JSON.stringify(manifest, null, 4) + '\n', '/index.ts': 'original source'});

test('missing support fields use actual host defaults and preserve declared ranges and all other metadata', () => {
    const before = files();
    const patch = planPluginSupportEdit(before, {mode: 'missing'}, host);
    const pkg = JSON.parse(patch.after);
    expect(pkg.fdo.compatibility).toEqual({fdo: '>=3 <4', sdk: '>=7.8.9 <8.0.0', api: '^2.3.4', features: []});
    expect(pkg).toMatchObject({name: manifest.name, scripts: manifest.scripts, dependencies: manifest.dependencies, fdo: {icon: 'cube'}});
    expect(patch.after).toMatch(/\n {4}"name"/);
    expect(patch.after.endsWith('\n')).toBe(true);
    expect(reviewPluginSupportChange(before, {...before, '/package.json': patch.after}, host).compatibility.status).toBe('compatible');
    expect(before).toEqual(files());
});

test('a deliberate unsupported target can be reviewed without pretending it works on this host', () => {
    const before = files();
    const patch = planPluginSupportEdit(before, {requirements: {fdo: '>=99', sdk: '^7.8.9', api: '^2.3.4', features: []}}, host);
    const review = reviewPluginSupportChange(before, {...before, '/package.json': patch.after}, host);
    expect(review).toMatchObject({requiresAcknowledgement: true, compatibility: {status: 'incompatible'}});
    expect(review.warnings.join(' ')).toContain('cannot build or run');
    expect(review.warnings.join(' ')).toContain('not proof');
});

test('repeating a support request is a no-op and does not reformat package.json', () => {
    const before = files();
    const patch = planPluginSupportEdit(before, {mode: 'missing'}, host);
    const current = {...before, '/package.json': JSON.stringify(JSON.parse(patch.after))};
    expect(planPluginSupportEdit(current, {mode: 'missing'}, host)).toBeNull();
    expect(planPluginSupportEdit(current, {requirements: JSON.parse(patch.after).fdo.compatibility}, host)).toBeNull();
});

test('a complete but invalid declaration can still be repaired', () => {
    const before = {'/package.json': JSON.stringify({fdo: {compatibility: {fdo: 'invalid', sdk: '^7', api: '^2', features: []}}})};
    expect(planPluginSupportEdit(before, {requirements: {fdo: '^3', sdk: '^7', api: '^2', features: []}}, host)).toHaveProperty('after');
});

test.each([
    before => ({...before, '/index.ts': 'changed code'}),
    before => ({...before, '/new.ts': 'new source'}),
    before => ({...before, '/package.json': JSON.stringify({...manifest, scripts: {build: 'injected'}})}),
    before => ({...before, '/package.json': JSON.stringify({...manifest, dependencies: {example: '99'}})}),
])('the metadata-only validation path cannot modify code, scripts, or dependencies', transform => {
    const before = files();
    expect(() => reviewPluginSupportChange(before, transform(before), host)).toThrow('support-only edit');
});

test('invalid ranges, malformed packages and arbitrary replacement fields fail closed', () => {
    expect(() => planPluginSupportEdit(files(), {requirements: {fdo: 'latest'}}, host)).toThrow('valid version range');
    expect(() => planPluginSupportEdit(files(), {requirements: {fdo: '^3', inventedContract: true}}, host)).toThrow('Unknown');
    expect(() => planPluginSupportEdit({'/package.json': '{broken'}, {mode: 'missing'}, host)).toThrow();
    expect(() => planPluginSupportEdit({}, {mode: 'missing'}, host)).toThrow('package.json');
});

test('support drafts allow undo, redo and recovery even when the render path has no preview adapter', async () => {
    const base = {workspaceId: 'support-only', revision: 'original', files: {'/package.json': JSON.stringify({name: 'legacy'}), '/index.ts': 'unpreviewable'}};
    const render = async () => ({status: 'unsupported', message: 'No static adapter'});
    const preview = await render();
    const first = await prepareVisualDraft({base, preview, request: {kind: 'compatibility', mode: 'missing'}, render, acceptFiles: pickLiveUiSources});
    expect(first).toMatchObject({supportOnly: true, changedFileCount: 1});
    expect(first.patches[0].file).toBe('/package.json');
    const undo = await prepareVisualDraft({base, previous: first, preview: first.preview, request: {kind: 'undo'}, render, acceptFiles: pickLiveUiSources});
    expect(undo.files).toEqual(base.files);
    expect(undo.patches).toHaveLength(0);
    const redo = await prepareVisualDraft({base, previous: undo, preview: undo.preview, request: {kind: 'redo'}, render, acceptFiles: pickLiveUiSources});
    expect(redo.files).toEqual(first.files);
    const restored = await restoreVisualDraft(savedVisualDraft(base, redo, 'same-host'), base, 'same-host', render, pickLiveUiSources);
    expect(restored.supportOnly).toBe(true);
    expect(restored.files).toEqual(first.files);
});
