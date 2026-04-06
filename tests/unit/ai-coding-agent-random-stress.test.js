import {resolveAiCodingAgentAction} from "../../src/components/editor/utils/aiCodingAgentRouting.js";
import {shouldExecuteWorkspacePlan} from "../../src/components/editor/utils/aiCodingAgentExecutionIntent.js";
import {shouldCreateProjectFiles} from "../../src/components/editor/utils/aiCodingAgentFileIntent.js";

function createSeededRng(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
}

function makeRandomQuestionPrompt(rng) {
    const openers = [
        "can you explain",
        "what is",
        "why does",
        "is it expected that",
        "how can i verify",
        "could you clarify",
    ];
    const topics = [
        "plugin logs are empty after init",
        "runtime says ready but ui is invisible",
        "capability denied appears for hosts write",
        "signature check failed after reload",
        "why iframe is mounted but nothing is visible",
        "whether dry run should change files",
        "if plugin close event is manual or crash",
        "how diagnostics should be interpreted",
    ];
    const suffixes = [
        "without changing code yet?",
        "for the current plugin behavior?",
        "from developer UX perspective?",
        "in short and practical terms?",
        "and what should i check first?",
        "with a clear troubleshooting flow?",
    ];

    return `${pick(rng, openers)} ${pick(rng, topics)} ${pick(rng, suffixes)}`;
}

describe("ai coding agent random question stress", () => {
    const workspaceFiles = [
        { path: "/index.ts", content: "export default class Plugin {}" },
        { path: "/render.tsx", content: "export const render = () => null;" },
    ];

    test("question-style prompts do not route into workspace execution or plan/file-creation flows", () => {
        const rng = createSeededRng(1774687257);
        const prompts = Array.from({ length: 250 }, () => makeRandomQuestionPrompt(rng));

        for (const prompt of prompts) {
            const action = resolveAiCodingAgentAction({
                requestedAction: "smart",
                prompt,
                selectedCode: "",
                previousResponse: "",
                workspaceFiles,
            });

            expect(action).not.toBe("plan");
            expect(shouldExecuteWorkspacePlan({
                prompt,
                previousResponse: "",
                workspaceFiles,
            })).toBe(false);
            expect(shouldCreateProjectFiles({
                prompt,
                previousResponse: "",
                workspaceFiles,
            })).toBe(false);
        }
    });

    test("generic confirmation prompts with stale prose context never trigger workspace execution", () => {
        const stalePreviousResponse = `
            Implementation Summary: Editor close reliability fix.
            See specs/006-fix-editor-close/tasks.md for pending checklist items.
            Validation surface present in workspace tests.
        `;
        const confirmations = [
            "yes, please make those changes",
            "ok proceed",
            "sure go ahead",
            "please do it",
            "yes continue",
        ];

        confirmations.forEach((prompt) => {
            expect(shouldExecuteWorkspacePlan({
                prompt,
                previousResponse: stalePreviousResponse,
                workspaceFiles,
            })).toBe(false);
        });
    });
});
