import {act} from 'react';
import {renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, jest, test} from '@jest/globals';
import {useLiveUiConnection} from '../../src/components/live-ui/utils/useLiveUiConnection';
import {liveUiWorkspacePayload} from '../../src/utils/plugins/authoring/liveUi/workspaceState';
import virtualFS from '../../src/components/editor/utils/VirtualFS';

jest.mock('../../src/components/editor/utils/VirtualFS', () => ({
    fs: {getRestoreLoading: () => false},
    sandboxName: 'workspace',
    aiCodingBusy: false,
    notifications: {subscribe: jest.fn()},
}));
jest.mock('../../src/utils/plugins/authoring/liveUi/workspaceState', () => ({liveUiWorkspacePayload: jest.fn()}));
jest.mock('../../src/components/live-ui/utils/applyVisualEdit', () => ({applyVisualEdit: jest.fn()}));
jest.mock('../../src/components/live-ui/utils/focusAiSelection', () => ({focusLiveUiAiSelection: jest.fn()}));

/** @type {(callback: () => Promise<void>) => PromiseLike<void>} */
const asyncAct = act;

let liveUi;
beforeEach(() => {
    jest.useFakeTimers();
    virtualFS.aiCodingBusy = false;
    virtualFS.notifications.subscribe.mockImplementation(() => jest.fn());
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
    return {...hook, finishPublish: result => resolve(result), failPublish: () => reject(new Error('Update failed'))};
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

test('closing Live UI ends synchronization quietly and the toolbar can open it again', async () => {
    const hook = await publishingPreview();
    await asyncAct(async () => {hook.finishPublish({status: 'closed'});});
    expect(hook.result.current.error).toBe('');
    liveUiWorkspacePayload.mockReturnValue({workspaceId: 'workspace', files: {'/render.tsx': 'edited again'}});
    await asyncAct(async () => {jest.advanceTimersByTime(2250);});
    expect(liveUi.publish).toHaveBeenCalledTimes(1);
    expect(liveUi.open).toHaveBeenCalledTimes(1);
    await asyncAct(async () => {await hook.result.current.open();});
    expect(liveUi.open).toHaveBeenCalledTimes(2);
    expect(liveUi.open.mock.calls.at(-1)[0]).toMatchObject({files: {'/render.tsx': 'edited again'}});
    hook.unmount();
});

test('an unexpected synchronization failure identifies the preview and the available retry action', async () => {
    const hook = await publishingPreview();
    await asyncAct(async () => {hook.failPublish();});
    expect(hook.result.current.error).toBe('The Live UI preview could not be updated. Select “Live UI editor” to try again.');
    hook.unmount();
});

test('deployment requests open only their owning idle workspace and unsubscribe on unmount', async () => {
    const hook = renderHook(() => useLiveUiConnection());
    const subscription = virtualFS.notifications.subscribe.mock.calls.findIndex(([event]) => event === 'openLiveUiDeployment');
    expect(subscription).toBeGreaterThanOrEqual(0);
    const notify = virtualFS.notifications.subscribe.mock.calls[subscription][1];
    const unsubscribe = virtualFS.notifications.subscribe.mock.results[subscription].value;

    await asyncAct(async () => {notify({workspaceId: 'another-workspace'});});
    expect(liveUi.open).not.toHaveBeenCalled();
    virtualFS.aiCodingBusy = true;
    await asyncAct(async () => {notify({workspaceId: 'workspace'});});
    expect(liveUi.open).not.toHaveBeenCalled();

    virtualFS.aiCodingBusy = false;
    await asyncAct(async () => {notify({workspaceId: 'workspace'});});
    expect(liveUi.open).toHaveBeenCalledTimes(1);
    expect(liveUi.open.mock.calls[0][0]).toMatchObject({workspaceId: 'workspace', focus: 'deployment', focusRequest: expect.any(String)});
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});
