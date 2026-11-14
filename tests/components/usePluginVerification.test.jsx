import {act, renderHook, waitFor} from '@testing-library/react';
import {usePluginVerification} from '../../src/components/plugin/usePluginVerification';

const verified = label => ({success:true,signer:{label}});
let onChanged, unsubscribe;
beforeEach(() => {
    unsubscribe = jest.fn();
    window.electron.plugin = {
        verifySignature: jest.fn().mockResolvedValue(verified('Original signer')),
        on: {signatureChanged: jest.fn(callback => {onChanged = callback; return unsubscribe;})},
    };
});
test('refreshes only the changed plugin and replaces its old certificate details', async () => {
    const plugin={id:'plugin-a'};
    const {result}=renderHook(()=>usePluginVerification(plugin));
    await waitFor(()=>expect(result.current?.signer.label).toBe('Original signer'));
    act(()=>onChanged('other-plugin'));
    expect(window.electron.plugin.verifySignature).toHaveBeenCalledTimes(1);
    window.electron.plugin.verifySignature.mockResolvedValue(verified('New signer'));
    act(()=>onChanged('plugin-a'));
    expect(result.current).toBeNull();
    await waitFor(()=>expect(result.current?.signer.label).toBe('New signer'));
});
test('a slow earlier verification cannot restore stale certificate details', async () => {
    const completions=[];
    window.electron.plugin.verifySignature.mockImplementation(()=>new Promise(resolve=>completions.push(resolve)));
    const plugin={id:'plugin-a'};
    const {result}=renderHook(()=>usePluginVerification(plugin));
    act(()=>onChanged('plugin-a'));
    await act(async()=>completions[1](verified('New signer')));
    expect(result.current?.signer.label).toBe('New signer');
    await act(async()=>completions[0](verified('Old signer')));
    expect(result.current?.signer.label).toBe('New signer');
});
test('refreshes on focus and reports failure without retaining the previous signer', async () => {
    const plugin={id:'plugin-a'};
    const {result}=renderHook(()=>usePluginVerification(plugin));
    await waitFor(()=>expect(result.current?.success).toBe(true));
    window.electron.plugin.verifySignature.mockRejectedValue(new Error('Certificate unavailable'));
    act(()=>window.dispatchEvent(new Event('focus')));
    await waitFor(()=>expect(result.current).toEqual({success:false,error:'Certificate unavailable'}));
});
test('cleans up listeners and ignores verification results after changing plugins or closing', async () => {
    const pending=[];
    window.electron.plugin.verifySignature.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
    const {result,rerender,unmount}=renderHook(({plugin,enabled})=>usePluginVerification(plugin,enabled),{initialProps:{plugin:{id:'plugin-a'},enabled:true}});
    rerender({plugin:{id:'plugin-b'},enabled:true});
    await act(async()=>pending[0](verified('Plugin A signer')));
    expect(result.current).toBeNull();
    await act(async()=>pending[1](verified('Plugin B signer')));
    expect(result.current?.signer.label).toBe('Plugin B signer');
    rerender({plugin:{id:'plugin-b'},enabled:false});
    expect(result.current).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
    unmount();
});
