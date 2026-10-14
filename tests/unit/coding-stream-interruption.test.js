/** @jest-environment node */
import {readCodingStreamEvents} from '../../src/utils/ai/generation/codingLlmStream';
import {isAiCodingTransientError, withCodingTransientRecovery} from '../../src/utils/ai/assistant/aiCodingTransientRecovery';

const body = (failure, cancelFailure = failure) => {
    const reader = {read: jest.fn()
        .mockResolvedValueOnce({done: false, value: new TextEncoder().encode('data: {"text":"partial"}\n\n')})
        .mockRejectedValueOnce(failure),
    cancel: jest.fn().mockRejectedValue(cancelFailure), releaseLock: jest.fn()};
    return {getReader: () => reader, reader};
};
const collect = async stream => {
    const events = [];
    for await (const event of readCodingStreamEvents(stream)) events.push(event);
    return events;
};

test('terminated body read replays once and discards incomplete attempt results', async () => {
    const failure = new TypeError('terminated', {cause: Object.assign(new Error('socket closed'), {code: 'UND_ERR_SOCKET'})});
    const stream = body(failure);
    const run = jest.fn().mockImplementationOnce(() => collect(stream)).mockResolvedValueOnce([{text: 'complete'}]);
    await expect(withCodingTransientRecovery({run, onRetry: jest.fn(), wait: async () => {}})).resolves.toEqual([{text: 'complete'}]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(stream.reader.releaseLock).toHaveBeenCalledTimes(1);
});

test.each([
    Object.assign(new TypeError('terminated'), {name: 'AbortError'}),
    new TypeError('terminated', {cause: Object.assign(new Error('aborted'), {code: 'ABORT_ERR'})}),
    Object.assign(new TypeError('terminated'), {retryable: false}),
    new SyntaxError('invalid provider event'),
    new Error('terminated'),
])('cleanup preserves non-retryable failures: %s', async failure => {
    await expect(collect(body(failure, new TypeError('terminated')))).rejects.toBe(failure);
    expect(isAiCodingTransientError(failure)).toBe(false);
});

test('a second interruption exhausts the existing retry allowance', async () => {
    const run = jest.fn(() => collect(body(new TypeError('terminated'))));
    await expect(withCodingTransientRecovery({run, onRetry: jest.fn(), wait: async () => {}})).rejects.toMatchObject({code: 'stream_incomplete'});
    expect(run).toHaveBeenCalledTimes(2);
});

test('cleanup cannot invalidate a stream that reached DONE', async () => {
    const stream = body(new TypeError('terminated'));
    stream.reader.read.mockReset().mockResolvedValueOnce({done: false, value: new TextEncoder().encode('data: {"text":"complete"}\n\ndata: [DONE]\n\n')});
    await expect(collect(stream)).resolves.toEqual([{text: 'complete'}]);
});
