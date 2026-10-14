import monaco from 'monaco-editor';
import virtualFS from '../../../src/components/editor/utils/VirtualFS';
import {createVirtualFile} from '../../../src/components/editor/utils/createVirtualFile';
import build from '../../../src/components/editor/utils/build';

beforeEach(()=>{
    jest.useFakeTimers();virtualFS.resetWorkspaceState();
    createVirtualFile('/package.json',JSON.stringify({source:'index.ts',main:'index.ts'}));
    createVirtualFile('/index.ts','export const original = 42;');
    createVirtualFile('/helper.ts','export const helper = true;');
    window.electron.plugin.build=jest.fn(async()=>({success:true,files:{outputFiles:[{text:'module.exports = { original: 42 };'}]}}));
    window.electron.notifications={add:jest.fn()};
});
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});
test('repeated compilation retains source/models while updating only the runtime artifact',async()=>{
    const before=virtualFS.getLatestContent();const model=monaco.editor.getModel(monaco.Uri.file('/index.ts'));
    for(let count=0;count<2;count++){
        expect((await build()).success).toBe(true);
        expect(virtualFS.getLatestContent()).toEqual(before);
        expect(model.getValue()).toBe('export const original = 42;');
        expect(virtualFS.build.getEntrypoint()).toBe('dist/index.cjs');
        expect(virtualFS.build.getContent()).toContain('module.exports');
        expect(window.electron.plugin.build.mock.calls[count][0].latestContent['/index.ts']).toBe(before['/index.ts']);
    }
});
