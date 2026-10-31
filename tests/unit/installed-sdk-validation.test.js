/** @jest-environment node */
import {createInstalledSdkValidator} from '../../src/utils/sdk/installedSdkValidation';

test('staged generation preserves the support policy and fingerprints the host contract', () => {
    const validate = createInstalledSdkValidator([{path: '/package.json', content: JSON.stringify({fdo: {compatibility: {fdo: '^1'}}})}]);
    expect(validate({path: '/package.json', content: '{}'}).join('\n')).toContain('AI cannot remove fdo.compatibility');
    expect(validate.capabilities.hostTarget.contract.apiVersion).toBe('1.0.0');
    expect(validate.capabilities.hostTarget.compatibility.declared).toBe(true);
});
jest.mock('../../src/utils/plugins/runtime/pluginRuntimeBundle', () => ({
    getHostPluginNodeModulesPath: () => require('node:path').resolve('dist/main/node_modules'),
}));

test('validates against the installed plugin runtime and supplies available exports', () => {
    const validate = createInstalledSdkValidator();
    const errors = validate({path: '/views/library.tsx', content: 'import {registerStyles} from "@anikitenko/fdo-sdk"; registerStyles({});'});
    expect(errors).toEqual([expect.stringContaining('does not provide "registerStyles"')]);
    expect(errors[0]).toContain('Installed runtime exports:');
    expect(errors[0]).toContain('DOM');
    expect(validate({path: '/views/library.tsx', content: 'import {DOM} from "@anikitenko/fdo-sdk"; export const dom = new DOM();'})).toEqual([]);
    expect(validate({path: '/types.ts', content: 'import type {PluginMetadata} from "@anikitenko/fdo-sdk"; export type Metadata = PluginMetadata;'})).toEqual([]);
});

test('checks plugin guide examples against the installed SDK with guide line diagnostics', () => {
    const validate = createInstalledSdkValidator();
    const guide = content => ({path: '/SKILL.md', content});
    expect(validate(guide('# Guide\n\n```ts\nimport {registerStyles} from "@anikitenko/fdo-sdk";\n```')))
        .toEqual([expect.stringContaining('/SKILL.md:4:')]);
    expect(validate(guide('```ts\nimport {DOMText} from "@anikitenko/fdo-sdk";\nconst text = new DOMText(); text.createSpanText({}, "label");\n```')))
        .toEqual([expect.stringContaining('createSpanText(text, options)')]);
    expect(validate(guide('```ts\nexport const = ;\n```')))
        .toEqual([expect.stringContaining('/SKILL.md:2: Invalid code example')]);
    expect(validate(guide('~~~typescript\nimport {DOMText} from "@anikitenko/fdo-sdk";\nnew DOMText().createSpanText("A & B", {});\n~~~'))).toEqual([]);
    expect(validate(guide('# Purpose\nA local tool.\n```json\n{"example": true}\n```'))).toEqual([]);
});

test('unknown SDK references in prose block guide use and have a structured contract report', () => {
    const validate = createInstalledSdkValidator();
    const content = '# Host actions\nUse sdk.host.executeCommand("ls").';
    expect(validate({path: '/SKILL.md', content})).toEqual([expect.stringContaining('Installed SDK does not expose host')]);
    const report = validate.report(content);
    expect(report.hasConflicts).toBe(true);
    expect(report.source).toContain('fdo-sdk');
    expect(report.findings[0]).toMatchObject({reference: 'sdk.host.executeCommand', line: 2, status: 'conflict'});
});

