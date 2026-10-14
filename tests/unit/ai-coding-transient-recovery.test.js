import {isAiCodingTransientError, isAiCodingProviderTimeoutError, withCodingTransientRecovery} from "../../src/utils/ai/assistant/aiCodingTransientRecovery";
import {withCodingOutputRecovery} from "../../src/utils/ai/assistant/aiCodingOutputRecovery";
import {providerRetryAfterMs} from '../../src/utils/ai/providers/aiProviderRetry';
import {completion, incompleteStream} from '../../src/utils/ai/providers/messages';

test('incomplete transport completion gets one replay, never an unbounded loop', async () => {
    const failure = incompleteStream('Stream ended before completion');
    const run = jest.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce('complete replacement');
    const onRetry = jest.fn();
    await expect(withCodingTransientRecovery({run, onRetry, wait: async () => {}})).resolves.toBe('complete replacement');
    expect(run).toHaveBeenCalledTimes(2);
    const failing = jest.fn().mockRejectedValue(failure);
    await expect(withCodingTransientRecovery({run: failing, onRetry, wait: async () => {}})).rejects.toBe(failure);
    expect(failing).toHaveBeenCalledTimes(2);
});

test('missing finish reason is retryable but explicit rejection and token limits are not transient EOF', () => {
    for (const [reason, retryable] of [[undefined, true], ['content_filter', false], ['length', false], ['unknown', false]]) {
        let failure;
        try { completion('partial text', [], undefined, reason); } catch (error) { failure = error; }
        expect(isAiCodingTransientError(failure)).toBe(retryable);
    }
    expect(isAiCodingTransientError(new Error('Stream ended before completion'))).toBe(false);
    expect(isAiCodingTransientError(Object.assign(incompleteStream('cancelled'), {name: 'AbortError'}))).toBe(false);
});

const overloaded = () => Object.assign(new Error("Temporarily unavailable"), {code: "overloaded_error"});
const limit = new Error("Assistant stream response.incomplete: max_output_tokens");

test('only typed retryable HTTP 408 failures allow transport recovery', () => {
    expect(isAiCodingProviderTimeoutError(Object.assign(new Error('Upstream timeout'), {status: 408}))).toBe(true);
    for (const error of [new Error('408 Request timeout'), Object.assign(new Error('aborted'), {status: 408, errors: [{code: 3008}]}),
        Object.assign(new Error('Billing required'), {status: 408}), Object.assign(new Error('Timeout'), {name: 'AbortError', status: 408}),
        Object.assign(new Error('Temporarily unavailable'), {status: 503})]) expect(isAiCodingProviderTimeoutError(error)).toBe(false);
});

test('a caller-owned timeout recovery skips replay without spending the transient budget', async () => {
    const error = Object.assign(new Error('Upstream timeout'), {status: 408});
    const budget = {remaining: 1};
    const run = jest.fn().mockRejectedValue(error), onRetry = jest.fn();
    await expect(withCodingTransientRecovery({run, onRetry, budget,
        shouldRetry: error => !isAiCodingProviderTimeoutError(error)})).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(budget.remaining).toBe(1);
});

test.each([
    overloaded(), Object.assign(new Error("Temporary server fault"), {status: 503}),
    Object.assign(new Error('408 {"errors":[{"message":"AiError: Request timeout","code":3046}],"success":false}'), {status: 408}),
    new Error("Assistant stream error: Our servers are currently overloaded. Please try again later."),
    new Error("503 Service Unavailable"),
    new Error("overloaded_error: Temporarily unavailable"),
    new Error('{"code":"server_error","message":"Temporarily unavailable"}'),
    Object.assign(new Error("Too many requests"), {code: "rate_limit_error"}),
    Object.assign(new Error("Provider returned error"), {status: 429}),
    Object.assign(new Error("429 Too Many Requests"), {status: 429}),
    new Error("429 Too Many Requests"),
    // Cloudflare answers for the provider: the status reaches FDO only inside
    // the fixed gateway sentence, with no error.status attached. Attempt 56
    // died fatally on exactly this shape ("error code: 522", no typed code).
    new Error("error code: 522"),
    new Error("  error code: 521  "),
    new Error("error code: 524"),
    Object.assign(new Error("Provider returned error"), {status: 522}),
    Object.assign(new Error("The assistant stopped sending response events for 100 seconds after the answer began."), {code: "stream_stalled"}),
    Object.assign(new Error("The assistant began an answer but did not finish within 900 seconds."), {code: "stream_stalled"}),
])("recognizes a temporary provider failure: %s", error => {
    expect(isAiCodingTransientError(error)).toBe(true);
});

