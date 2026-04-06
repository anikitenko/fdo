import React, {useEffect, useMemo, useRef, useState} from "react";
import {
    Button,
    Callout,
    Card,
    FormGroup,
    HTMLSelect,
    KeyComboTag,
    Menu,
    MenuItem,
    NonIdealState,
    Spinner,
    Switch,
    Tag,
    TextArea,
    useHotkeys,
} from "@blueprintjs/core";
import * as styles from "./AiCodingAgentPanel.module.css";
import * as styles2 from "../ai-chat/MarkdownRenderer.module.scss";
import Markdown from "markdown-to-jsx";
import virtualFS from "./utils/VirtualFS";
import {createVirtualFile} from "./utils/createVirtualFile";
import {formatSdkKnowledgeContext, shouldUseFdoSdkKnowledge} from "../../utils/fdoSdkKnowledge.js";
import {formatExternalReferenceContext, shouldUseExternalReferenceKnowledge} from "../../utils/externalReferenceKnowledge.js";
import {getAiCodingAgentIdleTimeoutMs} from "./utils/aiCodingAgentTimeouts.js";
import {shouldIncludeProjectContext} from "./utils/aiCodingAgentContextPolicy.js";
import {
    buildAiCodingFollowUpDraft,
    buildAiCodingFollowUpPrompt,
    shouldTreatAsAiCodingFollowUp,
} from "./utils/aiCodingAgentFollowup.js";
import {buildAiCodingAgentStatusMessage} from "./utils/aiCodingAgentStatus.js";
import { upsertAiCodingRequestStatus } from "../../utils/aiCodingAgentProgress.js";
import {
    isQuestionLikeAiCodingPrompt,
    mergeAiCodingRouteDecision,
    resolveAiCodingAgentAction,
    shouldUseAiRoutingJudge,
} from "./utils/aiCodingAgentRouting.js";
import {buildProjectFilePlanPrompt, extractProjectFileTargets, shouldCreateProjectFiles} from "./utils/aiCodingAgentFileIntent.js";
import {extractWorkspaceFileReferences, formatWorkspaceReferenceContext, resolveWorkspaceFileReferences} from "./utils/aiCodingAgentWorkspaceRefs.js";
import {buildAiCodingAgentRequestContexts} from "./utils/aiCodingAgentRequestContext.js";
import {buildWorkspaceExecutionPlanPrompt, shouldExecuteWorkspacePlan} from "./utils/aiCodingAgentExecutionIntent.js";
import {validateGeneratedPluginFiles} from "./utils/validateGeneratedPluginFiles.js";
import {parseAiWorkspacePlanResponse, shouldApplyAiResponseToWorkspace} from "./utils/aiCodingAgentPlanResponse.js";
import {buildExecutablePlanRetryPrompt, buildValidationRepairPlanPrompt} from "./utils/aiCodingAgentPlanRepair.js";
import {buildAiCodingProblemsContext} from "./utils/aiCodingAgentProblems.js";
import {buildAiCodingBuildOutputContext} from "./utils/aiCodingAgentBuildOutput.js";
import {applyAiMetadataBlockResponse, decideAiSingleFileApplyStrategy} from "./utils/aiCodingAgentSingleFileApply.js";
import {applyAiSearchReplaceBlocks, parseAiSearchReplaceResponse} from "./utils/aiCodingAgentSearchReplace.js";
import {buildSingleFileApplyRetryPrompt} from "./utils/aiCodingAgentSingleFileRepair.js";
import {classifyAiCodingIssueScope, shouldIncludeIssueDiagnosis} from "./utils/aiCodingAgentIssueScope.js";
import {applyWorkspaceMention, detectWorkspaceMention, getWorkspaceMentionItems} from "./utils/aiCodingAgentMentions.js";
import {detectAiPluginRuntimeIntent} from "./utils/aiCodingAgentPluginRuntimeIntent.js";
import {buildAiCodingRouteJudgeStatus} from "./utils/aiCodingAgentRouteJudgeStatus.js";
import {
    buildAiCodingPluginScopeViolationMessage,
    validateAiCodingPluginScopeRequest,
    validateAiCodingPluginScopeResponse,
} from "./utils/aiCodingAgentPluginScope.js";
import {isAiCodingFastLocalEditPrompt} from "./utils/aiCodingAgentFastPath.js";
import runPluginTests from "./utils/runTests.js";

import hljs from "../../assets/js/hljs/highlight.min"
import "../../assets/css/hljs/xt256.min.css"

import classnames from "classnames";
import {AppToaster} from "../AppToaster.jsx";

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
    const normalizedPrompt = String(prompt || "").trim().toLowerCase();
    const hasExplicitChangeIntent = /\b(create|build|generate|implement|scaffold|add|edit|refactor|rewrite|update|fix|patch|replace|modify|apply|proceed|continue|make|change|rename|set|use|choose|pick)\b/.test(normalizedPrompt);
    const hasScaffoldIntent = /\bplugin\s+like\b/.test(normalizedPrompt)
        || /\bi\s+want\s+(?:a|an)\s+plugin\b/.test(normalizedPrompt);
    const informationalVerificationIntent =
        /\b(confirm|confirmation|verify|verification|check|validate|explain|clarify)\b/.test(normalizedPrompt)
        || /\b(is|does|can)\b.+\b(work|working|correct|correctly|logged|logging)\b/.test(normalizedPrompt)
        || /\bwhy\b/.test(normalizedPrompt)
        || /\bwhat\b.+\bmean|means|difference\b/.test(normalizedPrompt);

    return informationalVerificationIntent && !hasExplicitChangeIntent && !hasScaffoldIntent;
}

