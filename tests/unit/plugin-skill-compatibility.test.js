import {pluginSkillCompatibility} from '../../src/utils/plugins/authoring/pluginSkillCompatibility';

const source = '/installed/fdo-sdk.bundle.js';
test('distinguishes supported references, unknown prose APIs and unchecked recommendations', () => {
    class DOMText { createSpanText() {} }
    const report = pluginSkillCompatibility('Use sdk.host.executeCommand().\nUse DOMText.createSpanText().\nKeep modules small.', {DOMText}, source);
    expect(report.hasConflicts).toBe(true);
    expect(report.findings).toEqual(expect.arrayContaining([
        expect.objectContaining({status: 'conflict', reference: 'sdk.host.executeCommand', line: 1, evidence: source, correction: expect.any(String)}),
        expect.objectContaining({status: 'verified', reference: 'DOMText.createSpanText'}),
    ]));
    expect(report.unchecked).toContain('not automatically verified');
});

test('does not execute getters or mistake warnings for recommendations', () => {
    const getter = jest.fn(() => { throw new Error('Never call'); });
    const sdk = Object.defineProperty({}, 'host', {get: getter});
    const report = pluginSkillCompatibility('Use sdk.host.executeCommand().\nNever use sdk.unknown().', sdk, source);
    expect(report.hasConflicts).toBe(false);
    expect(report.findings.map(item => item.status)).toEqual(['unverified', 'unverified']);
    expect(getter).not.toHaveBeenCalled();
});
