const source = 'export class Workbench {\n  private readonly metadata = {name: "Tools"};\n  get metadata() { return this.metadata; }\n}\n';
const corrected = source.replace('private readonly metadata', 'private readonly pluginMetadata').replace('return this.metadata', 'return this.pluginMetadata');
const workspaceFiles = [{path: '/index.ts', content: source},
    {path: '/render.tsx', content: 'export const render = () => "KEEP_EXISTING_RENDER";'},
    {path: '/styles.css', content: '.shell { --sentinel: KEEP_EXISTING_STYLES; }'},
    {path: '/consumer.ts', content: 'import {Workbench} from "./index"; export const workbench = new Workbench();'}];
const prompt = 'EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\nRepair the existing /index.ts. /index.ts:2:20 [8] Duplicate identifier metadata. /index.ts:3:7 [8] Duplicate identifier metadata. Preserve all other workspace files.';
module.exports = {source, corrected, workspaceFiles, prompt,
    replies: [{content: JSON.stringify({path: '/index.ts', lines: corrected.split('\n')})}]};
