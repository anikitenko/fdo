import {resolveMonacoTypeScriptApi} from "../../src/components/editor/utils/monacoTypeScriptApi";
import {buildWorkspaceMonacoCompilerOptions} from "../../src/components/editor/utils/workspaceMonacoCompilerOptions";

test.each([
    api => ({typescript: api}),
    api => ({languages: {typescript: api}}),
    api => ({default: {typescript: api}}),
    api => ({default: {languages: {typescript: api}}}),
])("resolves supported Monaco exports for compiler configuration and declaration loading", wrap => {
    const api = {typescriptDefaults: {addExtraLib: jest.fn()},
        ModuleResolutionKind: {NodeJs: 2}, ModuleKind: {ESNext: 99}};
    const resolved = resolveMonacoTypeScriptApi(wrap(api));
    expect(resolved).toBe(api);
    expect(buildWorkspaceMonacoCompilerOptions(resolved).moduleResolution).toBe(2);
    expect(resolved.typescriptDefaults.addExtraLib).toBe(api.typescriptDefaults.addExtraLib);
});
