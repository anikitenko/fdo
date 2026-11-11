const fs = require('node:fs');
const path = require('node:path');

// Public installed declarations required by the evaluation's SDK questions.
// index.d.ts re-exports these; providing only that index leaves signatures and
// browser ambient declarations invisible to an isolated, tool-disabled agent.
const EVALUATION_SDK_DECLARATIONS = [
    'index.d.ts', 'PluginRegistry.d.ts', 'FDOInterface.d.ts',
    'types.d.ts', 'ambient/fdo-host.d.ts', 'utils/renderOnLoad.d.ts',
];
const OPTIONAL_SDK_DECLARATIONS = ['SharedLogic.d.ts','PluginScope.d.ts','decorators/ErrorHandler.d.ts','decorators/Registration.d.ts'];
function readEvaluationSdkContext(typesRoot) {
    const files = [...EVALUATION_SDK_DECLARATIONS,...OPTIONAL_SDK_DECLARATIONS.filter(file => fs.existsSync(path.join(typesRoot,file)))];
    return files.map(file =>
        `SDK declaration: ${file}\n${fs.readFileSync(path.join(typesRoot, file), 'utf8')}\nEND SDK DECLARATION`
    ).join('\n\n');
}
module.exports = {readEvaluationSdkContext, EVALUATION_SDK_DECLARATIONS, OPTIONAL_SDK_DECLARATIONS};
