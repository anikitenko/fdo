// Main-process dependency inversion: validators and AI prompts can read the
// current catalogue without importing Electron's full plugin process manager.
let provider = () => [];
export function configureSharedLogicAuthoringCatalog(next) { provider = next; }
export function getSharedLogicAuthoringCatalog() { return provider(); }
