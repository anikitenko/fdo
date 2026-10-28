import * as Babel from '@babel/standalone';
import * as sdk from '@anikitenko/fdo-sdk';
import {waitFor} from '@testing-library/react';
import {PLUGIN_ACTION_EXAMPLE} from '../../src/utils/plugins/authoring/pluginActionGuidance';
import {validateGeneratedInteractions} from '../../src/utils/plugins/validation/generatedInteractions';

function actionSource(){
    const js=Babel.transform(PLUGIN_ACTION_EXAMPLE,{filename:'actions.ts',presets:['typescript'],plugins:['transform-modules-commonjs']}).code;
    const exports={};new Function('require','exports',js)(()=>sdk,exports);
    return sdk.resolveRenderOnLoadSource(exports.createViewActions());
}
const mount=source=>new Function('window','document','return '+source)(window,document);
beforeEach(()=>{document.body.innerHTML='<input data-input="value" value="Azure"><button type="button" data-action="run">Run</button><output data-output="result"></output>';});
afterEach(()=>{sdk.disposeRenderOnLoadActions(window,'example.main');document.body.innerHTML='';delete window.createBackendReq;});

test('the action example uses the installed SDK and a real click dispatches a mutation with pending/error cleanup',async()=>{
    expect(validateGeneratedInteractions([{path:'/actions.ts',content:PLUGIN_ACTION_EXAMPLE}])).toEqual([]);
    let resolve;
    window.createBackendReq=jest.fn(()=>new Promise(done=>{resolve=done;}));
    const cleanup=mount(actionSource()),button=document.querySelector('button'),output=document.querySelector('output');
    button.click();button.click();
    expect(window.createBackendReq).toHaveBeenCalledTimes(1);
    expect(window.createBackendReq).toHaveBeenCalledWith('UI_MESSAGE',{handler:'run',content:{value:'Azure'}});
    expect(button.disabled).toBe(true);
    resolve({result:{message:'Saved Azure'}});
    await waitFor(()=>expect(output.textContent).toBe('Saved Azure'));
    expect(button.disabled).toBe(false);expect(button.hasAttribute('aria-busy')).toBe(false);
    window.createBackendReq.mockRejectedValueOnce(new Error('Permission denied'));
    button.click();await waitFor(()=>expect(output.textContent).toBe('Permission denied'));
    expect(button.disabled).toBe(false);
    cleanup();button.click();expect(window.createBackendReq).toHaveBeenCalledTimes(2);
});

test('reinitializing the same SDK lifecycle key replaces listeners rather than duplicating mutations',async()=>{
    window.createBackendReq=jest.fn(async()=>({result:{message:'Saved'}}));
    const source=actionSource();mount(source);mount(source);
    document.querySelector('button').click();
    await waitFor(()=>expect(document.querySelector('output').textContent).toBe('Saved'));
    expect(window.createBackendReq).toHaveBeenCalledTimes(1);
});
