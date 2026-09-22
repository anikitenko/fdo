import {isAiCodingTransientError, isAiCodingProviderTimeoutError, withCodingTransientRecovery} from "../../src/utils/aiCodingTransientRecovery";
import {withCodingOutputRecovery} from "../../src/utils/aiCodingOutputRecovery";

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
])("recognizes a temporary provider failure: %s", error => {
    expect(isAiCodingTransientError(error)).toBe(true);
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
    new Error('The assistant did not start responding within 420 seconds.'),
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
