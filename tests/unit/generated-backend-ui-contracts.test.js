import {validateGeneratedPluginFiles as validate} from '../../src/components/editor/utils/validateGeneratedPluginFiles';
import {getValidationRepairPaths} from '../../src/components/editor/utils/aiCodingAgentPlanRepair';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';

// Reduced from the URL and image load scripts in the 2026-09-29 failed run.
const broken = [
    {path: '/features/url/render.tsx', content: `export const script = \`
        const dispatch = () => window.createBackendReq('workbench.run.url', {toolId: 'url-encode', payload: {input: input.value}});
        form.addEventListener('submit', (e) => { e.preventDefault(); dispatch(); });
    \`;`},
    {path: '/features/image/render.tsx', content: `export const script = \`
        function runAction() { return window.createBackendReq("workbench.v1.image", {input: input.value}); }
        form.addEventListener("submit", function(e) { e.preventDefault(); runAction(); });
    \`;`},
];
const fixed = broken.map(file => ({...file, content: `export const script = \`
    defineRenderOnLoadActions({handlers: {run: () => window.createBackendReq("UI_MESSAGE", {handler: "run", content: {}})}});
\`;`}));

// Reduced from /tools/json/render.tsx in the failed live workbench run.
const shorthand = {path: '/tools/json/render.tsx', content: `export function renderOnLoad(): string {
    return \`async function call(handler, btn) {
        const content = { input: input.value };
        btn.classList.add("is-busy");
        try { return await window.createBackendReq("UI_MESSAGE", { handler, content }); }
        finally { btn.classList.remove("is-busy"); }
    }\`;
}`};

test('accepts the live shorthand envelope without spending any repair request', async () => {
    expect(validate([shorthand], {partial: true}).errors).toEqual([]);
    const request = jest.fn().mockResolvedValue(JSON.stringify(shorthand));
    const result = await generateStagedWorkspace({prompt: 'Update JSON tool',
        workspaceFiles: [shorthand], repairPaths: [shorthand.path], request});
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toContain(shorthand.content);
});

test.each([
    '{ handler, content }',
    '{ content, handler }',
    '{ "content": {}, "handler": "run" }',
    `{ content: { description: "${'x'.repeat(1500)}" }, handler: "run" }`,
])('accepts equivalent envelope syntax: %.60s', envelope => {
    const content = `window.createBackendReq("UI_MESSAGE", ${envelope});`;
    expect(validate([{path: '/render.tsx', content}], {partial: true}).errors).toEqual([]);
});

test.each([
    'window.createBackendReq("UI_MESSAGE", { handler: { content: {} } });',
    'window.createBackendReq("UI_MESSAGE", {}); const unrelated = { handler: "run", content: {} };',
    'window.createBackendReq("UI_MESSAGE", { content });',
    'window.createBackendReq("UI_MESSAGE", null);',
    'window["createBackendReq"]("wrong", { handler, content });',
])('rejects a malformed call without borrowing keys from other objects: %s', content => {
    expect(validate([{path: '/render.tsx', content}], {partial: true}).errors)
        .toEqual([expect.stringContaining('must call "UI_MESSAGE"')]);
});

test('ignores commented out calls', () => {
    expect(validate([{path: '/render.tsx', content: '// window.createBackendReq("wrong", {});'}], {partial: true}).errors).toEqual([]);
});

test('reports all diagnostic owners together instead of revealing a second file after the first repair', () => {
    const errors = validate(broken).errors;
    expect(errors).toHaveLength(4);
    expect(getValidationRepairPaths(errors, broken)).toEqual(broken.map(file => file.path));
    const remaining = validate([fixed[0], broken[1]]).errors;
    expect(remaining).toHaveLength(2);
    expect(remaining.every(error => error.startsWith(broken[1].path + ':'))).toBe(true);
    expect(validate(fixed).errors).toEqual([]);
});

test.each(broken)('rejects both backend contract errors in the individual file $path', file => {
    const errors = validate([file], {partial: true}).errors;
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('must call "UI_MESSAGE"');
    expect(errors.join('\n')).toContain('must use defineRenderOnLoadActions');
});

test.each([true, false])('a valid call cannot mask an invalid call in the same file (valid first: %s)', validFirst => {
    const valid = 'window.createBackendReq("UI_MESSAGE", {handler: "run", content: {}});';
    const invalid = 'window.createBackendReq("wrong", {input: "value"});';
    const content = (validFirst ? [valid, invalid] : [invalid, valid]).join('\n');
    expect(validate([{path: '/render.tsx', content}], {partial: true}).errors)
        .toEqual([expect.stringContaining('must call "UI_MESSAGE"')]);
});

test('repairs each rejected file during staged generation without a second workspace plan', async () => {
    const reply = file => JSON.stringify({path: file.path, content: file.content});
    const request = jest.fn()
        .mockResolvedValueOnce(reply(broken[0])).mockResolvedValueOnce(reply(fixed[0]))
        .mockResolvedValueOnce(reply(broken[1])).mockResolvedValueOnce(reply(fixed[1]));
    const completed = jest.fn();
    const result = await generateStagedWorkspace({prompt: 'Correct backend UI contracts',
        workspaceFiles: broken, repairPaths: broken.map(file => file.path), request, onFileCompleted: completed});
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls[1][0].prompt).toContain(broken[0].path + ': window.createBackendReq');
    expect(request.mock.calls[3][0].prompt).toContain(broken[1].path + ': window.createBackendReq');
    expect(completed.mock.calls).toEqual(broken.map(file => [file.path]));
    expect(result).toContain(fixed[0].content);
    expect(result).toContain(fixed[1].content);
});

test.each(['wrong', 'UI_MESSAGE'])('validates backend calls after interpolation inside an IIFE: %s', channel => {
    const content = 'export const script = `(() => { const root = document.querySelector("${PLUGIN_KEY}"); window.createBackendReq("' + channel + '", {handler: "run", content: {}}); })();`;';
    const errors = validate([{path: '/render.tsx', content}], {partial: true}).errors;
    expect(errors).toHaveLength(channel === 'wrong' ? 1 : 0);
});
test('treats interpolated channel values as unknown', () => {
    const content = 'export const script = `(() => { window.createBackendReq("${channel}", {handler: "run", content: {}}); })();`;';
    expect(validate([{path: '/render.tsx', content}], {partial: true}).errors).toEqual([]);
});
test('does not warn about window accesses serialized for the iframe', () => {
    const content = 'class Plugin extends FDO_SDK { renderOnLoad() { return `(() => { const root = "${PLUGIN_KEY}"; window.__navigate(); })();`; } } export default Plugin; new Plugin();';
    expect(validate([{path: '/index.ts', content}]).warnings).toEqual([]);
});
