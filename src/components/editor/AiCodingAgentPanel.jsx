import {isInvestigationPrompt, investigationAllowsRepair, investigationBudget, runCodingInvestigation, createInvestigationActions, initialInvestigationActions} from './utils/aiCodingAgentInvestigation';
import {pluginGuideRecoveryMetadata} from '../../utils/ai/assistant/pluginGuideRecovery';
import {generationRecoveryReducer, initialGenerationRecovery} from './utils/aiGenerationRecoveryState';
import AiCodingConfidence from '../ai/AiCodingConfidence';
import {isClassificationOnly} from '../../utils/ai/assistant/aiCodingClassification';
import {aiCodingConfidence, pluginTestsVerificationCheck} from '../../utils/ai/assistant/aiCodingConfidence';
import {assistantInputCapabilities, imageSupportLabel, imageSupportOptionSuffix} from '../../utils/ai/assistant/aiAssistantInputCapabilities';
import {hasStrictTestRepairProgress} from './utils/aiTestRepairProgress';
import {stagePendingFiles, startPendingFiles, updatePendingFiles} from './utils/aiPendingFiles';
import {runCandidateTests} from './utils/runCandidateTests';
import {assertValidationRecoveryCurrent, retainValidationRecovery} from './utils/aiValidationRecovery';
import AiUsagePopover from "../ai-chat/AiUsagePopover";
import {repairGeneratedUnusedImports} from '../../utils/plugins/validation/generatedUnusedImports';
import FdoAiMark from "../ai/FdoAiMark";
import AiTimeEstimate from '../ai/AiTimeEstimate';
import {createCodingEstimator} from '../../utils/ai/assistant/aiCodingEstimate';
import React, {useEffect, useMemo, useReducer, useRef, useState} from "react";
import {rasterImagePreview} from './utils/rasterImagePreview';
import PluginAuthoringContract from '../plugin/PluginAuthoringContract';
import {workspaceAuthoringContract} from '../../utils/sdk/pluginAuthoringContract';

import {historyStorageKey, normalizeHistory, readHistory, writeHistory, buildHistoryContext} from "./utils/aiCodingAgentHistory";
import {
    Button,
    Callout,
    Card,
    Alert,
    Dialog,
    FormGroup,
    HTMLSelect,
    KeyComboTag,
    Menu,
    MenuItem,
    NonIdealState,
    Spinner,
    Tag,
    TextArea,
    useHotkeys,
} from "@blueprintjs/core";
import * as styles from "./AiCodingAgentPanel.module.css";
import * as styles2 from "../ai-chat/MarkdownRenderer.module.scss";
import Markdown from "markdown-to-jsx";
import virtualFS from "./utils/VirtualFS";
import {createVirtualFile} from "./utils/createVirtualFile";
import {validateAiWorkspaceCandidate} from './utils/validateAiWorkspaceCandidate';
import {readWorkspaceRepairScope} from '../../utils/plugins/validation/workspaceRepairScope';
import {applyAiWorkspaceFiles} from './utils/applyAiWorkspaceFiles';
import {SDK_KNOWLEDGE_BASELINE_QUERY, formatSdkKnowledgeContext, shouldUseFdoSdkKnowledge} from "../../utils/sdk/fdoSdkKnowledge.js";
import {formatExternalReferenceContext, shouldUseExternalReferenceKnowledge} from "../../utils/ai/assistant/externalReferenceKnowledge.js";
import {getAiCodingAgentIdleTimeoutMs} from "./utils/aiCodingAgentTimeouts.js";
import {shouldIncludeProjectContext} from "./utils/aiCodingAgentContextPolicy.js";
import {
    buildAiCodingFollowUpDraft,
    buildAiCodingFollowUpPrompt,
    shouldTreatAsAiCodingFollowUp,
} from "./utils/aiCodingAgentFollowup.js";
import {buildAiCodingAgentStatusMessage} from "./utils/aiCodingAgentStatus.js";
import {
    buildAiCodingWaitingStatus,
    buildAiCodingStreamStatus,
    createAiCodingStreamProgress,
    recordAiCodingStreamText,
    formatAiCodingElapsedShort,
    upsertAiCodingRequestStatus,
} from "../../utils/ai/assistant/aiCodingAgentProgress.js";
import {
    isQuestionLikeAiCodingPrompt,
    isDocumentationLookupPrompt,
    isNewPluginCreationRequest,
    mergeAiCodingRouteDecision,
    resolveAiCodingAgentAction,
    shouldUseAiRoutingJudge,
} from "./utils/aiCodingAgentRouting.js";
import {buildProjectFilePlanPrompt, extractProjectFileTargets, shouldCreateProjectFiles} from "./utils/aiCodingAgentFileIntent.js";
import {extractWorkspaceFileReferences, formatWorkspaceReferenceContext, resolveWorkspaceFileReferences} from "./utils/aiCodingAgentWorkspaceRefs.js";
import {buildAiCodingAgentRequestContexts} from "./utils/aiCodingAgentRequestContext.js";
import {buildWorkspaceExecutionPlanPrompt, shouldExecuteWorkspacePlan} from "./utils/aiCodingAgentExecutionIntent.js";
import {findWorkspaceStyleIssues, normalizeReservedHostBindingMarkers, validateGeneratedPluginFiles} from "./utils/validateGeneratedPluginFiles.js";
import {normalizeGeneratedModuleExports} from "../../utils/plugins/validation/generatedModuleExports";
import {repairWorkspaceSdkDom} from '../../utils/plugins/validation/workspaceSdkDomRepair';
import {parseAiWorkspacePlanResponse, shouldApplyAiResponseToWorkspace} from "./utils/aiCodingAgentPlanResponse.js";
import {extractAiCodeToApply} from "./utils/aiCodingAgentSingleFileApply";
import {buildExecutablePlanRetryPrompt, buildProblemsRepairPlanPrompt, buildValidationRepairPlanPrompt, getProblemsRepairPaths, getValidationRepairPaths, mergeValidationRepairResponse} from "./utils/aiCodingAgentPlanRepair.js";
import {buildAiCodingProblemsContext} from "./utils/aiCodingAgentProblems.js";
import {buildAiCodingBuildOutputContext} from "./utils/aiCodingAgentBuildOutput.js";
import {applyAiMetadataBlockResponse, decideAiSingleFileApplyStrategy} from "./utils/aiCodingAgentSingleFileApply.js";
import {applyAiSearchReplaceBlocks, parseAiSearchReplaceResponse} from "./utils/aiCodingAgentSearchReplace.js";
import {buildSingleFileApplyRetryPrompt} from "./utils/aiCodingAgentSingleFileRepair.js";
import {classifyAiCodingIssueScope, shouldIncludeIssueDiagnosis} from "./utils/aiCodingAgentIssueScope.js";
import {applyWorkspaceMention, detectWorkspaceMention, getWorkspaceMentionItems} from "./utils/aiCodingAgentMentions.js";
import {applyCodexSkillMention, detectCodexSkillMention, getCodexSkillMentionItems} from './utils/aiCodingSkillMentions';
import {detectAiPluginRuntimeIntent} from "./utils/aiCodingAgentPluginRuntimeIntent.js";
import {buildAiCodingRouteJudgeStatus} from "./utils/aiCodingAgentRouteJudgeStatus.js";
import {
    buildAiCodingPluginScopeViolationMessage,
    validateAiCodingPluginScopeRequest,
    validateAiCodingPluginScopeResponse,
} from "./utils/aiCodingAgentPluginScope.js";
import {isAiCodingFastLocalEditPrompt} from "./utils/aiCodingAgentFastPath.js";
import {isWorkspaceQualityReviewPrompt, WORKSPACE_REPAIR_PROMPT, WORKSPACE_REVIEW_PROMPT, parseWorkspaceReviewReport, formatWorkspaceReviewReport, workspaceReviewContext, includeWorkspaceAuthoringFindings} from "./utils/aiCodingAgentReview.js";
import {findWorkspaceHtmlIssues} from '../../utils/plugins/validation/workspaceHtmlReview';
import runHostPluginTests from "./utils/runTests.js";

import hljs from "../../assets/js/hljs/highlight.min"
import "../../assets/css/hljs/xt256.min.css"

import classnames from "classnames";
import {AppToaster} from "../AppToaster.jsx";
import {isAiCodingOutputLimitError} from "../../utils/ai/assistant/aiCodingOutputRecovery";

function authoringContractForEditor() {
    const entry = virtualFS.files?.['/package.json'];
    const model = entry?.model;
    const packageText = model && !model.isDisposed?.() ? model.getValue() : entry?.content;
    return workspaceAuthoringContract({'/package.json': packageText});
}
export {isAiCodingOutputLimitError} from "../../utils/ai/assistant/aiCodingOutputRecovery";

if (typeof hljs?.configure === "function") {
    hljs.configure({ ignoreUnescapedHTML: true });
}

const AI_ACTIONS = [
    { label: "Smart Mode (Recommended)", value: "smart" },
    { label: "Generate Code", value: "generate" },
    { label: "Edit Code", value: "edit" },
    { label: "Explain Code", value: "explain" },
    { label: "Fix Code", value: "fix" },
    { label: "Plan Code (Plugin Scaffold)", value: "plan" },
];

export function getRequestProgressStage(phase = "", hasResponse = false, attempt = 1, workspaceStage = "") {
    // The orchestrator knows whether this file is being generated, repaired or
    // split. A prior provider retry is not an attempt to correct every later file.
    if (workspaceStage) return workspaceStage;
    if (String(phase).startsWith("investigation-")) return "Investigating plugin";
    let stage;
    switch (String(phase || "").trim()) {
        case "tests": stage = "Running plugin tests"; break;
        case "routing-safety": stage = "Checking request safety"; break;
        case "retrieval":
        case "reference": stage = "Gathering workspace context"; break;
        case "plugin-runtime": stage = "Checking plugin runtime"; break;
        case "plan-retry":
        case "plan-retry-validation":
        case "plan-retry-problems":
        case "multi-file-retry":
        case "single-file-retry": stage = "Correcting generated code"; break;
        case "output-limit-retry": stage = "Restarting a complete response"; break;
        case "provider-retry": stage = "Retrying the provider"; break;
        case "scope-retry": stage = "Keeping changes in the plugin workspace"; break;
        case "retry-launch":
        case "early-retry-without-json":
        case "retry-without-json": stage = "Retrying response connection"; break;
        default:
            stage = attempt > 1 ? "Correcting generated code"
                : hasResponse ? "Drafting the response"
                : phase === "generation" ? "Generating plugin code"
                : "Understanding your request";
    }
    return attempt > 1 ? `${stage} · attempt ${attempt}` : stage;
}

function AiCodingRequestProgress({elapsedMs, entries, hasResponse, attempt, streamStatus, workspaceStage, estimate, estimateDetails, estimateProgress, confidence}) {
    const latest = entries[entries.length - 1];
    const stage = getRequestProgressStage(latest?.metadata?.phase, hasResponse, attempt, workspaceStage);
    const activity = streamStatus || latest?.message || buildAiCodingWaitingStatus({elapsedMs});

    return (
        <section
            className={styles["request-progress"]}
            data-testid="ai-coding-request-progress"
            role="status"
            aria-live="polite"
            aria-label={`${stage}, overall ${formatAiCodingElapsedShort(elapsedMs)} elapsed`}
        >
            <div className={styles["request-progress-header"]}>
                <div className={styles["request-progress-heading"]}>
                    <FdoAiMark size={24} active phase={hasResponse ? 'responding' : 'waiting'} />
                    <div>
                        <strong>{stage}</strong>
                        <span>Live work status</span>
                    </div>
                </div>
                <Tag minimal intent="primary" className={styles["request-elapsed-time"]}>
                    Overall: {formatAiCodingElapsedShort(elapsedMs)} elapsed
                </Tag>
            </div>
            <div className={styles["request-progress-bar"]} aria-hidden="true" />
            <p className={styles["request-progress-activity"]}>{activity}</p>
            <AiTimeEstimate text={estimate} details={estimateDetails} progress={estimateProgress}/>
            <AiCodingConfidence confidence={confidence}/>
            {entries.length > 1 && (
                <details className={styles["request-progress-details"]}>
                    <summary>Recent activity ({entries.length - 1})</summary>
                    <div className={styles["request-status-list"]}>
                        {entries.slice(0, -1).map((entry) => (
                            <p key={entry.id} className={styles["request-status-item"]}>{entry.message}</p>
                        ))}
                    </div>
                </details>
            )}
        </section>
    );
}

function shouldRunTestsBeforeAiRequest(prompt = "") {
    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    if (!normalizedPrompt) return false;

    // Do not treat "dry-run" as "run tests".
    if (/\bdry[-\s]?run\b/.test(normalizedPrompt)) {
        return false;
    }

    const asksToRunTests = /\b(?:run|execute|rerun)\s+(?:the\s+)?(?:plugin\s+)?tests?\b/.test(normalizedPrompt)
        || /\btests?\s+(?:should|to)?\s*(?:be\s+)?(?:run|executed|rerun)\b/.test(normalizedPrompt);
    const asksToInvestigateFailures = /\b(?:failing|failed|failure|failures|error|errors|broken)\b.*\btests?\b/.test(normalizedPrompt)
        || /\btests?\b.*\b(?:failing|failed|failure|failures|error|errors|broken)\b/.test(normalizedPrompt)
        || /\b(?:investigate|review|debug|diagnos(?:e|is|tic)?|fix)\b.*\b(?:failing|failed|failure|failures|error|errors|broken)\b/.test(normalizedPrompt);

    return asksToRunTests && asksToInvestigateFailures;
}