test('capabilities and fingerprint come from the installed SDK, and detect stale guides', () => {
    const validator = createInstalledSdkValidator();
    expect(validator.capabilities.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(validator.capabilities.api).toEqual(expect.arrayContaining([expect.objectContaining({name: 'DOMText', methods: expect.arrayContaining(['createSpanText'])})]));
    expect(validator.capabilities.api.find(item => item.name === 'FDO_SDK').properties)
        .toEqual(expect.arrayContaining([{name: 'secrets', type: 'SecretStore', static: false}, {name: 'ssh', type: 'SSHClient', static: false}]));
    expect(validator.report('# Guide').migrationRequired).toBe(true);
    expect(validator.report(`<!-- fdo-sdk-fingerprint: ${validator.capabilities.fingerprint} -->`).migrationRequired).toBe(false);
    expect(validator.plan([{path: '/view.ts', contract: 'Call sdk.host.executeCommand()'}])[0]).toContain('does not expose host');
});

test('rejects invented methods in plan contracts using installed declarations without invoking export getters', () => {
    const validator = createInstalledSdkValidator();
    expect(validator.plan([{path: '/render.ts', contract: 'Use DOMText.inventedMethod()'}])[0]).toContain('do not expose method');
    expect(validator.plan([{path: '/render.ts', contract: 'Use DOMText.createSpanText()'}])).toEqual([]);
});

test('guide diagnostics distinguish declaration-only imports from nonexistent runtime exports', () => {
    const validate = createInstalledSdkValidator();
    const errors = validate({path: '/SKILL.md', content: '# Guide\n~~~typescript\nimport {FDOInterface, PluginMetadata, style} from "@anikitenko/fdo-sdk";\n~~~'});
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('import type {FDOInterface}');
    expect(errors[1]).toContain('import type {PluginMetadata}');
    expect(errors[2]).toContain('does not provide "style"');
    expect(errors[2]).not.toContain('style is a declaration-only');
    expect(errors.every(error => error.startsWith('/SKILL.md:3:'))).toBe(true);
    expect(errors.join('\n')).not.toContain('/SKILL.md:1: /SKILL.md:');
    expect(validate({path: '/SKILL.md', content: '~~~typescript\nimport type {FDOInterface, PluginMetadata} from "@anikitenko/fdo-sdk";\n~~~'})).toEqual([]);
});
test('invented accessor methods receive installed signatures without being accepted', () => {
    const validate = createInstalledSdkValidator();
    const errors = validate({path: '/SKILL.md', content: '# Guide\nUse DOMButton.create() and DOM.appendChild().'});
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('createButton(label: string, onClick: Function');
    expect(errors[1]).toContain('createElement(tag: string');
    expect(errors.join('\n')).toContain('not automatic substitutes');
});

test('guide file trees and commands are documentation, while SDK examples remain checked', () => {
    const validate = createInstalledSdkValidator();
    const content = ['# Guide', '```', '/src/', '  index.ts', '```',
        '~~~sh', 'npm run build && npm test', '~~~',
        '```text', 'This is not JavaScript.', '```',
        '   ~~~typescript', 'import {registerStyles} from "@anikitenko/fdo-sdk";', '   ~~~~',
        '```', 'import {missingExport} from "@anikitenko/fdo-sdk";', '```'].join('\n');
    const errors = validate({path: '/SKILL.md', content});
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('/SKILL.md:13:');
    expect(errors[0]).toContain('registerStyles');
    expect(errors[1]).toContain('/SKILL.md:16:');
    expect(errors[1]).toContain('missingExport');
});

test('guide syntax diagnostics stay concise and preserve document line numbers', () => {
    const validate = createInstalledSdkValidator();
    const errors = validate({path: '/SKILL.md', content: '# Guide\n\n~~~ts\nexport const = ;\n~~~'});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/SKILL.md:4: Invalid code example');
    expect(errors[0]).not.toContain('Installed runtime exports:');
});

test('non-source fences consume their entire block before finding the next example', () => {
    const validate = createInstalledSdkValidator();
    const content = ['# Guide', '````markdown', '```ts', 'export const = ;', '```', '````',
        '~~~ts', 'export const valid = 1;', '~~~'].join('\n');
    expect(validate({path: '/SKILL.md', content})).toEqual([]);
});
