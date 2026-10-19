const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const invalidManifest = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../fixtures/ai/workspace-manifest-unescaped-quotes.txt'), 'utf8');
const missingContractKey = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../fixtures/ai/workspace-manifest-missing-contract-key.txt'), 'utf8');
const oversizedManifest = JSON.stringify(require('../fixtures/ai/workspace-manifest-oversized-contract.json'));
const flattenedEntry = require('../fixtures/ai/workspace-file-flattened-entry.json');
const missingCommaSource = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../fixtures/ai/workspace-render-missing-comma.ts'), 'utf8');

test('native initial inventory retains composition and tests alongside twelve feature modules', async () => {
    const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
        env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: 'auto'}});
    try {
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => {
            try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
        })).toBe(true);
        await app.evaluate(() => {
            globalThis.__coverageRequests = [];
            const paths = ['text', 'json', 'data', 'seo', 'images', 'social'].flatMap(feature =>
                [`/features/${feature}/logic.ts`, `/features/${feature}/render.ts`]);
            paths.push('/styles.css', '/render.tsx', '/index.ts', '/render.test.ts');
            globalThis.fetch = async (url, init = {}) => {
                const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                    result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                if (String(url).startsWith(`${base}models/schema?`)) return Response.json({success: true,
                    result: {input: {properties: {image_url: {type: 'string'}}}}});
                if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                const body = JSON.parse(init.body);
                globalThis.__coverageRequests.push(body);
                const path = body.response_format?.json_schema?.properties.path?.enum[0] || JSON.stringify(body.messages).match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
                const content = path ? {path, lines: [path.endsWith('.css') ? '.shell { color: red; }' : 'export {};']}
                    : {files: paths.map(path => ({path, contract: 'Implement requested module',
                        visualReference: !path.endsWith('/logic.ts') && !path.endsWith('.test.ts')}))};
                if (body.stream) return new Response(`data: ${JSON.stringify({response: JSON.stringify(content)})}\n\ndata: ${JSON.stringify({response: '', finish_reason: 'stop', usage: {prompt_tokens: 100, completion_tokens: 20}})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
                return Response.json({result: {choices: [{message: {content: JSON.stringify(content)}, finish_reason: 'stop'}],
                    usage: {prompt_tokens: 100, completion_tokens: 20}}});
            };
        });
        const result = await page.evaluate(async () => {
            await window.electron.settings.ai.addAssistant({name: 'Complete inventory', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Complete inventory');
            return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'complete-inventory', assistantId: assistant.id,
                prompt: 'Build twelve feature modules plus plugin composition, styles and tests.', workspaceFiles: [],
                image: 'data:image/png;base64,iVBORw0KGgo='}));
        });
        expect(result.success, result.error).toBe(true);
        expect(result.content.match(/### File:/g)).toHaveLength(16);
        for (const path of ['/index.ts', '/render.tsx', '/styles.css', '/render.test.ts']) expect(result.content).toContain(`### File: ${path}`);
        const requests = await app.evaluate(() => globalThis.__coverageRequests);
        expect(requests).toHaveLength(17);
        // The initial inventory reserves twelve of the 36 slots for split recovery.
        expect(requests[0].response_format.json_schema.properties.files.maxItems).toBe(24);
        expect(Array.isArray(requests[0].messages.at(-1).content)).toBe(true);
        for (const request of requests.slice(1)) {
            const path = JSON.stringify(request.messages).match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
            const needsImage = !path.endsWith('/logic.ts') && !path.endsWith('.test.ts');
            expect(Array.isArray(request.messages.at(-1).content)).toBe(needsImage);
        }
        expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(17);
    } finally { await closeElectronApp(app); }
});

test('repairs workspace imports through native IPC without regenerating retained files', async () => {
    const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
        env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '4'}});
    try {
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => {
            try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
        })).toBe(true);
        await app.evaluate(() => {
            globalThis.__importRequests = [];
            globalThis.fetch = async (url, init = {}) => {
                const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                    result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                const body = JSON.parse(init.body);
                globalThis.__importRequests.push(body);
                const responses = [
                    {files: [{path: '/logic.ts', contract: 'Export run'}, {path: '/render.tsx', contract: 'Export render'}]},
                    {path: '/logic.ts', lines: ['export const run = () => "ok";']},
                    {path: '/render.tsx', lines: ['import {render} from "./render"; import {missing} from "./logic"; import "./missing.css";']},
                    {path: '/render.tsx', lines: ['import {run} from "./logic"; import {title} from "./existing"; export const render = () => title + run();']},
                ];
                if (!responses[globalThis.__importRequests.length - 1]) throw new Error('Unexpected extra generation');
                if (body.stream) return new Response(`data: ${JSON.stringify({response: JSON.stringify(responses[globalThis.__importRequests.length - 1])})}\n\ndata: ${JSON.stringify({response: '', finish_reason: 'stop', usage: {prompt_tokens: 100, completion_tokens: 20}})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
                return Response.json({result: {choices: [{message: {content: JSON.stringify(responses[globalThis.__importRequests.length - 1])},
                    finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20}}});
            };
        });
        const result = await page.evaluate(async () => {
            await window.electron.settings.ai.addAssistant({name: 'Import recovery', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Import recovery');
            return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'import-recovery', assistantId: assistant.id,
                prompt: 'Repair plugin rendering, retaining existing modules.',
                workspaceFiles: [{path: '/existing.ts', content: 'export const title = "Existing";'}]}));
        });
        expect(result.success, result.error).toBe(true);
        expect(result.content.match(/### File:/g)).toHaveLength(2);
        expect(result.content).not.toContain('### File: /existing.ts');
        const requests = await app.evaluate(() => globalThis.__importRequests);
        expect(requests).toHaveLength(4);
        const repair = requests[3].messages.at(-1).content;
        expect(repair).toContain('resolves to this same file');
        expect(repair).toContain('does not export missing');
        expect(repair).toContain('has no file in the workspace or approved plan');
        expect(repair).toContain('export const title = "Existing";');
        expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(4);
    } finally { await closeElectronApp(app); }
});

test('replays each workspace step\'s transient failure independently', async () => {
    const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
        env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: '6'}});
    try {
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => {
            try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
        })).toBe(true);
        await app.evaluate(() => {
            globalThis.__stepRequests = [];
            const attempts = {};
            globalThis.fetch = async (url, init = {}) => {
                const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                    result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                const body = JSON.parse(init.body);
                const plan = body.response_format?.json_schema?.properties?.files;
                const path = plan ? null : JSON.stringify(body.messages).match(/Generate ONLY (\/[^\s]+)\. Its contract:/)?.[1];
                globalThis.__stepRequests.push({t: Date.now(), path: path || 'plan', maxTokens: body.max_tokens});
                // Every file step fails its FIRST attempt with a transient 503
                // and succeeds when replayed. A single allowance shared across
                // the transaction would let the first step's replay consume it,
                // so the second step's identical 503 would end the run; each
                // atomic step must carry its own replay.
                if (path) {
                    attempts[path] = (attempts[path] || 0) + 1;
                    if (attempts[path] === 1) return Response.json({success: false,
                        errors: [{code: 5000, message: 'Temporarily unavailable'}]}, {status: 503});
                }
                const content = plan
                    ? {files: [{path: '/logic.ts', contract: 'Export run'}, {path: '/render.tsx', contract: 'Export render'}]}
                    : path === '/logic.ts'
                        ? {path, lines: ['export const run = () => "ok";']}
                        : {path, lines: ['import {run} from "./logic";', 'export const render = () => run();']};
                if (body.stream) return new Response(`data: ${JSON.stringify({response: JSON.stringify(content)})}\n\ndata: ${JSON.stringify({response: '', finish_reason: 'stop', usage: {prompt_tokens: 100, completion_tokens: 20}})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
                return Response.json({result: {choices: [{message: {content: JSON.stringify(content)},
                    finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20}}});
            };
        });
        const result = await page.evaluate(async () => {
            await window.electron.settings.ai.addAssistant({name: 'Step retries', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Step retries');
            window.electron.aiCodingAgent.on.streamError(event => { globalThis.__stepErrors = globalThis.__stepErrors || []; globalThis.__stepErrors.push(event); });
            return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'step-retries', assistantId: assistant.id,
                prompt: 'Build a two-module plugin with a transient fault per file.'}));
        });
        const rendererErrors = await page.evaluate(() => globalThis.__stepErrors || []);
        const mainRequests = await app.evaluate(() => (globalThis.__stepRequests || []).map((request, index, all) => ({
            ...request, gapMs: index ? request.t - all[index - 1].t : 0,
        })));
        expect(result.success, `${result.error}\nstep state: ${JSON.stringify({requests: mainRequests, errors: rendererErrors})}`)
            .toBe(true);
        const requests = mainRequests.map(request => request.maxTokens);
        // plan, file A (503), file A replay, file B (503), file B replay.
        expect(requests).toHaveLength(5);
        expect(mainRequests.slice(1).map(request => request.path))
            .toEqual(['/logic.ts', '/logic.ts', '/render.tsx', '/render.tsx']);
        expect(rendererErrors).toEqual([]);
        expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(5);
    } finally { await closeElectronApp(app); }
});

