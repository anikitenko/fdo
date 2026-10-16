/** @jest-environment node */
import * as sdk from '@anikitenko/fdo-sdk';
import {createPluginTemplateFiles} from '../../src/components/editor/utils/virtualTemplates';
import {createStaticUiPreview} from '../../src/utils/plugins/authoring/liveUi/staticPreview';
import {planVisualSourceEdit} from '../../src/utils/plugins/authoring/liveUi/sourceEdits';

let files, preview, button;
beforeEach(async () => {
    files = createPluginTemplateFiles({name: 'visual-utility', template: 'utility'});
    preview = await createStaticUiPreview(files, sdk);
    button = preview.elements.find(item => item.tag === 'button');
});
test('maps literal text and style sources; a plain-text edit preserves behavior and escapes markup', async () => {
    expect(button).toMatchObject({text: {value: 'Inspect JSON'}, location: {path: '/render.tsx'}, styles: [expect.objectContaining({file: '/styles.css', key: 'button'})]});
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'text', value: 'Inspect <JSON> & "values"'});
    expect(patch.file).toBe('/render.tsx');
    expect(patch.after).toBe(patch.before.slice(0, patch.start) + patch.replacement + patch.before.slice(patch.end));
    expect(patch.after).toContain('Inspect &lt;JSON&gt; &amp; &quot;values&quot;');
    const next = await createStaticUiPreview({...files, [patch.file]: patch.after}, sdk);
    expect(next.status).toBe('ready');
    expect(next.elements.find(item => item.tag === 'button').text.value).toBe('Inspect <JSON> & "values"');
    expect(files['/index.ts']).toContain('inspectJson');
});
test('CSS edits preserve comments, states, media rules and unrelated declarations', async () => {
    files['/styles.css'] += '\n/* keep this comment */\n.button:hover { color: pink; }\n@media (max-width: 480px) { .button { color: yellow; } }';
    preview = await createStaticUiPreview(files, sdk);
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'color', value: '#abcdef'});
    expect(patch.after).toContain('color: #abcdef;');
    expect(patch.after).toContain('/* keep this comment */');
    expect(patch.after).toContain('.button:hover { color: pink; }');
    expect(patch.after).toContain('@media (max-width: 480px) { .button { color: yellow; } }');
    expect((await createStaticUiPreview({...files, [patch.file]: patch.after}, sdk)).status).toBe('ready');
});
test('computed content, forged targets and CSS rule injection are rejected', () => {
    const heading = preview.elements.find(item => item.tag === 'h1');
    expect(heading.text).toBeNull();
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: heading.id, kind: 'text', value: 'Other'})).toThrow('computed');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: 'forged', kind: 'text', value: 'Other'})).toThrow('source-mapped');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'color', value: 'red;} body {display:none'})).toThrow('one CSS value');
});
test('shared style edits report all currently rendered uses', async () => {
    files = createPluginTemplateFiles({name: 'visual-dashboard', template: 'dashboard'});
    preview = await createStaticUiPreview(files, sdk);
    const panel = preview.elements.find(item => item.styles.some(style => style.key === 'panel'));
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: panel.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'panel', property: 'padding', value: '30px'});
    expect(patch.affected).toBeGreaterThan(1);
});
test('duplicate base declarations remain read-only rather than guessing CSS cascade ownership', async () => {
    files['/styles.css'] += '\n.button { color: red !important; color: blue; }';
    preview = await createStaticUiPreview(files, sdk);
    const style = preview.elements.find(item => item.tag === 'button').styles.find(item => item.key === 'button');
    expect(style.declarations.some(item => item.property === 'color')).toBe(false);
});
test('adds a missing layout declaration to one base rule while preserving surrounding CSS and states', async () => {
    files['/styles.css'] += '\n/* trailing marker */\n.button:hover { color: pink; }\n@media (max-width: 480px) { .button { padding: 3px; } }';
    preview = await createStaticUiPreview(files, sdk);
    const style = preview.elements.find(item => item.tag === 'button').styles[0];
    expect(style.availableProperties).toContain('gap');
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'gap', value: '18px'});
    expect(patch.after.slice(0, patch.start)).toBe(patch.before.slice(0, patch.start));
    expect(patch.after.slice(patch.start + patch.replacement.length)).toBe(patch.before.slice(patch.end));
    expect(patch.after).toContain('gap: 18px');
    expect(patch.after).toContain('/* trailing marker */\n.button:hover { color: pink; }');
    expect(patch.after).toContain('@media (max-width: 480px) { .button { padding: 3px; } }');
    const next = await createStaticUiPreview({...files, [patch.file]: patch.after}, sdk);
    expect(next.status).toBe('ready');
    const updated = next.elements.find(item => item.tag === 'button').styles[0];
    expect(updated.availableProperties).not.toContain('gap');
    expect(updated.declarations).toContainEqual(expect.objectContaining({property: 'gap', value: '18px'}));
});
test('empty base classes can gain declarations; multiple base rules and duplicate properties are not guessed', async () => {
    files['/styles.css'] += '\n.empty { /* retain */ }';
    files['/render.tsx'] = files['/render.tsx'].replace("classFor('muted')", "classFor('empty')");
    preview = await createStaticUiPreview(files, sdk);
    const intro = preview.elements.find(item => item.tag === 'p');
    expect(intro.styles[0].declarations).toEqual([]);
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: intro.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'empty', property: 'display', value: 'grid'});
    expect(patch.after).toContain('/* retain */');
    expect(patch.after).toContain('display: grid');
    files['/styles.css'] += '\n.button { color: red; color: blue; }';
    preview = await createStaticUiPreview(files, sdk);
    const button = preview.elements.find(item => item.tag === 'button');
    expect(button.styles[0].availableProperties).toEqual([]);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'gap', value: '10px'})).toThrow('unambiguous base rule');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'color', value: 'red'})).toThrow('supported CSS declaration');
});
test('properties outside the former curated list and existing custom properties use the same checked CSS contract', async () => {
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'button', property: 'text-shadow', value: '0 1px 2px #000'});
    expect(patch.after).toContain('text-shadow: 0 1px 2px #000');
    files['/styles.css'] = patch.after + '\n.custom { --PanelGap: 8px; }';
    files['/render.tsx'] = files['/render.tsx'].replace("classFor('muted')", "classFor('custom')");
    preview = await createStaticUiPreview(files, sdk);
    const intro = preview.elements.find(item => item.tag === 'p');
    const custom = planVisualSourceEdit(files, preview.elements, {elementId: intro.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'custom', property: '--PanelGap', value: '16px'});
    expect(custom.after).toContain('--PanelGap: 16px');
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: intro.id, kind: 'css', scope: 'shared', styleFile: '/styles.css', styleKey: 'custom', property: 'color;display', value: 'grid'})).toThrow('supported CSS declaration');
});

