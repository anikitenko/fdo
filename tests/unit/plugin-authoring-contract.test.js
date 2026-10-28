/** @jest-environment node */
import {workspaceAuthoringContract, validateAiCompatibilityChanges, pluginAuthoringInstructions} from '../../src/utils/sdk/pluginAuthoringContract';
const host = {fdo: '1.4.0', sdk: '1.8.3', api: '1.0.0', features: {pluginDoctorReport: true}};
const pkg = compatibility => JSON.stringify({name: 'tools', ...(compatibility === undefined ? {} : {fdo: {compatibility}})});
const policy = {fdo: '>=1.0.3 <2', sdk: '^1.8.0', api: '^1', features: ['pluginDoctorReport']};

test('missing support declarations are build targets, not verified old-host support', () => {
    const context = workspaceAuthoringContract({'/package.json': pkg()}, host);
    expect(context.compatibility).toMatchObject({declared: false, supportedFdo: '>=1.4.0 <2.0.0'});
    expect(context.compatibility.summary).toContain('does not verify older FDO');
    expect(context.contract).toMatchObject({apiVersion: '1.0.0', contractVersion: '1.0.0', capabilitySchemaVersion: '1.0.0'});
});

test('AI instructions include host facts and the target policy without claiming permission grants', () => {
    const instructions = pluginAuthoringInstructions({'/package.json': pkg(policy)});
    expect(instructions).toContain('host-owned facts; grants no permissions');
    expect(instructions).toContain('>=1.0.3 <2');
    expect(instructions).toContain('Do not remove, widen, or retarget');
    expect(instructions).toContain('not older FDO releases');
});

test.each([
    [undefined, 'remove fdo.compatibility'],
    [{...policy, fdo: '*'}, 'supported fdo range'],
    [{...policy, fdo: '>=1.4.0 <2'}, 'supported fdo range'],
    [{...policy, sdk: '*'}, 'supported sdk range'],
    [{...policy, api: '*'}, 'supported api range'],
    [{...policy, features: []}, 'required feature'],
])('AI cannot silently change a maintainer support policy to %j', (next, message) => {
    expect(validateAiCompatibilityChanges(pkg(policy), pkg(next), host).join('\n')).toContain(message);
});

test('ordinary package edits and semantically equal ranges preserve policy', () => {
    const next = JSON.stringify({name: 'renamed', fdo: {compatibility: {...policy, sdk: '>=1.8.0 <2.0.0-0', api: '>=1.0.0 <2.0.0-0'}}});
    expect(validateAiCompatibilityChanges(pkg(policy), next, host)).toEqual([]);
    expect(validateAiCompatibilityChanges(pkg(), pkg(), host)).toEqual([]);
});

test('a new policy cannot promise older hosts just because current compilation passes', () => {
    expect(validateAiCompatibilityChanges(pkg(), pkg({fdo: '^1'}), host).join('\n')).toContain('AI cannot change');
    expect(validateAiCompatibilityChanges(pkg(), pkg({fdo: '>=1.4.0 <2', sdk: '^1.8.3', api: '^1'}), host)).toEqual([]);
});

test('invalid policies and unavailable features fail closed', () => {
    expect(workspaceAuthoringContract({'/package.json': '{broken'}, host).compatibility.status).toBe('incompatible');
    expect(validateAiCompatibilityChanges(pkg(), pkg({fdo: '^1', features: ['unknown']}), host).join('\n')).toContain('unavailable');
});
