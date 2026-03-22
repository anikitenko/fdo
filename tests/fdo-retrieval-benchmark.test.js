import { buildFdoSearchResult, findFdoMatches } from "../src/ipc/ai/tools/search_fdo_shared.js";
import { FDO_RETRIEVAL_BENCHMARK_CASES } from "./fdo-retrieval-benchmark-cases.js";

function containsAny(text = "", needles = []) {
    const haystack = String(text || "").toLowerCase();
    return needles.some((needle) => haystack.includes(String(needle).toLowerCase()));
}

describe("FDO retrieval benchmark set", () => {
    const metrics = {
        total: 0,
        passed: 0,
        emptyResults: 0,
        weakSourceMatches: 0,
    };

    afterAll(() => {
        console.log("[FDOBenchmark] metrics", metrics);
    });

    for (const testCase of FDO_RETRIEVAL_BENCHMARK_CASES) {
        test(`${testCase.id}: ${testCase.category}`, () => {
            metrics.total += 1;

            const results = findFdoMatches(testCase.query, {
                mode: testCase.mode,
                scope: testCase.scope,
            });
            const built = buildFdoSearchResult(
                testCase.mode === "help" ? "search_fdo_help" : "search_fdo_code",
                testCase.query,
                results,
                testCase.mode,
                testCase.scope
            );

            try {
                expect(results.length).toBeGreaterThanOrEqual(testCase.minResults || 1);
            } catch (err) {
                metrics.emptyResults += 1;
                throw err;
            }

            expect(built.ok).toBe(true);
            expect(Array.isArray(built.results)).toBe(true);
            expect(Array.isArray(built.sources)).toBe(true);
            expect(built.data?.metadata?.mode).toBe(testCase.mode);
            expect(built.data?.metadata?.scope).toBe(testCase.scope);
            expect((built.data?.metadata?.retrievalConfidence || 0)).toBeGreaterThan(0);

            const combinedDisplaySources = built.results.map((item) => item.displaySource || item.source).join(" | ");
            const combinedRawSources = built.results.map((item) => item.source).join(" | ");

            if (Array.isArray(testCase.expectedSourcesAny)) {
                try {
                    expect(containsAny(combinedDisplaySources, testCase.expectedSourcesAny)).toBe(true);
                } catch (err) {
                    metrics.weakSourceMatches += 1;
                    throw err;
                }
            }

            if (Array.isArray(testCase.expectedRawSourcesAny)) {
                try {
                    expect(containsAny(combinedRawSources, testCase.expectedRawSourcesAny)).toBe(true);
                } catch (err) {
                    metrics.weakSourceMatches += 1;
                    throw err;
                }
            }

            metrics.passed += 1;
        });
    }
});
