import {fetchWithTimeout} from "../../src/utils/fetchWithTimeout.js";

describe("fetchWithTimeout", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
    });

    test("passes an abort signal to fetch", async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true });

        await fetchWithTimeout("https://example.com", { method: "GET" }, 5000);

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][1].signal).toBeTruthy();
    });

    test("aborts slow fetches after timeout", async () => {
        jest.useFakeTimers();

        global.fetch = jest.fn((_url, options = {}) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            });
        }));

        const pending = fetchWithTimeout("https://example.com", {}, 25);
        jest.advanceTimersByTime(30);

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
});
