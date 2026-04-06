import {classifyAiCodingIssueScope, shouldIncludeIssueDiagnosis} from "../../src/components/editor/utils/aiCodingAgentIssueScope.js";

describe("ai coding agent issue scope", () => {
    test("classifies sdk-host runtime failures", () => {
        const result = classifyAiCodingIssueScope({
            prompt: `
UnhandledPromiseRejectionWarning: Error: goober css helper is unavailable in the plugin host environment.
at getGooberCss
at errorUIRenderer
            `,
        });

        expect(result.kind).toBe("sdk-host");
        expect(result.summary).toContain("SDK/host runtime");
    });

    test("classifies plugin implementation issues", () => {
        const result = classifyAiCodingIssueScope({
            prompt: "TypeError in my plugin render() and metadata.icon handling",
        });

        expect(result.kind).toBe("plugin");
    });

    test("returns none for generic prompts", () => {
        const result = classifyAiCodingIssueScope({
            prompt: "Can you help me build a new plugin?",
        });

        expect(result.kind).toBe("none");
        expect(result.summary).toBe("");
    });

    test("does not inject diagnosis for generation-style prompts", () => {
        expect(shouldIncludeIssueDiagnosis({
            prompt: "I want a plugin like switchhosts.app with SDK best practices",
            action: "smart",
        })).toBe(false);
        expect(shouldIncludeIssueDiagnosis({
            prompt: "Generate production-grade plugin scaffold",
            action: "generate",
        })).toBe(false);
        expect(shouldIncludeIssueDiagnosis({
            prompt: "Build a production-grade plugin with clear error toasts and tests",
            action: "smart",
        })).toBe(false);
    });

    test("injects diagnosis for troubleshooting prompts", () => {
        expect(shouldIncludeIssueDiagnosis({
            prompt: "Please diagnose why this plugin crashes with TypeError",
            action: "smart",
        })).toBe(true);
        expect(shouldIncludeIssueDiagnosis({
            prompt: "explain root cause of this failing behavior",
            action: "explain",
        })).toBe(true);
    });
});