test('a gateway-sentence status retries exactly once through the shared transport budget', async () => {
    const error = new Error('error code: 522');
    const budget = {remaining: 1};
    const run = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('complete');
    await expect(withCodingTransientRecovery({run, random: () => .5,
        onRetry: ({delayMs}) => expect(delayMs).toBe(2500),
        wait: async () => {}, budget,
    })).resolves.toBe('complete');
    expect(run).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(0);
});

test.each([
    new Error("No credits remaining"), new Error("network timeout"),
    new Error("Assistant stream ended before response.completed"),
    new Error("The generated tool describes overloaded servers"), limit,
    Object.assign(new Error("Quota exceeded"), {status: 503, code: "rate_limit_error"}),
    Object.assign(new Error("Invalid API key"), {status: 503}),
    Object.assign(new Error("Aborted"), {name: "AbortError", status: 503}),
    Object.assign(new Error("Request rejected"), {code: "insufficient_quota", status: 429}),
    Object.assign(new Error('No credits remaining'), {status: 408}),
    Object.assign(new Error('Request aborted'), {status: 408, code: 3008}),
    Object.assign(new Error('408'), {status: 408, errors: [{code: 3008}]}),
    Object.assign(new Error('408'), {status: 408, error: {errors: [{code: 3008}]}}),
    Object.assign(new Error('408'), {status: 408, name: 'APIUserAbortError'}),
    Object.assign(new Error('408'), {status: 408, headers: {get: key => key === 'x-should-retry' ? 'false' : null}}),
    new Error('The test reports 408 Request timeout'),
    // The gateway extractor is anchored: a status quoted inside diagnostics or
    // generated workspace text is not evidence of a transport fault, and a
    // gateway failure that is not a transient class stays permanent.
    new Error('The workspace reports error code: 522'),
    new Error('error code: 402'),
    new Error('error code: 401'),
    new Error('The assistant did not start responding within 420 seconds.'),
    new Error('The assistant stopped sending response events for 100 seconds after the answer began.'),
])("does not retry permanent or ambiguous errors: %s", async error => {
    const run = jest.fn().mockRejectedValue(error);
    await expect(withCodingTransientRecovery({run, onRetry: jest.fn()})).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
});

test("waits before restarting once, and returns only the replacement", async () => {
    const calls = [];
    const run = jest.fn()
        .mockImplementationOnce(() => { calls.push("failed"); throw overloaded(); })
        .mockImplementationOnce(() => { calls.push("replacement"); return "complete"; });
    await expect(withCodingTransientRecovery({run, random: () => .5,
        onRetry: ({delayMs}) => { expect(delayMs).toBe(2500); calls.push("reset"); },
        wait: async () => { calls.push("wait"); },
        onRetryStarted: () => { calls.push("retry-started"); },
    })).resolves.toBe("complete");
    expect(calls).toEqual(["failed", "reset", "wait", "retry-started", "replacement"]);
    expect(run.mock.calls).toEqual([[true], [false]]);
});

test("surfaces an overload that persists after the one retry", async () => {
    const error = overloaded();
    const run = jest.fn().mockRejectedValue(error);
    await expect(withCodingTransientRecovery({run, onRetry: jest.fn(), wait: async () => {}})).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(2);
});

test("a rate limit backs off longer than a server blip before the one retry", async () => {
    const error = Object.assign(new Error("Provider returned error"), {status: 429});
    const run = jest.fn().mockRejectedValueOnce(error).mockResolvedValue("complete");
    const delays = [];
    await expect(withCodingTransientRecovery({run, random: () => .5,
        onRetry: ({delayMs}) => delays.push(delayMs),
        wait: async () => {},
    })).resolves.toBe("complete");
    expect(run).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([10500]);
});

