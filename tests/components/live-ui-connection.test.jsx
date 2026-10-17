import {act} from 'react';
import {renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, jest, test} from '@jest/globals';
import {useLiveUiConnection} from '../../src/components/live-ui/utils/useLiveUiConnection';
import {liveUiWorkspacePayload} from '../../src/utils/plugins/authoring/liveUi/workspaceState';

jest.mock('../../src/components/editor/utils/VirtualFS', () => ({
    fs: {getRestoreLoading: () => false},
}));
jest.mock('../../src/utils/plugins/authoring/liveUi/workspaceState', () => ({liveUiWorkspacePayload: jest.fn()}));
jest.mock('../../src/components/live-ui/utils/applyVisualEdit', () => ({applyVisualEdit: jest.fn()}));
jest.mock('../../src/components/live-ui/utils/focusAiSelection', () => ({focusLiveUiAiSelection: jest.fn()}));

/** @type {(callback: () => Promise<void>) => PromiseLike<void>} */
const asyncAct = act;

let liveUi;
beforeEach(() => {
    jest.useFakeTimers();
    liveUiWorkspacePayload.mockReturnValue({workspaceId: 'workspace', files: {'/render.tsx': 'original'}});
    liveUi = {
        open: jest.fn(async () => ({sessionId: 'preview'})),
        publish: jest.fn(),
    };
    window.electron = {...window.electron, liveUi};
});
afterEach(() => {jest.useRealTimers(); jest.clearAllMocks();});

async function publishingPreview() {
    const hook = renderHook(() => useLiveUiConnection());
    await asyncAct(async () => {await hook.result.current.open();});
    let resolve, reject;
    liveUi.publish.mockImplementation(() => new Promise((done, fail) => {resolve = done; reject = fail;}));
    liveUiWorkspacePayload.mockReturnValue({workspaceId: 'workspace', files: {'/render.tsx': 'edited'}});
    act(() => {jest.advanceTimersByTime(750);});
    expect(liveUi.publish).toHaveBeenCalledTimes(1);
    return {...hook, finishPublish: () => resolve(), failPublish: () => reject(new Error('Live UI closed'))};
}

test('an explicit reopen waits for an in-flight publish instead of losing the click', async () => {
    const hook = await publishingPreview();
    let reopening;
    act(() => {reopening = hook.result.current.open();});
    expect(hook.result.current.opening).toBe(true);
    expect(liveUi.open).toHaveBeenCalledTimes(1);
    // Further timer ticks and clicks must not create competing open requests.
    act(() => {jest.advanceTimersByTime(1500); void hook.result.current.open();});
    await asyncAct(async () => {hook.finishPublish(); await reopening;});
    expect(liveUi.open).toHaveBeenCalledTimes(2);
    expect(liveUi.open.mock.calls.at(-1)?.[0]).toMatchObject({files: {'/render.tsx': 'edited'}});
    expect(hook.result.current.opening).toBe(false);
    hook.unmount();
});

test('reopens after publishing to the closed preview fails and clears its stale error', async () => {
    const hook = await publishingPreview();
    let reopening;
    act(() => {reopening = hook.result.current.open();});
    await asyncAct(async () => {hook.failPublish(); await reopening;});
    expect(liveUi.open).toHaveBeenCalledTimes(2);
    expect(hook.result.current.error).toBe('');
    hook.unmount();
});

test('does not reopen a preview after its IDE unmounts while synchronization is pending', async () => {
    const hook = await publishingPreview();
    let reopening;
    act(() => {reopening = hook.result.current.open();});
    hook.unmount();
    await asyncAct(async () => {hook.finishPublish(); await reopening;});
    expect(liveUi.open).toHaveBeenCalledTimes(1);
});
