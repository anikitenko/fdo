import {
    isQuestionLikeAiCodingPrompt,
    mergeAiCodingRouteDecision,
    resolveAiCodingAgentAction,
    shouldUseAiRoutingJudge,
} from "../../src/components/editor/utils/aiCodingAgentRouting.js";

describe("ai coding agent routing", () => {
    test("keeps explicit non-smart actions unchanged", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "plan",
            prompt: "Build a new plugin",
            selectedCode: "",
        })).toBe("plan");
    });

    test("routes fresh new-plugin requests from smart mode to plan mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "I want a new plugin production grade but even better than https://switchhosts.app.. please do something",
            selectedCode: "",
        })).toBe("smart");
    });

    test("keeps smart mode for plugin-like scaffold prompts that mention UX errors but are not troubleshooting", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "I want a plugin like https://switchhosts.app with dry-run, tests, and clear error toasts.",
            selectedCode: "",
        })).toBe("smart");
    });

    test("routes explicit scaffold requests from smart mode to plan mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "Create a new plugin scaffold for a hosts manager inspired by switchhosts",
            selectedCode: "",
        })).toBe("plan");
    });

    test("keeps smart mode for selected-code tasks", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "Improve this implementation",
            selectedCode: "function x() {}",
        })).toBe("edit");
    });

    test("routes selected-code explanation asks to explain", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "Explain what this does",
            selectedCode: "function x() {}",
        })).toBe("explain");
    });

    test("routes selected-code bug asks to fix", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "Fix this broken implementation",
            selectedCode: "function x() {}",
        })).toBe("fix");
    });

    test("follow-up prompts should be routed by the new user ask, not prior scaffold text", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "yes, please and currently I'm running on MacOS but solution must be agnostic to OS",
            selectedCode: "",
        })).toBe("smart");
    });

    test("routes TODO implementation prompts to plan mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "so can you please proceed with implementation from TODO and mark completed items after testing",
            selectedCode: "",
        })).toBe("plan");
    });

    test("routes current plugin best-practice fixes to plan mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "please fix my current plugin implementation and make it best practice according to SDK",
            selectedCode: "",
        })).toBe("plan");
    });

    test("routes failing test fix prompts to fix mode instead of scaffold mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "tests are failing please fix",
            selectedCode: "",
        })).toBe("fix");
    });

    test("routes current problems prompts to fix mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "please fix current problems in code",
            selectedCode: "",
        })).toBe("fix");
    });

    test("keeps advisory test questions in smart mode", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "how tests are working in this plugin?",
            selectedCode: "",
        })).toBe("smart");
    });

    test("does not treat polite mutation asks as advisory questions", () => {
        expect(isQuestionLikeAiCodingPrompt("can you please make name of plugin from undefined to a better name?")).toBe(false);
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "can you please make name of plugin from undefined to a better name?",
            selectedCode: "",
        })).toBe("generate");
    });

    test("does not treat creative metadata naming asks as advisory questions", () => {
        expect(isQuestionLikeAiCodingPrompt("can you please use for plugin name in metadata something more creative?")).toBe(false);
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "can you please use for plugin name in metadata something more creative?",
            selectedCode: "",
        })).toBe("generate");
    });

    test("routes non-plugin generation asks to generate", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "Create a validation function for host entries",
            selectedCode: "",
        })).toBe("generate");
    });

    test("keeps host-app file follow-ups in smart mode instead of generating plugin workspace changes", () => {
        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt: "please fix PluginPage.jsx and ai_coding_agent.js",
            previousResponse: "Look at /Users/alexvwan/dev/fdo/src/ipc/ai_coding_agent.js and src/components/plugin/PluginPage.jsx",
            selectedCode: "",
            workspaceFiles: [{ path: "/index.ts", content: "export default {}" }],
        })).toBe("smart");
    });

    test("uses route judge for ambiguous high-risk smart turns", () => {
        expect(shouldUseAiRoutingJudge({
            requestedAction: "smart",
            prompt: "yes, please make those changes",
            selectedCode: "",
            deterministicAction: "plan",
            createProjectFiles: false,
            executeWorkspacePlan: true,
        })).toBe(true);
    });

    test("uses route judge for verification prompts even when code is selected", () => {
        expect(shouldUseAiRoutingJudge({
            requestedAction: "fix",
            prompt: "but can you please checkout plugin logs to confirm?",
            selectedCode: "public init(): void { this.log('x'); }",
            deterministicAction: "smart",
            createProjectFiles: false,
            executeWorkspacePlan: false,
        })).toBe(true);
    });

    test("skips route judge for explicit mutating smart prompts", () => {
        expect(shouldUseAiRoutingJudge({
            requestedAction: "smart",
            prompt: "please change plugin's name in metadata from undefined to something more useful",
            selectedCode: "",
            deterministicAction: "generate",
            createProjectFiles: false,
            executeWorkspacePlan: false,
        })).toBe(false);
    });

    test("judge blocks mutating route when turn is really a question", () => {
        expect(mergeAiCodingRouteDecision({
            requestedAction: "smart",
            prompt: "can you check logs and verify init is working?",
            deterministicAction: "fix",
            judge: {
                available: true,
                route: "smart",
                confidence: 0.96,
                intent: {
                    isQuestion: true,
                    asksForCodeChange: false,
                    asksForFileCreation: false,
                    asksForPlanExecution: false,
                    isFollowupConfirmation: false,
                },
            },
        })).toMatchObject({
            action: "smart",
            downgraded: true,
            reason: "judge-blocked-mutation",
        });
    });

    test("judge upgrades deterministic smart mode only for explicit high-confidence mutation intent", () => {
        expect(mergeAiCodingRouteDecision({
            requestedAction: "smart",
            prompt: "please create a helper function to normalize host entries",
            deterministicAction: "smart",
            judge: {
                available: true,
                route: "generate",
                confidence: 0.92,
                intent: {
                    isQuestion: false,
                    asksForCodeChange: true,
                    asksForFileCreation: false,
                    asksForPlanExecution: false,
                    isFollowupConfirmation: false,
                },
            },
        })).toMatchObject({
            action: "generate",
            reason: "judge-upgraded-deterministic",
        });
    });

    test("conflicting mutating routes downgrade to smart", () => {
        expect(mergeAiCodingRouteDecision({
            requestedAction: "smart",
            prompt: "please continue with implementation",
            deterministicAction: "plan",
            judge: {
                available: true,
                route: "fix",
                confidence: 0.9,
                intent: {
                    isQuestion: false,
                    asksForCodeChange: true,
                    asksForFileCreation: false,
                    asksForPlanExecution: false,
                    isFollowupConfirmation: true,
                },
            },
            executeWorkspacePlan: true,
        })).toMatchObject({
            action: "smart",
            downgraded: true,
            reason: "mutating-route-conflict",
        });
    });
});
