import {isAiCodingOutputLimitError, withCodingOutputRecovery} from "../../src/utils/aiCodingOutputRecovery";

const limit = new Error("Assistant stream response.incomplete: max_output_tokens");
test("restarts once from the original task and returns only the complete replacement", async () => {
    const run = jest.fn().mockRejectedValueOnce(limit).mockResolvedValueOnce("complete files");
    const onRetry = jest.fn();
    await expect(withCodingOutputRecovery({prompt: "Build all five sections", run, onRetry})).resolves.toBe("complete files");
    expect(run.mock.calls[1][0]).toContain("Build all five sections");
    expect(run.mock.calls[1][0]).toContain("Preserve every requested feature");
    expect(run.mock.calls[1][1]).toBe(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
});

test("a second output limit remains a failure", async () => {
    const run = jest.fn().mockRejectedValue(limit);
    await expect(withCodingOutputRecovery({prompt: "Build", run, onRetry: jest.fn()})).rejects.toBe(limit);
    expect(run).toHaveBeenCalledTimes(2);
});

test.each(["Quota exceeded", "network timeout", "max_tokens must be less than 8192", "Assistant stream response.incomplete: content_filter"])("does not retry %s", async message => {
    const run = jest.fn().mockRejectedValue(new Error(message));
    const onRetry = jest.fn();
    await expect(withCodingOutputRecovery({prompt: "Build", run, onRetry})).rejects.toThrow(message);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
});

test("a cancelled request cannot start a recovery attempt", async () => {
    const run = jest.fn().mockRejectedValue(limit);
    const onRetry = jest.fn();
    await expect(withCodingOutputRecovery({prompt: "Build", run, onRetry, isCancelled: () => true})).rejects.toBe(limit);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
});

test("cancellation during the restart notification also prevents another request", async () => {
    let cancelled = false;
    const run = jest.fn().mockRejectedValue(limit);
    await expect(withCodingOutputRecovery({prompt: "Build", run, onRetry: () => {cancelled = true;}, isCancelled: () => cancelled})).rejects.toBe(limit);
    expect(run).toHaveBeenCalledTimes(1);
});

test.each(["max_output_tokens", "max_tokens"])("recognizes normalized output limit %s", reason => {
    expect(isAiCodingOutputLimitError(`Assistant stream response.incomplete: ${reason}`)).toBe(true);
});
