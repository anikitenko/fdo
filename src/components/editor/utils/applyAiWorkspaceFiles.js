// Keep source writes synchronous: a failed file must not leave earlier files
// from the same response applied. Scope checks prevent rollback into a newly
// selected workspace. A rollback failure is reported, never called success.
export function applyAiWorkspaceFiles({files, existingFiles, write, remove, assertScope}) {
    const previous = new Map(existingFiles.map(file => [file.path, file.content]));
    const touched = [];
    try {
        assertScope();
        for (const file of files) {
            assertScope();
            touched.push(file.path);
            write(file.path, file.content);
        }
    } catch (cause) {
        const rollbackErrors = [];
        try { assertScope(); }
        catch { throw new Error('Workspace changed during application. Rollback was not attempted in the newly selected workspace.', {cause}); }
        for (const path of touched.reverse()) {
            try {
                assertScope();
                if (previous.has(path)) write(path, previous.get(path));
                else remove(path);
            } catch (error) { rollbackErrors.push(`${path}: ${error.message}`); }
        }
        throw new Error(rollbackErrors.length
            ? `AI file application failed (${cause.message}); rollback also failed: ${rollbackErrors.join('; ')}. Restore the pre-apply snapshot before continuing.`
            : `AI file application failed (${cause.message}). Original file contents were restored.`, {cause});
    }
    return files.length;
}
