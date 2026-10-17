import Store from 'electron-store';
import '../../src/utils/persistence/store';
import Ajv from 'ajv';
import {assistantInputCapabilities} from '../../src/utils/ai/assistant/aiAssistantInputCapabilities';

jest.mock('electron-store', () => jest.fn());

const schema = Store.mock.calls.find(([options]) => options.name === 'settings')[0].schema.ai.properties.coding.items;
const ajv = new Ajv({strict: false});
ajv.addFormat('date-time', value => !Number.isNaN(Date.parse(value)));
const validate = ajv.compile(schema);
const assistant = {name: 'Coding', provider: 'openrouter', model: 'test-model', apiKey: 'test-key'};
test('the Settings schema persists Codex skills and rejects unimplemented executable extensions', () => {
    const validateSkills = ajv.compile(Store.mock.calls.find(([options]) => options.name === 'settings')[0].schema.ai.properties.codexSkills);
    const skill = {id: 'skill', name: 'team-review', description: 'Review', content: 'Instructions', enabled: true, assistantIds: ['one', 'two']};
    expect(validateSkills([skill])).toBe(true);
    expect(validateSkills([{...skill, hooks: ['run-command']}])).toBe(false);
});

test.each(['supported', 'unsupported', 'unknown'])('persists discovered image support %s using the actual Settings schema', imageSupport => {
    const inputCapabilities = {...assistantInputCapabilities(assistant, {}), imageSupport, checkedAt: '2026-10-12T12:00:00.000Z'};
    expect(validate({...assistant, inputCapabilities})).toBe(true);
});

test('accepts CLI integration limits and discovery fallbacks without a timestamp', () => {
    const cli = {...assistant, provider: 'codex-cli'};
    expect(validate({...cli, inputCapabilities: assistantInputCapabilities(cli)})).toBe(true);
    expect(validate({...assistant, inputCapabilities: assistantInputCapabilities(assistant)})).toBe(true);
    expect(validate(assistant)).toBe(true);
});

test('continues rejecting arbitrary assistant fields and invalid capability records', () => {
    expect(validate({...assistant, unexpectedField: true})).toBe(false);
    expect(validate({...assistant, inputCapabilities: {...assistantInputCapabilities(assistant), imageSupport: 'maybe'}})).toBe(false);
    expect(validate({...assistant, inputCapabilities: {...assistantInputCapabilities(assistant), unexpectedField: true}})).toBe(false);
});

test('persists remote MCP configuration under the actual strict settings schema', () => {
    const validateMcp = ajv.compile(Store.mock.calls.find(([options]) => options.name === 'settings')[0].schema.ai.properties.codexMcpServers);
    const server = {id: 'one', name: 'Docs', url: 'https://docs.example.com/mcp', bearerToken: '', enabled: false, assistantIds: [], enabledTools: [], tools: [{name: 'search', description: 'Search'}], checkedAt: '2026-10-13T00:00:00.000Z'};
    expect(validateMcp([server])).toBe(true);
    expect(validateMcp([{...server, unknownSetting: 'npx'}])).toBe(false);
});

test('persists command hooks in their own strict settings namespace',()=>{
    const validateHooks=ajv.compile(Store.mock.calls.find(([options])=>options.name==='settings')[0].schema.ai.properties.codexHooks);
    const hook={id:'test',name:'Team context',event:'UserPromptSubmit',toolPattern:'',command:'node',args:['hook.js'],cwd:'',environment:{TEAM:'test'},timeoutSeconds:10,enabled:false,assistantIds:[]};
    expect(validateHooks([hook])).toBe(true);
    expect(validateHooks([{...hook,event:'Unknown'}])).toBe(false);
    expect(validateHooks([{...hook,allowAllCommands:true}])).toBe(false);
});

test('Cursor API assistants persist with integration capabilities and no CLI metadata', () => {
    const cursor = {name: 'Cursor coding', provider: 'cursor', model: 'composer-fixture', apiKey: 'fixture', firstResponseTimeoutMs: 300000};
    expect(validate({...cursor, inputCapabilities: assistantInputCapabilities(cursor)})).toBe(true);
});

test('contains only active configuration, without JSON history fields', () => {
    const schema = Store.mock.calls.find(([options]) => options.name === 'settings')[0].schema;
    expect(schema.notifications).toBeUndefined();
    expect(schema.certificates).toBeUndefined();
    expect(schema.ai.properties.sessions).toBeUndefined();
    expect(schema.ai.default.sessions).toBeUndefined();
    // Assistant and integration configuration remain; historical data does not.
    expect(schema.ai.properties.coding).toBeDefined();
    expect(schema.ai.properties.usageLedger).toBeUndefined();
    expect(schema.ai.properties.metrics).toBeUndefined();
    expect(schema.ai.properties.observability.properties.langfuse.properties.encryptedSecretKey).toBeDefined();
    expect(schema.ai.properties.observability.properties.langfuse.properties.secretKey).toBeUndefined();
});
