import {createCodingFirstContentDeadline} from '../../src/utils/codingFirstContentDeadline';
import {buildAiCodingReasoningStatus} from '../../src/utils/aiCodingAgentProgress';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('continuous reasoning cannot keep a request alive beyond the visible-answer deadline', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 300000, abort, provider: 'ollama'});
    const failure = expect(deadline.promise).rejects.toThrow('produced reasoning but no answer text within 300 seconds');
    for (let i = 0; i < 30; i++) {
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
    expect(buildAiCodingReasoningStatus(20000)).toContain('no answer text has arrived yet (20s elapsed)');
});

const {codingFirstResponseTimeoutMs} = require('../../src/utils/codingRequestPolicy.cjs');

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

test('reasoning and stream activity cannot extend the configured first-answer deadline', async () => {
    const abort = jest.fn();
    const deadline = createCodingFirstContentDeadline({timeoutMs: 420000, abort, describeTransport: () => 'Cloudflare returned HTTP 200; 40 stream events received.'});
    const failure = expect(deadline.promise).rejects.toThrow('reasoning but no answer text within 420 seconds');
    for (let i = 0; i < 42; i++) { deadline.noteReasoning(); jest.advanceTimersByTime(10000); }
    await failure;
    await expect(deadline.promise).rejects.toThrow('40 stream events');
    expect(abort).toHaveBeenCalledTimes(1);
});

test('request policy preserves other provider defaults and validates overrides', () => {
    expect(codingFirstResponseTimeoutMs({provider: 'openai'})).toBe(90000);
    expect(codingFirstResponseTimeoutMs({provider: 'anthropic'})).toBe(90000);
    expect(codingFirstResponseTimeoutMs({provider: 'ollama'})).toBe(300000);
    expect(codingFirstResponseTimeoutMs({provider: 'cloudflare', firstResponseTimeoutMs: '420000'})).toBe(420000);
    for (const value of [0, -1, 9999, 600001, Infinity, 'bad', 12000.5]) {
        expect(() => codingFirstResponseTimeoutMs({firstResponseTimeoutMs: value})).toThrow('First response timeout');
    }
});