function shouldPreferMainPluginFile(prompt = "") {
    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    if (!normalizedPrompt) return false;

    const mentionsPlugin = /\bplugin\b/.test(normalizedPrompt);
    const looksLikeScaffoldIntent =
        /\b(create|build|generate|scaffold|implement|make)\b/.test(normalizedPrompt)
        || /plugin\s+like\b/.test(normalizedPrompt)
        || /\blike\s+https?:\/\//.test(normalizedPrompt);
    const looksLikePluginEntryMutation =
        /\b(rename|change|set|update|edit|modify|replace|fix|patch|use|choose|pick)\b/.test(normalizedPrompt)
        && /\b(metadata|plugin(?:'s)?\s+name|display\s+name|icon|author|description|version)\b/.test(normalizedPrompt);
    const looksLikeTroubleshooting =
        /\b(diagnos(?:e|is|tic)?|debug|analy[sz]e|investigat(?:e|ion|ing)?|troubleshoot(?:ing)?|fix(?:ing)?|failing|failure|crash|broken|not working)\b/.test(normalizedPrompt);

    return mentionsPlugin && (looksLikeScaffoldIntent || looksLikePluginEntryMutation) && !looksLikeTroubleshooting;
}

function shouldPreferRenderPluginFile(prompt = "") {
    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    if (!normalizedPrompt) return false;

    const mentionsRenderTarget =
        /\brender\b/.test(normalizedPrompt)
        || /\bui\b/.test(normalizedPrompt)
        || /\bheading\b/.test(normalizedPrompt)
        || /\btitle\b/.test(normalizedPrompt)
        || /\bscreen\b/.test(normalizedPrompt)
        || /\bview\b/.test(normalizedPrompt);
    const looksLikeChangeIntent =
        /\b(rename|change|set|update|edit|modify|replace|fix|patch|align|apply|make)\b/.test(normalizedPrompt);

    return mentionsRenderTarget && looksLikeChangeIntent;
}

function resolveDefaultPluginTargetFile({
    prompt = "",
    projectFiles = [],
    currentFilePath = "",
    mainPluginFilePath = "/index.ts",
} = {}) {
    const files = Array.isArray(projectFiles) ? projectFiles : [];
    const normalizedCurrentFilePath = String(currentFilePath || "").trim().toLowerCase();

    if (shouldPreferRenderPluginFile(prompt)) {
        const renderFile = files.find((file) => /(?:^|\/)render\.[cm]?[jt]sx?$/i.test(String(file?.path || "")));
        if (renderFile?.path) {
            return renderFile.path;
        }
        if (/(?:^|\/)render\.[cm]?[jt]sx?$/i.test(normalizedCurrentFilePath)) {
            return currentFilePath;
        }
    }

    if (shouldPreferMainPluginFile(prompt)) {
        return mainPluginFilePath;
    }

    return "";
}

function extractMetadataNameLiteral(source = "") {
    const text = String(source || "");
    const getterMatch = /get\s+metadata\s*\(\)\s*:\s*PluginMetadata\s*{[\s\S]*?return\s*{([\s\S]*?)}\s*;?\s*}/m.exec(text);
    const metadataBlock = getterMatch?.[1]
        || /(?:readonly\s+)?_metadata\s*(?::\s*PluginMetadata)?\s*=\s*{([\s\S]*?)}\s*;?/m.exec(text)?.[1]
        || /metadata\s*=\s*{([\s\S]*?)}\s*;?/m.exec(text)?.[1]
        || text;
    const nameMatch = /name\s*:\s*["'`]([^"'`]+)["'`]/m.exec(metadataBlock);
    return nameMatch ? nameMatch[1] : "";
}

function buildAppliedChangeSummary({
    filePath = "",
    beforeText = "",
    afterText = "",
    mode = "",
} = {}) {
    const safeFilePath = String(filePath || "").trim() || "current file";
    const beforeName = extractMetadataNameLiteral(beforeText);
    const afterName = extractMetadataNameLiteral(afterText);

    if (afterName && beforeName && afterName !== beforeName) {
        return {
            title: `Applied to ${safeFilePath}`,
            message: `Updated metadata.name from "${beforeName}" to "${afterName}". Original AI response is shown below.`,
        };
    }

    if (afterName && !beforeName) {
        return {
            title: `Applied to ${safeFilePath}`,
            message: `Updated plugin metadata in ${safeFilePath}. Original AI response is shown below.`,
        };
    }

    return {
        title: `Applied to ${safeFilePath}`,
        message: mode === "replace-whole-file"
            ? `Replaced the file contents in ${safeFilePath}. Original AI response is shown below.`
            : `Patched ${safeFilePath}. Original AI response is shown below.`,
    };
}

function buildSnapshotPersistenceSummary({
    beforeSnapshot = "",
    afterSnapshot = "",
} = {}) {
    const beforeLabel = String(beforeSnapshot || "").trim();
    const afterLabel = String(afterSnapshot || "").trim();

    if (beforeLabel && afterLabel && beforeLabel !== afterLabel) {
        return `Saved restore point ${beforeLabel} and persisted this result as ${afterLabel}.`;
    }

    if (beforeLabel || afterLabel) {
        return "Saved a restore point and persisted this result as the current workspace state.";
    }

    return "Persisted this result as the current workspace state and kept a rollback point.";
}

function extractMentionedWorkspaceFiles(content = "", workspaceFiles = []) {
    const text = String(content || "");
    const knownPaths = Array.isArray(workspaceFiles)
        ? workspaceFiles
            .map((file) => String(file?.path || "").trim())
            .filter(Boolean)
        : [];
    const mentioned = new Set();

    knownPaths.forEach((path) => {
        if (text.includes(path)) {
            mentioned.add(path);
            return;
        }
        const basename = path.split("/").pop();
        if (basename && text.includes(basename)) {
            mentioned.add(path);
        }
    });

    return Array.from(mentioned);
}

function buildPartialApplySummary({
    appliedFilePaths = [],
    mentionedFilePaths = [],
} = {}) {
    const applied = Array.isArray(appliedFilePaths) ? appliedFilePaths.filter(Boolean) : [];
    const mentioned = Array.isArray(mentionedFilePaths) ? mentionedFilePaths.filter(Boolean) : [];
    const unapplied = mentioned.filter((path) => !applied.includes(path));

    if (unapplied.length === 0) {
        return null;
    }

    return {
        intent: "warning",
        title: "Partially Applied",
        message: `Applied ${applied.join(", ") || "the current file"} only. The AI response also referenced ${unapplied.join(", ")}, but it did not provide an executable patch for ${unapplied.length === 1 ? "that file" : "those files"}, so FDO left ${unapplied.length === 1 ? "it" : "them"} unchanged.`,
    };
}

export function isInformationalOnlyPrompt(prompt = "") {
    if (isDocumentationLookupPrompt(prompt)) return true;
    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    const hasExplicitChangeIntent = /\b(create|build|generate|implement|scaffold|add|edit|refactor|rewrite|update|fix|patch|replace|modify|apply|proceed|continue|make|change|rename|set|use|choose|pick)\b/.test(normalizedPrompt);
    const hasScaffoldIntent = /\bplugin\s+like\b/.test(normalizedPrompt)
        || /\bi\s+want\s+(?:a|an)\s+plugin\b/.test(normalizedPrompt);
    const informationalVerificationIntent =
        /\b(confirm|confirmation|verify|verification|check|checkout|check out|validate|explain|clarify|show|view|read)\b/.test(normalizedPrompt)
        || /\b(is|does|can)\b.+\b(work|working|correct|correctly|logged|logging)\b/.test(normalizedPrompt)
        || /\b(log|logs|stderr|stdout|trace)\b/.test(normalizedPrompt)
        || /\bwhy\b/.test(normalizedPrompt)
        || /\bwhat\b.+\bmean|means|difference\b/.test(normalizedPrompt);

    return informationalVerificationIntent && !hasExplicitChangeIntent && !hasScaffoldIntent;
}

function extractQuotedPromptSnippets(prompt = "") {
    return [
        ...String(prompt || "").matchAll(/"([^"]+)"/g),
        ...String(prompt || "").matchAll(/'([^']+)'/g),
    ]
        .map((match) => String(match?.[1] || "").trim())
        .filter(Boolean);
}

function buildPluginRuntimeVerificationContext({
    prompt = "",
    runtimeIntent = null,
} = {}) {
    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    const asksEvidenceCheck =
        /\b(confirm|verify|check|whether|exists?|present|contains?|found)\b/.test(normalizedPrompt)
        || /\blook\s+for\b/.test(normalizedPrompt);
    const quotedSnippets = extractQuotedPromptSnippets(prompt);
    if (!(runtimeIntent?.shouldProbe || runtimeIntent?.wantsLogs) || (!asksEvidenceCheck && quotedSnippets.length === 0)) {
        return "";
    }

    const lines = [
        "Runtime verification instructions:",
        "Use the provided plugin runtime trace/log context as the primary evidence source.",
        "Answer the runtime/log verification request directly before suggesting any code or documentation changes.",
    ];

    if (quotedSnippets.length > 0) {
        lines.push(`Look specifically for these quoted strings in the runtime trace/logs: ${quotedSnippets.map((value) => `"${value}"`).join(", ")}.`);
    }

    lines.push("If the requested text is present in the available plugin logs, say so directly and cite the matching evidence.");
    lines.push("If the requested text is absent, say it was not found in the available logs.");
    lines.push("Do not respond with file patches, scaffolds, or documentation unless the user explicitly asks for code or docs changes.");

    return `${lines.join("\n")}\n\n`;
}

export function shouldAutoApplySingleFileResponse({
    action = "",
    prompt = "",

} = {}) {
    const normalizedAction = String(action || "").trim().toLowerCase();
    if (!normalizedAction) return false;
    if (normalizedAction === "explain") return false;

    if (isInformationalOnlyPrompt(prompt)) {
        return false;
    }

    if (normalizedAction === "fix" || normalizedAction === "edit" || normalizedAction === "generate") {
        return true;
    }
    if (normalizedAction !== "smart") {
        return false;
    }

    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    const hasExplicitChangeIntent = /\b(create|build|generate|implement|scaffold|add|edit|refactor|rewrite|update|fix|patch|replace|modify|apply|proceed|continue|make|change|rename|set|use|choose|pick)\b/.test(normalizedPrompt);
    const hasScaffoldIntent = /\bplugin\s+like\b/.test(normalizedPrompt)
        || /\bi\s+want\s+(?:a|an)\s+plugin\b/.test(normalizedPrompt);

    // Smart mode should only auto-apply when the prompt explicitly asks for changes.
    // Merely having selected code or a derived target file is not enough.
    return hasExplicitChangeIntent || hasScaffoldIntent || /хочу\s+(?:(?:такий|новий|цей)\s+)?плагін|створи|створити|зроби|додай|виправ|зміни|онови/iu.test(normalizedPrompt);
}

export function buildSelectionGuidance({
    action = "",
    effectiveAction = "",
    prompt = "",
    selectedCode = "",
    createProjectFiles = false,
    composerMode = null,
    hasResponse = false,
} = {}) {
    const requestedAction = String(action || "").trim().toLowerCase();
    const resolvedAction = String(effectiveAction || action || "").trim().toLowerCase();
    const normalizedPrompt = String(prompt || "").trim();
    const hasSelection = !!String(selectedCode || "").trim();
    const questionLike = isQuestionLikeAiCodingPrompt(normalizedPrompt) || isInformationalOnlyPrompt(normalizedPrompt);
    const followUpLike = composerMode === "refine" || (!!hasResponse && questionLike);
    const newPluginCreation = isNewPluginCreationRequest(normalizedPrompt);

    if (createProjectFiles || resolvedAction === "plan") {
        return {
            intent: hasSelection ? "primary" : "success",
            icon: "flows",
            title: "Selection not required",
            message: hasSelection
                ? "This request works from your prompt and workspace targets. The current selection is optional context, not the primary edit target."
                : "Describe the plugin or workspace files to create. No code selection is required for planning or scaffold requests.",
        };
    }

    if (newPluginCreation) {
        return hasSelection
            ? {
                intent: "primary",
                icon: "cube-add",
                title: "Plugin workspace creation",
                message: "Creating a new plugin starts from the plugin workspace. The current selection is optional context and will not limit the generated plugin.",
            }
            : {
                intent: "success",
                icon: "cube-add",
                title: "Selection not required",
                message: "Creating a new plugin starts from the plugin workspace. Describe the plugin you want; no code selection is needed.",
            };
    }

    if (resolvedAction === "edit") {
        return hasSelection
            ? {
                intent: "success",
                icon: "selection",
                title: "Selection ready",
                message: "The current selection will be treated as the primary edit target.",
            }
            : {
                intent: "warning",
                icon: "select",
                title: "Select code before editing",
                message: "Edit Code works best with an explicit selection. Select the code you want changed, or switch to Smart Mode for broader guidance.",
            };
    }

    if (resolvedAction === "fix" && requestedAction !== "smart") {
        return hasSelection
            ? {
                intent: "success",
                icon: "selection",
                title: "Selection ready",
                message: "The assistant will prioritize the selected code while diagnosing and fixing the issue.",
            }
            : {
                intent: "warning",
                icon: "select",
                title: "Selection recommended",
                message: "Select the broken code for a precise fix. Without a selection, the assistant may fall back to diagnostics, file context, or analysis-only guidance.",
            };
    }

    if (resolvedAction === "explain" || questionLike) {
        return hasSelection
            ? {
                intent: "primary",
                icon: "citation",
                title: "Selection optional",
                message: "Your question can be answered without a selection. The current selection will be used as extra context for a more targeted explanation.",
            }
            : {
                intent: "success",
                icon: "help",
                title: "Selection not required",
                message: "Ask the question directly. Select code only if you want the explanation tied to a specific block.",
            };
    }

    if (resolvedAction === "generate") {
        return hasSelection
            ? {
                intent: "primary",
                icon: "code",
                title: "Selection optional",
                message: "Generation can proceed without a selection. The current selection will be used only as shaping context for the generated result.",
            }
            : {
                intent: "success",
                icon: "code",
                title: "Selection not required",
                message: "Describe what to generate. Select code only if you want the output constrained by nearby implementation details.",
            };
    }

    if (requestedAction === "smart" || resolvedAction === "smart" || followUpLike) {
        return hasSelection
            ? {
                intent: "primary",
                icon: "predictive-analysis",
                title: "Selection optional",
                message: questionLike
                    ? "This reads like a question or verification request. The current selection will be treated as supporting context, not an automatic edit target."
                    : "Smart Mode can work without a selection. Because code is selected, the assistant will treat it as primary context if you ask for targeted changes.",
            }
            : {
                intent: "primary",
                icon: "predictive-analysis",
                title: "Selection optional",
                message: questionLike
                    ? "This reads like a question or verification request, so no code selection is required."
                    : "Smart Mode can handle broad requests without a selection. Select code if you want the assistant to focus on a specific block before applying changes.",
            };
    }

    return hasSelection
        ? {
            intent: "primary",
            icon: "selection",
            title: "Selection detected",
            message: "The current selection will be available as context for this request.",
        }
        : {
            intent: "primary",
            icon: "help",
            title: "Selection optional",
            message: "You can submit this request without selecting code, or select a block first for more targeted assistance.",
        };
}

export function buildSmartModeGuidance({
    prompt = "",
    effectiveAction = "",
    selectedCode = "",
    createProjectFiles = false,
    hasResponse = false,
    composerMode = null,
} = {}) {
    const normalizedPrompt = String(prompt || "").trim();
    const resolvedAction = String(effectiveAction || "smart").trim().toLowerCase();
    const hasSelection = !!String(selectedCode || "").trim();
    const questionLike = isQuestionLikeAiCodingPrompt(normalizedPrompt) || isInformationalOnlyPrompt(normalizedPrompt);
    const followUpLike = composerMode === "refine" || (!!hasResponse && normalizedPrompt.length > 0);
    const newPluginCreation = isNewPluginCreationRequest(normalizedPrompt);

    const predictedIntent = newPluginCreation
        ? "Create a plugin from the workspace"
        : createProjectFiles || resolvedAction === "plan"
        ? "Create or update workspace files"
        : resolvedAction === "edit"
        ? "Edit selected code"
        : resolvedAction === "fix"
        ? "Diagnose and fix code"
        : resolvedAction === "generate"
        ? "Generate new code"
        : resolvedAction === "explain" || questionLike
        ? "Answer or explain"
        : "Analyze first, then choose the safest path";

    const selectionMode = newPluginCreation
        ? hasSelection
            ? "The current selection is optional context; it will not limit the new plugin."
            : "No selection is required. Smart Mode starts from the plugin workspace."
        : createProjectFiles || resolvedAction === "plan"
        ? "Selection is optional; workspace targets matter more."
        : resolvedAction === "edit"
        ? hasSelection
            ? "Current selection will be treated as the edit target."
            : "Select code if you want Smart Mode to perform a precise edit."
        : questionLike
        ? hasSelection
            ? "Current selection will be used as supporting context, not an automatic edit target."
            : "No selection is required for question or verification requests."
        : hasSelection
        ? "Current selection will be treated as high-priority context."
        : "No selection is required, but selecting code narrows the result to a specific block.";

    const expectedResult = newPluginCreation
        ? "Expect complete plugin workspace files that can be reviewed or applied."
        : createProjectFiles || resolvedAction === "plan"
        ? "Expect a plan or workspace-file response rather than a direct single-file patch."
        : resolvedAction === "edit"
        ? "Expect a targeted code change if the selection is clear."
        : resolvedAction === "fix"
        ? "Expect diagnostics first, and then a fix only when the request is specific enough."
        : resolvedAction === "generate"
        ? "Expect new code or a suggested implementation shape."
        : resolvedAction === "explain" || questionLike
        ? "Expect an explanation, verification answer, or troubleshooting guidance."
        : "Expect Smart Mode to stay conservative when the request is ambiguous.";

    return {
        intent: questionLike ? "success" : "primary",
        icon: "predictive-analysis",
        title: followUpLike ? "Smart Mode follow-up" : "Smart Mode preview",
        predictedIntent,
        selectionMode,
        expectedResult,
    };
}

export default function AiCodingAgentPanel({ codeEditor, response, setResponse, onActivityChange, onShowTests, eventDocument = document, selectionFocusRequest = 0 }) {
    const scheduleUiFrame = callback => (eventDocument.defaultView || window).requestAnimationFrame(callback);
    const historyKey = historyStorageKey(virtualFS.sandboxName);
    const [conversation, setConversation] = useState(() => readHistory(localStorage, historyKey));
    const conversationRef = useRef(conversation);
    const workspaceReviewInProgressRef = useRef(false);
    const requestSnapshotRef = useRef(null);
    const appliedSnapshotRef = useRef(null);
    const assertSnapshotUnchanged = () => {
        if (!panelMountedRef.current) throw new Error("The AI panel was closed. No further AI edits were applied.");
        const started = requestSnapshotRef.current;
        if (started && (started.revision !== (virtualFS.fs.snapshotSwitchRevision || 0) || started.workspace !== virtualFS.sandboxName)) {
            throw new Error("Snapshot changed during this request. No further AI edits were applied. Send a new request using the restored files.");
        }
    };
    const [historyWarning, setHistoryWarning] = useState("");
    const [isResetConversationOpen, setIsResetConversationOpen] = useState(false);
    const saveConversation = (messages) => {
        const normalized = normalizeHistory(messages);
        conversationRef.current = normalized;
        setConversation(normalized);
        try { writeHistory(localStorage, historyKey, normalized); setHistoryWarning(""); }
        catch { setHistoryWarning("Conversation is available for this session, but could not be saved on this device."); }
    };
    useEffect(() => {
        const restored = readHistory(localStorage, historyKey);
        setConversation(restored);
        conversationRef.current = restored;
        const last = restored[restored.length - 1];
        const currentSnapshot = String(virtualFS.fs.version()?.version ?? "");
        const latest = last?.role === "assistant" && (last.snapshot != null && String(last.appliedSnapshot ?? last.snapshot) === currentSnapshot) ? last.content : "";
        responseRef.current = latest;
        if (!submitInFlightRef.current) requestSnapshotRef.current = {revision: virtualFS.fs.snapshotSwitchRevision || 0, workspace: virtualFS.sandboxName};
        setResponse(latest);
    }, [historyKey]);
    useEffect(() => virtualFS.notifications?.subscribe?.("snapshotSwitched", ({from, to}) => {
        preparedRecoveryRef.current = null;
        applyingGenerationCheckpointRef.current = null;
        dispatchGenerationRecovery({type: 'reset'});
        refreshGenerationCheckpoint();
        saveConversation([...conversationRef.current, {role: "snapshot", snapshot: to,
            content: `Switched from snapshot ${from} to ${to}. Earlier edits may have been rolled back; use the restored files for the next request.`}]);
        setResponse("");
        responseRef.current = "";
        setOperationSummary(null);
        if (submitInFlightRef.current) {
            setError("Snapshot switched. The previous request cannot apply further edits; send a new request after it stops.");
            const id = streamingRequestIdRef.current;
            if (id) {
                cancelledRequestIdsRef.current.add(id);
                Promise.resolve(window.electron.aiCodingAgent.cancelRequest?.({requestId: id})).catch(() => {});
            }
        }
    }), [historyKey]);
    useEffect(() => virtualFS.notifications?.subscribe?.('liveUiApplied', ({message, historySaved}) => {
        saveConversation(historySaved ? readHistory(localStorage, historyKey) : [...conversationRef.current, message]);
        setResponse(''); responseRef.current = ''; setOperationSummary(null);
        if (submitInFlightRef.current) {
            setError('Workspace changed in Live UI. The earlier request cannot apply further edits; send a new request using the current files.');
            const id = streamingRequestIdRef.current;
            if (id) {cancelledRequestIdsRef.current.add(id); Promise.resolve(window.electron.aiCodingAgent.cancelRequest?.({requestId: id})).catch(() => {});}
        } else requestSnapshotRef.current = {revision: virtualFS.fs.snapshotSwitchRevision || 0, workspace: virtualFS.sandboxName};
    }), [historyKey]);
    const requestConversationSnapshot = (versionId) => {
        const target = String(versionId || "").trim();
        if (!target) return;
        if (typeof window.__requestSnapshotSwitch === "function") {
            window.__requestSnapshotSwitch(target);
            return;
        }
        // The toolbar owns the switch confirmation flow. If it has not mounted
        // yet, still take the developer to the snapshot surface rather than
        // attempting an unsafe direct virtual-FS restore here.
        window.__openSnapshotsPanel?.();
    };
    const [action, setAction] = useState("smart");
    const [prompt, setPrompt] = useState("");
    const [isPhaseLoading, setIsLoading] = useState(false);
    // One user operation can include several requests, repairs and apply steps.
    // Phase completion must not reset its clock or remove its status trigger.
    const [isOperationActive, setIsOperationActive] = useState(false);
    const isLoading = isPhaseLoading || isOperationActive;
    const preservePendingFilesOnRetryRef = useRef(false);
    useEffect(() => {
        if (!isLoading) updatePendingFiles({activePath: '', status: 'stopped'});
    }, [isLoading]);

    useEffect(() => {
        virtualFS.aiCodingBusy = isLoading;
        window.electron?.aiCodingAgent?.setActivity?.(isLoading);
        return () => {virtualFS.aiCodingBusy = false;};
    }, [isLoading]);
    useEffect(() => () => {
        window.electron?.aiCodingAgent?.setActivity?.(false);
    }, []);
    const [error, setError] = useState(null);
    const [autoApply, setAutoApply] = useState(true);
    const [assistants, setAssistants] = useState([]);
    const [selectedAssistant, setSelectedAssistant] = useState(null);
    const [mentionSkills, setMentionSkills] = useState([]);
    const skillMentionLoadRef = useRef(0);
    const refreshMentionSkills = async () => {
        const sequence = ++skillMentionLoadRef.current;
        if (selectedAssistant?.provider !== 'codex-cli' || !window.electron.settings.ai.getExtensions) {setMentionSkills([]); return;}
        try {
            const result = await window.electron.settings.ai.getExtensions();
            if (sequence === skillMentionLoadRef.current) setMentionSkills(result.skills || []);
        } catch {if (sequence === skillMentionLoadRef.current) setMentionSkills([]);}
    };
    useEffect(() => {
        setMentionSkills([]); setMentionState(null);
        const refresh = () => {setMentionState(null); refreshMentionSkills();};
        refresh();
        window.electron.settings.ai.on?.extensionsUpdated?.(refresh);
        return () => {skillMentionLoadRef.current++; window.electron.settings.ai.off?.extensionsUpdated?.(refresh);};
    }, [selectedAssistant?.id, selectedAssistant?.provider]);
    const [selectedInputCapabilities, setSelectedInputCapabilities] = useState(null);
    const inputCapabilities = assistantInputCapabilities(selectedAssistant || {}, selectedInputCapabilities || selectedAssistant?.inputCapabilities || {});
    useEffect(() => {
        let cancelled = false;
        setSelectedInputCapabilities(null);
        if (!selectedAssistant
            || assistantInputCapabilities(selectedAssistant).source === 'integration'
            || typeof window.electron?.settings?.ai?.getInputCapabilities !== 'function') return;
        window.electron.settings.ai.getInputCapabilities(selectedAssistant).then(result => {
            if (!cancelled) setSelectedInputCapabilities(result);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [selectedAssistant]);
    const [loadingAssistants, setLoadingAssistants] = useState(true);
    const [refreshingAssistants, setRefreshingAssistants] = useState(false);
    const [assistantLoadError, setAssistantLoadError] = useState('');
    const assistantLoadSequence = useRef(0);
    const [composerMode, setComposerMode] = useState(null);
    const [savedGenerationCheckpoint, setSavedGenerationCheckpoint] = useState(null);
    const [checkpointError, setCheckpointError] = useState('');
    const preparedRecoveryRef = useRef(null);
    const applyingGenerationCheckpointRef = useRef(null);
    const checkpointSequenceRef = useRef(0);
    const [generationRecovery, dispatchGenerationRecovery] = useReducer(generationRecoveryReducer, initialGenerationRecovery);
    const recoveryFailure = generationRecovery.status === 'failed' ? generationRecovery.failure : null;
    const [uploadedImage, setUploadedImage] = useState(null);
    const [verificationReports, setVerificationReports] = useState([]);
    const verificationSequence = useRef(0);
    const [confidenceAttemptFloor, setConfidenceAttemptFloor] = useState(0);
    const [skillReview, setSkillReview] = useState(null);
    const [skillReviewError, setSkillReviewError] = useState('');
    const [skillReviewAction, setSkillReviewAction] = useState(null);
    const [skillReviewFeedback, setSkillReviewFeedback] = useState('');
    const skillReviewActionRef = useRef(null);
    useEffect(() => { if (!isLoading) setSkillReview(null); }, [isLoading]);
    const [imagePreview, setImagePreview] = useState(null);
    const imageUploadVersion = useRef(0);
    useEffect(() => () => { imageUploadVersion.current++; }, []);
    const [imageName, setImageName] = useState("");
    const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
    const [operationSummary, setOperationSummary] = useState(null);
    const [guideRecovery, setGuideRecovery] = useState(null);
    const [responseApplied, setResponseApplied] = useState(false);
    const [requestStatusEntries, setRequestStatusEntries] = useState([]);
    const [requestElapsedMs, setRequestElapsedMs] = useState(0);
    const [stageElapsedMs, setStageElapsedMs] = useState(0);
    const [requestAttempt, setRequestAttempt] = useState(0);
    const requestAttemptRef = useRef(0);
    const responseRef = useRef("");
    const streamContentBufferRef = useRef("");
    const streamProgressRef = useRef(createAiCodingStreamProgress());
    const [workspaceStage, setWorkspaceStage] = useState("");
    const [repairNotice, setRepairNotice] = useState(null);
    const [validationRecovery, setValidationRecovery] = useState(null);
    const validationRecoveryRef = useRef(null);
    const updateValidationRecovery = value => {validationRecoveryRef.current = value; setValidationRecovery(value);};
    useEffect(() => {updateValidationRecovery(null);}, [historyKey]);
    const estimatorRef = useRef(null);
    const streamContentFlushTimerRef = useRef(null);
    const timeoutRef = useRef(null);
    const streamingRequestIdRef = useRef(null);
    const autoApplyRef = useRef(autoApply);
    const fileInputRef = useRef(null);
    const pendingAutoFileCreateRef = useRef(false);
    const submitInFlightRef = useRef(false);
    const panelMountedRef = useRef(true);
    const expectWorkspaceApplyRef = useRef(false);
    const planRetryInFlightRef = useRef(false);
    const applyActionRef = useRef("");
    const currentRequestRef = useRef(null);
    const blockIncompleteGeneration = !!recoveryFailure || (['failed', 'cancelled'].includes(generationRecovery.status) && (currentRequestRef.current?.action === 'plan' || !!savedGenerationCheckpoint));
    const singleFileRetryInFlightRef = useRef(false);
    const multiFileRetryInFlightRef = useRef(false);
    const scopeRetryInFlightRef = useRef(false);
    const panelContentRef = useRef(null);
    const cancelledRequestIdsRef = useRef(new Set());
    const investigationAbortRef = useRef(null);
    const timedOutRequestIdsRef = useRef(new Set());
    const promptInputRef = useRef(null);
    useEffect(() => {
        if (!selectionFocusRequest) return;
        const view = eventDocument.defaultView || window;
        const frame = view.requestAnimationFrame(() => promptInputRef.current?.focus());
        return () => view.cancelAnimationFrame(frame);
    }, [selectionFocusRequest, eventDocument]);
    const promptBlurTimeoutRef = useRef(null);
    const [mentionState, setMentionState] = useState(null);
    const lastPluginTraceToastRef = useRef({key: "", at: 0});

    const runPluginTests = async () => {
        const attempt = ++verificationSequence.current;
        const publish = check => setVerificationReports(previous => [...previous.filter(report => report.attempt !== attempt),
            {attempt, changedPaths: [], checks: [check]}].slice(-10));
        publish({id: 'tests', label: 'Plugin tests', status: 'running'});
        try {
            const result = await runHostPluginTests();
            publish(pluginTestsVerificationCheck(result));
            return result;
        } catch (error) {
            publish(pluginTestsVerificationCheck({success: false, error: error.message}));
            throw error;
        }
    };

    const refreshGenerationCheckpoint = async () => {
        const sequence = ++checkpointSequenceRef.current;
        const workspaceId = virtualFS.sandboxName;
        if (!workspaceId || !window.electron.aiCodingAgent.getGenerationCheckpoint) return;
        try {
            const result = await window.electron.aiCodingAgent.getGenerationCheckpoint({workspaceId, workspaceFiles: getAllProjectFiles()});
            if (sequence !== checkpointSequenceRef.current || workspaceId !== virtualFS.sandboxName) return;
            setSavedGenerationCheckpoint(result.checkpoint || null);
            setCheckpointError(result.success ? '' : result.error);
        } catch (error) {if (sequence === checkpointSequenceRef.current && workspaceId === virtualFS.sandboxName) setCheckpointError(error.message);}
    };
    useEffect(() => {
        if (!isLoading) refreshGenerationCheckpoint();
        return () => {checkpointSequenceRef.current += 1;};
    }, [isLoading, selectedAssistant?.id, historyKey]);

    const beginStreamingRequest = (requestId) => {
        let estimateStorage;
        try { estimateStorage = window.localStorage; } catch { /* Optional history. */ }
        estimatorRef.current = createCodingEstimator({assistant: selectedAssistant || {}, storage: estimateStorage});
        dispatchGenerationRecovery({type: 'start', requestId});
        streamingRequestIdRef.current = requestId;
        streamProgressRef.current = createAiCodingStreamProgress();
        setWorkspaceStage("");
        requestAttemptRef.current += 1;
        setRequestAttempt(requestAttemptRef.current);
    };

    const clearRequestTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
    };

    // Providers can split one response into hundreds of tiny deltas. Rendering
    // every delta makes the editor janky and can starve other UI work. Preserve
    // the complete response in the ref, but paint it at most four times a second.
    const flushStreamContent = () => {
        if (streamContentFlushTimerRef.current) {
            clearTimeout(streamContentFlushTimerRef.current);
            streamContentFlushTimerRef.current = null;
        }
        const buffered = streamContentBufferRef.current;
        streamContentBufferRef.current = "";
        if (!buffered) return;
        responseRef.current += buffered;
        if (!workspaceReviewInProgressRef.current) setResponse(responseRef.current);
    };

    const scheduleStreamContentFlush = () => {
        if (streamContentFlushTimerRef.current) return;
        streamContentFlushTimerRef.current = setTimeout(flushStreamContent, 250);
    };

    const clearPromptBlurTimeout = () => {
        if (promptBlurTimeoutRef.current) {
            clearTimeout(promptBlurTimeoutRef.current);
            promptBlurTimeoutRef.current = null;
        }
    };
    const isMacPlatform = navigator.platform?.toLowerCase?.().includes("mac");
    const shortcutCombos = useMemo(() => ({
        submit: isMacPlatform ? "cmd + enter" : "ctrl + enter",
        stop: "esc",
        autoApply: isMacPlatform ? "cmd + shift + a" : "alt + a",
        refine: isMacPlatform ? "cmd + shift + r" : "alt + r",
        insert: isMacPlatform ? "cmd + shift + i" : "alt + i",
        execute: isMacPlatform ? "cmd + shift + e" : "alt + e",
        clear: isMacPlatform ? "cmd + shift + k" : "alt + c",
    }), [isMacPlatform]);

    // Mirror UI request-status transitions into the main-process E2E lifecycle
    // so auto-retry phases (and their reasons) are still readable from the
    // artifact after the editor page is torn down on a timeout.
    const recordCodingLifecycle = (event, details = {}) => {
        try {
            const pending = window.electron?.aiCodingAgent?.recordLifecycle?.({
                event,
                requestId: streamingRequestIdRef.current || currentRequestRef.current?.requestId || "",
                details,
            });
            // Diagnostics only: never let a rejected IPC invoke surface as an
            // unhandled rejection or disturb the request flow.
            pending?.catch?.(() => {});
        } catch {
            // Diagnostics only; never disturb the request flow.
        }
    };

    const pushRequestStatus = (message, metadata = {}) => {
        const normalizedMessage = String(message || "").trim();
        if (!normalizedMessage) return;
        setRequestStatusEntries((existing) => upsertAiCodingRequestStatus(existing, normalizedMessage, metadata));
        recordCodingLifecycle("request-status", {message: normalizedMessage, phase: metadata?.phase || ""});
    };

    const scrollPanelToBottomIfNearEnd = () => {
        const container = panelContentRef.current;
        if (!container) return;

        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom <= 120) {
            container.scrollTop = container.scrollHeight;
        }
    };

    const scheduleRequestTimeout = (provider = "") => {
        clearRequestTimeout();
        const timeoutMs = getAiCodingAgentIdleTimeoutMs(provider);
        timeoutRef.current = setTimeout(() => {
            console.error(`[AI Coding Agent] Request timeout after ${Math.round(timeoutMs / 1000)}s of inactivity`);
            const activeRequestId = streamingRequestIdRef.current;
            if (activeRequestId) {
                timedOutRequestIdsRef.current.add(activeRequestId);
                dispatchGenerationRecovery({type: 'cancel', requestId: activeRequestId});
                cancelledRequestIdsRef.current.add(activeRequestId);
                Promise.resolve(window.electron.aiCodingAgent.cancelRequest?.({requestId: activeRequestId})).catch(() => {});
            }
            setError("Request timed out. The AI service may be unavailable. Please try again.");
            setIsOperationActive(false);
            setIsLoading(false);
            streamingRequestIdRef.current = null;
            timeoutRef.current = null;
        }, timeoutMs);
    };

    const applyAssistants = allAssistants => {
        const codingAssistants = allAssistants.filter(a => a.purpose === 'coding');
        setAssistants(codingAssistants);
        setSelectedAssistant(current => codingAssistants.find(a => a.id === current?.id)
            || codingAssistants.find(a => a.default) || codingAssistants[0] || null);
    };
    const reloadAssistants = async () => {
        const sequence = ++assistantLoadSequence.current;
        setRefreshingAssistants(true);
        setAssistantLoadError('');
        try {
            const allAssistants = await window.electron.settings.ai.getAssistants();
            if (sequence === assistantLoadSequence.current) applyAssistants(allAssistants);
        } catch (err) {
            if (sequence === assistantLoadSequence.current) setAssistantLoadError('Could not reload AI assistants. Try again or check Settings.');
        } finally {
            if (sequence === assistantLoadSequence.current) {
                setLoadingAssistants(false);
                setRefreshingAssistants(false);
            }
        }
    };
    // Settings notifications and the explicit reload share selection behavior.
    useEffect(() => {
        const handleUpdate = (_, allAssistants) => {
            ++assistantLoadSequence.current;
            applyAssistants(allAssistants);
            setLoadingAssistants(false);
            setRefreshingAssistants(false);
            setAssistantLoadError('');
        };
        window.electron.settings.ai.on?.updated?.(handleUpdate);
        reloadAssistants();
        return () => {
            ++assistantLoadSequence.current;
            window.electron.settings.ai.off?.updated?.(handleUpdate);
        };
    }, []);

    // Keep autoApplyRef in sync with autoApply state
    useEffect(() => {
        autoApplyRef.current = autoApply;
    }, [autoApply]);

    useEffect(() => {
        return () => {
            clearPromptBlurTimeout();
        };
    }, []);

    useEffect(() => {
        scrollPanelToBottomIfNearEnd();
    }, [response, requestStatusEntries, isLoading, error, operationSummary]);

    // AI providers cannot give us a meaningful percentage while generating.
    // A live duration and real request phases make the wait understandable
    // without presenting a misleading completion estimate.
    useEffect(() => {
        if (!isLoading) return undefined;

        const startedAt = Date.now();
        const updateElapsed = () => setRequestElapsedMs(Math.max(0, Date.now() - startedAt));
        updateElapsed();
        const timer = setInterval(updateElapsed, 1000);
        return () => clearInterval(timer);
    }, [isLoading]);

    const hasResponse = !!response;
    const latestProgressPhase = requestStatusEntries[requestStatusEntries.length - 1]?.metadata?.phase;
    const confidence = useMemo(() => aiCodingConfidence(verificationReports.filter(report => report.attempt > confidenceAttemptFloor).at(-1), error,
        {active: isLoading, hasResponse: !!response}), [verificationReports, confidenceAttemptFloor, error, isLoading, response]);
    const progressStage = getRequestProgressStage(latestProgressPhase, hasResponse, requestAttempt, workspaceStage);
    const estimateData = isLoading && !workspaceStage.startsWith('Checking') ? estimatorRef.current?.estimate() : null;
    const estimateDetails = estimateData?.details || '';
    const estimateProgress = estimateData?.progress || '';
    const finishEstimate = !isLoading ? '' : workspaceStage.startsWith('Checking')
        ? 'Checking the workspace. Any required repairs may add time.'
        : estimateData?.text || 'Finish estimate unavailable until file generation is underway.';
    useEffect(() => {
        if (isLoading) window.electron?.aiCodingAgent?.setActivity?.(true, {
            stage: progressStage, progress: estimateProgress, estimate: finishEstimate,
        });
    }, [isLoading, progressStage, estimateProgress, finishEstimate]);
    // Reset for a new visible work stage, not for heartbeat text, token counts,
    // or opening the popover. The operation clock above keeps running.
    useEffect(() => {
        if (!isLoading) return undefined;
        const startedAt = Date.now();
        const updateElapsed = () => setStageElapsedMs(Math.max(0, Date.now() - startedAt));
        updateElapsed();
        const timer = setInterval(updateElapsed, 1000);
        return () => clearInterval(timer);
    }, [isLoading, progressStage]);
    const measuredStreamStatus = isLoading && [undefined, "first-content", "generation"].includes(latestProgressPhase)
        ? buildAiCodingStreamStatus(streamProgressRef.current) : "";
    const streamStatus = isLoading && workspaceStage
        ? measuredStreamStatus || requestStatusEntries.at(-1)?.message || 'Preparing the request.'
        : measuredStreamStatus;

    useEffect(() => {
        if (typeof onActivityChange !== "function") {
            return;
        }

        const latestEntry = requestStatusEntries[requestStatusEntries.length - 1];
        const latestStatus = streamStatus || latestEntry?.message || "";
        onActivityChange({
            guideReviewPending: !!skillReview,
            isLoading,
            hasResponse,
            error: error || "",
            latestStatus: isLoading ? latestStatus : operationSummary?.message || "",
            stage: isLoading ? progressStage : operationSummary?.title || "Request finished",
            elapsedMs: requestElapsedMs,
            stageElapsedMs,
            estimate: finishEstimate,
            estimateDetails,
            estimateProgress,
            confidence,
        });
    }, [onActivityChange, skillReview, isLoading, requestStatusEntries, hasResponse, streamStatus, error, requestElapsedMs, stageElapsedMs, progressStage, operationSummary, finishEstimate, estimateDetails, estimateProgress, confidence]);

    // Store handlers in refs to ensure proper cleanup and prevent duplicates
    const handlersRef = useRef({
        delta: null,
        done: null,
        error: null
    });

    const listenersRegistered = useRef(false);
    useEffect(() => {
        if (listenersRegistered.current) return; // Prevent double-registration
        listenersRegistered.current = true;
        panelMountedRef.current = true;
        // Create handler functions
        const handleStreamDelta = (data) => {
            if (requestSnapshotRef.current?.revision !== (virtualFS.fs.snapshotSwitchRevision || 0)) return;
            if (cancelledRequestIdsRef.current.has(data.requestId)) {
                return;
            }
            if (data.requestId !== streamingRequestIdRef.current) {
                return;
            }

            if (data.type === 'generation-checkpoint') {
                if (data.checkpoint.workspaceId !== virtualFS.sandboxName) return;
                setSavedGenerationCheckpoint(data.checkpoint);
                applyingGenerationCheckpointRef.current = data.checkpoint.id;
                return;
            }
            if (data.type === 'skill-review') {
                clearRequestTimeout();
                skillReviewActionRef.current = null;
                setSkillReviewAction(null);
                setSkillReviewFeedback('');
                setSkillReview({requestId: data.requestId, content: data.content, report: data.report, proposal: data.proposal});
                setSkillReviewError(data.errors ? Object.entries(data.errors).map(([key, value]) => `${key}: ${value}`).join('\n') : '');
                setWorkspaceStage(data.proposal ? 'Plugin guide proposal needs attention' : 'Waiting for plugin guide approval');
                return;
            }
            if (data.type === "heartbeat") {
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                return;
            }

            if (data.type === 'estimate-complete') {
                estimatorRef.current?.complete(data.path);
                return;
            }

            if (data.type === "stage") {
                if (Object.prototype.hasOwnProperty.call(data, 'estimate')) {
                    estimatorRef.current?.stage(data.estimate);
                }
                if (streamContentFlushTimerRef.current) clearTimeout(streamContentFlushTimerRef.current);
                streamContentFlushTimerRef.current = null;
                streamContentBufferRef.current = "";
                streamProgressRef.current = createAiCodingStreamProgress();
                stagePendingFiles(data.content, data.estimate?.path || '');
                setWorkspaceStage(data.label || "Generating workspace files");
                // These are pending files, not applied edits. STREAM_DONE is
                // emitted only after every file completed successfully.
                responseRef.current = data.content ? `${data.content}\n\n` : "";
                if (!workspaceReviewInProgressRef.current) setResponse(responseRef.current);
                pushRequestStatus(data.label || "Generating workspace files", {phase: 'workspace-stage'});
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                return;
            }

            if (data.type === "reset") {
                estimatorRef.current?.resetAttempt();
                if (streamContentFlushTimerRef.current) {
                    clearTimeout(streamContentFlushTimerRef.current);
                    streamContentFlushTimerRef.current = null;
                }
                streamContentBufferRef.current = "";
                streamProgressRef.current = createAiCodingStreamProgress();
                responseRef.current = "";
                setResponse("");
                requestAttemptRef.current += 1;
                setRequestAttempt(requestAttemptRef.current);
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                return;
            }

            if (data.type === "status") {
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                if (typeof data.message === "string" && data.message.trim()) {
                    pushRequestStatus(data.message.trim(), data.metadata || {});
                }
                return;
            }

            // Robust validation: only process if requestId matches AND content is valid
            if (data.content && 
                typeof data.content === 'string' &&
                data.content.length > 0) {
                // Whitespace-only chunks can contain significant code indentation.
                recordAiCodingStreamText(streamProgressRef.current, data.content);
                estimatorRef.current?.chunk(data.content);
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                streamContentBufferRef.current += data.content;
                scheduleStreamContentFlush();
            }
        };

        const handleStreamDone = (data) => {
            if (requestSnapshotRef.current?.revision !== (virtualFS.fs.snapshotSwitchRevision || 0)) return;
            if (cancelledRequestIdsRef.current.has(data.requestId)) {
                clearRequestTimeout();
                // Keep this marker until the original IPC promise returns.
                // A late stream completion must never make a stopped request
                // eligible to apply workspace edits.
                return;
            }
            const match = data.requestId === streamingRequestIdRef.current;
            if (!match) {
                console.warn("[AI Coding Agent] Stream done mismatch", data.requestId);
                return;
            }
            // ALWAYS clear timeout FIRST (critical to prevent timeout errors)
            clearRequestTimeout();
            flushStreamContent();
            streamProgressRef.current = createAiCodingStreamProgress();
            setWorkspaceStage("");
            estimatorRef.current?.stage(null);
            console.log('[AI Coding Agent] Timeout cleared');
            console.log('[AI Coding Agent] Stream done', { requestId: data.requestId, streamingRequestId: streamingRequestIdRef.current });

            console.log('[AI Coding Agent] Completing stream');
            // Keep the activity trail through validation and scoped repairs.
            responseRef.current = data.fullContent;
            if (/^### File:/m.test(data.fullContent || '')) stagePendingFiles(data.fullContent);
            if (!workspaceReviewInProgressRef.current) setResponse(data.fullContent);
            // Stream completion precedes IPC completion and workspace application.
            if (!submitInFlightRef.current) setIsLoading(false);

        };

        const handleStreamError = (data) => {
            console.error('[AI Coding Agent] Stream error', data);
            // Keep a useful partial reply visible when the provider reports an
            // error such as max_output_tokens immediately after a delta.
            flushStreamContent();
            if (cancelledRequestIdsRef.current.has(data.requestId)) {
                clearRequestTimeout();
                return;
            }
            if (data.requestId === streamingRequestIdRef.current) {
                dispatchGenerationRecovery({type: 'failed', requestId: data.requestId, failure: data.failure, originalPrompt: currentRequestRef.current?.userPrompt});
                setError(data.error);
                setIsOperationActive(false);
                setIsLoading(false);
                setRequestStatusEntries([]);
                streamingRequestIdRef.current = null;
                
                // Clear timeout
                clearRequestTimeout();
            }
        };

        const handleStreamCancelled = (data) => {
            const timedOut = timedOutRequestIdsRef.current.has(data.requestId);
            if (!timedOut && !cancelledRequestIdsRef.current.has(data.requestId) && data.requestId !== streamingRequestIdRef.current) {
                return;
            }
            dispatchGenerationRecovery({type: 'cancel', requestId: data.requestId});
            timedOutRequestIdsRef.current.delete(data.requestId);
            clearRequestTimeout();
            if (data.requestId === streamingRequestIdRef.current) {
                streamingRequestIdRef.current = null;
            }
            setIsOperationActive(false);
            setIsLoading(false);
            setRequestStatusEntries([]);
            setOperationSummary(timedOut ? {
                intent: "warning",
                title: "AI Request Timed Out",
                message: "The provider did not make progress in time. The request was stopped; retry when the provider is available.",
            } : {
                intent: "warning",
                title: "AI Request Stopped",
                message: data.message || "The AI request was stopped before any changes were applied.",
            });
            setError(timedOut ? "Request timed out. The AI service may be unavailable. Please try again." : null);
            expectWorkspaceApplyRef.current = false;
            pendingAutoFileCreateRef.current = false;
            planRetryInFlightRef.current = false;
            singleFileRetryInFlightRef.current = false;
            multiFileRetryInFlightRef.current = false;
            scopeRetryInFlightRef.current = false;
        };

        // Store handlers in ref for cleanup
        handlersRef.current = {
            delta: handleStreamDelta,
            done: handleStreamDone,
            error: handleStreamError,
            cancelled: handleStreamCancelled,
        };

        // Register event handlers
        window.electron.aiCodingAgent.on.streamDelta(handleStreamDelta);
        window.electron.aiCodingAgent.on.streamDone(handleStreamDone);
        window.electron.aiCodingAgent.on.streamError(handleStreamError);
        window.electron.aiCodingAgent.on.streamCancelled?.(handleStreamCancelled);

        console.log('[AI Coding Agent] Event handlers registered');

        return () => {
            panelMountedRef.current = false;
            investigationAbortRef.current?.abort();
            if (submitInFlightRef.current) {
                const requestId = currentRequestRef.current?.requestId || streamingRequestIdRef.current;
                if (requestId) cancelledRequestIdsRef.current.add(requestId);
            }
            if (streamContentFlushTimerRef.current) {
                clearTimeout(streamContentFlushTimerRef.current);
                streamContentFlushTimerRef.current = null;
            }
            streamContentBufferRef.current = "";
            // Use stored refs for cleanup to ensure we remove the exact same handlers
            if (handlersRef.current.delta) {
                window.electron.aiCodingAgent.off.streamDelta(handlersRef.current.delta);
            }
            if (handlersRef.current.done) {
                window.electron.aiCodingAgent.off.streamDone(handlersRef.current.done);
            }
            if (handlersRef.current.error) {
                window.electron.aiCodingAgent.off.streamError(handlersRef.current.error);
            }
            if (handlersRef.current.cancelled) {
                window.electron.aiCodingAgent.off.streamCancelled?.(handlersRef.current.cancelled);
            }
            listenersRegistered.current = false;
            console.log('[AI Coding Agent] Event handlers cleaned up');
        };
    }, []); // Empty dependency array - only register once

    const getSelectedCode = () => {
        if (!codeEditor) return "";
        const selection = codeEditor.getSelection();
        const model = codeEditor.getModel();
        if (!model) return "";
        return model.getValueInRange(selection);
    };

    const getLanguage = () => {
        if (!codeEditor) return "";
        const model = codeEditor.getModel();
        if (!model) return "";
        return model.getLanguageId();
    };

    const getContext = () => {
        if (!codeEditor) return "";
        const model = codeEditor.getModel();
        if (!model) return "";
        return model.getValue();
    };

    const getCurrentFilePath = () => {
        try {
            if (!codeEditor) return "";
            const model = codeEditor.getModel?.();
            if (!model || typeof virtualFS.getFileName !== "function") return "";
            return virtualFS.getFileName(model) || "";
        } catch (_) {
            return "";
        }
    };

    const getAllProjectFiles = () => {
        try {
            const latestContent = virtualFS.getLatestContent();
            return Object.entries(latestContent)
                .filter(([path]) => typeof path === "string" && path.startsWith("/"))
                .filter(([path]) => !path.startsWith("/node_modules/") && !path.startsWith("/dist/"))
                .map(([path, content]) => ({
                    path,
                    content: typeof content === "string" ? content : String(content ?? ""),
                }));
        } catch (err) {
            console.error('[AI Coding Agent] Error getting project files', err);
            return [];
        }
    };



    const updateMentionSuggestions = (text, cursorIndex) => {
        const skillMention = detectCodexSkillMention(text, cursorIndex);
        const mention = skillMention || detectWorkspaceMention(text, cursorIndex);
        if (!mention || (!skillMention && !mention.query.trim())) {
            setMentionState(null);
            return;
        }

        const currentFileModel = codeEditor?.getModel?.();
        const currentFilePath = currentFileModel && typeof virtualFS.getFileName === "function"
            ? virtualFS.getFileName(currentFileModel) || ""
            : "";
        const suggestions = skillMention ? getCodexSkillMentionItems(mentionSkills, selectedAssistant, mention.query)
            : getWorkspaceMentionItems(getAllProjectFiles(), mention.query, currentFilePath);
        if (suggestions.length === 0) {
            setMentionState(null);
            return;
        }

        setMentionState((existing) => ({
            ...mention,
            suggestions,
            selectedIndex: existing && existing.start === mention.start
                ? Math.min(existing.selectedIndex || 0, suggestions.length - 1)
                : 0,
        }));
    };

    const renderMentionTitle = (item) => {
        if (item.type === "special" || item.type === 'skill') {
            const titleText = String(item.title || "");
            const marker = /^[@$]/.test(titleText) ? titleText[0] : "";
            const body = marker ? titleText.slice(1) : titleText;
            return (
                <span className={styles["mention-token"]}>
                    {marker && <span className={styles["mention-token-marker"]}>{marker}</span>}
                    <span className={styles["mention-token-body"]}>{body}</span>
                </span>
            );
        }

        return <span className={styles["mention-file-title"]}>{item.title}</span>;
    };

    const renderErrorContent = (value) => {
        const message = String(value || "").trim();
        if (!message) {
            return null;
        }

        const validationPrefix = "Generated plugin files failed validation:";
        if (message.startsWith(validationPrefix)) {
            const details = message
                .slice(validationPrefix.length)
                .split(/\s*;\s*(?=\/[^:\n]+:)/)
                .map((item) => item.trim())
                .filter(Boolean);

            return (
                <Callout intent="danger" icon="warning-sign">
                    <strong>Generated Plugin Files Failed Validation</strong>
                    {details.length > 0 && (
                        <ul className={styles["error-list"]}>
                            {details.map((detail, index) => (
                                <li key={`${index}-${detail}`}>{detail}</li>
                            ))}
                        </ul>
                    )}
                </Callout>
            );
        }

        if (isAiCodingOutputLimitError(message)) {
            return (
                <Callout intent="warning" icon="time">
                    <strong>The assistant reached its response limit.</strong>
                    <p>The partial reply is kept for reference, but incomplete code was not applied.</p>
                    <p>Retry as a complete response to receive one self-contained set of plugin workspace files.</p>
                </Callout>
            );
        }

        return (
            <Callout intent="danger" icon="warning-sign">
                {message}
            </Callout>
        );
    };

    const applyMentionSuggestion = (insertText) => {
        if (!mentionState || !insertText) return;
        const applied = mentionState.kind === 'skill'
            ? applyCodexSkillMention(prompt, mentionState, insertText, mentionState.suggestions)
            : applyWorkspaceMention(prompt, mentionState, insertText);
        setPrompt(applied.value);
        setMentionState(null);
        scheduleUiFrame(() => {
            const input = promptInputRef.current;
            if (!input) return;
            input.focus();
            if (typeof input.setSelectionRange === "function") {
                input.setSelectionRange(applied.cursorIndex, applied.cursorIndex);
            }
        });
    };

    const getProblemsContext = ({errorsOnly = false} = {}) => {
        try {
            // The Problems panel aggregates workspace diagnostics, so a repair
            // request must see every plugin file rather than only the tab that
            // happened to be focused when the user pressed Send.
            const models = virtualFS.listModels?.() || [];
            return buildAiCodingProblemsContext(models, {errorsOnly});
        } catch (err) {
            console.error('[AI Coding Agent] Error getting problems context', err);
            return "";
        }
    };

    const waitForProblemsContext = async ({errorsOnly = true, timeoutMs = 1500} = {}) => {
        const startedAt = Date.now();
        // Monaco diagnostics arrive asynchronously after a workspace file is
        // replaced. Give the Problems panel a short, bounded chance to catch
        // up before deciding that a generated plan is clean.
        while (Date.now() - startedAt < timeoutMs) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const context = getProblemsContext({errorsOnly});
            if (context) return context;
        }
        return getProblemsContext({errorsOnly});
    };

    const getBuildOutputContext = (workspaceFiles = []) => {
        try {
            return buildAiCodingBuildOutputContext({
                buildHistory: virtualFS.build?.getHistory?.(20, "build") || [],
                testHistory: virtualFS.build?.getHistory?.(20, "test") || [],
                workspaceFiles,
            });
        } catch (err) {
            console.error('[AI Coding Agent] Error getting build/test output context', err);
            return "";
        }
    };

    const getCurrentPluginId = () => {
        try {
            const parsePluginName = (rawQuery = "") => {
                if (typeof rawQuery !== "string" || !rawQuery) return "";
                const query = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
                const searchParams = new URLSearchParams(query);
                const encodedData = searchParams.get("data");
                if (!encodedData) return "";
                const parsed = JSON.parse(decodeURIComponent(encodedData));
                return typeof parsed?.name === "string" ? parsed.name.trim() : "";
            };

            const fromSearch = parsePluginName(window?.location?.search || "");
            if (fromSearch) {
                return fromSearch;
            }

            const hash = String(window?.location?.hash || "");
            const hashQueryIndex = hash.indexOf("?");
            if (hashQueryIndex < 0) {
                return "";
            }
            return parsePluginName(hash.slice(hashQueryIndex));
        } catch (_) {
            return "";
        }
    };

    const resolvePluginIdFromPrompt = async (promptText = "") => {
        const fallbackId = getCurrentPluginId();
        const pluginApi = window?.electron?.plugin;
        if (!pluginApi || typeof pluginApi.getAll !== "function") {
            return fallbackId;
        }

        const rawPrompt = String(promptText || "");
        const quotedCandidates = [
            ...rawPrompt.matchAll(/"([^"]+)"/g),
            ...rawPrompt.matchAll(/'([^']+)'/g),
        ]
            .map((match) => String(match?.[1] || "").trim())
            .filter(Boolean);

        if (quotedCandidates.length === 0) {
            return fallbackId;
        }

        try {
            const all = await pluginApi.getAll();
            const plugins = Array.isArray(all?.plugins) ? all.plugins : [];
            const normalizedCandidates = quotedCandidates.map((value) => value.toLowerCase());
            const match = plugins.find((plugin) => {
                const id = String(plugin?.id || "").trim();
                const metadataName = String(plugin?.metadata?.name || "").trim();
                const values = [id, metadataName].filter(Boolean).map((value) => value.toLowerCase());
                return normalizedCandidates.some((candidate) => values.includes(candidate));
            });
            return String(match?.id || "").trim() || fallbackId;
        } catch (_) {
            return fallbackId;
        }
    };

    const showPluginTraceWarning = async (pluginId, detailText = "", intent = "warning", title = "") => {
            const safePluginId = String(pluginId || "").trim();
            const safeDetails = String(detailText || "").trim();
            const dedupeKey = `${safePluginId}:${safeDetails}`;
            const now = Date.now();
            if (lastPluginTraceToastRef.current.key === dedupeKey && now - lastPluginTraceToastRef.current.at < 10000) {
                return;
            }
            lastPluginTraceToastRef.current = {key: dedupeKey, at: now};

            const defaultTitle = intent === "danger"
                ? "Plugin runtime action failed."
                : "Plugin runtime warning.";
            const message = String(title || "").trim() || (safePluginId
                ? `Plugin trace unavailable for "${safePluginId}".`
                : defaultTitle);

            const details = [
                `Plugin trace fetch failed`,
                safePluginId ? `Plugin: ${safePluginId}` : "",
                safeDetails ? `Reason: ${safeDetails}` : "",
            ].filter(Boolean).join("\n");

            try {
                const toaster = await Promise.resolve(AppToaster);
                toaster?.show?.({
                    message,
                    intent,
                    icon: intent === "danger" ? "error" : "warning-sign",
                    timeout: 7000,
                    action: {
                        text: "Copy Details",
                        onClick: async () => {
                            try {
                                await navigator?.clipboard?.writeText?.(details);
                            } catch (_) {
                                // Ignore clipboard failures in restricted environments.
                            }
                        },
                    },
                });
            } catch (_) {
                // Keep tracing non-blocking if toaster is unavailable.
            }
        };

    const runPluginRuntimeProbe = async ({
        promptText = "",
        pluginId = "",
        maxFiles = 4,
        maxChars = 12000,
    } = {}) => {
        const runtimeIntent = detectAiPluginRuntimeIntent(promptText);
        if (!runtimeIntent.shouldProbe) {
            return { context: "", traceResult: null };
        }
        if (!pluginId || !window?.electron?.plugin) {
            return { context: "", traceResult: null };
        }

        const pluginApi = window.electron.plugin;
        const steps = [];
        const notes = [];
        const addStep = (name, result) => {
            steps.push({
                name,
                success: !!result?.success,
                error: result?.error || "",
                result,
            });
            if (!result?.success && result?.error) {
                notes.push(`${name}: ${result.error}`);
            }
        };
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const safeCall = async (label, fn, ...args) => {
            if (typeof fn !== "function") {
                const missing = { success: false, error: `${label} is unavailable` };
                addStep(label, missing);
                return missing;
            }
            try {
                const result = await fn(...args);
                addStep(label, result || { success: false, error: `${label} returned empty result` });
                return result || { success: false, error: `${label} returned empty result` };
            } catch (error) {
                const failure = { success: false, error: error?.message || String(error) };
                addStep(label, failure);
                return failure;
            }
        };

        const getRuntimeSnapshot = async () => {
            const statusResult = await safeCall("getRuntimeStatus", pluginApi.getRuntimeStatus, [pluginId]);
            return statusResult?.statuses?.[0] || null;
        };

        pushRequestStatus(`Running plugin runtime checks for "${pluginId}" via host plugin utilities.`, { phase: "plugin-runtime" });
        const beforeStatus = await getRuntimeSnapshot();

        if (runtimeIntent.wantsRestart || runtimeIntent.wantsDeactivate) {
            await safeCall("deactivate", pluginApi.deactivate, pluginId);
        }
        if (runtimeIntent.wantsActivate) {
            await safeCall("activate", pluginApi.activate, pluginId);
            await wait(120);
        }
        if (runtimeIntent.wantsInit) {
            await safeCall("init", pluginApi.init, pluginId);
        }
        if (runtimeIntent.wantsRender) {
            await safeCall("render", pluginApi.render, pluginId);
        }

        let afterStatus = await getRuntimeSnapshot();
        if (runtimeIntent.wantsActivate && (!afterStatus?.ready || !afterStatus?.inited)) {
            for (let attempt = 0; attempt < 3; attempt++) {
                await wait(120);
                afterStatus = await getRuntimeSnapshot();
                if (afterStatus?.ready && afterStatus?.inited) {
                    break;
                }
            }
        }

        const traceResult = await safeCall(
            "getLogTrace",
            pluginApi.getLogTrace,
            pluginId,
            { maxFiles, maxChars, maxNotifications: 10 },
        );

        const failedSteps = steps.filter((step) => !step.success);
        if (failedSteps.length > 0) {
            const primaryError = failedSteps[0]?.error || "Plugin runtime action failed.";
            const message = `Plugin runtime actions completed with errors for "${pluginId}".`;
            await showPluginTraceWarning(pluginId, primaryError, "danger", message);
            setOperationSummary({
                intent: "danger",
                title: "Plugin Runtime Action Failed",
                message: primaryError,
            });
        } else if (steps.some((step) => step.name === "getLogTrace")) {
            setOperationSummary({
                intent: "primary",
                title: "Plugin Runtime Verified",
                message: `Ran plugin runtime actions and refreshed logs for "${pluginId}".`,
            });
        }

        const context = [
            `Plugin runtime action report for "${pluginId}":`,
            `Requested actions: ${JSON.stringify(runtimeIntent)}`,
            beforeStatus ? `Runtime status before: ${JSON.stringify(beforeStatus)}` : "Runtime status before: unavailable",
            afterStatus ? `Runtime status after: ${JSON.stringify(afterStatus)}` : "Runtime status after: unavailable",
            notes.length > 0 ? `Action warnings/errors:\n- ${notes.join("\n- ")}` : "Action warnings/errors: none",
            "Step results:",
            ...steps.map((step) => `- ${step.name}: ${step.success ? "success" : `failed (${step.error || "unknown"})`}`),
            "",
            traceResult?.combined ? `Plugin trace bundle for "${pluginId}":\n${traceResult.combined}` : "Plugin trace bundle unavailable.",
            "",
        ].join("\n");

        return {
            context,
            traceResult,
        };
    };

    const getPluginLogsContext = async ({maxFiles = 4, maxChars = 12000, preloadedTraceResult = null} = {}) => {
        try {
            const pluginId = getCurrentPluginId();
            if (!pluginId || !window?.electron?.plugin) {
                return "";
            }
            if (preloadedTraceResult?.success && preloadedTraceResult?.combined) {
                return `Plugin trace bundle for "${pluginId}":\n${preloadedTraceResult.combined}\n\n`;
            }
            const traceApi = typeof window.electron.plugin.getLogTrace === "function"
                ? window.electron.plugin.getLogTrace
                : null;
            const tailApi = typeof window.electron.plugin.getLogTail === "function"
                ? window.electron.plugin.getLogTail
                : null;
            if (!traceApi && !tailApi) {
                return "";
            }
            const result = traceApi
                ? await traceApi(pluginId, {maxFiles, maxChars, maxNotifications: 10})
                : await tailApi(pluginId, {maxFiles, maxChars});
            if (!result?.success || !result?.combined) {
                const reason = result?.error || "Trace provider returned no log bundle.";
                await showPluginTraceWarning(pluginId, reason, "warning");
                return "";
            }
            return `Plugin trace bundle for "${pluginId}":\n${result.combined}\n\n`;
        } catch (error) {
            console.warn("[AI Coding Agent] Failed to load plugin runtime logs:", error?.message || error);
            await showPluginTraceWarning(getCurrentPluginId(), error?.message || String(error), "warning");
            return "";
        }
    };

    const findLikelyFailingWorkspaceFile = (projectFiles = []) => {
        try {
            const buildHistory = virtualFS.build?.getHistory?.(20, "build") || [];
            const testHistory = virtualFS.build?.getHistory?.(20, "test") || [];
            const recentFailureText = [...buildHistory, ...testHistory]
                .filter((entry) => entry?.error && typeof entry.message === "string")
                .map((entry) => entry.message)
                .join("\n")
                .toLowerCase();

            if (!recentFailureText) {
                return null;
            }

            const candidates = Array.isArray(projectFiles) ? projectFiles : [];
            for (const file of candidates) {
                const normalizedPath = String(file?.path || "").toLowerCase();
                const basename = normalizedPath.split("/").pop() || normalizedPath;
                if (!normalizedPath) continue;
                if (recentFailureText.includes(normalizedPath) || (basename && recentFailureText.includes(basename))) {
                    return file;
                }
            }

            return null;
        } catch (err) {
            console.error("[AI Coding Agent] Error resolving failing workspace file", err);
            return null;
        }
    };

    const collectWorkspaceFailurePaths = (failureText = "", projectFiles = []) => {
        const normalizedFailureText = String(failureText || "").toLowerCase();
        if (!normalizedFailureText) {
            return [];
        }

        const candidates = Array.isArray(projectFiles) ? projectFiles : [];
        return candidates
            .filter((file) => {
                const normalizedPath = String(file?.path || "").toLowerCase();
                const basename = normalizedPath.split("/").pop() || normalizedPath;
                if (!normalizedPath) return false;
                return normalizedFailureText.includes(normalizedPath) || (basename && normalizedFailureText.includes(basename));
            })
            .map((file) => file.path);
    };

    const estimateTestRepairAttemptBudget = (testRunResult, projectFiles = []) => {
        const failureText = [
            testRunResult?.error || "",
            testRunResult?.output || "",
        ].join("\n");
        const failurePaths = collectWorkspaceFailurePaths(failureText, projectFiles);
        return Math.min(4, Math.max(2, failurePaths.length + 1));
    };

    const buildIterativeTestRepairPrompt = ({
        basePrompt = "",
        attempt = 1,
        maxAttempts = 2,
        targetFilePath = "",
    } = {}) => {
        const scopeLine = targetFilePath
            ? `Target the failing workspace file ${targetFilePath}.`
            : "Target the currently failing plugin test or supporting workspace file only.";

        return [
            basePrompt,
            "",
            `Automated test-fix loop attempt ${attempt} of ${maxAttempts}.`,
            scopeLine,
            "Use the latest provided test output and current workspace state.",
            "Apply the smallest concrete fix that addresses the current failing tests.",
            "After this fix, FDO will rerun the tests automatically.",
        ].join("\n");
    };

    const getRelevantSdkKnowledgeContext = async (query) => {
        try {
            const load = (text, limit) => window.electron.system.getFdoSdkKnowledge(text, limit);
            let result = await load(query, 6);
            if (!result?.success || !Array.isArray(result.results) || result.results.length === 0) {
                result = await load(SDK_KNOWLEDGE_BASELINE_QUERY, 4);
            }
            if (!result?.success || !Array.isArray(result.results) || result.results.length === 0) {
                return "";
            }
            console.log('[AI Coding Agent] SDK knowledge loaded', { resultsCount: result.results.length });
            return formatSdkKnowledgeContext(result.results);
        } catch (err) {
            console.error('[AI Coding Agent] Failed to load SDK knowledge', err);
            return "";
        }
    };

    const getExternalReferenceContext = async (query) => {
        try {
            const result = await window.electron.system.getExternalReferenceKnowledge(query, 3);
            if (!result?.success || !Array.isArray(result.results) || result.results.length === 0) {
                return "";
            }
            console.log('[AI Coding Agent] External references loaded', { resultsCount: result.results.length });
            return formatExternalReferenceContext(result.results);
        } catch (err) {
            console.error('[AI Coding Agent] Failed to load external references', err);
            return "";
        }
    };

    const createSnapshotBeforeApply = () => {
        assertSnapshotUnchanged();
        try {
            const currentVersion = virtualFS.fs.version();
            const tabs = virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => ({id: t.id, active: t.active}));
            const created = virtualFS.fs.create(currentVersion.version, tabs, { quiet: true });
            console.log(`Created snapshot ${created.version} before AI code application`);
            return created;
        } catch (err) {
            console.error('Failed to create snapshot:', err);
            return null;
        }
    };

    const persistSnapshotAfterApply = (previousVersion = "") => {
        assertSnapshotUnchanged();
        try {
            const tabs = virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => ({ id: t.id, active: t.active }));
            const created = virtualFS.fs.create(previousVersion, tabs, { quiet: true });
            if (!created.error) {
                appliedSnapshotRef.current = created.version;
                const checkpointId = applyingGenerationCheckpointRef.current;
                if (checkpointId && window.electron.aiCodingAgent.discardGenerationCheckpoint) {
                    applyingGenerationCheckpointRef.current = null;
                    window.electron.aiCodingAgent.discardGenerationCheckpoint({workspaceId: virtualFS.sandboxName, id: checkpointId})
                        .then(result => {if (result.success) {checkpointSequenceRef.current += 1; setSavedGenerationCheckpoint(current => current?.id === checkpointId ? null : current);} else setCheckpointError(result.error);})
                        .catch(error => setCheckpointError(error.message));
                }
                if (!submitInFlightRef.current) {
                    const messages = [...conversationRef.current];
                    const last = messages.length - 1;
                    if (messages[last]?.role === "assistant") {
                        messages[last] = {...messages[last], appliedSnapshot: String(created.version)};
                        saveConversation(messages);
                    }
                }
            }
            console.log(`Persisted snapshot ${created.version} after AI code application`);
            return created;
        } catch (err) {
            console.error("Failed to persist post-apply snapshot:", err);
            return null;
        }
    };

    const rerunSingleFileAsExecutableResponse = async (priorContent) => {
        const requestMeta = currentRequestRef.current;
        if (!requestMeta || !["fix", "edit", "generate"].includes(requestMeta.action)) {
            return null;
        }

        const currentModel = codeEditor?.getModel?.() || null;
        const activeEditorFilePath = currentModel && typeof virtualFS.getFileName === "function"
            ? virtualFS.getFileName(currentModel) || ""
            : "";
        const currentFilePath = requestMeta.targetFilePath || activeEditorFilePath;
        const preferFullFileRewrite = !requestMeta.hasSelection
            || /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(currentFilePath)
            || /tests?\s+(?:are|is)\s+failing|failing tests?|test issue/i.test(requestMeta.prompt || "");

        const retryPrompt = buildSingleFileApplyRetryPrompt({
            originalPrompt: requestMeta.prompt,
            invalidResponse: priorContent,
            action: requestMeta.action,
            applyFailure: requestMeta.applyFailure || "",
            currentFilePath,
            preferFullFileRewrite,
            hasSelection: !!requestMeta.hasSelection,
        });
        const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        beginStreamingRequest(retryRequestId);
        responseRef.current = "";
        setResponse("");
        setIsLoading(true);
        scheduleRequestTimeout(selectedAssistant?.provider || "");
        pushRequestStatus(
            requestMeta.applyFailure
                ? "The previous AI patch did not apply cleanly. Requesting a more specific executable patch or a full corrected file."
                : `AI response was too partial to apply safely. Requesting an executable patch or full ${requestMeta.hasSelection ? "selected-code" : "file"} rewrite.`,
            { phase: "single-file-retry" },
        );

        if (requestMeta.action === "fix") {
            return await window.electron.aiCodingAgent.fixCode({
                requestId: retryRequestId,
                code: requestMeta.code,
                error: retryPrompt,
                language: requestMeta.language,
                context: requestMeta.context,
                assistantId: requestMeta.assistantId,
                targetFilePath: requestMeta.targetFilePath || currentFilePath,
            });
        }

        if (requestMeta.action === "generate") {
            return await window.electron.aiCodingAgent.generateCode({
                requestId: retryRequestId,
                prompt: retryPrompt,
                language: requestMeta.language,
                context: requestMeta.context,
                assistantId: requestMeta.assistantId,
            });
        }

        return await window.electron.aiCodingAgent.editCode({
            requestId: retryRequestId,
            code: requestMeta.code,
            instruction: retryPrompt,
            language: requestMeta.language,
            context: requestMeta.context,
            assistantId: requestMeta.assistantId,
            targetFilePath: requestMeta.targetFilePath || currentFilePath,
        });
    };

    const rerunMultiFileAsExecutableResponse = async ({
        priorContent = "",
        mentionedFilePaths = [],
    } = {}) => {
        const requestMeta = currentRequestRef.current;
        const normalizedMentionedPaths = Array.isArray(mentionedFilePaths)
            ? mentionedFilePaths.filter(Boolean)
            : [];
        if (!requestMeta || !selectedAssistant?.id || normalizedMentionedPaths.length < 2) {
            return null;
        }

        const retryPrompt = `${requestMeta.prompt}

IMPORTANT RETRY INSTRUCTION:
Your previous response claimed changes in multiple plugin workspace files (${normalizedMentionedPaths.join(", ")}) but did not return executable file content for all of them.

Previous response:
${String(priorContent || "").trim().slice(0, 5000)}

Return ONLY executable workspace file sections for every file you want to change:

### File: /path/to/file
\`\`\`typescript
...complete file content...
\`\`\`

Rules:
- Use only plugin workspace files.
- Include every changed file explicitly.
- Do not return prose, summaries, or partial snippets.`;

        const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        beginStreamingRequest(retryRequestId);
        responseRef.current = "";
        setResponse("");
        setIsLoading(true);
        scheduleRequestTimeout(selectedAssistant?.provider || "");
        pushRequestStatus(
            `Requesting executable multi-file changes for ${normalizedMentionedPaths.join(", ")}.`,
            { phase: "multi-file-retry" },
        );

        return await window.electron.aiCodingAgent.planCode({
            workspaceFiles: getAllProjectFiles(),
            requestId: retryRequestId,
            prompt: retryPrompt,
            image: uploadedImage,
            context: requestMeta.projectContext || requestMeta.context || "",
            assistantId: selectedAssistant.id,
        });
    };

    const rerunPluginScopedResponse = async ({
        action: retryAction = "",
        prompt: originalPrompt = "",
        invalidResponse = "",
        language = "",
        selectedCode = "",
        projectContext = "",
        referenceContext = "",
        assistantId = "",
        image = null,
        targetFilePath = "",
    } = {}) => {
        const scopedRetryPrompt = [
            "Previous response escaped the current plugin workspace by referencing FDO host application files.",
            "Retry using plugin workspace files only.",
            "Do not reference, suggest, or modify FDO host/internal files.",
            "Use only plugin-local files that already exist in this plugin workspace, such as /index.ts, /render.ts, /fdo.meta.json, /package.json, /tests/... and similar plugin files.",
            targetFilePath ? `Prefer ${targetFilePath} if a single-file update is appropriate.` : "",
            "",
            "Original request:",
            originalPrompt,
            "",
            "Rejected response:",
            invalidResponse,
        ].filter(Boolean).join("\n");
        const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        beginStreamingRequest(retryRequestId);
        responseRef.current = "";
        setResponse("");
        setIsLoading(true);
        scheduleRequestTimeout(selectedAssistant?.provider || "");
        pushRequestStatus(
            "Previous answer referenced host files. Requesting a plugin-only correction.",
            { phase: "scope-retry" },
        );

        switch (retryAction) {
            case "generate":
                return await window.electron.aiCodingAgent.generateCode({
                    requestId: retryRequestId,
                    prompt: scopedRetryPrompt,
                    language,
                    context: projectContext,
                    assistantId,
                });
            case "edit":
                if (!selectedCode) {
                    return await window.electron.aiCodingAgent.smartMode({
                        requestId: retryRequestId,
                        prompt: scopedRetryPrompt,
                        code: "",
                        language,
                        context: projectContext,
                        assistantId,
                    });
                }
                return await window.electron.aiCodingAgent.editCode({
                    requestId: retryRequestId,
                    code: selectedCode,
                    instruction: scopedRetryPrompt,
                    language,
                    context: referenceContext,
                    assistantId,
                    targetFilePath,
                });
            case "fix":
                if (!selectedCode) {
                    return await window.electron.aiCodingAgent.smartMode({
                        requestId: retryRequestId,
                        prompt: scopedRetryPrompt,
                        code: "",
                        language,
                        context: projectContext,
                        assistantId,
                    });
                }
                return await window.electron.aiCodingAgent.fixCode({
                    requestId: retryRequestId,
                    code: selectedCode,
                    error: scopedRetryPrompt,
                    language,
                    context: referenceContext,
                    assistantId,
                    targetFilePath,
                });
            case "plan":
                return await window.electron.aiCodingAgent.planCode({
                    workspaceFiles: getAllProjectFiles(),
                    requestId: retryRequestId,
                    prompt: scopedRetryPrompt,
                    image,
                    context: referenceContext,
                    assistantId,
                });
            case "explain":
            case "smart":
            default:
                return await window.electron.aiCodingAgent.smartMode({
                    requestId: retryRequestId,
                    prompt: scopedRetryPrompt,
                    code: selectedCode,
                    language,
                    context: projectContext,
                    assistantId,
                });
        }
    };

    const runDiagnosticSmartFallback = async ({
        requestId,
        prompt,
        selectedCode = "",
        language = "",
        context = "",
        assistantId = "",
        reason = "",
    } = {}) => {
        pushRequestStatus(
            reason || "No precise workspace file could be derived for direct patching. Switching to diagnostic mode with the current test/build context.",
            { phase: "diagnostic-fallback" },
        );
        return await window.electron.aiCodingAgent.smartMode({
            requestId,
            prompt,
            code: selectedCode,
            language,
            context,
            assistantId,
        });
    };

    const runIterativeTestRepairFlow = async ({
        basePrompt = "",
        language = "",
        assistantId = "",
        continueWhenTestsPass = false,
    } = {}) => {
        let testRunResult = await runPluginTests();
        if (testRunResult?.success) {
            const summary = testRunResult.skipped
                ? "No plugin tests were found, so there were no failures to investigate."
                : "Plugin tests passed. There were no failing tests to investigate.";
            if (!continueWhenTestsPass) {
                setResponse(summary);
                setOperationSummary({
                    intent: testRunResult.skipped ? "warning" : "success",
                    title: testRunResult.skipped ? "No Tests Found" : "Tests Passed",
                    message: summary,
                });
                setIsLoading(false);
                return true;
            }
            pushRequestStatus("Plugin tests passed. Continuing with the requested workspace quality review.", { phase: "tests" });
            return false;
        }

        let refreshedProjectFiles = getAllProjectFiles();
        let maxRepairAttempts = estimateTestRepairAttemptBudget(testRunResult, refreshedProjectFiles);
        pushRequestStatus(
            `Plugin tests failed. Starting an automated repair loop with up to ${maxRepairAttempts} attempt${maxRepairAttempts === 1 ? "" : "s"}.`,
            { phase: "tests" },
        );

        for (let attempt = 1; attempt <= maxRepairAttempts; attempt++) {
            refreshedProjectFiles = getAllProjectFiles();
            const buildOutputContext = getBuildOutputContext(refreshedProjectFiles);
            const pluginLogsContext = await getPluginLogsContext();
            const derivedFailingFile = findLikelyFailingWorkspaceFile(refreshedProjectFiles)
                || refreshedProjectFiles.find((file) => /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file.path))
                || null;

            if (!derivedFailingFile?.content) {
                const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                beginStreamingRequest(requestId);
                currentRequestRef.current = {
                    action: "smart",
                    prompt: basePrompt,
                    code: "",
                    language,
                    context: buildOutputContext,
                    assistantId,
                    targetFilePath: "",
                    diagnosticFallback: true,
                };
                const result = await runDiagnosticSmartFallback({
                    requestId,
                    prompt: `${basePrompt}\n\nPlugin tests failed, but no exact failing workspace file could be derived. Diagnose the failure from the latest test output and current workspace context.`,
                    selectedCode: "",
                    language,
                    context: buildOutputContext,
                    assistantId,
                    reason: "No exact failing workspace file could be identified from the latest test output. Switching to diagnostic mode.",
                });
                if (result?.success && result?.content) {
                    setResponse(result.content);
                } else if (result?.error) {
                    setError(result.error);
                }
                setOperationSummary({
                    intent: "warning",
                    title: "Test Diagnosis Only",
                    message: "The assistant reviewed the latest failing test output, but no exact workspace test file could be identified for automatic repair.",
                });
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                clearRequestTimeout();
                return true;
            }

            const targetFilePath = derivedFailingFile.path || "";
            const effectivePrompt = buildIterativeTestRepairPrompt({
                basePrompt,
                attempt,
                maxAttempts: maxRepairAttempts,
                targetFilePath,
            });
            const currentFileContext = getContext();
            const problemsContext = getProblemsContext();
            const issueScope = classifyAiCodingIssueScope({
                prompt: effectivePrompt,
                selectedCode: derivedFailingFile.content,
                problemsContext: `${problemsContext}${buildOutputContext}`,
            });
            const sdkKnowledgeEnabled = shouldUseFdoSdkKnowledge({
                action: "fix",
                prompt: effectivePrompt,
                code: derivedFailingFile.content,
                error: effectivePrompt,
                context: `${problemsContext}${buildOutputContext}${currentFileContext?.slice(0, 800)}`,
            });
            const externalReferenceEnabled = shouldUseExternalReferenceKnowledge({
                prompt: effectivePrompt,
                code: derivedFailingFile.content,
                context: `${problemsContext}${buildOutputContext}${currentFileContext?.slice(0, 800)}`,
            });
            const sdkKnowledgeQuery = [
                effectivePrompt,
                derivedFailingFile.content,
                problemsContext,
                buildOutputContext,
                pluginLogsContext,
                currentFileContext?.slice(0, 800),
            ].filter(Boolean).join("\n");
            const [sdkKnowledgeContext, externalReferenceContext] = await Promise.all([
                sdkKnowledgeEnabled ? getRelevantSdkKnowledgeContext(sdkKnowledgeQuery) : Promise.resolve(""),
                externalReferenceEnabled ? getExternalReferenceContext(sdkKnowledgeQuery) : Promise.resolve(""),
            ]);
            const requestContexts = buildAiCodingAgentRequestContexts({
                includeProjectContext: true,
                projectFiles: refreshedProjectFiles,
                currentFileContext,
                currentFilePath: getCurrentFilePath(),
                prompt: effectivePrompt,
                workspaceReferenceContext: "",
                problemsContext,
                buildOutputContext,
                pluginLogsContext,
                externalReferenceContext,
                sdkKnowledgeContext,
                projectContextMode: "focused",
            });
            const diagnosisContext = shouldIncludeIssueDiagnosis({
                prompt: effectivePrompt,
                action: "fix",
            }) && issueScope.summary
                ? `${issueScope.summary}\nThis is a preliminary ${issueScope.kind} classification, not a confirmed root cause. Verify the specific diagnostic and its relevance to the current workspace before proposing changes.\n\n`
                : "";
            const finalEnhancedContext = `${diagnosisContext}${requestContexts.projectContext}`;
            const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            currentRequestRef.current = {
                action: "fix",
                prompt: effectivePrompt,
                code: derivedFailingFile.content,
                language,
                context: requestContexts.referenceContext,
                assistantId,
                targetFilePath,
                diagnosticFallback: false,
            };
            applyActionRef.current = "fix";

            beginStreamingRequest(requestId);
            scheduleRequestTimeout(selectedAssistant?.provider || "");
            pushRequestStatus(
                `Repair attempt ${attempt} of ${maxRepairAttempts}: requesting a concrete fix for ${targetFilePath}.`,
                { phase: "generation", attempt, targetFilePath },
            );

            const result = await window.electron.aiCodingAgent.fixCode({
                requestId,
                code: derivedFailingFile.content,
                error: effectivePrompt,
                language,
                context: finalEnhancedContext,
                assistantId,
                targetFilePath,
            });

            if (cancelledRequestIdsRef.current.has(requestId) || result?.cancelled) {
                cancelledRequestIdsRef.current.delete(requestId);
                clearRequestTimeout();
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                return true;
            }

            if (!result?.success) {
                setError(result?.error || "The AI fix request failed during the automated test-repair loop.");
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                clearRequestTimeout();
                return true;
            }

            const autoApplyResult = await autoInsertCodeIntoEditor(result.content || responseRef.current);
            if (!autoApplyResult?.success) {
                setError(autoApplyResult?.error || "The AI fix could not be applied during the automated test-repair loop.");
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                clearRequestTimeout();
                return true;
            }

            pushRequestStatus(
                `Repair attempt ${attempt} applied. Rerunning plugin tests to verify the fix.`,
                { phase: "tests", attempt, targetFilePath },
            );
            testRunResult = await runPluginTests();
            refreshedProjectFiles = getAllProjectFiles();
            maxRepairAttempts = Math.max(maxRepairAttempts, estimateTestRepairAttemptBudget(testRunResult, refreshedProjectFiles));
            maxRepairAttempts = Math.min(maxRepairAttempts, 4);

            if (testRunResult?.success) {
                const attemptsLabel = attempt === 1 ? "attempt" : "attempts";
                if (!continueWhenTestsPass) {
                    setOperationSummary({
                        intent: "success",
                        title: "Tests Passed",
                        message: `Plugin tests passed after ${attempt} repair ${attemptsLabel}.`,
                    });
                    setError(null);
                    setIsLoading(false);
                    streamingRequestIdRef.current = null;
                    clearRequestTimeout();
                    return true;
                }
                pushRequestStatus(
                    `Plugin tests passed after ${attempt} repair ${attemptsLabel}. Continuing with the requested workspace quality review.`,
                    { phase: "tests", attempt },
                );
                setError(null);
                streamingRequestIdRef.current = null;
                clearRequestTimeout();
                return false;
            }
        }

        setOperationSummary({
            intent: "warning",
            title: "Tests Still Failing",
            message: `Plugin tests are still failing after ${maxRepairAttempts} repair attempt${maxRepairAttempts === 1 ? "" : "s"}. Review the latest Tests tab output and the last AI response.`,
        });
        setIsLoading(false);
        streamingRequestIdRef.current = null;
        clearRequestTimeout();
        return true;
    };

    const autoInsertCodeIntoEditor = async (contentOverride = "") => {
        assertSnapshotUnchanged();
        const contentToApply = contentOverride || responseRef.current || response;
        if (!contentToApply) {
            setError("No AI response available to apply.");
            return { success: false, error: "No AI response available to apply." };
        }

        if (shouldApplyAiResponseToWorkspace(contentToApply)) {
            try {
                const snapshot = createSnapshotBeforeApply();
                if (!snapshot && autoApply) {
                    setError("Failed to create snapshot before applying changes");
                    return { success: false, error: "Failed to create snapshot before applying changes." };
                }
                const execution = await executePlanResponse(contentToApply, { createSnapshot: true });
                if (execution.successCount > 0) {
                    const persisted = persistSnapshotAfterApply(snapshot?.version || "");
                    if (!persisted) {
                        setError("Applied workspace changes, but failed to persist the updated snapshot state.");
                        return {
                            success: false,
                            error: "Applied workspace changes, but failed to persist the updated snapshot state.",
                        };
                    }
                    const message = `Applied ${execution.successCount} workspace file(s) automatically${execution.errorCount > 0 ? `, ${execution.errorCount} issue(s)` : ''}.`;
                    setOperationSummary({
                        intent: execution.errorCount > 0 ? "warning" : "success",
                        title: "Workspace Updated",
                        message: execution.errorDetails.length > 0
                            ? `${message} ${buildSnapshotPersistenceSummary({
                                beforeSnapshot: snapshot?.version,
                                afterSnapshot: persisted?.version,
                            })} ${execution.errorDetails.join(' ; ')}`
                            : `${message} ${buildSnapshotPersistenceSummary({
                                beforeSnapshot: snapshot?.version,
                                afterSnapshot: persisted?.version,
                            })}`,
                    });
                    setError(execution.errorCount ? execution.errorDetails.join('; ') : null);
                    return {success: execution.errorCount === 0, mode: 'workspace'};
                } else {
                    setError(`Auto-apply could not update workspace files. Errors: ${execution.errorDetails.join('; ')}`);
                }
            } catch (err) {
                setError(err.message || "Failed to auto-apply workspace changes.");
            }
            return { success: false, mode: "workspace" };
        }

        if (expectWorkspaceApplyRef.current) {
            setError("AI response did not contain executable workspace file sections. No files were changed.");
            return { success: false, error: "AI response did not contain executable workspace file sections. No files were changed." };
        }

        const snapshot = createSnapshotBeforeApply();
        if (!snapshot && autoApply) {
            setError('Failed to create snapshot before applying changes');
            return { success: false, error: "Failed to create snapshot before applying changes." };
        }

        const insertResult = insertCodeIntoEditor(contentToApply);
        if (!insertResult?.success) {
            const shouldRetrySingleFile =
                !singleFileRetryInFlightRef.current &&
                (
                    insertResult?.mode === "unsafe-partial-selection" ||
                    insertResult?.mode === "unsafe-no-selection" ||
                    insertResult?.mode === "ambiguous-search-replace" ||
                    (
                        insertResult?.mode === "patch-apply-failed" &&
                        (
                            /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(currentRequestRef.current?.targetFilePath || "")
                            || /tests?\s+(?:are|is)\s+failing|failing tests?|test issue|run tests?.*fix|run tests?.*investigate/i.test(currentRequestRef.current?.prompt || "")
                        )
                    )
                ) &&
                (applyActionRef.current === "fix" || applyActionRef.current === "edit" || applyActionRef.current === "generate");
            if (shouldRetrySingleFile) {
                try {
                    singleFileRetryInFlightRef.current = true;
                    const retryResult = await rerunSingleFileAsExecutableResponse(contentToApply);
                    if (retryResult?.success) {
                        return await autoInsertCodeIntoEditor(retryResult.content || responseRef.current);
                    }
                    return retryResult;
                } finally {
                    singleFileRetryInFlightRef.current = false;
                }
            }
            setError(insertResult?.error || "Failed to auto-apply the generated single-file change.");
            return insertResult;
        }
        const persisted = persistSnapshotAfterApply(snapshot?.version || "");
        if (!persisted) {
            setError("Applied the generated change, but failed to persist the updated snapshot state.");
            return {
                success: false,
                error: "Applied the generated change, but failed to persist the updated snapshot state.",
            };
        }
        const mentionedFilePaths = extractMentionedWorkspaceFiles(contentToApply, getAllProjectFiles());
        const partialApplySummary = buildPartialApplySummary({
            appliedFilePaths: insertResult.appliedFilePaths,
            mentionedFilePaths,
        });
        if (partialApplySummary && !multiFileRetryInFlightRef.current) {
            try {
                multiFileRetryInFlightRef.current = true;
                const retryResult = await rerunMultiFileAsExecutableResponse({
                    priorContent: contentToApply,
                    mentionedFilePaths,
                });
                if (retryResult?.success && shouldApplyAiResponseToWorkspace(retryResult.content || responseRef.current)) {
                    const execution = await executePlanResponse(retryResult.content || responseRef.current, {
                        createSnapshot: false,
                    });
                    const persistedAfterMultiFile = persistSnapshotAfterApply(snapshot?.version || "");
                    if (!persistedAfterMultiFile) {
                        setError("Applied the generated multi-file changes, but failed to persist the updated snapshot state.");
                        return {
                            success: false,
                            error: "Applied the generated multi-file changes, but failed to persist the updated snapshot state.",
                        };
                    }
                    setOperationSummary({
                        intent: execution.errorCount > 0 ? "warning" : "success",
                        title: "Workspace Updated",
                        message: `Applied ${execution.successCount} workspace file(s) automatically${execution.errorCount > 0 ? `, ${execution.errorCount} issue(s)` : ""}. ${buildSnapshotPersistenceSummary({
                            beforeSnapshot: snapshot?.version,
                            afterSnapshot: persistedAfterMultiFile?.version,
                        })}`,
                    });
                    setError(null);
                    return { success: true, mode: "workspace" };
                }
            } finally {
                multiFileRetryInFlightRef.current = false;
            }
        }
        setOperationSummary({
            intent: partialApplySummary?.intent || "success",
            title: partialApplySummary?.title || insertResult.appliedSummary?.title || "Editor Updated",
            message: `${partialApplySummary?.message || insertResult.appliedSummary?.message || (
                insertResult.mode === "replace-whole-file"
                    ? "Applied the generated single-file change by replacing the current file."
                    : "Applied the generated single-file change to the current editor selection."
            )} ${buildSnapshotPersistenceSummary({
                beforeSnapshot: snapshot?.version,
                afterSnapshot: persisted?.version,
            })}`,
        });
        setError(null);
        setResponseApplied(true);
        return insertResult;
    };

    const handleRefine = () => {
        if (!response) {
            console.log('[AI Coding Agent] Cannot refine - no response');
            return;
        }
        console.log('[AI Coding Agent] Priming continuation mode');
        setComposerMode("refine");
        const draftPrompt = buildAiCodingFollowUpDraft(response);
        setPrompt(draftPrompt);
        clearPromptBlurTimeout();
        scheduleUiFrame(() => {
            const input = promptInputRef.current;
            if (!input) return;
            input.focus();
            if (typeof input.setSelectionRange === "function") {
                if (draftPrompt) {
                    input.setSelectionRange(0, input.value.length);
                } else {
                    const end = input.value.length;
                    input.setSelectionRange(end, end);
                }
            }
        });
    };

    const handleSmallerScopeRetry = () => {
        if (isLoading || submitInFlightRef.current) return;
        const recovery = recoveryFailure || (savedGenerationCheckpoint && {path: savedGenerationCheckpoint.path});
        if (!recovery || (savedGenerationCheckpoint && !savedGenerationCheckpoint.canResume)) return;
        const originalPrompt = savedGenerationCheckpoint?.requirements || generationRecovery.originalPrompt || currentRequestRef.current?.userPrompt || prompt || '';
        const retryGoal = 'For this retry, build a smaller working version of the core workflow. Keep the design simple, defer optional enhancements, and explain what was deferred.';
        const retryPrompt = originalPrompt.endsWith(retryGoal) ? originalPrompt : `${originalPrompt.trim()}\n\n${retryGoal}`;
        if (/^### File:/m.test(responseRef.current || '')) stagePendingFiles(responseRef.current);
        clearResponse({preserveRecovery: true});
        preservePendingFilesOnRetryRef.current = true;
        preparedRecoveryRef.current = {
            ...(savedGenerationCheckpoint?.canResume ? {checkpointId: savedGenerationCheckpoint.id} : {}),
            recoveryMode: 'smaller-scope', recoveryPath: recovery.path,
        };
        dispatchGenerationRecovery({type: 'prepare-checkpoint', originalPrompt: retryPrompt});
        if (streamContentFlushTimerRef.current) clearTimeout(streamContentFlushTimerRef.current);
        streamContentFlushTimerRef.current = null;
        streamContentBufferRef.current = '';
        streamingRequestIdRef.current = null;
        setAction('plan');
        setPrompt(retryPrompt);
        handleSubmit({prompt: retryPrompt, action: 'plan'});
    };

    const handleResumeGenerationCheckpoint = () => {
        if (!savedGenerationCheckpoint?.canResume) return;
        const checkpoint = savedGenerationCheckpoint;
        clearResponse();
        preparedRecoveryRef.current = {checkpointId: checkpoint.id, recoveryMode: 'resume'};
        preservePendingFilesOnRetryRef.current = true;
        dispatchGenerationRecovery({type: 'prepare-checkpoint', originalPrompt: checkpoint.requirements});
        setAction('plan'); setPrompt(checkpoint.requirements);
        setOperationSummary({intent: 'primary', title: 'Resume prepared', message: 'Submit to resume unfinished generation using the saved plan. To change requirements, choose Retry with smaller scope instead. The saved guide will be reviewed again before implementation continues.'});
        scheduleUiFrame(() => promptInputRef.current?.focus());
    };
    const handleDiscardGenerationCheckpoint = async () => {
        if (isLoading) return;
        const workspaceId = virtualFS.sandboxName;
        // Validation failures intentionally share this boundary with operation failures.
        try {
            const result = await window.electron.aiCodingAgent.discardGenerationCheckpoint({workspaceId, id: savedGenerationCheckpoint?.id || null});
            if (!result.success) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(result.error);
            }
            if (workspaceId !== virtualFS.sandboxName) return;
            checkpointSequenceRef.current += 1;
            setSavedGenerationCheckpoint(null); applyingGenerationCheckpointRef.current = null; setCheckpointError('');
            preparedRecoveryRef.current = null; dispatchGenerationRecovery({type: 'reset'});
        } catch (error) {setCheckpointError(error.message);}
    };

    const handleRetryTruncatedResponse = () => {
        if (!response) return;
        const draftPrompt = "Restart the interrupted answer as a compact, complete, self-contained response. Include every required plugin workspace file section, including files that were complete before interruption. Do not rely on or refer to the partial response.";
        setComposerMode("refine");
        setPrompt(draftPrompt);
        setError(null);
        clearPromptBlurTimeout();
        scheduleUiFrame(() => {
            const input = promptInputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange?.(0, input.value.length);
        });
    };

    const handleImageUpload = (event) => {
        const uploadVersion = ++imageUploadVersion.current;
        if (inputCapabilities.imageSupport === 'unsupported') {
            setError(`${imageSupportLabel(inputCapabilities)}. Select an image-capable assistant for screenshots.`);
            return;
        }
        const file = event.target.files[0];
        if (!file) return;

        const allowedImageMimeTypes = new Set([
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'image/bmp',
        ]);
        if (!allowedImageMimeTypes.has(file.type)) {
            setError('Please upload a raster image file (PNG, JPEG, GIF, WEBP, or BMP)');
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const preview = await rasterImagePreview(file);
                if (uploadVersion !== imageUploadVersion.current) return;
                setUploadedImage(e.target.result);
                setImagePreview(preview);
                setImageName(file.name || "UI mockup");
            } catch {
                if (uploadVersion === imageUploadVersion.current) setError('Failed to decode image preview');
            }
        };
        reader.onerror = () => {
            if (uploadVersion === imageUploadVersion.current) setError('Failed to read image file');
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveImage = () => {
        imageUploadVersion.current++;
        setUploadedImage(null);
        setImagePreview(null);
        setImageName("");
        setIsImagePreviewOpen(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        console.log('[AI Coding Agent] Image removed');
    };

    const handlePanelKeyDown = (event) => {
        if (!isLoading && mentionState?.suggestions?.length && (mentionState.kind !== 'skill' || event.target === promptInputRef.current)) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionState((existing) => existing ? {
                    ...existing,
                    selectedIndex: (existing.selectedIndex + 1) % existing.suggestions.length,
                } : existing);
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionState((existing) => existing ? {
                    ...existing,
                    selectedIndex: (existing.selectedIndex - 1 + existing.suggestions.length) % existing.suggestions.length,
                } : existing);
                return;
            }
            if ((event.key === "Tab" || (event.key === "Enter" && mentionState.kind !== 'skill')) && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                const selectedItem = mentionState.suggestions[mentionState.selectedIndex] || mentionState.suggestions[0];
                applyMentionSuggestion(selectedItem?.insertText || "");
                return;
            }
        }

        if (event.key === "Escape") {
            event.preventDefault();
            if (!isLoading && mentionState) {
                setMentionState(null);
                return;
            }
            if (isLoading) {
                handleStopRequest();
            }
        }
    };

    const hotkeyConfigs = useMemo(() => ([
        {
            combo: shortcutCombos.submit,
            label: "Submit request",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading && prompt.trim() && selectedAssistant) {
                    handleSubmit();
                }
            },
        },
        {
            combo: shortcutCombos.stop,
            label: "Stop request",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (isLoading) {
                    handleStopRequest();
                }
            },
        },
        {
            combo: shortcutCombos.autoApply,
            label: "Toggle Make changes / Review first",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading) {
                    setAutoApply((value) => !value);
                }
            },
        },
        {
            combo: shortcutCombos.refine,
            label: "Refine response",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading && response) {
                    handleRefine();
                }
            },
        },
        {
            combo: shortcutCombos.insert,
            label: /* language=TEXT */ "Insert into editor",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading && response && !autoApply && action !== "plan") {
                    handleApplyResponse();
                }
            },
        },
        {
            combo: shortcutCombos.execute,
            label: "Execute plan",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading && response && action === "plan") {
                    handleExecutePlan();
                }
            },
        },
        {
            combo: shortcutCombos.clear,
            label: "Clear response",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading && response) {
                    clearResponse();
                }
            },
        },
    ]), [shortcutCombos, isLoading, prompt, selectedAssistant, response, autoApply, action, blockIncompleteGeneration, eventDocument]);

    const { handleKeyDown: handleHotkeyKeyDown, handleKeyUp: handleHotkeyKeyUp } = useHotkeys(hotkeyConfigs, {document: eventDocument});

    const handlePanelKeyDownWithHotkeys = (event) => {
        handlePanelKeyDown(event);
        if (!event.defaultPrevented) {
            handleHotkeyKeyDown(event);
        }
    };

    const handleStopRequest = async () => {
        investigationAbortRef.current?.abort();
        const activeRequestId = streamingRequestIdRef.current;
        if (!activeRequestId) {
            return;
        }

        dispatchGenerationRecovery({type: 'cancel', requestId: activeRequestId});
        cancelledRequestIdsRef.current.add(activeRequestId);
        skillReviewActionRef.current = null;
        setSkillReviewAction(null);
        setIsOperationActive(false);
        setIsLoading(false);
        clearRequestTimeout();
        streamingRequestIdRef.current = null;
        expectWorkspaceApplyRef.current = false;
        pendingAutoFileCreateRef.current = false;
        planRetryInFlightRef.current = false;
        singleFileRetryInFlightRef.current = false;
        multiFileRetryInFlightRef.current = false;
        scopeRetryInFlightRef.current = false;
        setRequestStatusEntries([]);
        setOperationSummary({
            intent: "warning",
            title: "AI Request Stopped",
            message: "The AI request was stopped before any changes were applied.",
        });
        setError(null);

        try {
            await window.electron.aiCodingAgent.cancelRequest?.({ requestId: activeRequestId });
        } catch (cancelError) {
            console.warn("[AI Coding Agent] Failed to cancel backend request", cancelError);
        }
    };

    const handleGuideReviewAction = async action => {
        if (!skillReview || skillReviewActionRef.current) return;
        const review = skillReview;
        const operation = {};
        skillReviewActionRef.current = operation;
        setSkillReviewAction(action);
        setSkillReviewError('');
        setSkillReviewFeedback('');
        try {
            const payload = action === 'retry'
                ? {requestId: review.requestId, action: 'retry'}
                : {requestId: review.requestId, content: review.content, ...(action === 'check' ? {checkOnly: true} : {})};
            const result = await window.electron.aiCodingAgent.reviewSkill(payload);
            // A stopped request must not update a later review.
            if (streamingRequestIdRef.current !== review.requestId) return;
            if (action === 'check' || !result.success) {
                setSkillReview(current => current === review ? {...current, report: result.report || null} : current);
                if (result.success) setSkillReviewFeedback(review.proposal
                    ? 'Proposal check passed. Validate the proposal to continue to guide approval.'
                    : 'Compatibility check passed. Review the guide, then approve to continue. This does not verify plugin behavior.');
                else setSkillReviewError(result.error || 'The guide could not be validated. Try again.');
                return;
            }
            setSkillReview(current => current === review ? null : current);
            scheduleRequestTimeout(selectedAssistant?.provider || '');
        } catch (error) {
            if (streamingRequestIdRef.current === review.requestId) setSkillReviewError(error.message || 'The guide request failed. Try again.');
        } finally {
            if (skillReviewActionRef.current === operation) {
                skillReviewActionRef.current = null;
                setSkillReviewAction(null);
            }
        }
    };

    const handleCopyPlan = async () => {
        if (!response) return;
        try { await (eventDocument.defaultView || window).navigator.clipboard.writeText(response); }
        catch {setError('The response could not be copied. Select its text and copy it manually.');}
    };

    const checkSavedGenerationBeforeApply = async () => {
        if (!savedGenerationCheckpoint || applyingGenerationCheckpointRef.current !== savedGenerationCheckpoint.id) return true;
        const workspaceId = virtualFS.sandboxName;
        const before = getAllProjectFiles();
        const key = files => JSON.stringify(files.slice().sort((a, b) => a.path.localeCompare(b.path)));
        const result = await window.electron.aiCodingAgent.getGenerationCheckpoint({workspaceId, workspaceFiles: before});
        if (!result.success || result.checkpoint?.id !== savedGenerationCheckpoint.id || !result.checkpoint.canResume
            || workspaceId !== virtualFS.sandboxName || key(before) !== key(getAllProjectFiles())) {
            setError(result.error || result.checkpoint?.reason || 'The workspace or saved proposal changed. Refresh recovery before applying.');
            return false;
        }
        return true;
    };
    const handleExecutePlan = async () => {
        if (blockIncompleteGeneration) return;
        try {if (!await checkSavedGenerationBeforeApply()) return;} catch (error) {setError(error.message); return;}
        if (!response) return;
        setRepairNotice(null);

        console.log('[AI Coding Agent] Executing plan...');
        setIsOperationActive(true);
        requestAttemptRef.current = 0;
        setRequestAttempt(0);
        setRequestStatusEntries([]);
        setIsLoading(true);
        setError(null);
        setOperationSummary(null);

        // Validation failures intentionally share this boundary with operation failures.
        try {
            const execution = await executePlanResponse(response, {
                createSnapshot: true,
                allowValidationRetry: true,
            });
            if (execution.successCount > 0) {
                const persisted = persistSnapshotAfterApply(virtualFS.fs.version()?.version || "");
                if (!persisted || persisted.error) {
                    //noinspection ExceptionCaughtLocallyJS
                    throw new Error("Files changed, but the resulting snapshot could not be saved.");
                }
                const message = `Created ${execution.successCount} file(s) in the virtual workspace${execution.errorCount > 0 ? `, ${execution.errorCount} issue(s)` : ''}.`;
                setOperationSummary({
                    intent: execution.errorCount > 0 ? "warning" : "success",
                    title: "Plan Applied",
                    message: execution.errorDetails.length > 0
                        ? `${message} ${execution.errorDetails.join(' ; ')}`
                        : message,
                });
                setError(execution.errorCount > 0 ? `Plan application failed: ${execution.errorDetails.join('; ')}` : null);
                handleRemoveImage();
            } else {
                setError(`Failed to create any files from the plan. Errors: ${execution.errorDetails.join('; ')}`);
            }
        } catch (err) {
            console.error('[AI Coding Agent] Error executing plan:', err);
            setError(`Failed to execute plan: ${err.message}`);
        } finally {
            setIsOperationActive(false);
            setIsLoading(false);
        }
    };

    const executePlanResponse = async (
        planResponse,
        {
            createSnapshot = true,
            allowValidationRetry = true,
            allowTestRetry = true,
            previousTestResults = null,
            allowProgressTestRetry = true,
            allowProblemsRetry = true,
        } = {},
    ) => {
        if (!planResponse) return { successCount: 0, errorCount: 0, errorDetails: ["Empty response"] };

        if (createSnapshot) {
            const snapshot = createSnapshotBeforeApply();
            if (!snapshot) {
                throw new Error('Failed to create snapshot before applying plan');
            }
        }

        const verificationAttempt = ++verificationSequence.current;
        if (createSnapshot) setVerificationReports([]);
        const publishVerification = report => {
            setVerificationReports(previous => [...previous.filter(item => item.attempt !== verificationAttempt),
                {...report, attempt: verificationAttempt}].slice(-10));
            recordCodingLifecycle('workspace-verification', {attempt: verificationAttempt, ...report});
        };
        const parsedPlan = parseAiWorkspacePlanResponse(planResponse);
        stagePendingFiles(planResponse);
        updatePendingFiles({activePath: '', status: 'validating'});
        const normalizedImports = parsedPlan.files.map(file => ({...file, ...repairGeneratedUnusedImports(file)}));
        const unusedImportFiles = normalizedImports.filter(file => file.names.length);
        if (unusedImportFiles.length) pushRequestStatus(`Removed unused import bindings in ${unusedImportFiles.map(file => file.path).join(', ')}; preserved module side effects.`, {phase: 'validation'});
        const normalizedDom = normalizedImports.map(file => ({...file, ...repairWorkspaceSdkDom(file)}));
        const normalizedExports = normalizedDom.map(file => ({file, ...normalizeGeneratedModuleExports(file)}));
        const sdkDomPaths = normalizedDom.filter(file => file.repaired).map(file => file.path);
        if (sdkDomPaths.length) pushRequestStatus(`Corrected SDK DOM usage in ${sdkDomPaths.join(', ')}.`, {phase: 'validation'});
        const {files, normalizedPaths} = normalizeReservedHostBindingMarkers(normalizedExports.map(({file, content}) => ({...file, content})));
        const {invalidPaths} = parsedPlan;
        const repairScope = currentRequestRef.current?.repairPaths;
        if (repairScope && files.some(file => !repairScope.includes(file.path))) {
            throw new Error('Repair response changed files outside the requested scope. No generated files were applied.');
        }
        const pluginValidation = validateGeneratedPluginFiles(files, {workspaceFiles: getAllProjectFiles()});
        const correctedExportPaths = normalizedExports.filter(item => item.names.length).map(item => item.file.path);
        if (correctedExportPaths.length) {
            pushRequestStatus(`Removed redundant export wrappers in ${correctedExportPaths.join(', ')}; retained their implementations.`,
                {phase: "module-export-repair", paths: correctedExportPaths});
        }
        if (files.length === 0) {
            const invalidDetail = invalidPaths.length > 0
                ? ` Invalid paths: ${invalidPaths.join(', ')}`
                : "";
            throw new Error(`No valid workspace files found in the AI response. The response must contain workspace file sections.${invalidDetail}`);
        }
        if (normalizedPaths.length > 0) {
            pushRequestStatus(
                `Corrected the host-reserved listener marker in ${normalizedPaths.join(", ")} before validating the generated workspace.`,
                {phase: "reserved-binding-marker-repair", paths: normalizedPaths},
            );
        }
        if (invalidPaths.length) {
            throw new Error(`Generated plan contains invalid workspace paths: ${invalidPaths.join(', ')}. No generated files were applied.`);
        }
        const sourceCheck = {id: 'source', label: 'Generated source rules', status: pluginValidation.errors.length ? 'failed' : 'passed',
            detail: pluginValidation.errors.join('\n')};
        publishVerification({changedPaths: files.map(file => file.path), checks: [sourceCheck]});
        let candidateTestsFailed = false;
        let candidateTestResults = null;
        {
            const candidateRequestId = streamingRequestIdRef.current;
            setWorkspaceStage(`Checking ${files.length} generated files`);
            pushRequestStatus('Compiling proposed workspace changes before applying them.', {phase: 'validation'});
            pluginValidation.errors.push(...await validateAiWorkspaceCandidate({
                files, workspaceFiles: getAllProjectFiles(), readWorkspace: getAllProjectFiles,
                staticOnly: pluginValidation.errors.length > 0,
                build: window.electron.plugin?.build,
                typecheck: window.electron.plugin?.typecheck,
                runTests: window.electron.plugin?.runTests ? data => runCandidateTests(data, window.electron.plugin.runTests) : undefined,
                onVerification: report => publishVerification({...report, checks: [sourceCheck, ...report.checks]}),
                onTestFailure: results => { candidateTestsFailed = true; candidateTestResults = results; },
                onTestStart: () => {
                    updatePendingFiles({activePath: '', status: 'testing'});
                    onShowTests?.();
                    setWorkspaceStage('Running candidate workspace tests');
                    pushRequestStatus('Running generated and retained tests before applying workspace changes.', {phase: 'validation-tests'});
                },
                assertActive: () => {
                    assertSnapshotUnchanged();
                    if (candidateRequestId && cancelledRequestIdsRef.current.has(candidateRequestId)) {
                        throw new Error('AI request stopped during validation. No generated files were applied.');
                    }
                },
            }));
        }
        if (pluginValidation.errors.length > 0) {
            updateValidationRecovery(retainValidationRecovery({previous: validationRecoveryRef.current, files,
                workspaceFiles: getAllProjectFiles(), diagnostics: pluginValidation.errors,
                originalPrompt: currentRequestRef.current?.prompt || prompt || '',
                workspace: virtualFS.sandboxName, revision: virtualFS.fs.snapshotSwitchRevision || 0, repairScope}));
            const progressRetry = candidateTestsFailed && !allowTestRetry && allowProgressTestRetry
                && hasStrictTestRepairProgress(previousTestResults, candidateTestResults);
            if ((candidateTestsFailed ? (allowTestRetry || progressRetry) : allowValidationRetry) && selectedAssistant?.id) {
                const candidateFiles = [...new Map([...getAllProjectFiles(), ...files].map(file => [file.path, file])).values()];
                const validationRepairPaths = getValidationRepairPaths(pluginValidation.errors, candidateFiles);
                if (!validationRepairPaths.length) {
                    throw new Error(`Automatic repair stopped: validation errors could not be mapped to specific candidate workspace files. No additional AI request was sent and no generated files were applied. Review these diagnostics before requesting a broader change: ${pluginValidation.errors.join(' ; ')}`);
                }
                if (repairScope && validationRepairPaths.some(path => !repairScope.includes(path))) {
                    throw new Error(`Automatic repair stopped: validation requires changes outside your explicit repair scope (${validationRepairPaths.filter(path => !repairScope.includes(path)).join(', ')}). No additional AI request was sent and no generated files were applied. ${pluginValidation.errors.join(' ; ')}`);
                }
                const generatedRepairCount = files.filter(file => validationRepairPaths.includes(file.path)).length;
                const retainedRepairCount = validationRepairPaths.length - generatedRepairCount;
                const repairDescription = retainedRepairCount
                    ? `Repairing ${retainedRepairCount} existing workspace file(s) named by the diagnostics${generatedRepairCount ? ` and ${generatedRepairCount} generated file(s)` : ''}; retaining ${files.length - generatedRepairCount} generated files unchanged.`
                    : `Repairing ${generatedRepairCount} of ${files.length} generated files; retaining ${files.length - generatedRepairCount} unchanged.`;
                const retryPrompt = buildValidationRepairPlanPrompt({
                    originalPrompt: currentRequestRef.current?.prompt || prompt || "",
                    invalidResponse: planResponse,
                    validationErrors: pluginValidation.errors,
                    repairPaths: validationRepairPaths,
                });
                const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                beginStreamingRequest(retryRequestId);
                setRepairNotice({
                    message: `${progressRetry ? "Test failures decreased without new failures. One final scoped repair is available. " : ""}Validation found ${pluginValidation.errors.length} error(s). ${repairDescription} This additional AI pass uses tokens to correct the errors below.`,
                    diagnostics: pluginValidation.errors,
                    paths: validationRepairPaths,
                });
                setWorkspaceStage(`Repairing ${validationRepairPaths.length} files after validation`);
                responseRef.current = "";
                setResponse("");
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                pushRequestStatus(
                    `Repairing validation errors in ${validationRepairPaths.join(', ')}; retaining the other generated files.`,
                    { phase: "plan-retry-validation" },
                );
                recordCodingLifecycle("plan-retry-validation", {
                    phase: "plan-retry-validation",
                    fileCount: files.length,
                    validationErrors: pluginValidation.errors,
                });
                const retryResult = await window.electron.aiCodingAgent.planCode({
                    workspaceFiles: candidateFiles,
                    repairPaths: validationRepairPaths,
                    requestId: retryRequestId,
                    prompt: retryPrompt,
                    image: uploadedImage,
                    context: currentRequestRef.current?.context || "",
                    assistantId: selectedAssistant.id,
                });
                if (retryResult?.success && retryResult?.content) {
                    return await executePlanResponse(mergeValidationRepairResponse(files, retryResult.content, validationRepairPaths), {
                        createSnapshot: false,
                        allowValidationRetry: candidateTestsFailed ? allowValidationRetry : false,
                        allowTestRetry: candidateTestsFailed ? false : allowTestRetry,
                        previousTestResults: candidateTestsFailed ? candidateTestResults : previousTestResults,
                        allowProgressTestRetry: progressRetry ? false : allowProgressTestRetry,
                        allowProblemsRetry,
                    });
                }
                throw new Error(`Validation repair failed: ${retryResult?.error || 'The assistant returned no corrected files.'} No generated files were applied.`);
            }
            throw new Error(`Generated plugin files failed validation: ${pluginValidation.errors.join(' ; ')}`);
        }

        const folders = new Set();
        assertSnapshotUnchanged();
        files.forEach(file => {
            const parts = file.path.split('/').filter(Boolean);
            for (let i = 1; i < parts.length; i++) {
                const folderPath = '/' + parts.slice(0, i).join('/');
                folders.add(folderPath);
            }
        });

        const sortedFolders = Array.from(folders).sort();
        for (const folder of sortedFolders) {
            try {
                virtualFS.createFolder(folder);
            } catch (_) {
                // Folder may already exist.
            }
        }

        let errorCount = 0;
        const errorDetails = [];

        const successCount = applyAiWorkspaceFiles({files, existingFiles: getAllProjectFiles(),
            write: createVirtualFile, remove: path => virtualFS.deleteFile(path, {exact: true}),
            assertScope: assertSnapshotUnchanged});
        updatePendingFiles({files: [], activePath: '', status: 'applied'});

        if (invalidPaths.length > 0) {
            errorCount += invalidPaths.length;
            errorDetails.push(...invalidPaths.map((filePath) => `${filePath}: invalid workspace path`));
        }
        if (pluginValidation.warnings.length > 0) {
        pluginValidation.warnings.forEach(warning => pushRequestStatus(warning, {phase: 'validation-warning'}));
        }

        setWorkspaceStage('Checking editor diagnostics');
        const problemsContext = await waitForProblemsContext({errorsOnly: true});
        if (problemsContext) {
            if (allowProblemsRetry && selectedAssistant?.id) {
                const repairWorkspace = getAllProjectFiles();
                const repairPaths = getProblemsRepairPaths(problemsContext, repairWorkspace);
                if (!repairPaths.length) {
                    throw new Error(`Automatic repair stopped: editor errors could not be mapped to specific workspace files. Generated files remain applied. No additional AI request was sent. Review these diagnostics before requesting a broader change: ${problemsContext}`);
                }
                const retryPrompt = buildProblemsRepairPlanPrompt({
                    originalPrompt: currentRequestRef.current?.prompt || prompt || "",
                    previousResponse: planResponse,
                    problemsContext,
                    workspaceFiles: repairWorkspace,
                });
                const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                beginStreamingRequest(retryRequestId);
                setRepairNotice({
                    message: `Editor checks found errors after applying the generated files. Repairing ${repairPaths.length} workspace files; retaining all other files. This additional AI pass uses tokens to correct the errors below.`,
                    diagnostics: [problemsContext],
                    paths: repairPaths,
                });
                setWorkspaceStage(`Repairing ${repairPaths.length} files after editor checks`);
                responseRef.current = "";
                setResponse("");
                setIsLoading(true);
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                pushRequestStatus(
                    "Problems panel found generated-code errors. Requesting one plugin-local correction.",
                    {phase: "plan-retry-problems"},
                );
                recordCodingLifecycle("plan-retry-problems", {
                    phase: "plan-retry-problems",
                    problemsContext: String(problemsContext || "").slice(0, 500),
                });
                const retryResult = await window.electron.aiCodingAgent.planCode({
                    workspaceFiles: repairWorkspace,
                    requestId: retryRequestId,
                    repairPaths,
                    prompt: retryPrompt,
                    image: null,
                    context: "",
                    assistantId: selectedAssistant.id,
                });
                if (retryResult?.success && retryResult?.content) {
                    const repaired = mergeValidationRepairResponse(
                        repairWorkspace.filter(file => repairPaths.includes(file.path)), retryResult.content, repairPaths);
                    return await executePlanResponse(repaired, {
                        createSnapshot: false,
                        allowValidationRetry: false,
                        allowTestRetry,
                        previousTestResults,
                        allowProgressTestRetry,
                        allowProblemsRetry: false,
                    });
                }
                throw new Error(retryResult?.error || "The Problems-panel correction request did not return workspace files.");
            }
            errorCount += 1;
            errorDetails.push(`Problems panel still reports generated-code errors: ${problemsContext.replace(/\s+/g, " ").slice(0, 500)}`);
        }

        if (successCount > 0 && errorCount === 0) {setResponseApplied(true); updateValidationRecovery(null);}
        return { successCount, errorCount, errorDetails };
    };
    
    const handleRepairFailedValidation = async () => {
        const retained = validationRecoveryRef.current;
        if (!retained || submitInFlightRef.current || isLoading || !selectedAssistant) return;
        try {assertValidationRecoveryCurrent(retained, {files: getAllProjectFiles(), workspace: virtualFS.sandboxName, revision: virtualFS.fs.snapshotSwitchRevision || 0});}
        catch (failure) {setError(failure.message); return;}
        submitInFlightRef.current = true;
        setIsOperationActive(true); setIsLoading(true); setError(null); setOperationSummary(null);
        pendingAutoFileCreateRef.current = false; expectWorkspaceApplyRef.current = false;
        setRequestStatusEntries([]); setResponseApplied(false);
        responseRef.current = ''; setResponse('');
        updateValidationRecovery({...retained, attempts: retained.attempts + 1});
        requestSnapshotRef.current = {revision: retained.revision, workspace: retained.workspace};
        const retryPrompt = buildValidationRepairPlanPrompt({originalPrompt: retained.originalPrompt,
            validationErrors: retained.diagnostics, repairPaths: retained.paths});
        currentRequestRef.current = {...currentRequestRef.current, prompt: retained.originalPrompt, repairPaths: retained.repairScope};
        const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        beginStreamingRequest(requestId); scheduleRequestTimeout(selectedAssistant.provider);
        pushRequestStatus(`Repair attempt ${retained.attempts + 1}: retaining the latest candidate and correcting its validation failures.`, {phase: 'validation-repair'});
        saveConversation([...conversationRef.current, {role: 'user', content: 'Repair failed validation.', snapshot: virtualFS.fs.version()?.version ?? ''}]);
        // Validation failures intentionally share this boundary with operation failures.
        try {
            const result = await window.electron.aiCodingAgent.planCode({requestId, assistantId: selectedAssistant.id,
                workspaceFiles: retained.candidate, repairPaths: retained.paths, prompt: retryPrompt,
                context: currentRequestRef.current?.context || '', image: uploadedImage});
            if (cancelledRequestIdsRef.current.has(requestId) || result?.cancelled) return;
            assertValidationRecoveryCurrent(retained, {files: getAllProjectFiles(), workspace: virtualFS.sandboxName, revision: virtualFS.fs.snapshotSwitchRevision || 0});
            if (!result?.success || !result.content) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(result?.error || 'The assistant returned no corrected files.');
            }
            const merged = mergeValidationRepairResponse(retained.files, result.content, retained.paths);
            const execution = await executePlanResponse(merged, {createSnapshot: false, allowValidationRetry: false,
                allowTestRetry: false, allowProgressTestRetry: false, allowProblemsRetry: false});
            if (execution.errorCount || !execution.successCount) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(execution.errorDetails.join('\n') || 'No validated files were applied.');
            }
            const persisted = persistSnapshotAfterApply(virtualFS.fs.version()?.version || '');
            if (!persisted || persisted.error) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('Repair applied, but its snapshot could not be saved.');
            }
            const summary = `Validation repair completed. ${execution.successCount} files applied after candidate validation.`;
            responseRef.current = summary; setResponse(summary);
            setOperationSummary({intent: 'success', title: 'Validation Repair Complete', message: summary});
            saveConversation([...conversationRef.current, {role: 'assistant', content: summary,
                snapshot: virtualFS.fs.version()?.version ?? '', appliedSnapshot: appliedSnapshotRef.current}]);
        } catch (failure) {
            if (!cancelledRequestIdsRef.current.has(requestId)) {
                setError(failure.message);
                setOperationSummary({intent: 'warning', title: 'Validation Repair Needs Another Attempt',
                    message: 'The latest candidate and diagnostics are retained. You can repair again or select another assistant.'});
            }
        } finally {
            clearRequestTimeout(); streamingRequestIdRef.current = null;
            submitInFlightRef.current = false; setIsOperationActive(false); setIsLoading(false);
        }
    };

    const handleSubmit = async ({prompt: promptOverride, action: actionOverride, autoApply: autoApplyOverride, migrateGuide = false} = {}) => {
        if (submitInFlightRef.current) return;
        const requestPrompt = String(promptOverride ?? prompt).trim();
        const investigationRequest = !isNewPluginCreationRequest(requestPrompt) && (isInvestigationPrompt(requestPrompt)
            || /^(?:please )?(?:continue|keep going|go on)[.!]?$/i.test(requestPrompt) && responseRef.current.includes('Investigation actions:'));
        const reviewRequest = isWorkspaceQualityReviewPrompt(requestPrompt) || investigationRequest;
        const requestAction = reviewRequest ? "smart" : (actionOverride ?? action);
        let reviewTests = null;
        let reviewChangesApplied = false;
        let reviewReport = null;
        let requestSucceeded = false;
        const requestAutoApply = (!investigationRequest || isWorkspaceQualityReviewPrompt(requestPrompt) || investigationAllowsRepair(requestPrompt))
            && (typeof autoApplyOverride === "boolean" ? autoApplyOverride : autoApplyRef.current);
        if (!requestPrompt) return;
        
        // Validate assistant is selected
        if (!selectedAssistant) {
            setError("No coding assistant selected. Please select one from the dropdown or add one in Settings.");
            return;
        }
        if (uploadedImage && inputCapabilities.imageSupport === 'unsupported') {
            setError(`${imageSupportLabel(inputCapabilities)}. Remove the image or select an image-capable assistant.`);
            return;
        }

        setGuideRecovery(null);
        const projectFiles = getAllProjectFiles();
        const previousResponse = isClassificationOnly(response) ? '' : response;
        const followUpMode = shouldTreatAsAiCodingFollowUp({
            prompt: requestPrompt,
            previousResponse: preparedRecoveryRef.current ? '' : previousResponse,
            forceFollowUp: !preparedRecoveryRef.current && composerMode === "refine",
        });
        const createProjectFilesCandidate = shouldCreateProjectFiles({
            prompt: requestPrompt,
            previousResponse,
            workspaceFiles: projectFiles,
        });
        const executeWorkspacePlanCandidate = shouldExecuteWorkspacePlan({
            prompt: requestPrompt,
            previousResponse,
            workspaceFiles: projectFiles,
        });
        if (followUpMode) {
            console.log('[AI Coding Agent] Submitting follow-up with prior response context', { composerMode });
        }

        submitInFlightRef.current = true;
        updateValidationRecovery(null);
        // Initialize once per submitted operation, before any async routing or
        // loading phase can change. Internal repairs retain their file previews.
        startPendingFiles(preservePendingFilesOnRetryRef.current);
        preservePendingFilesOnRetryRef.current = false;
        // Reset once for the user's operation, not for internal repair requests.
        setConfidenceAttemptFloor(verificationSequence.current);
        workspaceReviewInProgressRef.current = reviewRequest;
        setMentionState(null);
        setRepairNotice(null);
        setIsOperationActive(true);
        requestAttemptRef.current = 0;
        setRequestAttempt(0);
        const priorConversation = conversationRef.current;
        requestSnapshotRef.current = {revision: virtualFS.fs.snapshotSwitchRevision || 0, workspace: virtualFS.sandboxName};
        appliedSnapshotRef.current = null;
        const userMessage = {role: "user", content: requestPrompt, snapshot: virtualFS.fs.version()?.version ?? ""};
        saveConversation([...priorConversation, userMessage]);
        setIsLoading(true);
        setError(null);
        setResponse("");
        setRequestStatusEntries([]);
        setResponseApplied(false);
        responseRef.current = "";
        setOperationSummary(null);
        scopeRetryInFlightRef.current = false;
        
        setComposerMode(null);

        // Validation failures intentionally share this boundary with operation failures.
        try {
            const selectedCode = getSelectedCode();
            const refreshedProjectFiles = getAllProjectFiles();
            const requestedRepairPaths = readWorkspaceRepairScope(requestPrompt, refreshedProjectFiles);
            const requestWantsFailureDiagnosis = requestAction === 'fix' || shouldRunTestsBeforeAiRequest(requestPrompt)
                || /\b(?:fix|repair|debug|diagnos\w*|investigat\w*|troubleshoot\w*)\b|\b(?:tests? (?:are |is )?failing|build failed|current problems|not working)\b/i.test(requestPrompt);
            const derivedFailingFile = !selectedCode && requestWantsFailureDiagnosis
                ? (
                    findLikelyFailingWorkspaceFile(refreshedProjectFiles)
                    || (
                        /tests?\s+(?:are|is)\s+failing|failing tests?|tests?\s+issue|run tests?.*investigate|investigate.*tests?/i.test(requestPrompt)
                            ? (refreshedProjectFiles.find((file) => /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file.path)) || null)
                            : null
                    )
                )
                : null;
            const effectiveSelectedCode = selectedCode || derivedFailingFile?.content || "";
            const derivedFailingFilePath = derivedFailingFile?.path
                || (
                    !selectedCode && effectiveSelectedCode
                        ? (refreshedProjectFiles.find((file) => file.content === effectiveSelectedCode)?.path || "")
                        : ""
                );
            const safePreviousResponse = validateAiCodingPluginScopeResponse({
                text: response,
                workspaceFiles: refreshedProjectFiles,
            }).ok
                ? response
                : "";
            const pluginScopeValidation = validateAiCodingPluginScopeRequest({
                prompt: requestPrompt,
                previousResponse: safePreviousResponse,
                workspaceFiles: refreshedProjectFiles,
            });
            if (!pluginScopeValidation.ok) {
                setError(buildAiCodingPluginScopeViolationMessage({
                    references: pluginScopeValidation.references,
                    phase: "request",
                }));
                setIsLoading(false);
                setRequestStatusEntries([]);
                return;
            }
            const resolvedAction = resolveAiCodingAgentAction({
                requestedAction: (createProjectFilesCandidate || executeWorkspacePlanCandidate) ? "plan" : requestAction,
                prompt: requestPrompt,
                selectedCode: effectiveSelectedCode,
                previousResponse: safePreviousResponse,
                workspaceFiles: refreshedProjectFiles,
            });
            let routingDecision = {
                action: resolvedAction,
                createProjectFiles: createProjectFilesCandidate,
                executeWorkspacePlan: executeWorkspacePlanCandidate,
                usedJudge: false,
                downgraded: false,
                reason: "deterministic",
            };
            if (
                !reviewRequest && !requestedRepairPaths && shouldUseAiRoutingJudge({
                    requestedAction: requestAction,
                    prompt: requestPrompt,
                    selectedCode: effectiveSelectedCode,
                    deterministicAction: resolvedAction,
                    createProjectFiles: createProjectFilesCandidate,
                    executeWorkspacePlan: executeWorkspacePlanCandidate,
                })
                && typeof window?.electron?.aiCodingAgent?.routeJudge === "function"
            ) {
                pushRequestStatus("Checking routing safety before applying a coding mode.", { phase: "routing-safety" });
                try {
                    const routeJudgeResult = await window.electron.aiCodingAgent.routeJudge({
                        assistantId: selectedAssistant.id,
                        prompt: requestPrompt,
                        previousResponse: safePreviousResponse,
                        selectedCode: effectiveSelectedCode,
                        requestedAction: requestAction,
                        deterministicAction: resolvedAction,
                        createProjectFiles: createProjectFilesCandidate,
                        executeWorkspacePlan: executeWorkspacePlanCandidate,
                    });
                    routingDecision = mergeAiCodingRouteDecision({
                        requestedAction: requestAction,
                        prompt: requestPrompt,
                        deterministicAction: resolvedAction,
                        judge: routeJudgeResult?.judge || routeJudgeResult || null,
                        createProjectFiles: createProjectFilesCandidate,
                        executeWorkspacePlan: executeWorkspacePlanCandidate,
                    });
                    const routingStatus = buildAiCodingRouteJudgeStatus(routingDecision);
                    if (routingStatus) {
                        pushRequestStatus(routingStatus, {
                            phase: "routing-safety",
                            reason: routingDecision.reason,
                        });
                    }
                } catch (routeJudgeError) {
                    console.warn("[AI Coding Agent] Route judge failed; using deterministic routing.", routeJudgeError);
                }
            }

            if (requestedRepairPaths) routingDecision = {action: 'plan', createProjectFiles: false, executeWorkspacePlan: false};
            if (reviewRequest) routingDecision = {action: "smart", createProjectFiles: false, executeWorkspacePlan: false};
            const createProjectFiles = routingDecision.createProjectFiles && routingDecision.action === "plan";
            const executeWorkspacePlan = routingDecision.executeWorkspacePlan && routingDecision.action === "plan";
            let finalPrompt = buildAiCodingFollowUpPrompt({
                prompt: requestPrompt,
                previousResponse: safePreviousResponse,
                forceFollowUp: composerMode === "refine",
            });
            if (reviewRequest) finalPrompt = requestPrompt;
            if (createProjectFiles) {
                finalPrompt = buildProjectFilePlanPrompt({
                    prompt: requestPrompt,
                    previousResponse: safePreviousResponse,
                    workspaceFiles: projectFiles,
                });
            } else if (executeWorkspacePlan) {
                finalPrompt = buildWorkspaceExecutionPlanPrompt({
                    prompt: requestPrompt,
                    previousResponse: safePreviousResponse,
                });
            }

            const runtimeIntentForAction = detectAiPluginRuntimeIntent(finalPrompt);
            const workspaceQualityReview = isWorkspaceQualityReviewPrompt(finalPrompt);
            const effectiveAction = isInformationalOnlyPrompt(finalPrompt) && routingDecision.action !== "plan"
                ? "smart"
                : routingDecision.action;
            pendingAutoFileCreateRef.current = !reviewRequest && requestAutoApply && (createProjectFiles || executeWorkspacePlan || effectiveAction === "plan");
            expectWorkspaceApplyRef.current = effectiveAction === "plan";
            applyActionRef.current = effectiveAction;
            let testsAlreadyRun = false;

            if (shouldRunTestsBeforeAiRequest(finalPrompt) && !requestAutoApply) {
                pushRequestStatus(
                    "Review first is selected. Tests will be diagnosed; proposed fixes wait for your review.",
                    { phase: "tests" },
                );
            }

            if (!reviewRequest && !requestedRepairPaths && shouldRunTestsBeforeAiRequest(finalPrompt) && requestAutoApply && !createProjectFiles && !executeWorkspacePlan) {
                pushRequestStatus("Running plugin tests before diagnosing errors.", { phase: "tests" });
                const testRepairComplete = await runIterativeTestRepairFlow({
                    basePrompt: finalPrompt,
                    language: getLanguage(),
                    assistantId: selectedAssistant.id,
                    continueWhenTestsPass: workspaceQualityReview,
                });
                testsAlreadyRun = true;
                if (testRepairComplete) return;
            }

            if (!reviewRequest && !requestedRepairPaths && shouldRunTestsBeforeAiRequest(finalPrompt) && !testsAlreadyRun) {
                pushRequestStatus("Running plugin tests before diagnosing errors.", { phase: "tests" });
                const testRunResult = await runPluginTests();
                if (reviewRequest) reviewTests = testRunResult;
                if (testRunResult?.success) {
                    if (workspaceQualityReview) {
                        pushRequestStatus("Plugin tests passed. Continuing with the requested workspace quality review.", { phase: "tests" });
                    } else {
                    const summary = testRunResult.skipped
                        ? "No plugin tests were found, so there were no test failures to investigate."
                        : "Plugin tests passed. There were no failing tests to investigate.";
                    setResponse(summary);
                    setIsLoading(false);
                    return;
                    }
                }
                if (!testRunResult?.success) pushRequestStatus("Plugin tests failed. Reviewing the failing output and related workspace files.", { phase: "tests" });
            }

            console.log('[AI Coding Agent] Submit started', {
                action: requestAction,
                effectiveAction,
                prompt: finalPrompt.substring(0, 50),
                composerMode,
                executeWorkspacePlan,
            });

            const language = getLanguage();
            const currentFileContext = getContext();
            const currentFilePath = getCurrentFilePath();
            const problemsContext = getProblemsContext();
            const buildOutputContext = getBuildOutputContext(refreshedProjectFiles);
            const runtimeIntent = runtimeIntentForAction;
            const currentPluginId = await resolvePluginIdFromPrompt(finalPrompt);
            const runtimeProbeResult = !reviewRequest && runtimeIntent.shouldProbe
                ? await runPluginRuntimeProbe({
                    promptText: finalPrompt,
                    pluginId: currentPluginId,
                })
                : { context: "", traceResult: null };
            const pluginLogsContext = !reviewRequest && (runtimeIntent.shouldProbe || runtimeIntent.wantsLogs)
                ? await getPluginLogsContext({
                    preloadedTraceResult: runtimeProbeResult?.traceResult || null,
                })
                : "";
            const pluginRuntimeActionContext = runtimeProbeResult?.context || "";
            const issueScope = classifyAiCodingIssueScope({
                prompt: finalPrompt,
                selectedCode: effectiveSelectedCode,
                problemsContext: `${problemsContext}${buildOutputContext}${pluginRuntimeActionContext}${pluginLogsContext}`,
            });
            const sdkKnowledgeEnabled = shouldUseFdoSdkKnowledge({
                action: effectiveAction,
                prompt: finalPrompt,
                code: effectiveSelectedCode,
                error: requestAction === "fix" ? requestPrompt : "",
                context: `${problemsContext}${buildOutputContext}${currentFileContext?.slice(0, 800)}`,
            });
            const externalReferenceEnabled = shouldUseExternalReferenceKnowledge({
                prompt: finalPrompt,
                code: effectiveSelectedCode,
                context: `${problemsContext}${buildOutputContext}${currentFileContext?.slice(0, 800)}`,
            });
            const sdkKnowledgeQuery = [
                finalPrompt,
                effectiveSelectedCode,
                problemsContext,
                buildOutputContext,
                pluginLogsContext,
                currentFileContext?.slice(0, 800),
            ].filter(Boolean).join("\n");
            const referencedWorkspaceFiles = resolveWorkspaceFileReferences(
                refreshedProjectFiles,
                extractWorkspaceFileReferences(requestPrompt, refreshedProjectFiles),
            );
            const workspaceReferenceContext = formatWorkspaceReferenceContext(referencedWorkspaceFiles);
            const includeIssueDiagnosis = shouldIncludeIssueDiagnosis({
                prompt: finalPrompt,
                action: effectiveAction,
            });
            pushRequestStatus(buildAiCodingAgentStatusMessage({
                phase: externalReferenceEnabled ? "reference" : "retrieval",
                externalReferenceEnabled,
                sdkKnowledgeEnabled,
                includeProjectContext: false,
                issueDiagnosis: includeIssueDiagnosis ? issueScope.summary : "",
            }), { phase: externalReferenceEnabled ? "reference" : "retrieval" });
            const [sdkKnowledgeContext, externalReferenceContext] = await Promise.all([
                sdkKnowledgeEnabled
                    ? getRelevantSdkKnowledgeContext(sdkKnowledgeQuery)
                    : Promise.resolve(""),
                externalReferenceEnabled
                    ? getExternalReferenceContext(sdkKnowledgeQuery)
                    : Promise.resolve(""),
            ]);
            
            const includeProjectContext = shouldIncludeProjectContext({
                action: effectiveAction,
                prompt: finalPrompt,
                selectedCode: effectiveSelectedCode,
                currentFileContext,
                sdkKnowledgeEnabled,
                externalReferenceEnabled,
            });
            const fastLocalEdit = isAiCodingFastLocalEditPrompt(finalPrompt, effectiveAction);
            const requestContexts = buildAiCodingAgentRequestContexts({
                includeProjectContext: reviewRequest || includeProjectContext,
                projectFiles: reviewRequest ? getAllProjectFiles() : refreshedProjectFiles,
                currentFileContext,
                currentFilePath,
                prompt: finalPrompt,
                workspaceReferenceContext,
                problemsContext,
                buildOutputContext,
                pluginLogsContext,
                pluginRuntimeActionContext,
                externalReferenceContext,
                sdkKnowledgeContext,
                projectContextMode: executeWorkspacePlan
                    ? "focused"
                    : (fastLocalEdit ? "targeted" : "full"),
            });
            const conversationContext = `Current plugin snapshot: ${userMessage.snapshot}.\n` + buildHistoryContext(priorConversation, content =>
                validateAiCodingPluginScopeResponse({text: content, workspaceFiles: refreshedProjectFiles}).ok);
            const styleReviewContext = reviewRequest ? `\n${workspaceReviewContext(getAllProjectFiles())}` : '';
            requestContexts.projectContext = conversationContext + requestContexts.projectContext + styleReviewContext;
            requestContexts.referenceContext = conversationContext + requestContexts.referenceContext + styleReviewContext;
            const enhancedContext = requestContexts.projectContext;
            const diagnosisContext = includeIssueDiagnosis && issueScope.summary
                ? `${issueScope.summary}\nThis is a preliminary ${issueScope.kind} classification, not a confirmed root cause. Verify the specific diagnostic and its relevance to the current workspace before proposing changes.\n\n`
                : "";
            const pluginRuntimeVerificationContext = buildPluginRuntimeVerificationContext({
                prompt: finalPrompt,
                runtimeIntent,
            });
            const finalEnhancedContext = `${pluginRuntimeVerificationContext}${diagnosisContext}${enhancedContext}`;
            const mainPluginFilePath = virtualFS.DEFAULT_FILE_MAIN || "/index.ts";
            const defaultPluginTargetFile = (
                !effectiveSelectedCode
                && !derivedFailingFilePath
                && (effectiveAction === "generate" || effectiveAction === "smart")
                && resolveDefaultPluginTargetFile({
                    prompt: finalPrompt,
                    projectFiles: refreshedProjectFiles,
                    currentFilePath,
                    mainPluginFilePath,
                })
            )
                ? resolveDefaultPluginTargetFile({
                    prompt: finalPrompt,
                    projectFiles: refreshedProjectFiles,
                    currentFilePath,
                    mainPluginFilePath,
                })
                : "";
            const resolvedTargetFilePath = derivedFailingFilePath || defaultPluginTargetFile;
            currentRequestRef.current = {
                action: effectiveAction,
                userPrompt: requestPrompt,
                prompt: finalPrompt,
                repairPaths: requestedRepairPaths,
                code: effectiveSelectedCode,
                language,
                context: requestContexts.referenceContext,
                projectContext: finalEnhancedContext,
                assistantId: selectedAssistant.id,
                targetFilePath: resolvedTargetFilePath,
                diagnosticFallback: false,
                hasSelection: !!effectiveSelectedCode,
            };

            console.log('[AI Coding Agent] Preparing request', { 
                action: effectiveAction, 
                hasCode: !!effectiveSelectedCode, 
                language,
                contextLength: finalEnhancedContext.length,
                includeProjectContext,
                sdkKnowledgeEnabled,
                externalReferenceEnabled,
                targetFilePath: resolvedTargetFilePath,
            });

            // Generate requestId upfront so we can track streaming events
            const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            currentRequestRef.current = {...currentRequestRef.current, requestId, generationBaseline: JSON.stringify(getAllProjectFiles().slice().sort((a, b) => a.path.localeCompare(b.path)))};
            beginStreamingRequest(requestId);
            console.log('[AI Coding Agent] Request ID set', requestId);
            // Start the inactivity timeout only when the actual AI request begins.
            scheduleRequestTimeout(selectedAssistant?.provider || "");
            pushRequestStatus(buildAiCodingAgentStatusMessage({
                phase: "generation",
                externalReferenceEnabled,
                sdkKnowledgeEnabled,
                includeProjectContext,
                issueDiagnosis: includeIssueDiagnosis ? issueScope.summary : "",
            }) + (effectiveAction !== requestAction
                ? `\nMode: ${effectiveAction === "plan" ? "Plan Code" : effectiveAction}.`
                : ""), { phase: "generation" });

            let result;
            if (reviewRequest) {
                const controller = new AbortController(); investigationAbortRef.current = controller;
                const baseline=JSON.stringify(getAllProjectFiles());
                const assertCurrent=()=>{assertSnapshotUnchanged();if(baseline!==JSON.stringify(getAllProjectFiles()))throw new Error('The workspace changed during investigation. Start again with the current files.');};
                const latestContent=Object.fromEntries(refreshedProjectFiles.map(file=>[file.path,file.content]));
                let firstAnalysis=true;
                const cancel=()=>window.electron.aiCodingAgent.cancelRequest?.({requestId:streamingRequestIdRef.current});
                const report=await runCodingInvestigation({prompt:requestPrompt,files:refreshedProjectFiles,
                    context:`${sdkKnowledgeContext}${getProblemsContext()}${getBuildOutputContext(refreshedProjectFiles)}\n${conversationContext}`,
                    budget:investigationBudget(refreshedProjectFiles,requestPrompt,selectedAssistant.firstResponseTimeoutMs),
                    signal:controller.signal,assertCurrent,cancel,
                    initialActions:initialInvestigationActions(refreshedProjectFiles,requestPrompt),
                    onProgress:({message,phase,budget})=>{
                        setWorkspaceStage('Investigating plugin');
                        pushRequestStatus(`${message} About ${Math.round(budget.tokens).toLocaleString()} estimated tokens and ${Math.ceil(budget.milliseconds/1000)}s remain.`,{phase});
                    },
                    ask:async ({prompt:investigationPrompt,maxOutputTokens})=>{
                        const id=firstAnalysis?requestId:`${requestId}-analysis-${Math.random().toString(36).slice(2)}`;firstAnalysis=false;
                        beginStreamingRequest(id);setWorkspaceStage('Investigating plugin');scheduleRequestTimeout(selectedAssistant.provider||'');
                        return window.electron.aiCodingAgent.smartMode({requestId:id,prompt:requestPrompt,context:investigationPrompt,assistantId:selectedAssistant.id,
                            investigation:true,maxOutputTokens,language});
                    },
                    perform:createInvestigationActions(refreshedProjectFiles,{
                        sourceChecks:()=>isWorkspaceQualityReviewPrompt(requestPrompt)?workspaceReviewContext(refreshedProjectFiles):{styles:findWorkspaceStyleIssues(refreshedProjectFiles),note:'Source diagnostics only; this does not verify rendering, runtime health or current tests.'},
                        typecheck:()=>window.electron.plugin?.typecheck?.({latestContent})??{success:false,error:'Typechecker unavailable.'},
                        build:async()=>{const result=await window.electron.plugin?.build?.({latestContent});return result?{success:result.success,error:result.error,errors:result.errors,warnings:result.warnings}:{success:false,error:'Builder unavailable.'};},
                        tests:async()=>{reviewTests=await runPluginTests();return reviewTests;},
                        runtime:()=>{const id=getCurrentPluginId();return id?window.electron.plugin?.getRuntimeStatus?.([id])??{success:false,error:'Runtime status unavailable.'}:{success:false,error:'This workspace has no installed plugin runtime.'};},
                        logs:async()=>{const logs=await getPluginLogsContext();return logs||{success:false,error:'No plugin trace is available.'};},
                        sdk:async({query})=>await getRelevantSdkKnowledgeContext(query)||{success:false,error:'SDK evidence unavailable.'},
                    }),
                });
                if(controller.signal.aborted)return;
                assertCurrent();flushStreamContent();clearRequestTimeout();streamingRequestIdRef.current=null;
                result={success:true,requestId,content:JSON.stringify(report)};
            } else switch (effectiveAction) {
                case "smart":
                    result = await window.electron.aiCodingAgent.smartMode({
                        requestId,
                        prompt: finalPrompt,
                        code: effectiveSelectedCode,
                        language,
                        context: finalEnhancedContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "generate":
                    result = await window.electron.aiCodingAgent.generateCode({
                        requestId,
                        prompt: finalPrompt,
                        language,
                        context: finalEnhancedContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "edit":
                    if (!effectiveSelectedCode) {
                        currentRequestRef.current = {
                            ...currentRequestRef.current,
                            diagnosticFallback: true,
                        };
                        result = await runDiagnosticSmartFallback({
                            requestId,
                            prompt: finalPrompt,
                            selectedCode: "",
                            language,
                            context: finalEnhancedContext,
                            assistantId: selectedAssistant.id,
                            reason: "No exact workspace file was identified for direct editing. Switching to diagnostic mode with the current workspace/test context.",
                        });
                        break;
                    }
                    result = await window.electron.aiCodingAgent.editCode({
                        requestId,
                        code: effectiveSelectedCode,
                        instruction: finalPrompt,
                        language,
                        context: requestContexts.referenceContext,
                        assistantId: selectedAssistant.id,
                        targetFilePath: derivedFailingFilePath || "",
                    });
                    break;
                case "explain":
                    if (!effectiveSelectedCode) {
                        setError("Please select code to explain");
                        setIsLoading(false);
                        clearRequestTimeout();
                        return;
                    }
                    result = await window.electron.aiCodingAgent.explainCode({
                        requestId,
                        code: effectiveSelectedCode,
                        language,
                        context: requestContexts.referenceContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                case "fix":
                    if (!effectiveSelectedCode) {
                        currentRequestRef.current = {
                            ...currentRequestRef.current,
                            diagnosticFallback: true,
                        };
                        result = await runDiagnosticSmartFallback({
                            requestId,
                            prompt: finalPrompt,
                            selectedCode: "",
                            language,
                            context: finalEnhancedContext,
                            assistantId: selectedAssistant.id,
                            reason: "No exact workspace file was identified for direct patching. Switching to diagnostic mode with the current workspace/test context.",
                        });
                        break;
                    }
                    result = await window.electron.aiCodingAgent.fixCode({
                        requestId,
                        code: effectiveSelectedCode,
                        error: requestPrompt,
                        language,
                        context: requestContexts.referenceContext,
                        assistantId: selectedAssistant.id,
                        targetFilePath: derivedFailingFilePath || "",
                    });
                    break;
                case "plan":
                    result = await window.electron.aiCodingAgent.planCode({
                        workspaceId: virtualFS.sandboxName,
                        ...(preparedRecoveryRef.current || {}),
                        userRequirements: requestPrompt,
                        workspaceFiles: getAllProjectFiles(),
                        ...(requestedRepairPaths ? {repairPaths: requestedRepairPaths} : {}),
                        requestId,
                        prompt: finalPrompt,
                        image: uploadedImage, // base64 image if uploaded
                        context: requestContexts.referenceContext,
                        assistantId: selectedAssistant.id,
                    });
                    break;
                default:
                    break;
            }

            const rerunPlanAsExecutableSections = async (priorContent) => {
                const retryPrompt = buildExecutablePlanRetryPrompt({
                    originalPrompt: finalPrompt,
                    invalidResponse: priorContent,
                });
                const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                beginStreamingRequest(retryRequestId);
                responseRef.current = "";
                setResponse("");
                setIsLoading(true);
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                pushRequestStatus(
                    "Plan response was prose-only. Requesting executable workspace file sections.",
                    { phase: "plan-retry" },
                );
                return await window.electron.aiCodingAgent.planCode({
                    workspaceFiles: getAllProjectFiles(),
                    requestId: retryRequestId,
                    prompt: retryPrompt,
                    userRequirements: requestPrompt,
                    ...(requestedRepairPaths ? {repairPaths: requestedRepairPaths} : {}),
                    image: uploadedImage,
                    context: requestContexts.referenceContext,
                    assistantId: selectedAssistant.id,
                });
            };

            console.log('[AI Coding Agent] IPC result received', {success:result?.success,requestId:result?.requestId});

            if (cancelledRequestIdsRef.current.has(requestId) || result?.cancelled) {
                console.log('[AI Coding Agent] Ignoring cancelled request result', { requestId });
                cancelledRequestIdsRef.current.delete(requestId);
                clearRequestTimeout();
                setIsLoading(false);
                expectWorkspaceApplyRef.current = false;
                pendingAutoFileCreateRef.current = false;
                planRetryInFlightRef.current = false;
                singleFileRetryInFlightRef.current = false;
                multiFileRetryInFlightRef.current = false;
                return;
            }

            if (reviewRequest && !result?.success) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(result?.error || "The workspace review could not complete.");
            }
            if (result?.success && isClassificationOnly(result.content || responseRef.current)) {
                //noinspection ExceptionCaughtLocallyJS
                throw Object.assign(new Error('The provider returned only a safety classification, with no answer or implementation. Select a coding-capable model and submit again. No changes were applied.'),
                    {code: 'AI_PROVIDER_CLASSIFICATION_ONLY'});
            }
            if (result && result.success && result.requestId) {
                requestSucceeded = true;
                if (effectiveAction === 'plan' && currentRequestRef.current?.generationBaseline !== JSON.stringify(getAllProjectFiles().slice().sort((a, b) => a.path.localeCompare(b.path)))) {
                    //noinspection ExceptionCaughtLocallyJS
                    throw new Error('The workspace changed during generation. No generated files were applied. Review your newer edits before recovering the saved proposal.');
                }
                dispatchGenerationRecovery({type: 'ready', requestId: result.requestId});
                console.log('[AI Coding Agent] Request successful, streaming complete', { requestId: result.requestId });
                // Request ID already set before IPC call, streaming events should have flowed
                // Verify requestId matches
                if (result.requestId !== requestId) {
                    console.warn('[AI Coding Agent] RequestId mismatch in result', { expected: requestId, received: result.requestId });
                }

                if (reviewRequest) {
                    assertSnapshotUnchanged();
                    const parsedReport=parseWorkspaceReviewReport(result.content || responseRef.current,getAllProjectFiles());
                    const report=isWorkspaceQualityReviewPrompt(requestPrompt)?includeWorkspaceAuthoringFindings(parsedReport,getAllProjectFiles()):parsedReport;
                    reviewReport = report;
                    if (report.status === "completed" && (!reviewTests?.success || reviewTests?.skipped)) {
                        report.status = "partial";
                        report.limitations.push(!reviewTests ? "Plugin tests were not run during this investigation." : reviewTests?.skipped ? "No plugin tests were available to verify behavior."
                            : "Host plugin tests did not pass or could not complete.");
                    }
                    let repairSummary = "";
                    const testSummary = value => !value ? "Tests: not run during this investigation." : value?.skipped ? "Tests: no plugin tests were found."
                        : value?.success ? "Tests: the host ran plugin tests successfully."
                            : "Tests: plugin tests did not pass or could not complete. See the Tests output.";
                    const publishReport = () => {
                        responseRef.current = formatWorkspaceReviewReport(report, {
                            repairSummary, tests: testSummary(reviewTests), changed: reviewChangesApplied,
                        });
                        setResponse(responseRef.current);
                    };
                    publishReport();
                    if (requestAutoApply && report.status !== "blocked" && (!report.budget || report.budget.tokens >= 4000 && report.budget.milliseconds > 0) && (report.findings.length || migrateGuide)) {
                        const repairPaths = [...new Set([...(migrateGuide ? ["/SKILL.md"] : []), ...report.findings.map(finding => finding.file)])];
                        assertSnapshotUnchanged();
                        const repairRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                        beginStreamingRequest(repairRequestId);
                        scheduleRequestTimeout(selectedAssistant?.provider || "");
                        pushRequestStatus(`Repairing confirmed issues in ${repairPaths.length} workspace files.`, {phase: "review-repair"});
                        const repaired = await window.electron.aiCodingAgent.planCode({
                            requestId: repairRequestId,
                            assistantId: selectedAssistant.id,
                            workspaceFiles: getAllProjectFiles(),
                            repairPaths,
                            prompt: `${migrateGuide ? "First migrate /SKILL.md to the installed SDK, preserving the product requirements and acceptance behavior. Pause for human guide approval before repairing implementation files. " : ""}Repair only these confirmed plugin-local findings. Preserve working behavior and public SDK contracts. Return complete changed files for the approved paths.\n${JSON.stringify(report.findings)}`,
                            context: requestContexts.referenceContext,
                            image: null,
                        });
                        if (!repaired?.success) {
                            //noinspection ExceptionCaughtLocallyJS
                            throw Object.assign(new Error(repaired?.error || "The workspace repair could not complete."), {guideRecovery: pluginGuideRecoveryMetadata(repaired)});
                        }
                        const scopedRepair = mergeValidationRepairResponse(
                            getAllProjectFiles().filter(file => repairPaths.includes(file.path)), repaired.content, repairPaths);
                        const execution = await executePlanResponse(scopedRepair, {allowProblemsRetry: true});
                        reviewChangesApplied = execution.successCount > 0;
                        if (reviewChangesApplied) {
                            const persisted = persistSnapshotAfterApply(virtualFS.fs.version()?.version || "");
                            if (!persisted || persisted.error) {
                                //noinspection ExceptionCaughtLocallyJS
                                throw new Error("Repairs were applied, but the resulting snapshot could not be saved.");
                            }
                        }
                        reviewTests = await runPluginTests();
                        const remainingStyleIssues = findWorkspaceStyleIssues(getAllProjectFiles());
                        if (remainingStyleIssues.length) {
                            report.status = 'partial';
                            report.limitations.push('Style registration is still missing after repair.', ...remainingStyleIssues.map(issue => `${issue.file}: ${issue.issue}`));
                        }
                        const remainingHtmlIssues = findWorkspaceHtmlIssues(getAllProjectFiles());
                        if (remainingHtmlIssues.length) {
                            report.status = 'partial';
                            report.limitations.push('SDK-helper migration still needs attention after repair.', ...remainingHtmlIssues.map(issue => `${issue.file}: ${issue.evidence}`));
                        }
                        repairSummary = `Repair: ${execution.successCount} file(s) updated.`;
                        if (execution.errorCount || !reviewTests?.success) {
                            report.status = "partial";
                            report.limitations.push(...execution.errorDetails);
                            if (!reviewTests?.success) report.limitations.push("Repairs are not verified by passing plugin tests.");
                        }
                        publishReport();
                    } else if (requestAutoApply) {
                        repairSummary = report.status === "blocked" ? "No repairs were attempted because the review was blocked." : "No confirmed issues were identified for automatic repair.";
                        publishReport();
                    }
                    setOperationSummary({intent: report.status === "completed" ? "success" : "warning",
                        title: report.status === "completed" ? "Workspace Review Complete" : "Workspace Review Needs Attention",
                        message: repairSummary || report.summary});
                    streamingRequestIdRef.current = null;
                    clearRequestTimeout();
                    return;
                }

                if (
                    effectiveAction === "plan" &&
                    !planRetryInFlightRef.current &&
                    !shouldApplyAiResponseToWorkspace(result.content || responseRef.current)
                ) {
                    try {
                        planRetryInFlightRef.current = true;
                        result = await rerunPlanAsExecutableSections(result.content || responseRef.current);
                        console.log('[AI Coding Agent] IPC plan retry result received', result);
                    } finally {
                        planRetryInFlightRef.current = false;
                    }
                }

                const pluginScopeResponseValidation = validateAiCodingPluginScopeResponse({
                    text: result.content || responseRef.current,
                    workspaceFiles: refreshedProjectFiles,
                });
                if (!pluginScopeResponseValidation.ok) {
                    if (!scopeRetryInFlightRef.current) {
                        try {
                            scopeRetryInFlightRef.current = true;
                            result = await rerunPluginScopedResponse({
                                action: effectiveAction,
                                prompt: finalPrompt,
                                invalidResponse: result.content || responseRef.current,
                                language,
                                selectedCode: effectiveSelectedCode,
                                projectContext: finalEnhancedContext,
                                referenceContext: requestContexts.referenceContext,
                                assistantId: selectedAssistant.id,
                                image: uploadedImage,
                                targetFilePath: currentRequestRef.current?.targetFilePath || "",
                            });
                            console.log('[AI Coding Agent] IPC scope retry result received', result);
                        } finally {
                            scopeRetryInFlightRef.current = false;
                        }
                    }
                }

                if (cancelledRequestIdsRef.current.has(result?.requestId) || result?.cancelled) {
                    cancelledRequestIdsRef.current.delete(result?.requestId);
                    clearRequestTimeout();
                    setIsLoading(false);
                    expectWorkspaceApplyRef.current = false;
                    pendingAutoFileCreateRef.current = false;
                    planRetryInFlightRef.current = false;
                    singleFileRetryInFlightRef.current = false;
                    multiFileRetryInFlightRef.current = false;
                    return;
                }
                if (!result?.success) {
                    setError(result?.error || "Plugin-scope correction failed.");
                    setIsLoading(false);
                    streamingRequestIdRef.current = null;
                    clearRequestTimeout();
                    expectWorkspaceApplyRef.current = false;
                    pendingAutoFileCreateRef.current = false;
                    planRetryInFlightRef.current = false;
                    singleFileRetryInFlightRef.current = false;
                    multiFileRetryInFlightRef.current = false;
                    scopeRetryInFlightRef.current = false;
                    return;
                }

                const correctedPluginScopeValidation = validateAiCodingPluginScopeResponse({
                    text: result?.content || responseRef.current,
                    workspaceFiles: refreshedProjectFiles,
                });
                if (!correctedPluginScopeValidation.ok) {
                    const scopeError = buildAiCodingPluginScopeViolationMessage({
                        references: correctedPluginScopeValidation.references,
                        phase: "response",
                    });
                    responseRef.current = "";
                    setResponse("");
                    setRequestStatusEntries([]);
                    setOperationSummary({
                        intent: "warning",
                        title: "Plugin Scope Enforced",
                        message: scopeError,
                    });
                    setError(scopeError);
                    setIsLoading(false);
                    pendingAutoFileCreateRef.current = false;
                    expectWorkspaceApplyRef.current = false;
                    planRetryInFlightRef.current = false;
                    singleFileRetryInFlightRef.current = false;
                    multiFileRetryInFlightRef.current = false;
                    scopeRetryInFlightRef.current = false;
                    return;
                }

                if (
                    requestAutoApply &&
                    !pendingAutoFileCreateRef.current &&
                    effectiveAction !== "plan" &&
                    !currentRequestRef.current?.diagnosticFallback
                ) {
                    const allowSingleFileAutoApply = shouldAutoApplySingleFileResponse({
                        action: effectiveAction,
                        prompt: requestPrompt,
                        selectedCode: currentRequestRef.current?.code || "",
                        targetFilePath: currentRequestRef.current?.targetFilePath || "",
                    });
                    if (allowSingleFileAutoApply) {
                        const autoApplyResult = await autoInsertCodeIntoEditor(result.content || responseRef.current);
                        if (autoApplyResult?.success && autoApplyResult?.requestId) {
                            result = autoApplyResult;
                        }
                    } else {
                        setOperationSummary({
                            intent: "primary",
                            title: "Response Ready",
                            message: "Auto-apply skipped because this looks like an informational request, not a code-change request.",
                        });
                    }
                }
                
                if (pendingAutoFileCreateRef.current) {
                    // Validation failures intentionally share this boundary with operation failures.
                    try {
                        const execution = await executePlanResponse(result.content || responseRef.current);
                        if (execution.successCount > 0) {
                            const persisted = persistSnapshotAfterApply(virtualFS.fs.version()?.version || "");
                            if (!persisted || persisted.error) {
                                //noinspection ExceptionCaughtLocallyJS
                                throw new Error("Files changed, but the resulting snapshot could not be saved.");
                            }
                            const message = `Created ${execution.successCount} file(s) in the virtual workspace${execution.errorCount > 0 ? `, ${execution.errorCount} failed` : ''}.`;
                            setOperationSummary({
                                intent: execution.errorCount > 0 ? "warning" : "success",
                                title: "Files Created",
                                message,
                            });
                            setError(execution.errorCount > 0 ? `Plan application failed: ${execution.errorDetails.join('; ')}` : null);
                            if (workspaceQualityReview && execution.errorCount === 0) {
                                pushRequestStatus("Workspace review changes were applied. Running plugin tests to verify the final workspace.", { phase: "tests" });
                                const verification = await runPluginTests();
                                setOperationSummary({
                                    intent: verification?.success ? "success" : "warning",
                                    title: verification?.success ? "Workspace Review Complete" : "Workspace Review Needs Attention",
                                    message: verification?.success
                                        ? "Confirmed workspace changes were applied and plugin tests passed."
                                        : "Confirmed workspace changes were applied, but plugin tests still report failures. Review the latest Tests output before continuing.",
                                });
                            }
                        } else {
                            setError(`Failed to create files. Errors: ${execution.errorDetails.join('; ')}`);
                        }
                    } catch (autoCreateError) {
                        setError(autoCreateError.message || "Failed to create virtual files from AI response.");
                    } finally {
                        pendingAutoFileCreateRef.current = false;
                        expectWorkspaceApplyRef.current = false;
                    }
                }

                // Clear streamingRequestId now that IPC is complete
                // This prevents any late/duplicate done events from matching
                streamingRequestIdRef.current = null;
            } else if (result && result.error) {
                dispatchGenerationRecovery({type: 'failed', requestId: result.requestId || currentRequestRef.current?.requestId || generationRecovery.requestId, failure: result.failure, originalPrompt: requestPrompt});
                console.error('[AI Coding Agent] Error in result', result.error);
                setError(result.error);
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                clearRequestTimeout();
                expectWorkspaceApplyRef.current = false;
            } else {
                console.error('[AI Coding Agent] Invalid result - missing requestId or success flag', result);
                setError("Invalid response from AI service. Please try again.");
                setIsLoading(false);
                streamingRequestIdRef.current = null;
                clearRequestTimeout();
                expectWorkspaceApplyRef.current = false;
            }
        } catch (err) {
            requestSucceeded = false;
            if (err.name === 'AbortError') return;
            if (reviewRequest) {
                const recovery = pluginGuideRecoveryMetadata(err);
                if (recovery) setGuideRecovery({prompt: requestPrompt, workspace: virtualFS.sandboxName});
                const failedReport = reviewReport ? {...reviewReport, status: 'partial',
                    limitations: [...reviewReport.limitations, err.message || 'Repairs could not complete.']}
                    : {status: 'blocked', summary: 'Workspace quality remains unverified.', findings: [],
                        limitations: [err.message || 'The review could not complete.']};
                responseRef.current = formatWorkspaceReviewReport(failedReport, {changed: reviewChangesApplied});
                setResponse(responseRef.current);
                setOperationSummary({intent: 'warning', title: reviewReport ? 'Workspace Repair Could Not Complete' : 'Workspace Review Could Not Complete', message: err.message});
            }
            console.error('[AI Coding Agent] Exception in handleSubmit', err);
            dispatchGenerationRecovery({type: 'failed', requestId: streamingRequestIdRef.current || currentRequestRef.current?.requestId, failure: err.failure, originalPrompt: requestPrompt});
            setError(err.message || "An error occurred");
            setIsLoading(false);
            clearRequestTimeout();
            expectWorkspaceApplyRef.current = false;
            planRetryInFlightRef.current = false;
            singleFileRetryInFlightRef.current = false;
            multiFileRetryInFlightRef.current = false;
            scopeRetryInFlightRef.current = false;
        }
        finally {
            investigationAbortRef.current = null;
            workspaceReviewInProgressRef.current = false;
            preparedRecoveryRef.current = null;
            if (responseRef.current.trim() && !isClassificationOnly(responseRef.current)) {
                const stale = requestSnapshotRef.current?.revision !== (virtualFS.fs.snapshotSwitchRevision || 0)
                    || requestSnapshotRef.current?.workspace !== virtualFS.sandboxName;
                if (!stale) saveConversation([...conversationRef.current, {role: "assistant", content: responseRef.current,
                    snapshot: userMessage.snapshot, ...(appliedSnapshotRef.current != null ? {appliedSnapshot: appliedSnapshotRef.current} : {})}]);
                if (requestSucceeded) setPrompt("");
            }
            submitInFlightRef.current = false;
            setIsOperationActive(false);
            setIsLoading(false);
        }
    };

    const handleWorkspaceReview = (repair = false) => {
        const reviewPrompt = repair ? WORKSPACE_REPAIR_PROMPT : WORKSPACE_REVIEW_PROMPT;
        setPrompt(reviewPrompt);
        setAction("smart");
        setAutoApply(repair);
        // The ref is read by response handlers that can run before React has
        // committed the state update triggered above.
        autoApplyRef.current = repair;
        handleSubmit({
            prompt: reviewPrompt,
            action: "smart",
            autoApply: repair,
        });
    };

    const handlePromptChange = (event) => {
        if (isLoading) return;
        const nextValue = event.target.value;
        const selectionStart = typeof event.target.selectionStart === "number" ? event.target.selectionStart : nextValue.length;
        setPrompt(nextValue);
        updateMentionSuggestions(nextValue, selectionStart);
    };

    const handlePromptCursorActivity = (event) => {
        if (isLoading) return;
        if (event.type === 'keyup' && ['Escape', 'Enter', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const nextValue = event.target.value;
        const selectionStart = typeof event.target.selectionStart === "number" ? event.target.selectionStart : nextValue.length;
        updateMentionSuggestions(nextValue, selectionStart);
    };

    const handleApplyResponse = async () => {
        if (blockIncompleteGeneration) return;
        try {if (!await checkSavedGenerationBeforeApply()) return;} catch (error) {setError(error.message); return;}
        setIsOperationActive(true);
        setIsLoading(true);
        try { await autoInsertCodeIntoEditor(); }
        catch (err) { setError(err.message); }
        finally { setIsOperationActive(false); setIsLoading(false); }
    };

    const insertCodeIntoEditor = (contentOverride = "") => {
        assertSnapshotUnchanged();
        const contentToApply = contentOverride || responseRef.current || response;
        if (!codeEditor || !contentToApply) {
            console.log('[AI Coding Agent] Cannot insert - no editor or response');
            return { success: false, error: "No editor or AI response available to apply." };
        }

        const selection = codeEditor.getSelection();
        const model = codeEditor.getModel();
        if (!model) {
            console.log('[AI Coding Agent] Cannot insert - no model');
            return { success: false, error: "No editor model is available." };
        }
        const currentModelPath = typeof virtualFS.getFileName === "function"
            ? virtualFS.getFileName(model) || ""
            : "";
        const targetFilePath = currentRequestRef.current?.targetFilePath || "";
        const targetFileContent = targetFilePath && targetFilePath !== currentModelPath
            ? (virtualFS.getLatestContent?.()[targetFilePath] || "")
            : "";
        const currentFileText = targetFileContent || model.getValue();
        const isTestFocusedRequest = /tests?\s+(?:are|is)\s+failing|failing tests?|test issue|run tests?.*fix|run tests?.*investigate|fix tests?/i.test(
            currentRequestRef.current?.prompt || "",
        );
        const currentFileIsTestFile = /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(currentModelPath);
        const targetFileIsTestFile = /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(targetFilePath);
        const isEmptySelection =
            !selection ||
            (selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn);
        const selectedText = !isEmptySelection ? model.getValueInRange(selection) : "";
        const { blocks: patchBlocks, invalidPaths: invalidPatchPaths } = parseAiSearchReplaceResponse(contentToApply);
        if (invalidPatchPaths.length > 0) {
            return {
                success: false,
                error: `AI patch used non-workspace file path(s): ${invalidPatchPaths.join(", ")}. Use virtual workspace paths like /index.ts or /tests/unit/example.test.js only.`,
            };
        }
        if (patchBlocks.length > 0) {
            try {
                const groupedBlocks = patchBlocks.reduce((groups, block) => {
                    const normalizedBlockPath = String(block?.filePath || "").trim();
                    const effectiveBlockPath = normalizedBlockPath || targetFilePath || currentModelPath;
                    if (!groups.has(effectiveBlockPath)) {
                        groups.set(effectiveBlockPath, []);
                    }
                    groups.get(effectiveBlockPath).push({
                        search: block.search,
                        replace: block.replace,
                    });
                    return groups;
                }, new Map());

                groupedBlocks.forEach((blocksForFile, blockFilePath) => {
                    const isCurrentEditorFile = !blockFilePath || blockFilePath === currentModelPath;
                    const patchBaseText = isCurrentEditorFile
                        ? (isEmptySelection ? model.getValue() : selectedText)
                        : (virtualFS.getLatestContent?.()[blockFilePath] || "");
                    const patchedText = applyAiSearchReplaceBlocks(patchBaseText, blocksForFile);

                    if (isCurrentEditorFile) {
                        const patchRange = isEmptySelection ? model.getFullModelRange() : selection;
                        model.pushEditOperations([], [{
                            range: patchRange,
                            text: patchedText,
                            forceMoveMarkers: true,
                        }], () => null);
                        codeEditor.focus();
                    } else {
                        virtualFS.setFileContent(blockFilePath, patchedText);
                    }
                });

                console.log('[AI Coding Agent] Search/replace patch applied successfully', {
                    blockCount: patchBlocks.length,
                    replaceMode: groupedBlocks.size > 1
                        ? "patched-multiple-files"
                        : (
                            [...groupedBlocks.keys()][0] && [...groupedBlocks.keys()][0] !== currentModelPath
                                ? "patched-target-file"
                                : (isEmptySelection ? "patched-whole-file" : "patched-selection")
                        ),
                });
                return {
                    success: true,
                    mode: groupedBlocks.size > 1
                        ? "patched-multiple-files"
                        : (
                            [...groupedBlocks.keys()][0] && [...groupedBlocks.keys()][0] !== currentModelPath
                                ? "patched-target-file"
                                : (isEmptySelection ? "patched-whole-file" : "patched-selection")
                        ),
                    appliedFilePaths: [...groupedBlocks.keys()].map((path) => path || currentModelPath).filter(Boolean),
                };
            } catch (error) {
                console.warn('[AI Coding Agent] Failed to apply search/replace patch', {
                    error: error?.message || String(error),
                });
                currentRequestRef.current = currentRequestRef.current
                    ? {
                        ...currentRequestRef.current,
                        applyFailure: error?.message || String(error),
                    }
                    : currentRequestRef.current;
                return {
                    success: false,
                    error: error?.message || "Failed to apply the AI patch.",
                    mode: /matched multiple locations/i.test(error?.message || "")
                        ? "ambiguous-search-replace"
                        : "patch-apply-failed",
                };
            }
        }

        if (isTestFocusedRequest && !targetFileIsTestFile && !currentFileIsTestFile) {
            return {
                success: false,
                mode: "unsafe-test-target",
                error: "This request is focused on failing tests, but the AI response did not target a test file explicitly. Return SEARCH/REPLACE patches with File: /tests/... or target the failing test file directly.",
            };
        }

        const metadataPatchedText = applyAiMetadataBlockResponse({
            responseContent: contentToApply,
            targetSource: currentFileText,
        });
        if (metadataPatchedText) {
            const appliedSummary = buildAppliedChangeSummary({
                filePath: targetFilePath || currentModelPath,
                beforeText: currentFileText,
                afterText: metadataPatchedText,
                mode: "patched-metadata-block",
            });
            if (targetFileContent && targetFilePath) {
                virtualFS.setFileContent(targetFilePath, metadataPatchedText);
                return {
                    success: true,
                    mode: "patched-metadata-target-file",
                    appliedSummary,
                    appliedFilePaths: [targetFilePath],
                };
            }

            model.pushEditOperations([], [{
                range: model.getFullModelRange(),
                text: metadataPatchedText,
                forceMoveMarkers: true,
            }], () => null);
            codeEditor.focus();
            return {
                success: true,
                mode: "patched-metadata-block",
                appliedSummary,
                appliedFilePaths: [currentModelPath],
            };
        }

        const applyDecision = decideAiSingleFileApplyStrategy({
            action: applyActionRef.current,
            content: contentToApply,
            currentFileText: targetFileContent || model.getValue(),
            selectedText: targetFileContent || selectedText,
            hasSelection: targetFileContent ? true : !isEmptySelection,
        });

        if (!applyDecision.safe) {
            console.warn('[AI Coding Agent] Refusing unsafe single-file auto-apply', {
                reason: applyDecision.reason,
            });
                return {
                    success: false,
                    mode: applyDecision.mode,
                    error: applyDecision.mode === "unsafe-partial-selection"
                        ? "AI returned only a small recommendation/snippet for a large selected region. Ask it to return SEARCH/REPLACE patches or a full rewrite of the selected code."
                        : "AI returned another partial snippet instead of an executable whole-file change. Ask it to rewrite the whole file or return exact SEARCH/REPLACE patches.",
                };
        }

        const codeToInsert = applyDecision.code;
        const appliedSummary = buildAppliedChangeSummary({
            filePath: targetFilePath || currentModelPath,
            beforeText: currentFileText,
            afterText: codeToInsert,
            mode: targetFileContent ? "replace-target-file" : applyDecision.mode,
        });
        if (targetFileContent && targetFilePath) {
            virtualFS.setFileContent(targetFilePath, codeToInsert);
        } else {
            const targetRange = applyDecision.mode === "replace-whole-file"
                ? model.getFullModelRange()
                : selection;

            const edit = {
                range: targetRange,
                text: codeToInsert,
                forceMoveMarkers: true,
            };

            model.pushEditOperations([], [edit], () => null);
            codeEditor.focus();
        }
        
        console.log('[AI Coding Agent] Code inserted successfully', {
            replaceMode: targetFileContent ? "replace-target-file" : applyDecision.mode,
        });
        return {
            success: true,
            mode: targetFileContent ? "replace-target-file" : applyDecision.mode,
            appliedSummary,
            appliedFilePaths: [targetFileContent && targetFilePath ? targetFilePath : currentModelPath].filter(Boolean),
        };
    };

    const clearResponse = ({preserveRecovery = false} = {}) => {
        preservePendingFilesOnRetryRef.current = false;
        if (!preserveRecovery) {dispatchGenerationRecovery({type: 'reset'}); preparedRecoveryRef.current = null; updateValidationRecovery(null);}
        setRepairNotice(null);
        setResponse("");
        setRequestStatusEntries([]);
        responseRef.current = "";
        setError(null);
        setOperationSummary(null);
        setComposerMode(null);
        pendingAutoFileCreateRef.current = false;
        expectWorkspaceApplyRef.current = false;
        planRetryInFlightRef.current = false;
        applyActionRef.current = "";
        currentRequestRef.current = null;
        singleFileRetryInFlightRef.current = false;
        multiFileRetryInFlightRef.current = false;
        scopeRetryInFlightRef.current = false;
    };

    const liveFollowUpMode = shouldTreatAsAiCodingFollowUp({
        prompt,
        previousResponse: response,
        forceFollowUp: composerMode === "refine",
    });
    const liveFileTargets = extractProjectFileTargets({
        prompt,
        previousResponse: response,
        workspaceFiles: getAllProjectFiles(),
    });
    const liveCreateProjectFiles = liveFileTargets.length > 0;
    const liveSelectedCode = getSelectedCode();
    const liveProblemsContext = getProblemsContext();
    const liveEffectiveAction = resolveAiCodingAgentAction({
        requestedAction: liveCreateProjectFiles ? "plan" : action,
        prompt: prompt,
        selectedCode: liveSelectedCode,
        previousResponse: response,
    });
    const liveIssueScope = classifyAiCodingIssueScope({
        prompt,
        selectedCode: liveSelectedCode,
        problemsContext: liveProblemsContext,
    });
    const showLiveIssueDiagnosis = shouldIncludeIssueDiagnosis({
        prompt,
        action: liveEffectiveAction,
    }) && !!liveIssueScope.summary && liveIssueScope.kind !== "plugin";
    const promptLabel = liveCreateProjectFiles
        ? `Create workspace file${liveFileTargets.length > 1 ? "s" : ""}`
        : composerMode === "refine"
        ? "Continue or refine the current AI coding thread"
        : response && liveFollowUpMode
        ? "Continue the current AI coding thread"
        : action === "smart"
        ? "Describe what you want to do"
        : action === "generate"
        ? "Describe what you want to generate"
        : action === "edit"
        ? "Describe how to edit the selected code"
        : action === "explain"
        ? "What would you like to know? (optional)"
        : action === "plan"
        ? "Describe the plugin or upload a UI mockup"
        : "Describe the error (optional)";
    const promptPlaceholder = liveCreateProjectFiles
        ? `e.g., Create ${liveFileTargets.join(", ")} in the virtual workspace`
        : composerMode === "refine"
        ? "A concrete continuation draft is prefilled when FDO can infer the next plugin-local step. You can submit it as-is or edit it."
        : response && liveFollowUpMode
        ? "e.g., continue with the implementation, create README.md, or break this into milestones"
        : action === "smart"
        ? "e.g., Add error handling to this function, or Create a validation function, or Explain this algorithm"
        : action === "generate"
        ? "e.g., Create a function that validates email addresses"
        : action === "edit"
        ? "e.g., Add error handling and logging"
        : action === "explain"
        ? "e.g., Focus on the algorithm used"
        : action === "plan"
        ? "e.g., Create a todo list plugin with drag and drop support, or Analyze the uploaded UI mockup"
        : "e.g., TypeError on line 42";
    const intentHint = liveCreateProjectFiles
        ? `This will create real virtual workspace file${liveFileTargets.length > 1 ? "s" : ""}: ${liveFileTargets.join(", ")}.`
        : composerMode === "refine"
        ? "This will continue the current AI coding thread using the previous response as context. FDO prefills the next plugin-local step when it can infer one."
        : response && liveFollowUpMode
        ? "This follow-up will continue the current AI coding thread using the previous response as context."
        : liveEffectiveAction !== action
        ? `This request will use ${liveEffectiveAction === "plan" ? "Plan Code" : liveEffectiveAction} for a better fit.`
        : null;
    const selectionGuidance = buildSelectionGuidance({
        action,
        effectiveAction: liveEffectiveAction,
        prompt,
        selectedCode: liveSelectedCode,
        createProjectFiles: liveCreateProjectFiles,
        composerMode,
        hasResponse: !!response,
    });
    const smartModeGuidance = action === "smart"
        ? buildSmartModeGuidance({
            prompt,
            effectiveAction: liveEffectiveAction,
            selectedCode: liveSelectedCode,
            createProjectFiles: liveCreateProjectFiles,
            hasResponse: !!response,
            composerMode,
        })
        : null;
    const mentionMenuVisible = !isLoading && !!mentionState?.suggestions?.length;
    const responseIsReviewReport = /^\*\*Workspace review (?:completed|partially completed|could not complete)\*\*/.test(response || "");
    const responseHasWorkspaceFiles = shouldApplyAiResponseToWorkspace(response || '');
    const responseRequestsChanges = shouldAutoApplySingleFileResponse({
        action: currentRequestRef.current?.action,
        prompt: currentRequestRef.current?.userPrompt || currentRequestRef.current?.prompt || '',
    });
    const responseHasUnappliedCode = !responseApplied && (responseHasWorkspaceFiles
        || (responseRequestsChanges && (parseAiSearchReplaceResponse(response || '').blocks.length > 0
            || extractAiCodeToApply(response || '').blocksFound > 0)));

    // Show loading state while fetching assistants
    if (loadingAssistants) {
        return (
            <div className={styles["ai-coding-agent-panel"]}>
                <div className={styles["panel-content"]}>
                    <NonIdealState
                        icon={<Spinner size={40} />}
                        title="Loading AI Assistants"
                        description="Please wait..."
                    />
                </div>
            </div>
        );
    }

    // Show message if no assistants available
    if (assistants.length === 0) {
        return (
            <div className={styles["ai-coding-agent-panel"]}>
                <div className={styles["panel-content"]}>
                    <NonIdealState
                        icon="warning-sign"
                        title="No Coding Assistants Available"
                        description={
                            <div>
                                <p>No AI coding assistants found.</p>
                                <p>Please add a coding assistant in Settings → AI Assistants.</p>
                                {assistantLoadError && <p>{assistantLoadError}</p>}
                            </div>
                        }
                        action={<Button text="Reload AI assistants" icon="refresh" loading={refreshingAssistants}
                            onClick={() => reloadAssistants()} />}
                    />
                </div>
            </div>
        );
    }

    const requestProgress = <AiCodingRequestProgress
        elapsedMs={requestElapsedMs} entries={requestStatusEntries} hasResponse={!!response}
        attempt={requestAttempt} streamStatus={streamStatus} workspaceStage={workspaceStage}
        estimate={finishEstimate} estimateDetails={estimateDetails} estimateProgress={estimateProgress}
        confidence={confidence}/>;
    return (
        <div
            className={styles["ai-coding-agent-panel"]}
            ref={panelContentRef}
            onKeyDown={handlePanelKeyDownWithHotkeys}
            onKeyUp={handleHotkeyKeyUp}
            tabIndex={0}
        >
            {isLoading && eventDocument !== document && <div className={styles['floating-progress']}>{requestProgress}</div>}
            <div className={styles["panel-header"]}>
                <AiUsagePopover surface="coding" />
                <Button
                    size="small"
                    disabled={isLoading}
                    onClick={() => setIsResetConversationOpen(true)}
                >
                    Reset workspace conversation
                </Button>
                <div className={styles["panel-header-tags"]}>
                    <Tag minimal intent="success">
                        Plugin Scope Only
                    </Tag>
                    <Tag minimal intent="primary">
                        Beta
                    </Tag>
                </div>
            </div>

            <div className={styles["panel-content"]}>
            <section aria-label="Conversation history" data-testid="ai-conversation-history" className={styles["conversation-history"]}>

                <details className={styles['request-help']} open={eventDocument === document}>
                <summary>Conversation history{conversation.length ? ` (${conversation.length})` : ''}</summary>
                <p className={styles["conversation-note"]}>FDO keeps this plugin’s chat on this computer so you can return to it later. Recent messages are sent to your selected AI assistant with follow-up requests.</p>
                {historyWarning && <Callout intent="warning">{historyWarning}</Callout>}
                {conversation.map((message, index) => message.role === "assistant" && index === conversation.length - 1 && message.content === response ? null : (
                    <details key={index} open={message.role === "user"} className={styles["conversation-message"]}>
                        <summary>
                            <span className={styles["message-heading"]}>
                                <strong>{message.role === "snapshot" ? "Snapshot switch" : message.role === "user" ? "You" : "Assistant"}</strong>
                                <span className={styles["message-expand"]}>Show message</span>
                                <span className={styles["message-collapse"]}>Collapse</span>
                            </span>
                            <span className={styles["message-preview"]}>{message.content.replace(/\s+/g, " ")}</span>
                        </summary>
                        <div className={styles["message-content"]}>
                        {message.snapshot != null && (
                            <div>
                                <Button
                                    variant="minimal"
                                    size="small"
                                    icon="history"
                                    text={`Snapshot: ${message.snapshot}`}
                                    title={`Switch to snapshot ${message.snapshot}`}
                                    onClick={() => requestConversationSnapshot(message.snapshot)}
                                    disabled={isLoading}
                                />
                                {message.appliedSnapshot != null && <small>{` → Applied: ${message.appliedSnapshot}`}</small>}
                            </div>
                        )}
                        <Markdown options={{disableParsingRawHTML: true}}>{message.content}</Markdown>
                        </div>
                    </details>
                ))}
                </details>
            </section>

                <FormGroup label="AI Assistant" labelFor="assistant-select">
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <div style={{flex: 1, minWidth: 0}}>
                    <HTMLSelect
                        id="assistant-select"
                        value={selectedAssistant?.id || ""}
                        onChange={(e) => {
                            const assistant = assistants.find(a => a.id === e.target.value);
                            setSelectedAssistant(assistant);
                        }}
                        fill
                    >
                        {assistants.map(assistant => (
                            <option key={assistant.id} value={assistant.id}>
                                {assistant.name} ({assistant.provider} - {assistant.model}){imageSupportOptionSuffix(assistant.id === selectedAssistant?.id ? inputCapabilities : assistantInputCapabilities(assistant))}
                                {assistant.default ? ' ★' : ''}
                            </option>
                        ))}
                    </HTMLSelect>
                    </div>
                    <Button text="Reload" icon="refresh" aria-label="Reload AI assistants" title="Reload AI assistants from Settings"
                        disabled={isLoading || refreshingAssistants} loading={refreshingAssistants}
                        onClick={() => reloadAssistants()} />
                    </div>
                    {assistantLoadError && <Callout intent="warning" style={{marginTop: '8px'}}>{assistantLoadError}</Callout>}
                    <p style={{marginTop: '8px'}}>Screenshots: {imageSupportLabel(inputCapabilities)}</p>
                    {inputCapabilities.imageSupport === 'unknown' && <p>{selectedAssistant?.provider === 'cursor'
                        ? 'Attach screenshots or mockups to your request.'
                        : 'You can attach an image. The provider will check whether the selected model accepts it.'}</p>}
                </FormGroup>

                <FormGroup label="Action" labelFor="action-select">
                    <HTMLSelect
                        id="action-select"
                        value={action}
                        onChange={(e) => {setAction(e.target.value); if (preparedRecoveryRef.current) {preparedRecoveryRef.current = null; dispatchGenerationRecovery({type: 'reset'}); setOperationSummary(null);}}}
                        options={AI_ACTIONS}
                        fill
                    />
                </FormGroup>

                <PluginAuthoringContract context={authoringContractForEditor()}/>
                {smartModeGuidance && !mentionMenuVisible && (
                    <details className={styles['request-help']} open={eventDocument === document || ['warning', 'danger'].includes(smartModeGuidance.intent)}>
                    <summary>Smart Mode guidance</summary>
                    <Callout
                        intent={smartModeGuidance.intent}
                        icon={smartModeGuidance.icon}
                        className={styles["smart-mode-guidance"]}
                    >
                        <strong>{smartModeGuidance.title}</strong>
                        <div className={styles["smart-mode-guidance-grid"]}>
                            <div className={styles["smart-mode-guidance-item"]}>
                                <span className={styles["smart-mode-guidance-label"]}>Likely behavior</span>
                                <span>{smartModeGuidance.predictedIntent}</span>
                            </div>
                            <div className={styles["smart-mode-guidance-item"]}>
                                <span className={styles["smart-mode-guidance-label"]}>Selection</span>
                                <span>{smartModeGuidance.selectionMode}</span>
                            </div>
                            <div className={styles["smart-mode-guidance-item"]}>
                                <span className={styles["smart-mode-guidance-label"]}>Expected result</span>
                                <span>{smartModeGuidance.expectedResult}</span>
                            </div>
                        </div>
                    </Callout>
                    </details>
                )}

                {action === "plan" && (
                    <FormGroup label="UI Mockup (Optional)" labelInfo="Upload an image for AI to analyze">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                            onChange={handleImageUpload}
                            style={{ display: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <Button
                                icon="camera"
                                text="Upload Image"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isLoading || inputCapabilities.imageSupport === 'unsupported'}
                            />
                            {imagePreview && (
                                <div style={{ flex: 1 }}>
                                    <Button
                                        variant="minimal"
                                        aria-label={`Open reference image: ${imageName || "UI Mockup"}`}
                                        title={`Open ${imageName || "UI Mockup"}`}
                                        onClick={() => setIsImagePreviewOpen(true)}
                                        style={{padding: 0, display: "block"}}
                                    >
                                        <img
                                            src={imagePreview}
                                            alt="UI Mockup"
                                            style={{
                                                display: "block",
                                                maxWidth: '200px',
                                                maxHeight: '150px',
                                                borderRadius: '4px',
                                                border: '1px solid #ccc'
                                            }}
                                        />
                                    </Button>
                                    <div style={{display: "flex", alignItems: "center", gap: "4px", marginTop: "4px"}}>
                                        <Button
                                            variant="minimal"
                                            size="small"
                                            icon="zoom-in"
                                            onClick={() => setIsImagePreviewOpen(true)}
                                        >
                                            {imageName || "Open reference image"}
                                        </Button>
                                        <Button
                                            icon="cross"
                                            variant={"minimal"}
                                            size={"small"}
                                            aria-label="Remove UI mockup"
                                            onClick={handleRemoveImage}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </FormGroup>
                )}

                <FormGroup label={isLoading ? "Current request" : promptLabel} labelFor="prompt-input"
                    labelInfo={isLoading ? "In progress" : undefined}
                    helperText={!isLoading && selectedAssistant?.provider === 'codex-cli' && mentionSkills.some(skill => skill.enabled && skill.assistantIds?.includes(selectedAssistant.id))
                        ? 'Type $ to choose an assigned skill. Ordinary $variables remain plain text.' : undefined}>
                    <div className={classnames(styles["prompt-input-wrap"], isLoading && styles["prompt-running"])}>
                        <TextArea
                            id="prompt-input"
                            inputRef={promptInputRef}
                            value={prompt}
                            onChange={handlePromptChange}
                            onClick={handlePromptCursorActivity}
                            onKeyUp={handlePromptCursorActivity}
                            onBlur={() => {
                                clearPromptBlurTimeout();
                                promptBlurTimeoutRef.current = setTimeout(() => {
                                    setMentionState(null);
                                }, 120);
                            }}
                            onFocus={handlePromptCursorActivity}
                            placeholder={promptPlaceholder}
                            fill
                            rows={4}
                            readOnly={isLoading}
                            aria-describedby={isLoading ? "prompt-running-hint" : undefined}
                        />
                        {isLoading && <p id="prompt-running-hint" className={styles["prompt-running-hint"]}>
                            Your request is running. You can select and copy the text. Stop the run to edit it.
                        </p>}
                        {!isLoading && mentionState?.suggestions?.length > 0 && (
                            <div className={styles["mention-menu-shell"]}>
                                <div
                                    className={styles["mention-menu-a11y"]}
                                    role="listbox"
                                    aria-label={mentionState.kind === 'skill' ? 'Codex skill suggestions' : 'Workspace file suggestions'}
                                >
                                    <Menu className={styles["mention-menu"]}>
                                        {mentionState.suggestions.map((item, index) => (
                                            <div
                                                key={item.token}
                                                role="option"
                                                aria-selected={index === mentionState.selectedIndex}
                                                aria-label={item.title}
                                            >
                                                <MenuItem
                                                    icon={item.type === 'skill' ? 'learning' : item.type === "special" ? "citation" : "document"}
                                                    multiline={item.type === 'skill'}
                                                    className={item.type === 'skill' ? styles['skill-menu-item'] : undefined}
                                                    text={item.type === 'skill' ? <span className={styles['skill-menu-content']}>
                                                        <span className={styles['skill-menu-name']}>{renderMentionTitle(item)}</span>
                                                        {item.subtitle && <span className={styles['skill-menu-description']}>{item.subtitle}</span>}
                                                    </span> : renderMentionTitle(item)}
                                                    labelElement={item.type !== 'skill' && item.subtitle ? (
                                                        <span className={styles["mention-menu-path"]}>
                                                            {item.subtitle}
                                                        </span>
                                                    ) : null}
                                                    active={index === mentionState.selectedIndex}
                                                    onMouseDown={(event) => {
                                                        event.preventDefault();
                                                        clearPromptBlurTimeout();
                                                        applyMentionSuggestion(item.insertText);
                                                    }}
                                                />
                                            </div>
                                        ))}
                                    </Menu>
                                    {mentionState.kind === 'skill' && <p style={{fontSize: 12, padding: '4px 8px', margin: 0}}>Tab or click to insert a skill · Esc to dismiss. Variables remain plain text.</p>}
                                </div>
                            </div>
                        )}
                    </div>
                </FormGroup>

                {selectionGuidance && !mentionMenuVisible && (
                    <details className={styles['request-help']} open={eventDocument === document || ['warning', 'danger'].includes(selectionGuidance.intent)}>
                    <summary>Code selection guidance</summary>
                    <Callout
                        intent={selectionGuidance.intent}
                        icon={selectionGuidance.icon}
                        className={styles["selection-guidance"]}
                    >
                        <strong>{selectionGuidance.title}</strong>
                        <div className={styles["selection-guidance-text"]}>
                            {selectionGuidance.message}
                        </div>
                    </Callout>
                    </details>
                )}

                {intentHint && !mentionMenuVisible && (
                    <Callout intent={liveCreateProjectFiles ? "success" : "primary"} icon={liveCreateProjectFiles ? "document" : "predictive-analysis"} className={styles["intent-hint"]}>
                        {intentHint}
                    </Callout>
                )}

                {showLiveIssueDiagnosis && !mentionMenuVisible && (
                    <Callout intent="warning" icon="diagnosis" className={styles["intent-hint"]}>
                        {liveIssueScope.summary}
                    </Callout>
                )}

                <FormGroup label="Changes" labelFor="ai-change-mode">
                    <HTMLSelect id="ai-change-mode" value={autoApply ? "apply" : "review"}
                        onChange={(event) => setAutoApply(event.target.value === "apply")} disabled={isLoading}
                        options={[
                            {label: "Make changes", value: "apply"},
                            {label: "Review first", value: "review"},
                        ]}/>
                    {!mentionMenuVisible && <div style={{marginTop: "8px", fontSize: "12px"}}>
                        {autoApply
                            ? "Requested edits are applied and saved with a restore point. Questions leave your files unchanged."
                            : "Review proposed edits before applying them. Your workspace stays unchanged until you apply."}
                    </div>}
                </FormGroup>

                <FormGroup label="Workspace quality">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        <Button
                            text="Review workspace"
                            icon="endorsed"
                            onClick={() => handleWorkspaceReview(false)}
                            disabled={isLoading || !selectedAssistant}
                            title="Run plugin tests and review the current workspace without changing files"
                        />
                        <Button
                            text="Review & repair"
                            icon="wrench"
                            intent="primary"
                            onClick={() => handleWorkspaceReview(true)}
                            disabled={isLoading || !selectedAssistant}
                            title="Run plugin tests, repair confirmed plugin-local issues, and verify the resulting workspace"
                        />
                    </div>
                    {!mentionMenuVisible && <div style={{ marginTop: "8px", fontSize: "12px" }}>
                        Review workspace keeps files unchanged. Review &amp; repair creates a restore point, applies confirmed plugin-local fixes, and verifies the resulting workspace with plugin tests.
                    </div>}
                </FormGroup>

                <details className={styles['request-help']} open={eventDocument === document}>
                <summary>Keyboard shortcuts</summary>
                {!mentionMenuVisible && (
                <Callout intent="primary" icon="key-command" className={styles["shortcut-hint"]}>
                    <div className={styles["shortcut-list"]}>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.submit} /> submit</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.stop} /> stop</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.autoApply} /> change mode</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.refine} /> refine</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.insert} /> insert</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.execute} /> execute plan</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.clear} /> clear</span>
                    </div>
                </Callout>
                )}

                </details>
                {savedGenerationCheckpoint && !isLoading && <Callout intent={savedGenerationCheckpoint.canResume ? 'primary' : 'warning'} title="Saved generation work" data-testid="saved-generation-checkpoint">
                    <p>{savedGenerationCheckpoint.completedFileCount} validated files saved · {savedGenerationCheckpoint.pendingFileCount} unfinished files. These files are separate from your workspace.</p>
                    {savedGenerationCheckpoint.requiresImage && <p>Resume requires the original reference image. Reattach it after restarting FDO, or replan using your current reference.</p>}
                    {savedGenerationCheckpoint.reason && <p>{savedGenerationCheckpoint.reason}</p>}
                    <Button text={savedGenerationCheckpoint.pendingFileCount ? "Resume unfinished generation" : "Recover saved proposal"} disabled={!savedGenerationCheckpoint.canResume} onClick={handleResumeGenerationCheckpoint}/>
                    <Button text="Retry with smaller scope using saved helpers" disabled={!savedGenerationCheckpoint.canResume} onClick={handleSmallerScopeRetry}/>
                    <Button text="Discard saved generation work" onClick={handleDiscardGenerationCheckpoint}/>
                </Callout>}
                {checkpointError && <Callout intent="danger" role="alert">{checkpointError}{!savedGenerationCheckpoint && !isLoading && <Button text="Discard unreadable checkpoint" onClick={handleDiscardGenerationCheckpoint}/>}</Callout>}
                {['prepared', 'retrying'].includes(generationRecovery.status) && <Callout data-testid="generation-recovery-state" intent="primary" title={generationRecovery.status === 'prepared' ? 'Recovery prompt ready for review' : preparedRecoveryRef.current?.recoveryMode === 'resume' ? 'Resuming saved generation' : 'Generating the smaller-scope retry'}>
                    {generationRecovery.status === 'prepared' ? 'Edit the prompt and Submit when ready. No provider request has been sent.' : 'A new generation attempt is running against your current workspace. You can stop it at any time.'}
                    {generationRecovery.status === 'prepared' && <Button text="Discard recovery draft" onClick={() => {setPrompt(''); clearResponse();}}/>}
                </Callout>}
                {verificationReports.length > 0 && <details data-testid="workspace-verification-report">
                    <summary>Verification · {verificationReports.length} attempt(s)</summary>
                    {verificationReports.map((report, index) => <section key={report.attempt} aria-label={`Verification attempt ${index + 1}`}>
                        <strong>Attempt {index + 1}</strong>
                        <p>Changed files: {report.changedPaths.join(', ')}</p>
                        <ul>{report.checks.map(check => <li key={check.id}>
                            {check.label}: <strong>{check.status}</strong>
                            {check.detail && <details><summary>Details</summary><pre style={{whiteSpace: 'pre-wrap'}}>{check.detail}</pre></details>}
                        </li>)}</ul>
                    </section>)}
                </details>}
                <div className={`${styles["action-buttons"]} ${eventDocument !== document ? styles['floating-actions'] : ''}`}>
                    <Button
                        intent="primary"
                        text={isLoading ? "Processing..." : composerMode === "refine" ? "Continue Thread" : "Submit"}
                        icon={isLoading ? <Spinner size={16} /> : "send-message"}
                        onClick={handleSubmit}
                        disabled={isLoading || !prompt.trim() || !selectedAssistant}
                        fill
                        title={shortcutCombos.submit}
                    />
                    {isLoading && (
                        <Button
                            intent="danger"
                            text="Stop"
                            icon="stop"
                            onClick={handleStopRequest}
                            title={shortcutCombos.stop}
                        />
                    )}
                    {response && !blockIncompleteGeneration && !responseIsReviewReport && !responseApplied && (action === "plan" || expectWorkspaceApplyRef.current || responseHasWorkspaceFiles) && (
                        <>
                            <Button
                                text="Copy Plan"
                                icon="clipboard"
                                onClick={handleCopyPlan}
                                disabled={isLoading}
                            />
                            <Button
                                text="Apply proposed changes"
                                icon="play"
                                onClick={handleExecutePlan}
                                disabled={isLoading}
                                title={shortcutCombos.execute}
                            />
                        </>
                    )}
                    {response && !blockIncompleteGeneration && !responseIsReviewReport && action !== "plan" && !expectWorkspaceApplyRef.current && !responseHasWorkspaceFiles
                        && ((!autoApply && !responseApplied) || responseHasUnappliedCode) && (
                        <Button
                            text="Apply proposed changes"
                            icon="insert"
                            onClick={handleApplyResponse}
                            disabled={isLoading}
                            title={shortcutCombos.insert}
                        />
                    )}
                    {responseIsReviewReport && (
                        <Button text="Review again" icon="refresh" disabled={isLoading}
                            onClick={() => handleWorkspaceReview(false)} />
                    )}
                    {response && (
                        <Button
                            text="Refine Response"
                            icon="lightbulb"
                            onClick={handleRefine}
                            disabled={isLoading}
                            title={shortcutCombos.refine}
                        />
                    )}
                    {response && (
                        <Button
                            text="Clear"
                            icon="cross"
                            onClick={clearResponse}
                            disabled={isLoading}
                            title={shortcutCombos.clear}
                        />
                    )}
                </div>

                {validationRecovery && <Callout intent="warning" title="Unapplied proposal needs repair" data-testid="validation-recovery">
                    <p>The latest candidate and validation diagnostics are kept in this session. Each click requests one focused repair, then validates it before applying changes. You can repeat after a failure or select another assistant.</p>
                    <Button text="Repair failed validation" icon="wrench" loading={isLoading} disabled={isLoading || !selectedAssistant}
                        onClick={handleRepairFailedValidation}/>
                    <Button text="Discard retained proposal" variant="minimal" disabled={isLoading} onClick={() => updateValidationRecovery(null)}/>
                    <p><small>{validationRecovery.attempts} user-requested repair attempt(s). Repair requests use your selected provider and may incur costs.</small></p>
                    <details><summary>Files and latest diagnostics</summary>
                        <p>{validationRecovery.paths.join(', ')}</p>
                        <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{validationRecovery.diagnostics.join('\n')}</pre>
                    </details>
                </Callout>}
                {error && (
                    <div data-testid="ai-coding-error" role="alert" className={styles["error-message"]}>
                        {recoveryFailure ? <Callout intent="warning" title="Generation stopped before changes were applied">
                            <p>The assistant could not complete <code>{recoveryFailure.path}</code> {recoveryFailure.code === 'WORKSPACE_DEPENDENCY_SPLIT_EXHAUSTED' ? 'because stylesheet dependencies remained unresolved after automatic splitting.' : 'within its response limits, even after automatic recovery.'}</p>
                            <p>Your existing workspace is unchanged. {recoveryFailure.resumable ? 'Validated progress is saved in a checkpoint. Resume or replan using Saved generation work.' : 'This attempt has no resumable checkpoint.'} Partial output is not a complete proposal and cannot be applied.</p>
                            <Button text="Retry with smaller scope" icon="refresh" disabled={isLoading || !!(savedGenerationCheckpoint && !savedGenerationCheckpoint.canResume)} onClick={handleSmallerScopeRetry}/>
                            <p><small>This prepares an editable Plan Code prompt. Review which features to keep or defer, then Submit to start a new attempt. You can also select another assistant before submitting.</small></p>
                            <details><summary>Technical details</summary><p>Code: {recoveryFailure.code} · Stage: {recoveryFailure.stage}</p><p>{recoveryFailure.completedFileCount ?? 0} files completed in memory; {recoveryFailure.resumable ? 'these are saved separately for recovery and have not been applied.' : 'these were not applied or saved as a resumable checkpoint.'}</p><pre>{error}</pre></details>
                        </Callout> : renderErrorContent(error)}
                        {!recoveryFailure && isAiCodingOutputLimitError(error) && response && (
                            <Button
                                size="small"
                                icon="refresh"
                                text="Retry as complete response"
                                onClick={handleRetryTruncatedResponse}
                                disabled={isLoading}
                            />
                        )}
                    </div>
                )}

                {operationSummary && (
                    <div className={styles["operation-summary"]}>
                        <Callout intent={operationSummary.intent} icon={operationSummary.intent === "success" ? "endorsed" : "warning-sign"}>
                            <strong>{operationSummary.title}</strong>
                            <p className={styles["operation-summary-text"]}>{operationSummary.message}</p>
                        </Callout>
                    </div>
                )}

                {guideRecovery && guideRecovery.workspace === virtualFS.sandboxName && (
                    <Callout intent="primary" icon="manual" title="Update the plugin guide for this SDK" data-testid="guide-sdk-recovery">
                        <p>No files were changed. Recheck the current workspace, update SKILL.md for the installed SDK, and review the guide before repairs continue.</p>
                        <Button icon="refresh" disabled={isLoading || !selectedAssistant} onClick={() => handleSubmit({prompt: guideRecovery.prompt, action: 'smart', autoApply: true, migrateGuide: true})}>Update guide and resume repair</Button>
                    </Callout>
                )}

                {isLoading && !onActivityChange && eventDocument === document && requestProgress}

                {repairNotice && (
                    <Callout className={styles["repair-notice"]} intent="warning" icon="wrench" title={isLoading ? "Why another AI pass?" : "Repair pass details"} data-testid="ai-coding-repair-notice">
                        <p>{repairNotice.message}</p>
                        <p>Repair scope: {repairNotice.paths.join(', ')}</p>
                        <details>
                            <summary>Errors that triggered this repair</summary>
                            <pre>{repairNotice.diagnostics.join('\n')}</pre>
                        </details>
                    </Callout>
                )}

                {response && (
                    <div className={styles["response-container"]}>
                        <h4>Response:</h4>
                        <AiCodingConfidence confidence={confidence}/>
                        {conversation[conversation.length - 1]?.appliedSnapshot != null && <p>Applied as snapshot {conversation[conversation.length - 1].appliedSnapshot}</p>}
                        <Card data-testid="ai-coding-response" className={styles["response-card"]}>
                            <AiCodingResponse content={response} streaming={isLoading} />
                        </Card>
                    </div>
                )}

                {!response && !error && !isLoading && (
                    <NonIdealState
                        icon="code"
                        title="AI Coding Assistant"
                        description="Select an action and provide a prompt to get AI-powered coding assistance."
                    />
                )}
            </div>
            <Alert
                isOpen={isResetConversationOpen}
                intent="warning"
                icon="trash"
                cancelButtonText="Cancel"
                confirmButtonText="Reset conversation"
                canEscapeKeyCancel
                canOutsideClickCancel
                onCancel={() => setIsResetConversationOpen(false)}
                onConfirm={() => {
                    saveConversation([]);
                    setResponse("");
                    responseRef.current = "";
                    setPrompt("");
                    setError(null);
                    setOperationSummary(null);
                    setIsResetConversationOpen(false);
                }}
            >
                <p>
                    This removes the saved AI conversation for the current plugin workspace from this device.
                    It does not delete files, snapshots, or provider-side data.
                </p>
            </Alert>
            <Dialog isOpen={!!skillReview} title={skillReview?.proposal ? "Fix plugin guide draft" : "Review plugin guide"} canEscapeKeyClose={false} canOutsideClickClose={false} isCloseButtonShown={false} className={styles["guide-review-dialog"]}>
                <div className={styles["guide-review-body"]}>
                    {skillReview?.proposal ? <Callout intent="warning" title="The guide draft needs correction">
                        The assistant could not create a valid guide draft. This JSON is an intermediate format, not SKILL.md. FDO converts its purpose, modules, conventions, verified examples, and acceptance criteria into the Markdown guide. After correction, you will review the actual SKILL.md and approve it before implementation continues.
                    </Callout> : <Callout intent="primary" title="Your approval is needed">Review or edit SKILL.md, the plugin’s implementation guide. The assistant is paused until you approve. Compatibility checks cover SDK contracts; approval confirms your intended behavior.</Callout>}
                    {skillReview?.proposal && <p data-testid="guide-proposal-recovery">Valid sections have been preserved. Ask the assistant to fix the failed sections, or edit the JSON using the field-specific errors below. Validating this draft does not approve SKILL.md.</p>}
                    <label htmlFor="plugin-guide-editor"><strong>{skillReview?.proposal ? "Structured guide draft (JSON)" : "SKILL.md"}</strong></label>
                    <textarea id="plugin-guide-editor" disabled={!!skillReviewAction} aria-label="Plugin guide" value={skillReview?.content || ''} rows={18} maxLength={skillReview?.proposal ? 20000 : 16000}
                        style={{width: '100%', fontFamily: 'monospace'}}
                        onChange={event => { setSkillReviewError(''); setSkillReviewFeedback(''); setSkillReview(current => ({...current, content: event.target.value, report: null})); }} />
                    {skillReview?.report ? <section aria-label="Guide compatibility report">
                        <h4>SDK compatibility</h4><details><summary>Contract details</summary><p>Contract source: <code>{skillReview.report.source}</code></p>
                        <p>SDK {skillReview.report.sdkVersion || 'version unavailable'} · {skillReview.report.migrationRequired ? 'Guide migration / first approval required' : 'Guide matches this SDK'}</p>
                        {skillReview.report.fingerprint && <p>Contract fingerprint: <code>{skillReview.report.fingerprint}</code></p>}</details>
                        {skillReview.report.acceptanceCriteria?.length > 0 && <section aria-label="Acceptance criteria">
                            <strong>Approval includes these acceptance criteria</strong>
                            <ul>{skillReview.report.acceptanceCriteria.map(item => <li key={item.id}>{item.description} — {item.testFile}: {item.testName}</li>)}</ul>
                        </section>}
                        <p>{skillReview.report.unchecked}</p>
                        <ul>{(skillReview.report.findings || []).map((finding, index) => <li key={index}>
                            <strong>{finding.status === 'verified' ? 'API exists' : finding.status === 'conflict' ? 'Conflict' : 'Not verified'}: {finding.reference}</strong>
                            {finding.line && ` (line ${finding.line})`} — {finding.message} {finding.correction}
                        </li>)}</ul>
                    </section> : !skillReviewFeedback && <p>{skillReview?.proposal ? 'Draft validation checks its structure, planned paths, and SDK contracts.' : 'Current edits have not been checked. Approval will validate them again.'}</p>}
                </div>
                <div className={styles["guide-review-footer"]}>
                    {skillReviewAction && <p role="status">{skillReviewAction === 'check' ? 'Checking compatibility…' : skillReviewAction === 'retry' ? 'Requesting another attempt…' : 'Validating your approval…'}</p>}
                    {skillReviewFeedback && <Callout intent="success" role="status">{skillReviewFeedback}</Callout>}
                    {skillReviewError && <Callout intent="danger" role="alert" className={styles["guide-review-error"]}>{skillReviewError}</Callout>}
                    <div className={styles["guide-review-actions"]}>
                        <Button disabled={!!skillReviewAction} loading={skillReviewAction === 'check'} onClick={() => handleGuideReviewAction('check')}>{skillReview?.proposal ? 'Check draft' : 'Check compatibility'}</Button>
                        {skillReview?.proposal && <Button disabled={!!skillReviewAction} loading={skillReviewAction === 'retry'} onClick={() => handleGuideReviewAction('retry')}>Retry failed step</Button>}
                        <Button onClick={handleStopRequest}>Stop and revise request</Button>
                        <Button intent="primary" disabled={!!skillReviewAction} loading={skillReviewAction === 'approve'} data-testid="approve-plugin-guide" onClick={() => handleGuideReviewAction('approve')}>{skillReview?.proposal ? "Validate edited proposal" : "Approve and continue"}</Button>
                    </div>
                    <small>Checking keeps this review open. Stopping returns you to your request. {skillReview?.proposal ? 'Validating continues to guide approval.' : 'Approving resumes implementation with this guide.'}</small>
                </div>
            </Dialog>
            <Dialog
                isOpen={isImagePreviewOpen}
                onClose={() => setIsImagePreviewOpen(false)}
                title={imageName || "Reference image"}
                style={{width: "min(960px, calc(100vw - 32px))"}}
            >
                <div className="bp6-dialog-body" style={{display: "flex", justifyContent: "center", padding: "12px"}}>
                    {imagePreview && <img src={imagePreview} alt={imageName || "UI Mockup"} style={{maxWidth: "100%", maxHeight: "70vh", objectFit: "contain"}} />}
                </div>
            </Dialog>
        </div>
    );
}

// Avoid reparsing/highlighting a growing codebase on every chunk or timer tick.
// Plain text is also safe while Markdown fences and HTML fragments are incomplete.
const AiCodingResponse = React.memo(function AiCodingResponse({content, streaming}) {
    if (streaming) return <pre className={styles["streaming-response"]}>{content}</pre>;
    return <Markdown options={{disableParsingRawHTML: true, overrides: {code: SyntaxHighlightedCode}}}
        className={classnames(styles2["markdown-body"], "markdown-body")}>{content}</Markdown>;
});

function SyntaxHighlightedCode(props) {
    const ref = React.useRef(null);

    React.useEffect(() => {
        if (ref.current && props.className?.includes('lang-') && typeof hljs !== "undefined") {
            // hljs won't reprocess the element unless this attribute is removed
            ref.current.removeAttribute('data-highlighted');
            hljs.highlightElement(ref.current);
        }
    }, [props.className, props.children]);

    return <code {...props} ref={ref}/>;
}
