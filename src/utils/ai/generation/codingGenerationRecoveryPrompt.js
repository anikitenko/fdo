export function smallerScopeGenerationPrompt(originalPrompt, path) {
    const failedModule = typeof path === 'string' && path.startsWith('/') ? path : 'a workspace module';
    return `${originalPrompt.trim()}\n\nSmaller-scope generation request:\nStart a new generation attempt from the current workspace. The previous attempt could not complete ${failedModule}; its generated files were not applied. Do not treat the previous partial response as existing files.\nDeliver a compact first version of the core user workflow. Keep styling concise and organize code into focused modules. Defer optional enhancements and explain what is deferred. Preserve required security and SDK contracts. Return a complete, working set of files for this smaller scope.`;
}
