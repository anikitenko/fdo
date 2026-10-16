/** @jest-environment jsdom */
import {createRenderOnLoadActionsSource} from '@anikitenko/fdo-sdk';
import {pluginOnLoadInvocation} from '../../src/components/plugin/utils/pluginOnLoadInvocation';
import {createSdkUiViewRuntime} from '../../src/components/plugin/utils/sdkUiViewRuntime';
const initialize = source => new Function(pluginOnLoadInvocation(source));
test('function initializers return cleanup without executing it until disposal', async () => {
    window.__onLoadCalls = [];
    const view = createSdkUiViewRuntime({},()=>document.body);
    await view.runOnLoad(initialize('() => {window.__onLoadCalls.push("setup"); return () => window.__onLoadCalls.push("cleanup");};'));
    expect(window.__onLoadCalls).toEqual(['setup']);
    view.dispose(); expect(window.__onLoadCalls).toEqual(['setup','cleanup']);
});
test('published SDK IIFE keeps bindings active until view disposal', async () => {
    document.body.innerHTML = '<button>Action</button>';
    window.__onLoadCalls = [];
    const source = createRenderOnLoadActionsSource({lifecycleKey:'host-test',handlers:{click:()=>window.__onLoadCalls.push('click')},bindings:[{selector:'button',event:'click',handler:'click'}],setup:()=>{window.__onLoadCalls.push('setup');return ()=>window.__onLoadCalls.push('cleanup');}});
    const view = createSdkUiViewRuntime({},()=>document.body);
    await view.runOnLoad(initialize(source));
    document.querySelector('button').click();
    expect(window.__onLoadCalls).toEqual(['setup','click']);
    view.dispose();document.querySelector('button').click();
    expect(window.__onLoadCalls).toEqual(['setup','click','cleanup']);
});
test('empty callbacks are harmless; malformed multi-expression transport is rejected', () => {
    expect(initialize('')()).toBeUndefined();
    expect(()=>pluginOnLoadInvocation('() => {}; throw new Error("extra")')).toThrow('one function');
});