export function shouldAutoApplySingleFileResponse({
    action = "",
    prompt = "",
    selectedCode = "",
    targetFilePath = "",
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
    return hasExplicitChangeIntent || hasScaffoldIntent;
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

    if (resolvedAction === "fix") {
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

    const predictedIntent = createProjectFiles || resolvedAction === "plan"
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

    const selectionMode = createProjectFiles || resolvedAction === "plan"
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

    const expectedResult = createProjectFiles || resolvedAction === "plan"
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

export default function AiCodingAgentPanel({ codeEditor, response, setResponse, onActivityChange }) {
    const [action, setAction] = useState("smart");
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [autoApply, setAutoApply] = useState(false);
    const [assistants, setAssistants] = useState([]);
    const [selectedAssistant, setSelectedAssistant] = useState(null);
    const [loadingAssistants, setLoadingAssistants] = useState(true);
    const [composerMode, setComposerMode] = useState(null);
    const [uploadedImage, setUploadedImage] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [operationSummary, setOperationSummary] = useState(null);
    const [requestStatusEntries, setRequestStatusEntries] = useState([]);
    const responseRef = useRef("");
    const timeoutRef = useRef(null);
    const streamingRequestIdRef = useRef(null);
    const autoApplyRef = useRef(autoApply);
    const fileInputRef = useRef(null);
    const pendingAutoFileCreateRef = useRef(false);
    const expectWorkspaceApplyRef = useRef(false);
    const planRetryInFlightRef = useRef(false);
    const applyActionRef = useRef("");
    const currentRequestRef = useRef(null);
    const singleFileRetryInFlightRef = useRef(false);
    const multiFileRetryInFlightRef = useRef(false);
    const scopeRetryInFlightRef = useRef(false);
    const panelRef = useRef(null);
    const panelContentRef = useRef(null);
    const cancelledRequestIdsRef = useRef(new Set());
    const promptInputRef = useRef(null);
    const promptBlurTimeoutRef = useRef(null);
    const [mentionState, setMentionState] = useState(null);
    const lastPluginTraceToastRef = useRef({key: "", at: 0});

    const clearRequestTimeout = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
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

    const pushRequestStatus = (message, metadata = {}) => {
        const normalizedMessage = String(message || "").trim();
        if (!normalizedMessage) return;
        setRequestStatusEntries((existing) => upsertAiCodingRequestStatus(existing, normalizedMessage, metadata));
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
            setError("Request timed out. The AI service may be unavailable. Please try again.");
            setIsLoading(false);
            streamingRequestIdRef.current = null;
            cancelledRequestIdsRef.current.clear();
            timeoutRef.current = null;
        }, timeoutMs);
    };

    // Load available coding assistants
    useEffect(() => {
        async function loadAssistants() {
            try {
                setLoadingAssistants(true);
                const allAssistants = await window.electron.settings.ai.getAssistants();
                const codingAssistants = allAssistants.filter(a => a.purpose === 'coding');
                setAssistants(codingAssistants);
                
                // Select default or first assistant
                const defaultAssistant = codingAssistants.find(a => a.default);
                setSelectedAssistant(defaultAssistant || codingAssistants[0] || null);
            } catch (err) {
                console.error('Failed to load assistants:', err);
                setError('Failed to load AI assistants. Please check your settings.');
            } finally {
                setLoadingAssistants(false);
            }
        }
        loadAssistants();
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

    useEffect(() => {
        if (typeof onActivityChange !== "function") {
            return;
        }

        const latestStatus = requestStatusEntries[requestStatusEntries.length - 1]?.message || "";
        onActivityChange({
            isLoading,
            hasResponse: !!response,
            error: error || "",
            latestStatus,
        });
    }, [onActivityChange, isLoading, requestStatusEntries, response, error]);

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
        // Create handler functions
        const handleStreamDelta = (data) => {
            if (cancelledRequestIdsRef.current.has(data.requestId)) {
                return;
            }
            if (data.requestId !== streamingRequestIdRef.current) {
                return;
            }

            if (data.type === "heartbeat") {
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

            console.log('[AI Coding Agent] Stream content received', {
                requestId: data.requestId,
                contentLength: data.content ? data.content.length : 0,
            });

            // Robust validation: only process if requestId matches AND content is valid
            if (data.content && 
                typeof data.content === 'string' &&
                data.content.length > 0 &&
                /\S/.test(data.content)) {  // Must contain at least one non-whitespace character
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                responseRef.current += data.content;
                setResponse(responseRef.current);
                console.log('[AI Coding Agent] Response updated', { totalLength: responseRef.current.length });
            }
        };

        const handleStreamDone = (data) => {
            if (cancelledRequestIdsRef.current.has(data.requestId)) {
                clearRequestTimeout();
                cancelledRequestIdsRef.current.delete(data.requestId);
                return;
            }
            const match = !streamingRequestIdRef.current || data.requestId === streamingRequestIdRef.current;
            if (!match) {
                console.warn("[AI Coding Agent] Stream done mismatch", data.requestId);
                return;
            }
            // ALWAYS clear timeout FIRST (critical to prevent timeout errors)
            clearRequestTimeout();
            console.log('[AI Coding Agent] Timeout cleared');
            console.log('[AI Coding Agent] Stream done', { requestId: data.requestId, streamingRequestId: streamingRequestIdRef.current });

            console.log('[AI Coding Agent] Completing stream');
            setRequestStatusEntries([]);
            responseRef.current = data.fullContent;
            setResponse(data.fullContent);
            setIsLoading(false);

        };

        const handleStreamError = (data) => {
            console.error('[AI Coding Agent] Stream error', data);
            if (cancelledRequestIdsRef.current.has(data.requestId)) {
                clearRequestTimeout();
                cancelledRequestIdsRef.current.delete(data.requestId);
                return;
            }
            if (data.requestId === streamingRequestIdRef.current) {
                setError(data.error);
                setIsLoading(false);
                setRequestStatusEntries([]);
                streamingRequestIdRef.current = null;
                
                // Clear timeout
                clearRequestTimeout();
            }
        };

        const handleStreamCancelled = (data) => {
            if (!cancelledRequestIdsRef.current.has(data.requestId) && data.requestId !== streamingRequestIdRef.current) {
                return;
            }
            clearRequestTimeout();
            cancelledRequestIdsRef.current.delete(data.requestId);
            if (data.requestId === streamingRequestIdRef.current) {
                streamingRequestIdRef.current = null;
            }
            setIsLoading(false);
            setRequestStatusEntries([]);
            setOperationSummary({
                intent: "warning",
                title: "AI Request Stopped",
                message: data.message || "The AI request was stopped before any changes were applied.",
            });
            setError(null);
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

    const formatMentionSuggestion = (filePath) => {
        const normalized = String(filePath || "").replace(/^[/\\]+/, "");
        const segments = normalized.split("/");
        const basename = segments.pop() || normalized;
        const directory = segments.join("/");
        return {
            basename,
            directory,
        };
    };

    const updateMentionSuggestions = (text, cursorIndex) => {
        const mention = detectWorkspaceMention(text, cursorIndex);
        if (!mention || !mention.query.trim()) {
            setMentionState(null);
            return;
        }

        const currentFileModel = codeEditor?.getModel?.();
        const currentFilePath = currentFileModel && typeof virtualFS.getFileName === "function"
            ? virtualFS.getFileName(currentFileModel) || ""
            : "";
        const suggestions = getWorkspaceMentionItems(getAllProjectFiles(), mention.query, currentFilePath);
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
        if (item.type === "special") {
            const titleText = String(item.title || "");
            const marker = titleText.startsWith("@") ? "@" : "";
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
                .split(/\s*;\s*/)
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

        return (
            <Callout intent="danger" icon="warning-sign">
                {message}
            </Callout>
        );
    };

    const applyMentionSuggestion = (insertText) => {
        if (!mentionState || !insertText) return;
        const applied = applyWorkspaceMention(prompt, mentionState, insertText);
        setPrompt(applied.value);
        setMentionState(null);
        requestAnimationFrame(() => {
            const input = promptInputRef.current;
            if (!input) return;
            input.focus();
            if (typeof input.setSelectionRange === "function") {
                input.setSelectionRange(applied.cursorIndex, applied.cursorIndex);
            }
        });
    };

    const getProblemsContext = () => {
        try {
            const currentModel = codeEditor?.getModel?.() || null;
            const models = currentModel ? [currentModel] : virtualFS.listModels();
            return buildAiCodingProblemsContext(models);
        } catch (err) {
            console.error('[AI Coding Agent] Error getting problems context', err);
            return "";
        }
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
            const result = await window.electron.system.getFdoSdkKnowledge(query, 6);
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
        try {
            const tabs = virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => ({ id: t.id, active: t.active }));
            const created = virtualFS.fs.create(previousVersion, tabs, { quiet: true });
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
        streamingRequestIdRef.current = retryRequestId;
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
        streamingRequestIdRef.current = retryRequestId;
        responseRef.current = "";
        setResponse("");
        setIsLoading(true);
        scheduleRequestTimeout(selectedAssistant?.provider || "");
        pushRequestStatus(
            `Requesting executable multi-file changes for ${normalizedMentionedPaths.join(", ")}.`,
            { phase: "multi-file-retry" },
        );

        return await window.electron.aiCodingAgent.planCode({
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
        streamingRequestIdRef.current = retryRequestId;
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
    } = {}) => {
        let testRunResult = await runPluginTests();
        if (testRunResult?.success) {
            const summary = testRunResult.skipped
                ? "No plugin tests were found, so there were no failures to investigate."
                : "Plugin tests passed. There were no failing tests to investigate.";
            setResponse(summary);
            setOperationSummary({
                intent: testRunResult.skipped ? "warning" : "success",
                title: testRunResult.skipped ? "No Tests Found" : "Tests Passed",
                message: summary,
            });
            setIsLoading(false);
            return true;
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
                streamingRequestIdRef.current = requestId;
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
                ? `${issueScope.summary}\nTreat this as a ${issueScope.kind} issue unless the provided code or diagnostics prove otherwise.\n\n`
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

            streamingRequestIdRef.current = requestId;
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
                    setError(null);
                } else {
                    setError(`Auto-apply could not update workspace files. Errors: ${execution.errorDetails.join('; ')}`);
                }
            } catch (err) {
                setError(err.message || "Failed to auto-apply workspace changes.");
            }
            return { success: true, mode: "workspace" };
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
        requestAnimationFrame(() => {
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

    const handleImageUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            setError('Please upload an image file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Image = e.target.result;
            setUploadedImage(base64Image);
            setImagePreview(URL.createObjectURL(file));
            console.log('[AI Coding Agent] Image uploaded', { size: file.size, type: file.type });
        };
        reader.onerror = () => {
            setError('Failed to read image file');
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveImage = () => {
        setUploadedImage(null);
        if (imagePreview) {
            URL.revokeObjectURL(imagePreview);
        }
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        console.log('[AI Coding Agent] Image removed');
    };

    const handlePanelKeyDown = (event) => {
        if (mentionState?.suggestions?.length) {
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
            if ((event.key === "Enter" || event.key === "Tab") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                const selectedItem = mentionState.suggestions[mentionState.selectedIndex] || mentionState.suggestions[0];
                applyMentionSuggestion(selectedItem?.insertText || "");
                return;
            }
        }

        if (event.key === "Escape") {
            event.preventDefault();
            if (mentionState) {
                setMentionState(null);
                return;
            }
            if (isLoading) {
                handleStopRequest();
            }
            return;
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
            label: "Toggle auto-apply",
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
            label: "Insert into editor",
            allowInInput: true,
            preventDefault: true,
            onKeyDown: () => {
                if (!isLoading && response && !autoApply && action !== "plan") {
                    insertCodeIntoEditor();
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
    ]), [shortcutCombos, isLoading, prompt, selectedAssistant, response, autoApply, action]);

    const { handleKeyDown: handleHotkeyKeyDown, handleKeyUp: handleHotkeyKeyUp } = useHotkeys(hotkeyConfigs);

    const handlePanelKeyDownWithHotkeys = (event) => {
        handlePanelKeyDown(event);
        if (!event.defaultPrevented) {
            handleHotkeyKeyDown(event);
        }
    };

    const handleStopRequest = async () => {
        const activeRequestId = streamingRequestIdRef.current;
        if (!activeRequestId) {
            return;
        }

        cancelledRequestIdsRef.current.add(activeRequestId);
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

    const handleCopyPlan = () => {
        if (!response) return;
        navigator.clipboard.writeText(response);
        console.log('[AI Coding Agent] Plan copied to clipboard');
    };

    const handleExecutePlan = async () => {
        if (!response) return;

        console.log('[AI Coding Agent] Executing plan...');
        setIsLoading(true);
        setError(null);
        setOperationSummary(null);

        try {
            const execution = await executePlanResponse(response, {
                createSnapshot: true,
                allowValidationRetry: true,
            });
            if (execution.successCount > 0) {
                const message = `Created ${execution.successCount} file(s) in the virtual workspace${execution.errorCount > 0 ? `, ${execution.errorCount} issue(s)` : ''}.`;
                setOperationSummary({
                    intent: execution.errorCount > 0 ? "warning" : "success",
                    title: "Plan Applied",
                    message: execution.errorDetails.length > 0
                        ? `${message} ${execution.errorDetails.join(' ; ')}`
                        : message,
                });
                setError(null);
                handleRemoveImage();
            } else {
                setError(`Failed to create any files from the plan. Errors: ${execution.errorDetails.join('; ')}`);
            }
        } catch (err) {
            console.error('[AI Coding Agent] Error executing plan:', err);
            setError(`Failed to execute plan: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const executePlanResponse = async (
        planResponse,
        {
            createSnapshot = true,
            allowValidationRetry = true,
        } = {},
    ) => {
        if (!planResponse) return { successCount: 0, errorCount: 0, errorDetails: ["Empty response"] };

        if (createSnapshot) {
            const snapshot = createSnapshotBeforeApply();
            if (!snapshot) {
                throw new Error('Failed to create snapshot before applying plan');
            }
        }

        const { files, invalidPaths } = parseAiWorkspacePlanResponse(planResponse);
        const pluginValidation = validateGeneratedPluginFiles(files);
        if (files.length === 0) {
            const invalidDetail = invalidPaths.length > 0
                ? ` Invalid paths: ${invalidPaths.join(', ')}`
                : "";
            throw new Error(`No valid workspace files found in the AI response. The response must contain workspace file sections.${invalidDetail}`);
        }
        if (pluginValidation.errors.length > 0) {
            if (allowValidationRetry && selectedAssistant?.id) {
                const retryPrompt = buildValidationRepairPlanPrompt({
                    originalPrompt: currentRequestRef.current?.prompt || prompt || "",
                    invalidResponse: planResponse,
                    validationErrors: pluginValidation.errors,
                });
                const retryRequestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                streamingRequestIdRef.current = retryRequestId;
                responseRef.current = "";
                setResponse("");
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                pushRequestStatus(
                    "Generated plan failed plugin validation. Requesting corrected plugin-local files and node:test-compatible tests.",
                    { phase: "plan-retry-validation" },
                );
                const retryResult = await window.electron.aiCodingAgent.planCode({
                    requestId: retryRequestId,
                    prompt: retryPrompt,
                    image: uploadedImage,
                    context: currentRequestRef.current?.context || "",
                    assistantId: selectedAssistant.id,
                });
                if (retryResult?.success && retryResult?.content) {
                    return await executePlanResponse(retryResult.content, {
                        createSnapshot: false,
                        allowValidationRetry: false,
                    });
                }
            }
            throw new Error(`Generated plugin files failed validation: ${pluginValidation.errors.join(' ; ')}`);
        }

        const folders = new Set();
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

        let successCount = 0;
        let errorCount = 0;
        const errorDetails = [];

        for (const file of files) {
            try {
                createVirtualFile(file.path, file.content);
                successCount++;
            } catch (err) {
                errorCount++;
                errorDetails.push(`${file.path}: ${err.message}`);
            }
        }

        if (invalidPaths.length > 0) {
            errorCount += invalidPaths.length;
            errorDetails.push(...invalidPaths.map((filePath) => `${filePath}: invalid workspace path`));
        }
        if (pluginValidation.warnings.length > 0) {
            errorDetails.push(...pluginValidation.warnings);
        }

        return { successCount, errorCount, errorDetails };
    };
    
    const handleSubmit = async () => {
        if (!prompt.trim()) return;
        
        // Validate assistant is selected
        if (!selectedAssistant) {
            setError("No coding assistant selected. Please select one from the dropdown or add one in Settings.");
            return;
        }

        const projectFiles = getAllProjectFiles();
        const followUpMode = shouldTreatAsAiCodingFollowUp({
            prompt,
            previousResponse: response,
            forceFollowUp: composerMode === "refine",
        });
        const createProjectFilesCandidate = shouldCreateProjectFiles({
            prompt,
            previousResponse: response,
            workspaceFiles: projectFiles,
        });
        const executeWorkspacePlanCandidate = shouldExecuteWorkspacePlan({
            prompt,
            previousResponse: response,
            workspaceFiles: projectFiles,
        });
        if (followUpMode) {
            console.log('[AI Coding Agent] Submitting follow-up with prior response context', { composerMode });
        }

        setIsLoading(true);
        setError(null);
        setResponse("");
        setRequestStatusEntries([]);
        responseRef.current = "";
        setOperationSummary(null);
        scopeRetryInFlightRef.current = false;
        
        setComposerMode(null);

        try {
            const selectedCode = getSelectedCode();
            const refreshedProjectFiles = getAllProjectFiles();
            const derivedFailingFile = !selectedCode
                ? (
                    findLikelyFailingWorkspaceFile(refreshedProjectFiles)
                    || (
                        /tests?\s+(?:are|is)\s+failing|failing tests?|tests?\s+issue|run tests?.*investigate|investigate.*tests?/i.test(prompt)
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
                prompt,
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
                requestedAction: (createProjectFilesCandidate || executeWorkspacePlanCandidate) ? "plan" : action,
                prompt,
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
                shouldUseAiRoutingJudge({
                    requestedAction: action,
                    prompt,
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
                        prompt,
                        previousResponse: safePreviousResponse,
                        selectedCode: effectiveSelectedCode,
                        requestedAction: action,
                        deterministicAction: resolvedAction,
                        createProjectFiles: createProjectFilesCandidate,
                        executeWorkspacePlan: executeWorkspacePlanCandidate,
                    });
                    routingDecision = mergeAiCodingRouteDecision({
                        requestedAction: action,
                        prompt,
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

            const createProjectFiles = routingDecision.createProjectFiles && routingDecision.action === "plan";
            const executeWorkspacePlan = routingDecision.executeWorkspacePlan && routingDecision.action === "plan";
            let finalPrompt = buildAiCodingFollowUpPrompt({
                prompt,
                previousResponse: safePreviousResponse,
                forceFollowUp: composerMode === "refine",
            });
            if (createProjectFiles) {
                finalPrompt = buildProjectFilePlanPrompt({
                    prompt,
                    previousResponse: safePreviousResponse,
                    workspaceFiles: projectFiles,
                });
            } else if (executeWorkspacePlan) {
                finalPrompt = buildWorkspaceExecutionPlanPrompt({
                    prompt,
                    previousResponse: safePreviousResponse,
                });
            }

            const effectiveAction = isInformationalOnlyPrompt(finalPrompt) && routingDecision.action !== "plan"
                ? "smart"
                : routingDecision.action;
            pendingAutoFileCreateRef.current = createProjectFiles || executeWorkspacePlan || effectiveAction === "plan";
            expectWorkspaceApplyRef.current = effectiveAction === "plan";
            applyActionRef.current = effectiveAction;

            if (shouldRunTestsBeforeAiRequest(finalPrompt) && !autoApplyRef.current) {
                pushRequestStatus(
                    "Auto-apply is off. Tests will be diagnosed, but fixes will not be applied and rerun automatically.",
                    { phase: "tests" },
                );
            }

            if (shouldRunTestsBeforeAiRequest(finalPrompt) && autoApplyRef.current && !createProjectFiles && !executeWorkspacePlan) {
                pushRequestStatus("Running plugin tests before diagnosing errors.", { phase: "tests" });
                await runIterativeTestRepairFlow({
                    basePrompt: finalPrompt,
                    language: getLanguage(),
                    assistantId: selectedAssistant.id,
                });
                return;
            }

            if (shouldRunTestsBeforeAiRequest(finalPrompt)) {
                pushRequestStatus("Running plugin tests before diagnosing errors.", { phase: "tests" });
                const testRunResult = await runPluginTests();
                if (testRunResult?.success) {
                    const summary = testRunResult.skipped
                        ? "No plugin tests were found, so there were no test failures to investigate."
                        : "Plugin tests passed. There were no failing tests to investigate.";
                    setResponse(summary);
                    setIsLoading(false);
                    return;
                }
                pushRequestStatus("Plugin tests failed. Reviewing the failing output and related workspace files.", { phase: "tests" });
            }

            console.log('[AI Coding Agent] Submit started', {
                action,
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
            const currentPluginId = getCurrentPluginId();
            const runtimeIntent = detectAiPluginRuntimeIntent(finalPrompt);
            const runtimeProbeResult = runtimeIntent.shouldProbe
                ? await runPluginRuntimeProbe({
                    promptText: finalPrompt,
                    pluginId: currentPluginId,
                })
                : { context: "", traceResult: null };
            const pluginLogsContext = runtimeIntent.shouldProbe || runtimeIntent.wantsLogs
                ? await getPluginLogsContext({
                    preloadedTraceResult: runtimeProbeResult?.traceResult || null,
                })
                : "";
            const pluginRuntimeActionContext = runtimeProbeResult?.context || "";
            const issueScope = classifyAiCodingIssueScope({
                prompt: finalPrompt,
                selectedCode: effectiveSelectedCode,
                problemsContext: `${problemsContext}${buildOutputContext}`,
            });
            const sdkKnowledgeEnabled = shouldUseFdoSdkKnowledge({
                action: effectiveAction,
                prompt: finalPrompt,
                code: effectiveSelectedCode,
                error: action === "fix" ? prompt : "",
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
                extractWorkspaceFileReferences(prompt, refreshedProjectFiles),
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
                includeProjectContext,
                projectFiles: refreshedProjectFiles,
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
            const enhancedContext = requestContexts.projectContext;
            const diagnosisContext = includeIssueDiagnosis && issueScope.summary
                ? `${issueScope.summary}\nTreat this as a ${issueScope.kind} issue unless the provided code or diagnostics prove otherwise.\n\n`
                : "";
            const finalEnhancedContext = `${diagnosisContext}${enhancedContext}`;
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
                prompt: finalPrompt,
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
            streamingRequestIdRef.current = requestId;
            console.log('[AI Coding Agent] Request ID set', requestId);
            // Start the inactivity timeout only when the actual AI request begins.
            scheduleRequestTimeout(selectedAssistant?.provider || "");
            pushRequestStatus(buildAiCodingAgentStatusMessage({
                phase: "generation",
                externalReferenceEnabled,
                sdkKnowledgeEnabled,
                includeProjectContext,
                issueDiagnosis: includeIssueDiagnosis ? issueScope.summary : "",
            }) + (effectiveAction !== action
                ? `\nMode: ${effectiveAction === "plan" ? "Plan Code" : effectiveAction}.`
                : ""), { phase: "generation" });

            let result;
            switch (effectiveAction) {
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
                        error: prompt,
                        language,
                        context: requestContexts.referenceContext,
                        assistantId: selectedAssistant.id,
                        targetFilePath: derivedFailingFilePath || "",
                    });
                    break;
                case "plan":
                    result = await window.electron.aiCodingAgent.planCode({
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
                streamingRequestIdRef.current = retryRequestId;
                responseRef.current = "";
                setResponse("");
                setIsLoading(true);
                scheduleRequestTimeout(selectedAssistant?.provider || "");
                pushRequestStatus(
                    "Plan response was prose-only. Requesting executable workspace file sections.",
                    { phase: "plan-retry" },
                );
                return await window.electron.aiCodingAgent.planCode({
                    requestId: retryRequestId,
                    prompt: retryPrompt,
                    image: uploadedImage,
                    context: requestContexts.referenceContext,
                    assistantId: selectedAssistant.id,
                });
            };

            console.log('[AI Coding Agent] IPC result received', result);

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

            if (result && result.success && result.requestId) {
                console.log('[AI Coding Agent] Request successful, streaming complete', { requestId: result.requestId });
                // Request ID already set before IPC call, streaming events should have flowed
                // Verify requestId matches
                if (result.requestId !== requestId) {
                    console.warn('[AI Coding Agent] RequestId mismatch in result', { expected: requestId, received: result.requestId });
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
                    autoApplyRef.current &&
                    !pendingAutoFileCreateRef.current &&
                    effectiveAction !== "plan" &&
                    !currentRequestRef.current?.diagnosticFallback
                ) {
                    const allowSingleFileAutoApply = shouldAutoApplySingleFileResponse({
                        action: effectiveAction,
                        prompt: currentRequestRef.current?.prompt || finalPrompt,
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
                    try {
                        const execution = await executePlanResponse(result.content || responseRef.current);
                        if (execution.successCount > 0) {
                            const message = `Created ${execution.successCount} file(s) in the virtual workspace${execution.errorCount > 0 ? `, ${execution.errorCount} failed` : ''}.`;
                            setOperationSummary({
                                intent: execution.errorCount > 0 ? "warning" : "success",
                                title: "Files Created",
                                message,
                            });
                            setError(null);
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
            console.error('[AI Coding Agent] Exception in handleSubmit', err);
            setError(err.message || "An error occurred");
            setIsLoading(false);
            clearRequestTimeout();
            expectWorkspaceApplyRef.current = false;
            planRetryInFlightRef.current = false;
            singleFileRetryInFlightRef.current = false;
            multiFileRetryInFlightRef.current = false;
            scopeRetryInFlightRef.current = false;
        }
    };

    const handlePromptChange = (event) => {
        const nextValue = event.target.value;
        const selectionStart = typeof event.target.selectionStart === "number" ? event.target.selectionStart : nextValue.length;
        setPrompt(nextValue);
        updateMentionSuggestions(nextValue, selectionStart);
    };

    const handlePromptCursorActivity = (event) => {
        const nextValue = event.target.value;
        const selectionStart = typeof event.target.selectionStart === "number" ? event.target.selectionStart : nextValue.length;
        updateMentionSuggestions(nextValue, selectionStart);
    };

    const insertCodeIntoEditor = (contentOverride = "") => {
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
        const nextFileText = codeToInsert;
        const appliedSummary = buildAppliedChangeSummary({
            filePath: targetFilePath || currentModelPath,
            beforeText: currentFileText,
            afterText: nextFileText,
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

    const clearResponse = () => {
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
    const mentionMenuVisible = !!mentionState?.suggestions?.length;

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
                            </div>
                        }
                    />
                </div>
            </div>
        );
    }

    return (
        <div
            className={styles["ai-coding-agent-panel"]}
            ref={panelRef}
            onKeyDown={handlePanelKeyDownWithHotkeys}
            onKeyUp={handleHotkeyKeyUp}
            tabIndex={0}
        >
            <div className={styles["panel-header"]}>
                <h3>AI Coding Agent</h3>
                <div className={styles["panel-header-tags"]}>
                    <Tag minimal intent="success">
                        Plugin Scope Only
                    </Tag>
                    <Tag minimal intent="primary">
                        Beta
                    </Tag>
                </div>
            </div>

            <div className={styles["panel-content"]} ref={panelContentRef}>
                <FormGroup label="AI Assistant" labelFor="assistant-select">
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
                                {assistant.name} ({assistant.provider} - {assistant.model})
                                {assistant.default ? ' ★' : ''}
                            </option>
                        ))}
                    </HTMLSelect>
                </FormGroup>

                <FormGroup label="Action" labelFor="action-select">
                    <HTMLSelect
                        id="action-select"
                        value={action}
                        onChange={(e) => setAction(e.target.value)}
                        options={AI_ACTIONS}
                        fill
                    />
                </FormGroup>

                {smartModeGuidance && !mentionMenuVisible && (
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
                )}

                {action === "plan" && (
                    <FormGroup label="UI Mockup (Optional)" labelInfo="Upload an image for AI to analyze">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            style={{ display: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                            <Button
                                icon="camera"
                                text="Upload Image"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isLoading}
                            />
                            {imagePreview && (
                                <div style={{ flex: 1 }}>
                                    <img 
                                        src={imagePreview} 
                                        alt="UI Mockup" 
                                        style={{ 
                                            maxWidth: '200px', 
                                            maxHeight: '150px', 
                                            borderRadius: '4px',
                                            border: '1px solid #ccc'
                                        }} 
                                    />
                                    <Button
                                        icon="cross"
                                        variant={"minimal"}
                                        size={"small"}
                                        onClick={handleRemoveImage}
                                        disabled={isLoading}
                                        style={{ marginTop: '4px' }}
                                    />
                                </div>
                            )}
                        </div>
                    </FormGroup>
                )}

                <FormGroup label={promptLabel} labelFor="prompt-input">
                    <div className={styles["prompt-input-wrap"]}>
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
                            disabled={isLoading}
                        />
                        {mentionState?.suggestions?.length > 0 && (
                            <div className={styles["mention-menu-shell"]}>
                                <div
                                    className={styles["mention-menu-a11y"]}
                                    role="listbox"
                                    aria-label="Workspace file suggestions"
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
                                                    icon={item.type === "special" ? "citation" : "document"}
                                                    text={renderMentionTitle(item)}
                                                    labelElement={item.subtitle ? (
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
                                </div>
                            </div>
                        )}
                    </div>
                </FormGroup>

                {selectionGuidance && !mentionMenuVisible && (
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
                )}

                {intentHint && !mentionMenuVisible && (
                    <Callout intent={liveCreateProjectFiles ? "success" : "primary"} icon={liveCreateProjectFiles ? "document" : "predictive-analysis"} className={styles["intent-hint"]}>
                        {intentHint}
                    </Callout>
                )}

                {liveIssueScope.summary && !mentionMenuVisible && (
                    <Callout intent="warning" icon="diagnosis" className={styles["intent-hint"]}>
                        {liveIssueScope.summary}
                    </Callout>
                )}

                <FormGroup>
                    <Switch
                        checked={autoApply}
                        label="Auto-apply generated changes to the editor or virtual workspace (keeps a restore point and saves the result)"
                        onChange={(e) => setAutoApply(e.target.checked)}
                        disabled={isLoading}
                    />
                    {autoApply && !mentionMenuVisible && (
                        <Callout intent="primary" style={{ marginTop: '8px', fontSize: '12px' }}>
                            Single-file responses will be inserted into the current editor selection. Multi-file plan responses will be applied to the virtual workspace. FDO keeps a restore point before each apply and saves the updated workspace as the new current state.
                        </Callout>
                    )}
                </FormGroup>

                {!mentionMenuVisible && (
                <Callout intent="primary" icon="key-command" className={styles["shortcut-hint"]}>
                    <div className={styles["shortcut-list"]}>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.submit} /> submit</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.stop} /> stop</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.autoApply} /> auto-apply</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.refine} /> refine</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.insert} /> insert</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.execute} /> execute plan</span>
                        <span className={styles["shortcut-item"]}><KeyComboTag combo={shortcutCombos.clear} /> clear</span>
                    </div>
                </Callout>
                )}

                <div className={styles["action-buttons"]}>
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
                    {response && action === "plan" && (
                        <>
                            <Button
                                text="Copy Plan"
                                icon="clipboard"
                                onClick={handleCopyPlan}
                                disabled={isLoading}
                            />
                            <Button
                                text="Execute Plan"
                                icon="play"
                                onClick={handleExecutePlan}
                                disabled={isLoading}
                                title={shortcutCombos.execute}
                            />
                        </>
                    )}
                    {response && !autoApply && action !== "plan" && (
                        <Button
                            text="Insert into Editor"
                            icon="insert"
                            onClick={insertCodeIntoEditor}
                            disabled={isLoading}
                            title={shortcutCombos.insert}
                        />
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

                {error && (
                    <div className={styles["error-message"]}>
                        {renderErrorContent(error)}
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

                {isLoading && requestStatusEntries.length > 0 && !response && (
                    <div className={styles["loading-indicator"]}>
                        <Callout intent="primary" icon={<Spinner size={20} />}>
                            <strong>Processing your request...</strong>
                            <div className={styles["request-status-list"]}>
                                {requestStatusEntries.map((entry) => (
                                    <p key={entry.id} className={styles["request-status-item"]}>
                                        {entry.message}
                                    </p>
                                ))}
                            </div>
                        </Callout>
                    </div>
                )}

                {isLoading && requestStatusEntries.length === 0 && !response && (
                    <div className={styles["loading-indicator"]}>
                        <Callout intent="primary" icon={<Spinner size={20} />}>
                            <strong>Processing your request...</strong>
                            <p style={{ margin: '4px 0 0 0', fontSize: '12px' }}>
                                The AI is analyzing your prompt and generating a response. This may take a few moments.
                            </p>
                        </Callout>
                    </div>
                )}

                {response && (
                    <div className={styles["response-container"]}>
                        <h4>Response:</h4>
                        {isLoading && requestStatusEntries.length > 0 && (
                            <div className={styles["loading-indicator"]} style={{ marginBottom: '12px' }}>
                                <Callout intent="primary" icon={<Spinner size={16} />}>
                                    <div className={styles["request-status-list"]}>
                                        {requestStatusEntries.map((entry) => (
                                            <p key={entry.id} className={styles["request-status-item"]}>
                                                {entry.message}
                                            </p>
                                        ))}
                                    </div>
                                </Callout>
                            </div>
                        )}
                        <Card className={styles["response-card"]}>
                            <Markdown
                                children={response}
                                options={{
                                    disableParsingRawHTML: true,
                                    overrides: {
                                        code: SyntaxHighlightedCode,
                                    },
                                }}
                                className={classnames(styles2["markdown-body"], "markdown-body")}
                            />
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
        </div>
    );
}

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