for (const scenario of ['complete', 'incomplete final file', 'invalid plan recovery', 'missing contract key recovery', 'invalid plan twice', 'oversized contract recovery', 'truncated plan recovery', 'truncated plan twice', 'budget insufficient', 'budget exact', 'budget adaptive', 'budget retry exhausted']) {
    const incomplete = scenario === 'incomplete final file';
    const truncated = scenario.startsWith('truncated plan');
    const invalidCount = ['invalid plan twice', 'truncated plan twice'].includes(scenario) ? 2 : ['invalid plan recovery', 'missing contract key recovery', 'oversized contract recovery', 'truncated plan recovery'].includes(scenario) ? 1 : 0;
    const budgeted = scenario.startsWith('budget');
    const budgetFailure = budgeted && !['budget exact', 'budget adaptive'].includes(scenario);
    const retryExhausted = scenario === 'budget retry exhausted';
    const success = !incomplete && invalidCount !== 2 && !budgetFailure;
    test(`Cloudflare workspace transaction: ${scenario}`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true, env: {FDO_E2E_LIVE_AI: budgeted ? '1' : '0', FDO_TEST_AI_MAX_REQUESTS: scenario === 'budget adaptive' ? 'auto' : scenario === 'budget insufficient' ? '2' : '3'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_electron, {incomplete, invalidCount, invalidManifest, truncated, retryExhausted}) => {
                globalThis.__stageRequests = [];
                globalThis.fetch = async (url, init = {}) => {
                    const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                    const body = JSON.parse(init.body);
                    globalThis.__stageRequests.push(body);
                    const stage = globalThis.__stageRequests.length - invalidCount;
                    if (retryExhausted && stage === 2) return Response.json({success: false, errors: [{code: 5000, message: 'Temporarily unavailable'}]}, {status: 503});
                    const text = stage <= 0 ? invalidManifest : stage === 1 ? JSON.stringify({files: [
                        {path: '/render.ts', contract: 'Export render()'}, {path: '/index.ts', contract: 'Import render()'},
                    ]}) : stage === 2 ? JSON.stringify({path: '/render.ts', lines: ['export const render = () => "Hello";']})
                        : JSON.stringify({path: '/index.ts', lines: ['import {render} from "./render";']});
                    if (body.response_format) return Response.json({result: {choices: [{message: {content: text},
                        finish_reason: incomplete && stage >= 3 ? null : truncated && stage <= 0 ? 'length' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20}}});
                    const events = [{choices: [{delta: {content: text}, finish_reason: null}]}];
                    if (!(incomplete && stage >= 3)) events.push({choices: [{delta: {}, finish_reason: truncated && stage <= 0 ? 'length' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20}});
                    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
                        {headers: {'content-type': 'text/event-stream'}});
                };
            }, {incomplete, invalidCount, truncated, retryExhausted, invalidManifest: scenario === 'oversized contract recovery' ? oversizedManifest : scenario === 'missing contract key recovery' ? missingContractKey : invalidManifest});
            const result = await page.evaluate(async () => {
                await window.electron.settings.ai.addAssistant({name: 'Staged workspace', provider: 'cloudflare', purpose: 'coding',
                    model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Staged workspace');
                const done = [], stages = [], errors = [];
                window.electron.aiCodingAgent.on.streamDone(event => done.push(event));
                window.electron.aiCodingAgent.on.streamError(event => errors.push(event));
                window.electron.aiCodingAgent.on.streamDelta(event => { if (event.type === 'stage') stages.push(event); });
                const response = await window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'stage-test', assistantId: assistant.id, prompt: 'Implement a greeting plugin.'}));
                window.__stageResult = {response, done, stages, errors};
                return response;
            });
            const requests = await app.evaluate(() => globalThis.__stageRequests);
            if (scenario === 'budget adaptive') {
                const budget = await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__);
                expect(budget).toMatchObject({mode: 'adaptive', used: 3, allocated: 3, baseCeiling: 50, ceiling: 52, validatedFiles: 2});
                expect(budget.deadline).toBeGreaterThan(budget.startedAt);
            }
            // A truncated plan's corrective retry is the one request allowed a
            // larger ceiling: repeating the budget that just cut the answer off
            // cannot produce a fitting plan. Non-limited retries (invalid JSON
            // or schema shape) keep the 2048-token plan budget.
            expect(requests.map(request => request.max_tokens)).toEqual(budgetFailure ? retryExhausted ? [2048, 6144] : [2048] : invalidCount === 2 ? (truncated ? [2048, 4096] : [2048, 2048])
                : [...Array(invalidCount).fill(2048), truncated ? 4096 : 2048, 6144, 6144, ...(incomplete ? [6144] : [])]);
            for (const request of requests) {
                // Classify by schema shape, not token budget: the escalated
                // plan retry no longer shares the 2048 value with first plans.
                const planning = request.response_format?.json_schema?.properties?.files !== undefined;
                expect(request.stream).toBe(!planning);
                if (planning) {
                    expect(request.response_format.type).toBe('json_schema');
                    expect(request.response_format.json_schema.properties.files.items.required).toEqual(['path', 'contract']);
                    expect(request.stream_options).toBeUndefined();
                } else {
                    expect(request.response_format).toBeUndefined();
                    expect(request.messages.at(-1).content).toContain('Generate ONLY');
                }
            }
            expect(requests.every(request => request.chat_template_kwargs.enable_thinking === false)).toBe(true);
            if (invalidCount !== 2 && !budgetFailure) expect(requests.at(-1).messages.at(-1).content).toContain('export const render = () => "Hello";');
            if (invalidCount) expect(requests[1].messages.at(-1).content).toContain('FILE PLAN VALIDATION RETRY');
            if (scenario === 'oversized contract recovery') expect(requests[1].messages.at(-1).content).toContain('has 787 characters; maximum is 240');
            expect(result.success).toBe(success);
            if (budgetFailure) expect(result.error).toContain('2 requests needed, 1 remaining');
            if (incomplete) expect(result.error).toContain('stream ended before a completion event');
            if (invalidCount === 2) expect(result.error).toContain('file-plan validation failed after one retry');
            if (success) await expect.poll(() => page.evaluate(() => window.__stageResult.done.length)).toBe(1);
            const observed = await page.evaluate(() => window.__stageResult);
            expect(observed.done).toHaveLength(success ? 1 : 0);
            expect(observed.stages.map(stage => stage.index)).toEqual(budgetFailure ? retryExhausted ? [0, 1] : [0] : invalidCount === 2 ? [0, 0]
                : [...Array(invalidCount + 1).fill(0), 1, 2]);
            if (success) {
                expect(observed.errors).toEqual([]);
                expect(result.content).toContain('### File: /render.ts');
                expect(result.content).toContain('### File: /index.ts');
                expect(result.content).not.toContain('"files":');
            }
            const usage = await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}));
            expect(usage.entries).toHaveLength(requests.length);
            expect(usage.entries.filter(entry => entry.status === 'completed')).toHaveLength(requests.length - (incomplete ? 2 : retryExhausted ? 1 : 0) - (truncated ? invalidCount : 0));
        } finally { await closeElectronApp(app); }
    });
}

