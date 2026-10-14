import {enforceCodingResponseSize} from '../../src/utils/ai/generation/codingResponseSize';
import {isAiCodingOutputLimitError} from '../../src/utils/ai/assistant/aiCodingOutputRecovery';

test('stops at the first oversized chunk before consuming or completing the response', async () => {
    const abort = jest.fn();
    const completed = jest.fn();
    const trailing = jest.fn();
    let released = false;
    async function* stream() {
        try { yield '1234'; yield '5678'; trailing(); yield 'more'; }
        finally { released = true; }
    }
    let content = '';
    let failure;
    try {
        for await (const piece of stream()) {
            enforceCodingResponseSize(content.length + piece.length, 6, abort);
            content += piece;
        }
        completed();
    } catch (error) { failure = error; }
    expect(isAiCodingOutputLimitError(failure)).toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(trailing).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    expect(released).toBe(true);
    expect(content).toBe('1234');
});

test('accepts the exact boundary and leaves requests without a bound alone', () => {
    expect(() => enforceCodingResponseSize(10, 10)).not.toThrow();
    expect(() => enforceCodingResponseSize(100, undefined)).not.toThrow();
});
