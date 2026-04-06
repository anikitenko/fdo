import {detectAiCodingPragmaticIntent} from "../../src/components/editor/utils/aiCodingAgentPragmaticIntent.js";
import {resolveAiCodingAgentAction} from "../../src/components/editor/utils/aiCodingAgentRouting.js";
import {shouldExecuteWorkspacePlan} from "../../src/components/editor/utils/aiCodingAgentExecutionIntent.js";
import {extractProjectFileTargets} from "../../src/components/editor/utils/aiCodingAgentFileIntent.js";

describe("ai coding agent pragmatic intent", () => {
    test("handles mixed fix + verification + low-rewrite prompt", () => {
        const prompt = "ugh this thing is broken just fix current plugin but don't rewrite everything and give me what to test before marking done";
        const intent = detectAiCodingPragmaticIntent({ prompt });

        expect(intent.primaryIntent).toBe("fix");
        expect(intent.verificationIntent).toBe(true);
        expect(intent.rewriteTolerance).toBe("low");
        expect(intent.autoMarkDoneAllowed).toBe(false);
    });

    test("keeps verification-only prompt out of execution mode", () => {
        const prompt = "please give me steps to test before marking completed after my testing";

        expect(shouldExecuteWorkspacePlan({ prompt, previousResponse: "" })).toBe(false);
    });

    test("does not turn todo follow-up verification into file creation", () => {
        const prompt = "continue with TODO and mark what was completed after my testing";

        expect(extractProjectFileTargets({ prompt, previousResponse: "" })).toEqual([]);
    });

    test("routes messy selected-code fix prompt to fix", () => {
        const prompt = "omfg this is broken can you fix it but don't rewrite too much";

        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt,
            selectedCode: "const value = broken();",
            previousResponse: "",
        })).toBe("fix");
    });

    test("treats failing-test prompts as fix intent", () => {
        const intent = detectAiCodingPragmaticIntent({
            prompt: "tests are failing please fix",
        });

        expect(intent.primaryIntent).toBe("fix");
    });

    test("keeps advisory test questions out of fix intent", () => {
        const intent = detectAiCodingPragmaticIntent({
            prompt: "how tests are working in this plugin?",
        });

        expect(intent.primaryIntent).toBe("advisory");
    });

    test("routes advisory messy prompt to smart", () => {
        const prompt = "okay maybe help me think through this plugin, i am tired and not sure";

        expect(resolveAiCodingAgentAction({
            requestedAction: "smart",
            prompt,
            selectedCode: "",
            previousResponse: "",
        })).toBe("smart");
    });
});