for (const {stylesheet, repairSplit, echoRoot, fullInventory, reuseCss, wrongFolder, duplicateHelper, unrelatedProposals, earlySize} of [{stylesheet: false}, {stylesheet: false, earlySize: true}, {stylesheet: true}, {stylesheet: true, repairSplit: true}, {stylesheet: true, echoRoot: true}, {stylesheet: true, fullInventory: true}, {stylesheet: true, reuseCss: 'pending'}, {stylesheet: true, reuseCss: 'completed'}, {stylesheet: true, wrongFolder: true}, {stylesheet: true, repairSplit: true, duplicateHelper: true}, {stylesheet: true, repairSplit: true, unrelatedProposals: true}]) {
test(`oversized ${stylesheet ? 'CSS' : 'TypeScript'} file is split into helper modules through the native SDK${earlySize ? ' after early stream cancellation' : unrelatedProposals ? ' with unrelated conflicting source proposals in a CSS split' : duplicateHelper ? ' after a corrected plan repeats an identical helper' : wrongFolder ? ' with a wrong relative helper folder' : repairSplit ? ' after split validation repair' : echoRoot ? ' with misplaced original module' : fullInventory ? ' with a full initial inventory' : reuseCss ? ` reusing ${reuseCss} CSS` : ''}`, async () => {
    const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
        env: {FDO_E2E_LIVE_AI: fullInventory || reuseCss ? '1' : '0', FDO_TEST_AI_MAX_REQUESTS: reuseCss ? '6' : 'auto'}});
    try {
        const page = await app.firstWindow();
        await expect.poll(() => page.evaluate(async () => {
            try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
        })).toBe(true);
        await app.evaluate((_electron, {stylesheet, repairSplit, echoRoot, fullInventory, reuseCss, wrongFolder, duplicateHelper, unrelatedProposals, earlySize}) => {
            globalThis.__stageRequests = [];
            const file = (path, content) => JSON.stringify({path, content});
            const modulePath = stylesheet ? '/styles.css' : '/render.ts';
            const helperPath = stylesheet ? '/features/greeting/styles.css' : '/features/greeting.ts';
            const files = [{path: modulePath, contract: stylesheet ? 'Greeting styles' : 'Export render(): string'}, {path: '/index.ts', contract: 'Import render()'}];
            const tail = fullInventory ? Array.from({length: 10}, (_, i) => ({path: `/features/f${i}.ts`, contract: 'Feature'})) : [];
            files.push(...tail);
            const responses = [
                JSON.stringify({files}),
                `### File: ${modulePath}\n\`\`\`\nTRUNCATED_SOURCE`,
                JSON.stringify({files: [{path: helperPath, contract: 'Greeting feature'}]}),
                file(helperPath, stylesheet ? '.greeting { color: green; }' : 'export const greeting = () => "Hello";'),
                file(modulePath, stylesheet ? '@import "./features/greeting/styles.css";' : 'import {greeting} from "./features/greeting";\nexport const render = greeting;'),
                file('/index.ts', stylesheet ? 'import css from "./styles.css";' : 'import {render} from "./render";'),
                ...tail.map(entry => file(entry.path, 'export {};')),
            ];
            if (wrongFolder) responses[4] = file(modulePath, '@import "./greeting/styles.css";\n.local { color: blue; }');
            if (echoRoot) responses[2] = JSON.stringify({files: [files[0], {path: helperPath, contract: 'Greeting styles'}]});
            if (duplicateHelper) responses[2] = JSON.stringify({files: [
                {path: helperPath, contract: 'Greeting feature'}, {path: helperPath, contract: 'Greeting feature'}]});
            if (unrelatedProposals) responses[2] = JSON.stringify({files: [
                {path: '/features/workbench/catalog.ts', contract: 'Category metadata'},
                {path: '/features/workbench/catalog.ts', contract: 'Transformations'},
                {path: '/index.ts', contract: 'Rewrite entry'},
                {path: helperPath, contract: 'Greeting feature'}]});
            if (repairSplit) responses.splice(2, 0, JSON.stringify({files: [{path: helperPath, contract: 'First responsibility'}, {path: helperPath, contract: 'Conflicting responsibility'}]}));
            let limitedIndex = 1;
            if (reuseCss) {
                const helper = {path: helperPath, contract: 'Original CSS contract'};
                const plan = [files[0], helper, files[1]];
                if (reuseCss === 'completed') plan.splice(0, 2, helper, files[0]);
                const helperFile = file(helperPath, '.greeting { color: green; }');
                responses.splice(0, responses.length,
                    JSON.stringify({files: plan}), ...(reuseCss === 'completed' ? [helperFile] : []),
                    'TRUNCATED_SOURCE', JSON.stringify({files: [{...helper, contract: 'OVERWRITE_EXISTING_CONTRACT'}]}),
                    ...(reuseCss === 'pending' ? [helperFile] : []),
                    file(modulePath, '@import "./features/greeting/styles.css";'),
                    file('/index.ts', 'import css from "./styles.css";'));
                limitedIndex = reuseCss === 'completed' ? 2 : 1;
            }
            globalThis.fetch = async (url, init = {}) => {
                const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                    result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                const index = globalThis.__stageRequests.push(JSON.parse(init.body)) - 1;
                if (index >= responses.length) throw new Error('Unexpected extra inference request');
                if (earlySize && index === limitedIndex) {
                    const event = `data: ${JSON.stringify({response: 'x'.repeat(50000)})}\n\n`;
                    // No completion event: the host must stop reading itself.
                    return new Response(new ReadableStream({
                        start(controller) { controller.enqueue(new TextEncoder().encode(event)); },
                        cancel() { globalThis.__earlyResponseCancelled = true; },
                    }), {headers: {'content-type': 'text/event-stream'}});
                }
                if (globalThis.__stageRequests[index].response_format) return Response.json({success: true, result: {response: index === limitedIndex ? responses[index] : JSON.parse(responses[index]), finish_reason: index === limitedIndex ? 'length' : 'stop', usage: {prompt_tokens: 100, completion_tokens: 20}}});
                return new Response([
                    {choices: [{delta: {content: responses[index]}, finish_reason: null}]},
                    {choices: [{delta: {}, finish_reason: index === limitedIndex ? 'length' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20}},
                ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}});
            };
        }, {stylesheet, repairSplit, echoRoot, fullInventory, reuseCss, wrongFolder, duplicateHelper, unrelatedProposals, earlySize});
        const observed = await page.evaluate(async () => {
            await window.electron.settings.ai.addAssistant({name: 'Split workspace', provider: 'cloudflare', purpose: 'coding',
                model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
            const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'Split workspace');
            const done = [], errors = [], stages = [];
            let resolveDone;
            const donePromise = new Promise(resolve => { resolveDone = resolve; });
            window.electron.aiCodingAgent.on.streamDone(event => { done.push(event); resolveDone?.(); });
            window.electron.aiCodingAgent.on.streamError(event => errors.push(event));
            window.electron.aiCodingAgent.on.streamDelta(event => { if (event.type === 'stage') stages.push(event.label); });
            const result = await window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'split-test', assistantId: assistant.id, prompt: 'Build a greeting plugin using feature folders.'}));
            if (!done.length) await Promise.race([donePromise, new Promise(resolve => setTimeout(resolve, 2000))]);
            return {result, done, errors, stages};
        });
        expect(observed.result.success, observed.result.error).toBe(true);
        expect(observed.errors).toEqual([]);
        expect(observed.done).toHaveLength(1);
        expect(observed.result.content).toContain(stylesheet ? '### File: /features/greeting/styles.css' : '### File: /features/greeting.ts');
        expect(observed.result.content).not.toContain('TRUNCATED_SOURCE');
        expect(observed.stages).toContain(`Splitting oversized module: ${stylesheet ? '/styles.css' : '/render.ts'}`);
        if (earlySize) expect(await app.evaluate(() => globalThis.__earlyResponseCancelled)).toBe(true);
        const requests = await app.evaluate(() => globalThis.__stageRequests);
        expect(requests.map(request => request.max_tokens)).toEqual(reuseCss ? reuseCss === 'pending' ? [2048, 3072, 2048, 3072, 1536, 6144] : [2048, 3072, 3072, 2048, 1536, 6144] : stylesheet ? [2048, 3072, 2048, ...(repairSplit ? [2048] : []), 1536, 1536, 6144, ...(fullInventory ? Array(10).fill(6144) : [])] : [2048, 6144, 2048, 3072, 2048, 6144]);
        if (wrongFolder) {
            expect(observed.result.content).toContain('@import "./features/greeting/styles.css";\n.local { color: blue; }');
            expect(observed.result.content).not.toContain('@import "./greeting/styles.css";');
            expect(requests[4].messages.at(-1).content).toContain('@import "./features/greeting/styles.css";');
            expect(requests).toHaveLength(6);
        }
        if (duplicateHelper || unrelatedProposals) {
            expect(requests).toHaveLength(7);
            expect(observed.result.content).not.toContain('### File: /features/workbench/catalog.ts');
            expect(observed.result.content.match(/### File: \/features\/greeting\/styles.css/g)).toHaveLength(1);
        }
        if (fullInventory) {
            expect(observed.result.content.match(/^### File:/gm)).toHaveLength(13);
            const budget = await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__);
            expect(budget).toMatchObject({mode: 'adaptive', used: 16, allocated: 16, baseCeiling: 50, ceiling: 63, validatedFiles: 13});
        }
        if (repairSplit) {
            expect(requests[3].messages.at(-1).content).toContain('conflicting duplicate paths');
            expect(requests[3].response_format.json_schema.properties.files).toMatchObject({minItems: 1, maxItems: 12});
        }
        expect(requests[reuseCss === 'completed' ? 3 : 2].messages.at(-1).content).toContain('MODULE SPLIT REQUIRED');
        if (reuseCss) {
            expect(observed.result.content.match(/^### File:/gm)).toHaveLength(3);
            expect(observed.result.content.match(/### File: \/features\/greeting\/styles.css/g)).toHaveLength(1);
            expect(requests[4].messages.at(-1).content).toContain('Original CSS contract');
            expect(requests[4].messages.at(-1).content).not.toContain('OVERWRITE_EXISTING_CONTRACT');
            expect(await app.evaluate(() => globalThis.__FDO_E2E_LIVE_AI_BUDGET__.used)).toBe(6);
        }
        expect(requests.slice(reuseCss === 'completed' ? 3 : 2).some(request => JSON.stringify(request).includes('TRUNCATED_SOURCE'))).toBe(false);
        const usage = await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}));
        expect(usage.entries).toHaveLength(fullInventory ? 16 : repairSplit ? 7 : 6);
        expect(usage.entries.filter(entry => entry.status === 'completed')).toHaveLength(fullInventory ? 15 : repairSplit ? 6 : 5);
    } finally { await closeElectronApp(app); }
});

}

