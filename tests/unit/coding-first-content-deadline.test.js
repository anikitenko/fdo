import {createCodingFirstContentDeadline, createCodingAnswerDeadline} from '../../src/utils/ai/generation/codingFirstContentDeadline';
import {buildAiCodingReasoningStatus} from '../../src/utils/ai/assistant/aiCodingAgentProgress';
import {isAiCodingTransientError} from '../../src/utils/ai/assistant/aiCodingTransientRecovery';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a pre-first-content transport silence is typed for the bounded transient replay', async () => {
    // Recorded live failure (attempt 57): an OpenRouter stream opened and
    // delivered nothing for the full 300s; the deadline fired with no typed
    // code, read as permanent, and failed the workspace instead of letting
    // the atomic step's one replay open a fresh stream.
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 300000, abort});
    const failure = expect(deadline.promise).rejects.toMatchObject({code: 'stream_stalled'});
    jest.advanceTimersByTime(300000);
    const error = await deadline.promise.catch(error => error);
    await failure;
    expect(error.message).toContain("FDO's 300-second first-response deadline");
    expect(isAiCodingTransientError(error)).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
});

test('reasoning without an answer has a bounded allowance and is not automatically replayed', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 300000, abort});
    const failure = expect(deadline.promise).rejects.toThrow('no answer within the 900-second reasoning budget');
    deadline.noteReasoning();
    jest.advanceTimersByTime(300000);
    expect(abort).not.toHaveBeenCalled();
    jest.advanceTimersByTime(600000);
    const error = await deadline.promise.catch(error => error);
    await failure;
    expect(error.code).toBe('reasoning_timeout');
    expect(isAiCodingTransientError(error)).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
});

test('continuous reasoning cannot keep a request alive beyond the bounded reasoning budget', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 300000, abort, provider: 'ollama'});
    const failure = expect(deadline.promise).rejects.toThrow('no answer within the 900-second reasoning budget');
    for (let i = 0; i < 90; i++) {
        deadline.noteReasoning();
        jest.advanceTimersByTime(10000);
    }
    await failure;
    expect(abort).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

test('a silent model gets a distinct timeout diagnosis', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 300000, abort, provider: 'ollama'});
    const failure = expect(deadline.promise).rejects.toThrow('Local model loading and prompt/image processing');
    jest.advanceTimersByTime(300000);
    await failure;
    expect(abort).toHaveBeenCalledTimes(1);
});

test('answer arrival or cancellation clears the deadline without a late abort', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 300000, abort});
    deadline.noteReasoning();
    jest.advanceTimersByTime(299999);
    deadline.clear();
    jest.advanceTimersByTime(300000);
    expect(abort).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(buildAiCodingReasoningStatus(20000)).toContain('no answer text has arrived yet (20 seconds elapsed)');
});

const {codingFirstResponseTimeoutMs} = require('../../src/utils/ai/generation/codingRequestPolicy.cjs');

test('Cloudflare allows delayed first answers beyond the former 90-second cutoff', () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: codingFirstResponseTimeoutMs({provider: 'cloudflare'}), abort});
    jest.advanceTimersByTime(120000);
    expect(abort).not.toHaveBeenCalled();
    deadline.clear(); // Simulate answer arrival after two minutes.
    jest.advanceTimersByTime(600000);
    expect(abort).not.toHaveBeenCalled();
});

test('Cloudflare remains bounded at five minutes and reports the observed transport stage', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: codingFirstResponseTimeoutMs({provider: 'cloudflare'}), abort,
        describeTransport: () => 'Cloudflare HTTP response headers have not arrived yet.'});
    const failure = expect(deadline.promise).rejects.toThrow("FDO's 300-second first-response deadline");
    jest.advanceTimersByTime(300000);
    await failure;
    await expect(deadline.promise).rejects.toThrow('HTTP response headers have not arrived');
    expect(abort).toHaveBeenCalledTimes(1);
});

test('reasoning activity cannot extend the absolute three-times allowance', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 420000, abort, describeTransport: () => 'Cloudflare returned HTTP 200; 40 stream events received.'});
    const failure = expect(deadline.promise).rejects.toThrow('no answer within the 1260-second reasoning budget');
    for (let i = 0; i < 126; i++) { deadline.noteReasoning(); jest.advanceTimersByTime(10000); }
    await failure;
    await expect(deadline.promise).rejects.toThrow('40 stream events');
    expect(abort).toHaveBeenCalledTimes(1);
});

test('request policy preserves other provider defaults and validates overrides', () => {
    expect(codingFirstResponseTimeoutMs({provider: 'openai'})).toBe(240000);
    expect(codingFirstResponseTimeoutMs({provider: 'anthropic'})).toBe(240000);
    expect(codingFirstResponseTimeoutMs({provider: 'ollama'})).toBe(300000);
    expect(codingFirstResponseTimeoutMs({provider: 'cloudflare', firstResponseTimeoutMs: '420000'})).toBe(420000);
    for (const value of [0, -1, 9999, 600001, Infinity, 'bad', 12000.5]) {
        expect(() => codingFirstResponseTimeoutMs({firstResponseTimeoutMs: value})).toThrow('First response timeout');
    }
});

