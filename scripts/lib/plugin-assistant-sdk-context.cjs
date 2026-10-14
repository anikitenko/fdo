const fs = require('node:fs');
const path = require('node:path');

// Public installed declarations required by the evaluation's SDK questions.
// index.d.ts re-exports these; providing only that index leaves signatures and
// browser ambient declarations invisible to an isolated, tool-disabled agent.
const EVALUATION_SDK_DECLARATIONS = [
    'index.d.ts', 'PluginRegistry.d.ts', 'FDOInterface.d.ts',
    'types.d.ts', 'ambient/fdo-host.d.ts', 'utils/renderOnLoad.d.ts',
];
function readEvaluationSdkContext(typesRoot) {
    return EVALUATION_SDK_DECLARATIONS.map(file =>
        `SDK declaration: ${file}\n${fs.readFileSync(path.join(typesRoot, file), 'utf8')}\nEND SDK DECLARATION`
    ).join('\n\n');
}
module.exports = {readEvaluationSdkContext, EVALUATION_SDK_DECLARATIONS};