for (const kind of ['JSON response format', 'CSS response format', 'CSS source syntax', 'entry instantiation', 'flattened entry', 'renderer syntax', 'format then renderer syntax']) {
const phased = kind === 'format then renderer syntax';
const adaptive = kind === 'JSON response format';
// Source-kind failures that repeat identically now earn one flagged final
// round before failing, so their budget, stage and usage counts grow by one.
const sourceKind = kind === 'CSS source syntax' || kind === 'entry instantiation'
    || kind === 'flattened entry' || kind === 'renderer syntax' || phased;
for (const repeated of [false, true]) {
    test(`completed ${kind} ${repeated ? sourceKind ? 'fails after repeated repairs' : 'fails after one retry' : 'recovers without regenerating dependencies'}`, async () => {
        const app = await launchElectronApp(electron, {reviewedWorkspaceFixture: true, isolatedUserDataDir: true,
            env: {FDO_E2E_LIVE_AI: '1', FDO_TEST_AI_MAX_REQUESTS: phased ? (repeated ? '6' : '5')
                : adaptive ? '5' : sourceKind && repeated ? '5' : '4'}});
        try {
            const page = await app.firstWindow();
            await expect.poll(() => page.evaluate(async () => {
                try { return Array.isArray(await window.electron.settings.ai.getAssistants()); } catch { return false; }
            })).toBe(true);
            await app.evaluate((_electron, {repeated, kind, flattenedEntry, missingCommaSource, phased, sourceKind}) => {
                globalThis.__formatRequests = [];
                const entry = kind.includes('entry');
                const renderer = kind.endsWith('renderer syntax');
                const jsonFormat = kind === 'JSON response format';
                const path = jsonFormat ? '/features/categories/actionHandler.ts' : entry ? '/index.ts' : renderer ? '/features/personal/render.ts' : '/styles/overlay.css';
                const valid = jsonFormat ? 'export const action = "category";' : renderer ? missingCommaSource.replace('class: "space-section"\n', 'class: "space-section",\n')
                    : entry ? '// Plugin lifecycle\nclass OverlayPlugin extends FDO_SDK {}\nnew OverlayPlugin();' : '/* Overlay */\n.overlay {\n  display: grid;\n}';
                const invalid = jsonFormat ? JSON.stringify({path, lines: [valid]}).replace('\\"category\\"', '"category"')
                    : kind === 'flattened entry' ? JSON.stringify(flattenedEntry)
                    : renderer ? JSON.stringify({path, lines: missingCommaSource.split('\n')})
                    : entry ? JSON.stringify({path, content: 'class OverlayPlugin extends FDO_SDK {}'})
                    : kind === 'CSS source syntax' ? JSON.stringify({path, content: '.overlay { display: grid;'}) : valid;
                const responses = [
                    JSON.stringify({files: [{path: '/types.ts', contract: 'Shared types'}, {path, contract: entry ? 'Start plugin' : 'Overlay styles'},
                        ...(jsonFormat ? [{path: '/styles/category.css', contract: 'Category styles'}] : [])]}),
                    JSON.stringify({path: '/types.ts', lines: ['// Shared state', 'export type State = "open" | "closed";']}),
                    ...(phased ? ['Not a file envelope'] : []),
                    invalid,
                    repeated ? invalid : jsonFormat ? `Looking at the diagnostics, align the category roles.\n\`\`\`ts\n${valid}\n\`\`\`\nThe requested file is complete.` : JSON.stringify({path, lines: valid.split('\n')}),
                    // An identical second source rejection earns one flagged final round.
                    ...(sourceKind && repeated ? [invalid] : []),
                    ...(jsonFormat ? ['```css\n.category[data-mode="text"] { display: grid; }\n```'] : []),
                ];
                globalThis.fetch = async (url, init = {}) => {
                    const base = `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/`;
                    if (String(url).startsWith(`${base}models/search?`)) return Response.json({success: true,
                        result: [{name: '@cf/qwen/qwen3.8-27b', task: {name: 'Text Generation'}}]});
                    if (String(url) !== `${base}run/@cf/qwen/qwen3.8-27b`) throw new Error('Unexpected endpoint');
                    const index = globalThis.__formatRequests.push(JSON.parse(init.body)) - 1;
                    if (index >= responses.length) throw new Error('Unexpected extra request');
                    // A valid HTTP JSON envelope can contain malformed generated
                    // JSON, even with a successful finish reason and a schema.
                    if (jsonFormat && !globalThis.__formatRequests[index].stream) return Response.json({success: true, result: {
                        choices: [{message: {content: responses[index]}, finish_reason: 'stop'}],
                        usage: {prompt_tokens: 100, completion_tokens: 20},
                    }});
                    if (globalThis.__formatRequests[index].response_format) return Response.json({success: true, result: {response: responses[index].startsWith('{') ? JSON.parse(responses[index]) : responses[index], usage: {prompt_tokens: 100, completion_tokens: 20}}});
                    return new Response(`data: ${JSON.stringify({choices: [{delta: {content: responses[index]}, finish_reason: null}]})}\n\n`
                        + `data: ${JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20}})}\n\n`,
                    {headers: {'content-type': 'text/event-stream'}});
                };
            }, {repeated, kind, flattenedEntry, missingCommaSource, phased, sourceKind});
            const result = await page.evaluate(async () => {
                await window.electron.settings.ai.addAssistant({name: 'File format recovery', provider: 'cloudflare', purpose: 'coding',
                    model: '@cf/qwen/qwen3.8-27b', accountId: 'a'.repeat(32), apiKey: 'test-token', defaultThinkingMode: 'off'});
                const assistant = (await window.electron.settings.ai.getAssistants()).find(item => item.name === 'File format recovery');
                window.__formatEvents = {done: [], stages: [], errors: []};
                window.electron.aiCodingAgent.on.streamDone(event => window.__formatEvents.done.push(event));
                window.electron.aiCodingAgent.on.streamError(event => window.__formatEvents.errors.push(event));
                window.electron.aiCodingAgent.on.streamDelta(event => { if (event.type === 'stage') window.__formatEvents.stages.push(event); });
                return window.electron.aiCodingAgent.planCode(window.__withReviewedWorkspace({requestId: 'format-test', assistantId: assistant.id, prompt: 'Build an overlay plugin.'}));
            });
            const requests = await app.evaluate(() => globalThis.__formatRequests);
            const entry = kind.includes('entry');
            const path = kind === 'JSON response format' ? '/features/categories/actionHandler.ts' : entry ? '/index.ts' : kind.endsWith('renderer syntax') ? '/features/personal/render.ts' : '/styles/overlay.css';
            const fileTokens = path.endsWith('.css') ? 3072 : 6144;
            expect(requests.map(request => request.max_tokens)).toEqual([2048, 6144, fileTokens, fileTokens,
                ...(phased ? [fileTokens, ...(repeated ? [fileTokens] : [])] : []),
                ...(sourceKind && repeated && !phased ? [fileTokens] : []),
                ...(adaptive && !repeated ? [3072] : [])]);
            const repairRequest = requests[phased ? 4 : 3];
            expect(repairRequest.messages.at(-1).content).toContain('FILE VALIDATION RETRY');
            if (kind === 'CSS source syntax' || kind.endsWith('renderer syntax')) {
                expect(repairRequest.messages.at(-1).content).toContain('FOCUSED WORKSPACE SYNTAX REPAIR');
                expect(repairRequest.messages.at(-1).content).not.toContain('export type State');
            } else if (kind.startsWith('CSS')) expect(repairRequest.messages.at(-1).content).not.toContain('export type State');
            else expect(repairRequest.messages.at(-1).content).toContain('export type State');
            if (kind.endsWith('response format')) expect(repairRequest.messages.at(-1).content).toContain('BEGIN REJECTED FILE RESPONSE');
            else expect(repairRequest.messages.at(-1).content).toContain('BEGIN REJECTED SOURCE');
            if (kind === 'JSON response format') {
                expect(repairRequest.messages.at(-1).content).toContain('invalid JSON at character');
                expect(repairRequest.messages.at(-1).content).toContain('"lines":["export const action = "category";"]');
            }
            if (kind.endsWith('renderer syntax')) expect(repairRequest.messages.at(-1).content)
                .toContain(`BEGIN REJECTED SOURCE\n${missingCommaSource}\nEND REJECTED SOURCE`);
            if (kind === 'JSON response format') {
                expect(repairRequest.response_format).toBeUndefined();
                expect(repairRequest.stream).toBe(true);
                expect(repairRequest.stream_options).toEqual({include_usage: true});
                expect(repairRequest.messages.at(-1).content).toContain('SOURCE FORMAT RECOVERY');
            } else expect(repairRequest.response_format).toBeUndefined();
            if (kind === 'entry instantiation') expect(repairRequest.messages.at(-1).content).toContain('new OverlayPlugin()');
            if (kind === 'flattened entry') expect(repairRequest.messages.at(-1).content).toContain('no executable plugin class');
            if (kind === 'CSS source syntax') expect(repairRequest.messages.at(-1).content).toContain('invalid source syntax');
            expect(result.success).toBe(!repeated);
            if (repeated) {
                expect(result.error).toContain(sourceKind ? `after repeated repairs of ${path}` : `after one repair of ${path}`);
                if (sourceKind) expect(requests.at(-1).messages.at(-1).content).toContain('REPEAT REJECTION');
            } else {
                expect(result.content).toContain(`### File: ${path}`);
                if (adaptive) {
                    expect(requests[4].response_format).toBeUndefined();
                    expect(requests[4].stream).toBe(true);
                    expect(requests[4].messages.at(-1).content).toContain('SOURCE FORMAT RECOVERY');
                    expect(result.content).toContain('### File: /styles/category.css\n```css\n.category[data-mode="text"] { display: grid; }\n```');
                }
                if (kind === 'JSON response format') {
                    expect(result.content).toContain('export const action = "category";');
                    expect(result.content).not.toContain('Looking at the diagnostics');
                    expect(result.content).not.toContain('The requested file is complete.');
                }
                if (entry) expect(result.content).toContain('// Plugin lifecycle\nclass OverlayPlugin extends FDO_SDK {}\nnew OverlayPlugin();');
                if (kind.endsWith('renderer syntax')) expect(result.content).toContain('class: "space-section",\n');
                await expect.poll(() => page.evaluate(() => window.__formatEvents.done.length)).toBe(1);
            }
            const events = await page.evaluate(() => window.__formatEvents);
            expect(events.done).toHaveLength(repeated ? 0 : 1);
            expect(events.stages.map(stage => stage.index)).toEqual([0, 1, 2, 2, ...(phased ? [2] : []),
                ...(sourceKind && repeated ? [2] : []), ...(adaptive && !repeated ? [3] : [])]);
            if (!repeated) expect(events.errors).toEqual([]);
            const usage = await page.evaluate(() => window.electron.aiUsage.get({surface: 'coding'}));
            expect(usage.entries).toHaveLength(phased ? (repeated ? 6 : 5)
                : (adaptive && !repeated) || (sourceKind && repeated) ? 5 : 4);
            if (phased) {
                const validations = await app.evaluate(() => (globalThis.__FDO_E2E_CODING_LIFECYCLE__ || [])
                    .filter(event => event.event === 'workspace-file-validation'));
                expect(validations.map(event => event.kind)).toEqual(repeated ? ['format', 'source', 'source', 'source'] : ['format', 'source']);
                expect(validations.map(event => event.repairAvailable)).toEqual(repeated ? [true, true, true, false] : [true, true]);
                expect(repairRequest.messages.at(-1).content).toContain('NUMBERED DIAGNOSTIC CONTEXT');
            }
        } finally { await closeElectronApp(app); }
    });
}
}
