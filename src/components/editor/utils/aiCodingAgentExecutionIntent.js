import {detectAiCodingPragmaticIntent} from "./aiCodingAgentPragmaticIntent.js";
import {hasHostAppFileReference} from "./aiCodingAgentScopeBoundary.js";

function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

export function shouldExecuteWorkspacePlan({ prompt = "", previousResponse = "", workspaceFiles = [] } = {}) {
    const normalizedPrompt = normalizeText(prompt);
    const pragmaticIntent = detectAiCodingPragmaticIntent({ prompt, previousResponse: "" });
    const normalizedPrevious = String(previousResponse || "");
    const previousLooksExecutablePlan = /###\s*File:\s*\/[^\s]+/i.test(normalizedPrevious)
        || /```(?:[a-z]+)?[\s\S]*?```/i.test(normalizedPrevious);
    const runtimeLogVerificationIntent =
        /\b(log|logs|stderr|stdout|trace|runtime)\b/.test(normalizedPrompt)
        && /\b(confirm|verify|check|whether|exists?|present|contains?|found)\b/.test(normalizedPrompt);

    if (hasHostAppFileReference([prompt, previousResponse].filter(Boolean).join("\n"), workspaceFiles)) {
        return false;
    }

    if (runtimeLogVerificationIntent) {
        return false;
    }

    const implementationSignals = [
        "proceed with implementation",
        "continue with implementation",
        "implement from",
        "continue from",
        "work through",
        "do the work",
        "start implementing",
        "proceed",
        "continue",
        "fix my current plugin",
        "fix this plugin",
        "fix current plugin implementation",
        "fix my plugin implementation",
        "update the current plugin",
        "improve the current plugin",
        "make it best practice",
        "make it production grade",
        "according to sdk",
    ];
    const taskSourceSignals = [
        "todo",
        "todo.md",
        "checklist",
        "plan",
        "plan.md",
        "spec",
        "spec.md",
    ];
    const workspaceSignals = [
        "current plugin",
        "this plugin",
        "my plugin",
        "current implementation",
        "existing plugin",
        "plugin implementation",
    ];
    const advisorySignals = [
        "steps to test",
        "test steps",
        "how to test",
        "what to test",
        "provide me with steps",
        "provide steps",
        "before marking",
        "before mark",
        "before marking as completed",
        "testing instructions",
        "manual test",
        "qa steps",
        "verification steps",
    ];
    const confirmationSignals = [
        "yes",
        "yep",
        "yeah",
        "sure",
        "okay",
        "ok",
        "please do",
        "do that",
        "do it",
        "make those changes",
        "apply those changes",
        "go ahead",
    ];

    if (advisorySignals.some((signal) => normalizedPrompt.includes(signal)) || pragmaticIntent.verificationOnly) {
        return false;
    }

    const wantsImplementation = implementationSignals.some((signal) => normalizedPrompt.includes(signal));
    const hasTaskSource = taskSourceSignals.some((signal) => normalizedPrompt.includes(signal));
    const hasWorkspaceTarget = workspaceSignals.some((signal) => normalizedPrompt.includes(signal));
    const isConfirmationOnly = normalizedPrompt.length <= 140
        && confirmationSignals.some((signal) => normalizedPrompt.includes(signal))
        && !hasTaskSource
        && !hasWorkspaceTarget;

    if (isConfirmationOnly && !previousLooksExecutablePlan) {
        return false;
    }

    const followUpExecutionFromPlan = isConfirmationOnly && previousLooksExecutablePlan;

    return (wantsImplementation || pragmaticIntent.executionIntent || followUpExecutionFromPlan)
        && (hasTaskSource || hasWorkspaceTarget || followUpExecutionFromPlan);
}

export function buildWorkspaceExecutionPlanPrompt({ prompt = "", previousResponse = "" } = {}) {
    const trimmedPreviousResponse = String(previousResponse || "").trim();
    const priorContextNote = trimmedPreviousResponse
        ? "Use the existing workspace files and task-tracking files as the source of truth. Do not depend on the prior prose response unless it is confirmed by those files.\n\n"
        : "";

    return `EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\n\n${priorContextNote}User request:\n${prompt}\n\nImplement the requested work in the current virtual workspace using the referenced task files as the source of truth.\nReturn the result ONLY as executable file sections in this format:\n\n### File: /path/to/file\n\`\`\`ts\n...updated file content...\n\`\`\`\n\nIf task-tracking files such as /TODO.md are part of the work, update them to mark completed items accurately based on the implemented changes.\nDo not return prose-only guidance. Return concrete file sections that can be applied to the virtual workspace.`;
}
