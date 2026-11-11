/** @jest-environment node */
import path from 'node:path';
import {sharedLogicDeclarations,sharedLogicAuthoringInstructions} from '../../src/utils/sdk/sharedLogicAuthoring';
import {configureSharedLogicAuthoringCatalog} from '../../src/utils/sdk/sharedLogicAuthoringCatalog';
import {typecheckPluginWorkspace} from '../../src/utils/sdk/pluginWorkspaceTypecheck';
import {installSharedLogicMonaco} from '../../src/components/editor/utils/sharedLogicMonaco';

const service = {providerId:'website-provider',name:'website-availability',version:1,description:'Website check',available:true,methods:['check'],contract:{
    check:{input:{type:'object',properties:{url:{type:'string'}},required:['url']},
        output:{type:'object',properties:{available:{type:'boolean'},status:{type:'integer'}},required:['available','status']}},
}};
afterEach(() => {configureSharedLogicAuthoringCatalog(() => []);jest.useRealTimers();});

test('generated declarations give real TypeScript errors for wrong methods, arguments and results', () => {
    configureSharedLogicAuthoringCatalog(() => [service]);
    const result = typecheckPluginWorkspace({'/index.ts': `
        import {SharedLogic,FDO_SDK} from '@anikitenko/fdo-sdk';
        declare const shared: SharedLogic;
        declare const sdk: FDO_SDK;
        const client = shared.client({providerId:'website-provider',name:'website-availability',version:1});
        const good: Promise<{available:boolean;status:number}> = client.call('check',{url:'https://example.com'});
        const direct: Promise<{available:boolean;status:number}> = shared.call({providerId:'website-provider',name:'website-availability',version:1},'check',{url:'https://example.com'});
        const viaSdk: Promise<{available:boolean;status:number}> = sdk.shared.client({providerId:'website-provider',name:'website-availability',version:1}).call('check',{url:'https://example.com'});
        // @ts-expect-error SDK instance results remain strongly typed
        const wrongSdk: Promise<string> = sdk.shared.client({providerId:'website-provider',name:'website-availability',version:1}).call('check',{url:'https://example.com'});
        // @ts-expect-error unknown method
        client.call('erase', {url:'https://example.com'});
        // @ts-expect-error URL is a string
        client.call('check',{url:123});
        // @ts-expect-error result is an object
        const wrong: Promise<string> = client.call('check',{url:'https://example.com'});
        export {good,direct,viaSdk};
    `},path.resolve('node_modules'));
    expect(result.diagnostics).toEqual([]);
});

test('unknown contracts do not invent fields and malformed provider schemas never become editor code', () => {
    const declarations = sharedLogicDeclarations([{...service,contract:undefined}]);
    expect(declarations).toContain('"check":(input:unknown)=>unknown');
    expect(sharedLogicDeclarations([{...service,contract:{check:{input:{type:'string;export const hacked:any'},output:{type:'string'}}}}])).not.toContain('hacked');
    const prompt = sharedLogicAuthoringInstructions([{...service,available:false,privateKey:'never include'}]);
    expect(prompt).toContain('"available":false');
    expect(prompt).toContain('plugins.shared.call.website-provider.website-availability.v1');
    expect(prompt).toContain('Manage Plugins');
    expect(prompt).not.toContain('never include');
});

test('Monaco refresh replaces generated libs, updates completions and disposes timers and registrations', async () => {
    jest.useFakeTimers();
    const libraries = [];
    const defaults = {addExtraLib:jest.fn(() => {const item={dispose:jest.fn()};libraries.push(item);return item;})};
    const registrations=[];
    const providers=[];
    const monaco={typescript:{typescriptDefaults:defaults,javascriptDefaults:defaults},languages:{registerCompletionItemProvider:jest.fn((_language,provider) => {
        providers.push(provider);const registration={dispose:jest.fn()};registrations.push(registration);return registration;
    }),CompletionItemKind:{Method:1}}};
    const fetch=jest.fn(async()=>({success:true,services:[service]}));
    const support=installSharedLogicMonaco(monaco,fetch);
    await Promise.resolve();await Promise.resolve();
    expect(defaults.addExtraLib).toHaveBeenCalledTimes(2);
    const model={getLineContent:()=> 'this.shared.',getWordUntilPosition:()=>({startColumn:13,endColumn:13})};
    expect(providers[0].provideCompletionItems(model,{lineNumber:1,column:13}).suggestions[0].insertText).toContain('client(');
    const method = providers[0].provideCompletionItems(model,{lineNumber:1,column:13}).suggestions.find(item => item.label.startsWith('check —'));
    expect(method.insertText).toContain('.call("check", {"url": "${1:}"})$0');
    expect(method.detail).toContain('status');
    fetch.mockResolvedValue({success:true,services:[{...service,available:false,contract:undefined}]});
    await support.refresh();
    const unknown = providers[0].provideCompletionItems(model,{lineNumber:1,column:13}).suggestions.find(item => item.label.startsWith('check —'));
    expect(unknown.detail).toContain('Unavailable');
    expect(unknown.insertText).toContain('.call("check", ${1:input})$0');
    fetch.mockResolvedValue({success:true,services:[]});
    await support.refresh();
    expect(libraries[0].dispose).toHaveBeenCalled();
    support.dispose();
    expect(registrations.every(item => item.dispose.mock.calls.length === 1)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
});

test('generated types are installed when the TypeScript contribution becomes available after mount', async () => {
    jest.useFakeTimers();
    const monaco={languages:{registerCompletionItemProvider:jest.fn(() => ({dispose:jest.fn()}))}};
    const support=installSharedLogicMonaco(monaco,async()=>({success:true,services:[service]}));
    await Promise.resolve();await Promise.resolve();
    const defaults={addExtraLib:jest.fn(() => ({dispose:jest.fn()}))};
    monaco.typescript={typescriptDefaults:defaults,javascriptDefaults:defaults};
    await support.refresh();
    expect(defaults.addExtraLib).toHaveBeenCalledTimes(2);
    support.dispose();
    expect(jest.getTimerCount()).toBe(0);
});