test('removing a declaration preserves comments, unrelated declarations, states and media rules', async () => {
    files['/styles.css'] += '\n/* keep */\n.button:hover { color: pink; }\n@media (max-width: 480px) { .button { color: yellow; } }';
    preview = await createStaticUiPreview(files, sdk);
    const patch = planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', action: 'remove', styleFile: '/styles.css', styleKey: 'button', property: 'color'});
    expect(patch.added).toBe('');
    expect(patch.after.slice(0, patch.start)).toBe(patch.before.slice(0, patch.start));
    expect(patch.after.slice(patch.start)).toBe(patch.before.slice(patch.end));
    expect(patch.after).toContain('/* keep */\n.button:hover { color: pink; }');
    expect(patch.after).toContain('@media (max-width: 480px) { .button { color: yellow; } }');
    const next = await createStaticUiPreview({...files, [patch.file]: patch.after}, sdk);
    expect(next.status).toBe('ready');
    expect(next.elements.find(item => item.tag === 'button').styles[0].declarations.some(item => item.property === 'color')).toBe(false);
    expect(() => planVisualSourceEdit(files, preview.elements, {elementId: button.id, kind: 'css', scope: 'shared', action: 'remove', styleFile: '/styles.css', styleKey: 'button', property: 'missing'})).toThrow('supported CSS declaration');
});
