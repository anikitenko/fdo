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

    test("does not treat source code error handling or test fixtures as a reported failure", () => {
        expect(classifyAiCodingIssueScope({
            prompt: "Explain the selected code",
            selectedCode: 'try { parse(input); } catch (error) { output.textContent = "Error: invalid JSON"; }\nconst expected = "TypeError: goober is unavailable in plugin host environment";',
        })).toEqual({kind: "none", summary: ""});
    });

    test("generic compiler/test errors do not claim a confirmed current runtime failure", () => {
        const result = classifyAiCodingIssueScope({
            prompt: "Fix this test",
            problemsContext: "Recent test output:\nAssertionError: expected uppercase output",
        });
        expect(result.kind).toBe("plugin");
        expect(result.summary).toBe("Reported error included in the request context.");
        expect(result.summary).not.toContain("runtime diagnostics identify");
    });

    test("does not diagnose a new plugin from stale SDK/host problem markers", () => {
        const result = classifyAiCodingIssueScope({
            prompt: "Create a compact JSON Inspector plugin with a polished iframe UI.",
            problemsContext: "TypeError: SDK host runtime failed in window.createBackendReq",
        });

        expect(result).toEqual({kind: "none", summary: ""});
    });

    test("does not infer an SDK/host failure from ordinary authoring instructions", () => {
        const result = classifyAiCodingIssueScope({
            prompt: "Build a plugin with FDO_SDK that renders inside an iframe in the plugin host runtime.",
        });

        expect(result).toEqual({kind: "none", summary: ""});
    });

    test("keeps an unexpected plugin-process exit unclassified until logs identify its cause", () => {
        const result = classifyAiCodingIssueScope({
            prompt: "Plugin process stopped unexpectedly while rendering an FDO_SDK iframe plugin.",
        });

        expect(result.kind).toBe("runtime");
        expect(result.summary).toContain("before rendering");
        expect(result.summary).not.toContain("SDK/host runtime contract");
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