test("Stop during the actual delay prevents another provider request", async () => {
    jest.useFakeTimers();
    try {
        let cancelled = false;
        const error = overloaded();
        const run = jest.fn().mockRejectedValue(error);
        const result = withCodingTransientRecovery({run, onRetry: jest.fn(), isCancelled: () => cancelled});
        const rejection = expect(result).rejects.toBe(error);
        await jest.advanceTimersByTimeAsync(200);
        cancelled = true;
        await jest.advanceTimersByTimeAsync(100);
        await rejection;
        expect(run).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});

test.each([429, 503])('honors Retry-After on HTTP %s within the same one-retry budget', async status => {
    const error = Object.assign(new Error('Provider returned error'), {status, headers: new Headers({'retry-after': '45'})});
    const run = jest.fn().mockRejectedValueOnce(error).mockResolvedValue('complete');
    const wait = jest.fn().mockResolvedValue();
    const budget = {remaining: 1};
    await expect(withCodingTransientRecovery({run, wait, budget, onRetry: jest.fn(), random: () => 0})).resolves.toBe('complete');
    expect(wait.mock.calls[0][0]).toBe(45000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(budget.remaining).toBe(0);
});

test('reads HTTP dates and normalized numeric hints without accepting malformed header values', () => {
    const now = Date.parse('Mon, 28 Sep 2026 10:00:00 GMT');
    expect(providerRetryAfterMs({headers: {'Retry-After': 'Mon, 28 Sep 2026 10:01:00 GMT'}}, now)).toBe(60000);
    expect(providerRetryAfterMs({headers: {'Retry-After': 'Mon, 28 Sep 2026 09:59:00 GMT'}}, now)).toBe(0);
    expect(providerRetryAfterMs({headers: {'retry-after': '0.25'}}, now)).toBe(250);
    expect(providerRetryAfterMs({retryAfterMs: 45000}, now)).toBe(45000);
    for (const value of ['', '-1', 'Infinity', 'tomorrow', '1e100', {}, ['45']]) {
        expect(providerRetryAfterMs({headers: {'retry-after': value}}, now)).toBeUndefined();
    }
});

test('a long provider reset does not consume a retry or cause an earlier request', async () => {
    const error = Object.assign(new Error('Rate limited'), {status: 429, retryAfterMs: 86400000});
    const run = jest.fn().mockRejectedValue(error), wait = jest.fn(), onRetry = jest.fn();
    const budget = {remaining: 1};
    await expect(withCodingTransientRecovery({run, wait, onRetry, budget})).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(1);
    expect(wait).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
});

test('cancels an actual Retry-After wait without issuing the second request', async () => {
    jest.useFakeTimers();
    try {
        let cancelled = false;
        const error = Object.assign(new Error('Rate limited'), {status: 429, retryAfterMs: 60000});
        const run = jest.fn().mockRejectedValue(error);
        const result = withCodingTransientRecovery({run, onRetry: jest.fn(), isCancelled: () => cancelled});
        const rejection = expect(result).rejects.toBe(error);
        await jest.advanceTimersByTimeAsync(5000);
        expect(run).toHaveBeenCalledTimes(1);
        cancelled = true;
        await jest.advanceTimersByTimeAsync(100);
        await rejection;
        expect(run).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
});

test.each([[overloaded(), limit, overloaded()], [limit, overloaded(), overloaded()]])(
    "output-limit recovery and overload recovery share a three-request ceiling", async (...errors) => {
        const budget = {remaining: 1};
        const run = jest.fn();
        for (const error of errors) run.mockRejectedValueOnce(error);
        await expect(withCodingOutputRecovery({prompt: "original task", onRetry: jest.fn(),
            run: prompt => withCodingTransientRecovery({budget, run: () => run(prompt), onRetry: jest.fn(), wait: async () => {}}),
        })).rejects.toBe(errors[2]);
        expect(run).toHaveBeenCalledTimes(3);
        expect(run.mock.calls[2][0]).toContain("original task");
        expect(budget.remaining).toBe(0);
    },
);

const workerLimitMessage = 'Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (16/16)';
test.each([undefined, 200, 429, 503])('recognizes worker-capacity errors with status %s', status => {
    expect(isAiCodingTransientError(Object.assign(new Error(workerLimitMessage), {status}))).toBe(true);
});
test.each([
    new Error('ResourceExhausted: account request limit reached'),
    new Error('ResourceExhausted: Worker local total request limit reached (16/16)'),
    new Error('/index.ts: ' + workerLimitMessage),
    new Error(workerLimitMessage + ' Billing quota exceeded'),
    Object.assign(new Error(workerLimitMessage), {status: 403}),
    Object.assign(new Error(workerLimitMessage), {retryable: false}),
    Object.assign(new Error(workerLimitMessage), {name: 'AbortError'}),
])('does not mistake unrelated limits, validation errors or cancellation for worker capacity', error => {
    expect(isAiCodingTransientError(error)).toBe(false);
});
test.each([true, false])('worker capacity uses one rate-limit retry (recovers=%s)', async recovers => {
    const failure = new Error(workerLimitMessage);
    const run = jest.fn().mockRejectedValueOnce(failure);
    if (recovers) run.mockResolvedValueOnce('completed');
    else run.mockRejectedValueOnce(failure);
    const wait = jest.fn(async () => {});
    const onRetry = jest.fn();
    const budget = {remaining: 1};
    const result = withCodingTransientRecovery({run, wait, onRetry, random: () => 0, budget});
    if (recovers) await expect(result).resolves.toBe('completed');
    else await expect(result).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith({delayMs: 8000});
    expect(wait).toHaveBeenCalledTimes(1);
    expect(budget.remaining).toBe(0);
});
