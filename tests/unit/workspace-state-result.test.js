/** @jest-environment node */
import path from 'node:path';
import {repairConcreteStateResult} from '../../src/utils/plugins/validation/workspaceStateResult';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {generateStagedWorkspace} from '../../src/utils/ai/generation/codingWorkspaceGeneration';
const nodeModules = path.join(process.cwd(), 'node_modules');
const file = content => ({path: '/actions.ts', content});
const recorded = `type Result = {success: true; data: string} | {success: false; message: string};
interface State {isLoading: boolean; result: Result | null;}
let state: State = {isLoading: false, result: null};
function showResult(result: Result) {return result;}
export function onError(message: string) {
  state = {...state, isLoading: false, result: {success: false, message}};
  showResult(state.result);
}`;
test('concrete local state satisfies its interface and fixes nullability without casts', () => {
    expect(typecheckPluginWorkspace({'/actions.ts': recorded}, nodeModules).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code: 2345})]));
    const fixed = repairConcreteStateResult(file(recorded));
    expect(fixed.repaired).toBe(true);
    expect(fixed.content).toContain('satisfies typeof state');
    expect(fixed.content).toContain('showResult(nextPluginState.result)');
    expect(fixed.content).not.toContain('result!');
    expect(typecheckPluginWorkspace({'/actions.ts': fixed.content}, nodeModules).diagnostics).toEqual([]);
    expect(repairConcreteStateResult(file(fixed.content)).repaired).toBe(false);
});
test.each([
    recorded.replace('result: {success: false, message}', 'result: null'),
    recorded.replace('showResult(state.result);', 'await work(); showResult(state.result);').replace('export function', 'export async function'),
    recorded.replace('result: {success: false, message}', 'result: {success: false, message}, ...other'),
    recorded.replace('showResult(state.result);', 'showResult(state["result"]);'),
])('preserves ambiguous state updates unchanged', content => {
    expect(repairConcreteStateResult(file(content))).toEqual({content, repaired: false});
});
test('keeps source assertions and accepts the refactor in one file request', async () => {
    const request = jest.fn().mockResolvedValueOnce(JSON.stringify({files: [{path: '/actions.ts', contract: 'Error action'}]}))
        .mockResolvedValueOnce(JSON.stringify(file(recorded)));
    const result = await generateStagedWorkspace({prompt: 'Build error action', request});
    expect(result).toContain('showResult(nextPluginState.result)');
    expect(request).toHaveBeenCalledTimes(2);
});
