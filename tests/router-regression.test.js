import {
    resolveTurnIntent,
    resolveToolPolicyFromIntent,
    shouldUseSemanticRouter,
} from "../src/ipc/ai/tools/index.js";
import { ROUTER_EVAL_CASES } from "./router-eval-cases.js";

function sortStrings(values = []) {
    return [...values].sort((a, b) => a.localeCompare(b));
}

describe("AI chat router regression set", () => {
    const metrics = {
        total: 0,
        routeAccuracy: 0,
        staleRouteErrors: 0,
        unnecessaryClarifications: 0,
        wrongToolActivations: 0,
    };

    afterAll(() => {
        // Keep the harness metrics visible in test output.
        // This is not production telemetry, but it makes router regressions measurable in CI/manual runs.
        console.log("[RouterEval] metrics", metrics);
    });

    for (const testCase of ROUTER_EVAL_CASES) {
        test(`${testCase.id}: ${testCase.description}`, () => {
            metrics.total += 1;

            const intent = resolveTurnIntent(
                testCase.prompt,
                testCase.history || [],
                testCase.sessionRouting || null
            );
            const toolPolicy = resolveToolPolicyFromIntent(intent, testCase.prompt);
            const useSemantic = shouldUseSemanticRouter(intent, testCase.sessionRouting || null);

            try {
                expect(intent.route).toBe(testCase.expected.route);
                metrics.routeAccuracy += 1;
            } catch (err) {
                if ((testCase.sessionRouting?.activeRoute || "general") !== testCase.expected.route) {
                    metrics.staleRouteErrors += 1;
                }
                throw err;
            }

            if (testCase.expected.scope) {
                expect(intent.scope).toBe(testCase.expected.scope);
            }

            if (typeof testCase.expected.topicShift === "boolean") {
                expect(!!intent.topicShift).toBe(testCase.expected.topicShift);
            }

            if (typeof testCase.expected.minConfidence === "number") {
                expect(intent.confidence).toBeGreaterThanOrEqual(testCase.expected.minConfidence);
            }

            if (typeof testCase.expected.maxConfidence === "number") {
                expect(intent.confidence).toBeLessThanOrEqual(testCase.expected.maxConfidence);
            }

            if (typeof testCase.expected.useSemanticRouter === "boolean") {
                expect(useSemantic).toBe(testCase.expected.useSemanticRouter);
                if (!testCase.expected.useSemanticRouter && intent.route === "general" && testCase.expected.route !== "general") {
                    metrics.unnecessaryClarifications += 1;
                }
            }

            expect(toolPolicy.policy).toBe(testCase.expected.policy);

            const actualTools = sortStrings((toolPolicy.allowedTools || []).map((tool) => tool.name));
            const expectedTools = sortStrings(testCase.expected.tools || []);

            try {
                expect(actualTools).toEqual(expectedTools);
            } catch (err) {
                metrics.wrongToolActivations += 1;
                throw err;
            }
        });
    }
});
