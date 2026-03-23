import {
    applyCompressedUsageCap,
    computeModelUsageStats,
    computeUsagePercent,
    formatUsagePercentDisplay,
} from "../../src/utils/aiChatStats.js";

describe("AI chat token usage stats", () => {
    test("computes exact percentage with one decimal of precision", () => {
        expect(computeUsagePercent(2432, 121600)).toBe(2);
        expect(computeUsagePercent(1946, 121600)).toBe(1.6);
        expect(computeUsagePercent(0, 121600)).toBe(0);
    });

    test("formats integer percentages without inventing extra decimals", () => {
        expect(formatUsagePercentDisplay(2)).toBe("2");
        expect(formatUsagePercentDisplay(2.0)).toBe("2");
    });

    test("formats fractional percentages without misleading integer rounding", () => {
        expect(formatUsagePercentDisplay(1.6)).toBe("1.6");
        expect(formatUsagePercentDisplay(1.64)).toBe("1.6");
        expect(formatUsagePercentDisplay(1.66)).toBe("1.7");
    });

    test("current UI example stays mathematically consistent", () => {
        const maxTokens = 121600;
        const used = 2432;
        const percentUsed = computeUsagePercent(used, maxTokens);

        expect(percentUsed).toBe(2);
        expect(`${formatUsagePercentDisplay(percentUsed)}% of ${maxTokens.toLocaleString()} tokens`)
            .toBe("2% of 121,600 tokens");
    });

    test("model usage stats stay consistent for long conversations", () => {
        const messages = [
            { role: "user", content: "a".repeat(4000) },
            { role: "assistant", content: "b".repeat(6000), model: "gpt-test" },
            { role: "user", content: "c".repeat(2000), replyContext: "d".repeat(1000) },
        ];

        const stats = computeModelUsageStats(messages, 121600, 500);

        expect(stats.estimatedUsed).toBeGreaterThan(0);
        expect(stats.percentUsed).toBe(computeUsagePercent(stats.estimatedUsed, 121600));
        expect(stats.percentUsed).toBeLessThan(100);
    });

    test("compression cap preserves 20 percent headroom", () => {
        const capped = applyCompressedUsageCap(98000, 100000, 0.2);

        expect(capped.maxUsedAfterCompression).toBe(80000);
        expect(capped.estimatedUsed).toBe(80000);
        expect(capped.percentUsed).toBe(80);
    });

    test("compression cap does not inflate already-safe usage", () => {
        const capped = applyCompressedUsageCap(32000, 100000, 0.2);

        expect(capped.maxUsedAfterCompression).toBe(80000);
        expect(capped.estimatedUsed).toBe(32000);
        expect(capped.percentUsed).toBe(32);
    });
});
