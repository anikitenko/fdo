import {expect, jest, test} from '@jest/globals';
import {loadPluginHostDocument} from '../../src/components/plugin/utils/loadPluginHostDocument';

test('shares an in-flight host fetch and HTML parse across frames and refreshes', async () => {
    let finish;
    const text = jest.fn(() => /* language=TEXT */ '<html lang="end"><head><script src="./host.js"></script></head><body>Host</body></html>');
    const pending = new Promise(resolve => {finish = () => resolve(undefined);});
    const fetcher = jest.fn(async () => {await pending;return {ok: true, text};});
    const parse = jest.spyOn(DOMParser.prototype, 'parseFromString');
    try {
        const first = loadPluginHostDocument(fetcher), second = loadPluginHostDocument(fetcher);
        expect(first).toBe(second);
        await Promise.resolve();
        finish();
        expect(await first).toContain('static://host/host.js');
        expect(await loadPluginHostDocument(fetcher)).toBe(await first);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(text).toHaveBeenCalledTimes(1);
        expect(parse).toHaveBeenCalledTimes(1);
    } finally {parse.mockRestore();}
});

test.each([{mode: 'transport'}, {mode: 'http'}])('failed $mode requests are evicted so a retry can succeed', async ({mode}) => {
    const fetcher = jest.fn(async () => ({ok: true, status: 200, text: async () => ''}));
    if (mode === 'transport') fetcher.mockRejectedValueOnce(new Error('Temporarily unavailable'));
    else fetcher.mockResolvedValueOnce({ok: false, status: 503, text: async () => ''});
    fetcher.mockResolvedValueOnce({ok: true, status: 200, text: async () => '<main>Recovered</main>'});
    await expect(loadPluginHostDocument(fetcher)).rejects.toThrow();
    await expect(loadPluginHostDocument(fetcher)).resolves.toContain('Recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a hung static request times out, aborts, and leaves a fresh retry available', async () => {
    jest.useFakeTimers();
    try {
        const fetcher = jest.fn(async () => ({ok: true, text: async () => '<main>Retried</main>'})).mockImplementationOnce(() => new Promise(() => {}))
            .mockResolvedValueOnce({ok: true, text: async () => '<main>Retried</main>'});
        const first = loadPluginHostDocument(fetcher);
        const failure = expect(first).rejects.toThrow('timed out');
        await Promise.resolve();
        jest.advanceTimersByTime(10000);
        await failure;
        expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
        await expect(loadPluginHostDocument(fetcher)).resolves.toContain('Retried');
    } finally {jest.useRealTimers();}
});