test('a stalled answer stream is abandoned at the idle bound instead of hanging on the remote socket', async () => {
    const abort = jest.fn();
    const deadline = createCodingAnswerDeadline({timeoutMs: 900000, idleTimeoutMs: 100000, abort,
        describeTransport: () => 'OpenRouter returned HTTP 200; 12 stream events received.'});
    deadline.start();
    deadline.touch();
    jest.advanceTimersByTime(90000);
    expect(abort).not.toHaveBeenCalled(); // still inside the idle window
    const failure = expect(deadline.promise).rejects.toThrow('stopped sending response events for 100 seconds after the answer began');
    jest.advanceTimersByTime(10001);
    await failure;
    await expect(deadline.promise).rejects.toThrow('12 stream events received');
    // Typed so the bounded transient retry may replay the atomic step once.
    await expect(deadline.promise).rejects.toMatchObject({code: 'stream_stalled'});
    expect(abort).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

test('response events keep the answer alive but cannot extend the total completion budget', async () => {
    const abort = jest.fn();
    const deadline = createCodingAnswerDeadline({timeoutMs: 300000, idleTimeoutMs: 100000, abort});
    deadline.start();
    const failure = expect(deadline.promise).rejects.toThrow('began an answer but did not finish within 300 seconds');
    // A trickle of events every 60s must not keep the request alive forever.
    for (let i = 0; i < 6; i++) { deadline.touch(); jest.advanceTimersByTime(60000); }
    await failure;
    expect(abort).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});

test('normal completion clears both answer bounds without a late abort', () => {
    const abort = jest.fn();
    const deadline = createCodingAnswerDeadline({timeoutMs: 300000, idleTimeoutMs: 100000, abort});
    deadline.start();
    deadline.touch();
    deadline.clear();
    jest.advanceTimersByTime(600000);
    expect(abort).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
});

test('no bound arms before the first content event', () => {
    const abort = jest.fn();
    const deadline = createCodingAnswerDeadline({timeoutMs: 300000, idleTimeoutMs: 100000, abort});
    jest.advanceTimersByTime(600000); // start() not called: first-response deadline still governs
    expect(abort).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    deadline.clear();
});

test('a late reasoning event grants the absolute allowance, and completion clears it', () => {
    const abort = jest.fn(); const deadline = createCodingFirstContentDeadline({timeoutMs: 90000, abort});
    jest.advanceTimersByTime(80000); deadline.noteReasoning();
    jest.advanceTimersByTime(100000); expect(abort).not.toHaveBeenCalled();
    deadline.clear(); deadline.noteReasoning(); deadline.noteBuffered();
    jest.advanceTimersByTime(400000); expect(abort).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('declared buffered generation survives the initial wait but repeated notifications cannot extend its total allowance', async () => {
    const abort = jest.fn(); const deadline = createCodingFirstContentDeadline({timeoutMs: 90000, abort});
    const failure = expect(deadline.promise).rejects.toMatchObject({code: 'buffered_response_timeout'});
    deadline.noteBuffered(); jest.advanceTimersByTime(100000); expect(abort).not.toHaveBeenCalled();
    deadline.noteBuffered(); deadline.noteReasoning(); jest.advanceTimersByTime(170001); await failure;
    expect(abort).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
test('reasoning pauses only idle checks after an answer prefix; the completion budget remains active', async () => {
    const abort = jest.fn(); const deadline = createCodingAnswerDeadline({timeoutMs: 270000, idleTimeoutMs: 30000, abort});
    const failure = expect(deadline.promise).rejects.toThrow('did not finish within 270 seconds');
    deadline.start(); deadline.pauseIdle(); jest.advanceTimersByTime(60000); expect(abort).not.toHaveBeenCalled();
    jest.advanceTimersByTime(210001); await failure; expect(abort).toHaveBeenCalledTimes(1);
});


test('upgrades legacy saved 90-second defaults once without overwriting other custom waits', () => {
    const {migrateCodingTimeoutDefaults} = require('../../src/utils/ai/generation/codingRequestPolicy.cjs');
    const data={'ai.coding':[{id:'old',provider:'openai',firstResponseTimeoutMs:90000},{id:'codex',provider:'codex-cli',firstResponseTimeoutMs:90000},{id:'custom',provider:'openai',firstResponseTimeoutMs:420000}]};
    const store={get:(key,fallback)=>data[key]??fallback,set:jest.fn((key,value)=>{data[key]=value;})};
    migrateCodingTimeoutDefaults(store);
    expect(data['ai.coding'].map(a=>a.firstResponseTimeoutMs)).toEqual([240000,300000,420000]);
    data['ai.coding'][0].firstResponseTimeoutMs=90000;store.set.mockClear();migrateCodingTimeoutDefaults(store);
    expect(data['ai.coding'][0].firstResponseTimeoutMs).toBe(90000);expect(store.set).not.toHaveBeenCalled();
});
test('a confirmed turn grants a bounded generation allowance without exposing reasoning',async()=>{
    const abort=jest.fn();const deadline=createCodingFirstContentDeadline({timeoutMs:240000,abort});
    const failure=expect(deadline.promise).rejects.toMatchObject({code:'generation_timeout'});
    deadline.noteGeneration();jest.advanceTimersByTime(240001);expect(abort).not.toHaveBeenCalled();
    deadline.noteGeneration();jest.advanceTimersByTime(480000);await failure;expect(abort).toHaveBeenCalledTimes(1);
});

test.each(['openrouter', 'codex-cli', 'gemini-cli', 'openai'])('answer silence uses the configured allowance for %s', provider => {
    const {codingAnswerIdleTimeoutMs} = require('../../src/utils/ai/generation/codingRequestPolicy.cjs');
    expect(codingAnswerIdleTimeoutMs({provider, firstResponseTimeoutMs: 300000})).toBe(300000);
    expect(codingAnswerIdleTimeoutMs({provider, firstResponseTimeoutMs: 420000})).toBe(420000);
    expect(codingAnswerIdleTimeoutMs({provider, firstResponseTimeoutMs: 10000})).toBe(30000);
});
