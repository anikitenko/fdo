import * as styles from "../css/AiChatDialog.module.css";
import {
    Button,
    Classes,
    ControlGroup,
    Dialog,
    FormGroup,
    HTMLSelect,
    Icon,
    Tooltip,
    Tag,
    Switch,
    Popover,
    Spinner, NonIdealState, Slider, MenuDivider, MenuItem, Menu
} from "@blueprintjs/core";
import {AppToaster} from "../AppToaster";
import React, {useEffect, useMemo, useRef, useState} from "react";
import MarkdownRenderer from "./MarkdownRenderer";
import AttachFromUrlDialog from "./components/AttachFromUrlDialog";
import {shortenUrl} from "./utils/shortenUrl";

const costUsageTooltip = (
    inputTokens, outputTokens, local, totalTokens, inputCost, outputCost, totalCost
) => {
    const formatCost = (value) => `$${value.toFixed(5)}`;
    const formatTokens = (num) =>
        num >= 1000 ? `${(num / 1000).toFixed(1)}K` : num.toString();
    if (!inputTokens && !outputTokens && !local && !totalTokens && !inputCost && !outputCost && !totalCost) return null
    return (
        <div>
            <div>Input tokens: {formatTokens(inputCost)}</div>
            <div>Output tokens: {formatTokens(outputCost)}</div>
            <div>Local: {local ? "yes" : "no"}</div>
            <div>Total tokens: {formatTokens(totalTokens)}</div>
            <div>Input cost: {formatCost(inputCost)}</div>
            <div>Output cost: {formatCost(outputCost)}</div>
            <div>Total cost: {formatCost(totalCost)}</div>
        </div>
    )
}

export function cleanFullMessage(text) {
    if (!text) return text;

    let out = text;

    // Remove repeated doubled words: "Chat Chat" → "Chat"
    out = out.replace(/\b(\w+)\b(?:\s+\1\b)+/gi, "$1");

    // Remove repeated fragments like "ocketsockets" → "ockets"
    out = out.replace(/(\w{3,6})(\1)+/gi, "$1");

    // Remove repeated syllables: "abilityability" → "ability"
    out = out.replace(/([a-z]{3,5})(\1)+/gi, "$1");

    // Remove repeated hyphenated fragments: "time-time" → "time"
    out = out.replace(/(\w+)([-–—]\1)+/gi, "$1");

    return out;
}

function mergeStreamChunk(existing, incoming) {
    const current = String(existing || "");
    const chunk = String(incoming || "");

    if (!chunk) return current;
    if (!current) return chunk;
    if (chunk.startsWith(current)) return chunk;
    if (current.endsWith(chunk)) return current;

    const maxOverlap = Math.min(current.length, chunk.length);
    for (let size = maxOverlap; size > 0; size--) {
        if (current.slice(-size) === chunk.slice(0, size)) {
            return current + chunk.slice(size);
        }
    }

    return current + chunk;
}

function formatConfidenceLabel(value) {
    if (!Number.isFinite(value)) return "";
    return `${Math.round(value * 100)}% confidence`;
}

function sourceTypeLabel(type = "") {
    switch (type) {
        case "docs":
            return "Docs";
        case "schema":
            return "Schema";
        case "config":
            return "Config";
        case "code":
            return "Code";
        default:
            return "Other";
    }
}

function groundedTagStyle(kind = "default") {
    if (kind === "success") {
        return {
            color: "rgba(214, 255, 226, 0.98)",
            background: "rgba(34, 197, 94, 0.22)",
            border: "1px solid rgba(214, 255, 226, 0.2)",
        };
    }
    if (kind === "warning") {
        return {
            color: "rgba(255, 243, 199, 0.98)",
            background: "rgba(245, 158, 11, 0.2)",
            border: "1px solid rgba(255, 243, 199, 0.18)",
        };
    }
    return {
        color: "rgba(255, 255, 255, 0.96)",
        background: "rgba(255, 255, 255, 0.14)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
    };
}

function looksCodeHeavySnippet(text = "") {
    const value = String(text || "").trim();
    if (!value) return false;
    const codePatterns = [
        /\b(import|export|const|let|function|return|await|async)\b/,
        /=>/,
        /[{}()[\];]/,
        /<[A-Z][A-Za-z0-9]+/,
    ];
    const hits = codePatterns.reduce((sum, pattern) => sum + (pattern.test(value) ? 1 : 0), 0);
    return hits >= 2;
}

function formatInspectableSnippet(item = {}) {
    const snippet = String(item?.snippet || "").trim();
    if (!snippet) return "";
    if (item?.sourceType === "code" || looksCodeHeavySnippet(snippet)) {
        return "";
    }
    return snippet;
}

function isClickableUrl(value = "") {
    return /^https?:\/\//i.test(String(value || "").trim());
}

function openExternalUrl(event, url) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!url) return;
    window.electron.system.openExternal(url);
}

function getSelectedTextInDialog() {
    const selection = window.getSelection?.();
    const text = selection?.toString?.() || "";
    return text.replace(/\s+/g, " ").trim();
}

function formatSelectionReplySnippet(text = "") {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    return `> ${normalized}\n\n`;
}

function deriveSessionTitleFromText(text = "") {
    const normalized = String(text || "")
        .replace(/\s+/g, " ")
        .replace(/^[\s"'`({\[]+|[\s"'`)}\]]+$/g, "")
        .trim();

    if (!normalized) return "New Chat";

    const simplified = normalized.replace(/^(please|can you|could you|would you|hey|hi)\s+/i, "").trim() || normalized;
    const words = simplified.split(" ").filter(Boolean);
    const short = words.slice(0, 8).join(" ");
    const clipped = short.length > 60 ? short.slice(0, 57).trimEnd() : short;
    const cleaned = clipped.replace(/[.,:;!?-]+$/g, "").trim();

    if (!cleaned) return "New Chat";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isUntouchedEmptySession(session = {}) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    return messages.length === 0;
}

function upsertSessionListItem(list = [], session = {}) {
    const nextItem = {
        id: session.id,
        name: session.name,
        updatedAt: session.updatedAt,
    };
    return [nextItem, ...(list || []).filter((item) => item.id !== session.id)];
}

function getSelectionRectInViewport() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
    }

    try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) {
            return null;
        }
        return rect;
    } catch {
        return null;
    }
}

function normalizeComposerTopic(text = "") {
    return String(text || "")
        .replace(/\s+/g, " ")
        .replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, "")
        .replace(/^(ok|okay|well|yeah|yes|sure)[,.\s]+/i, "")
        .replace(/^(and\s+)+/i, "")
        .replace(/^(and\s+)?(can\s+you\s+)?(search|look up|find|tell me about)\s+/i, "")
        .replace(/^(but\s+)?what\s+do\s+you\s+know\s+about\s+/i, "")
        .replace(/^(how do|how does|how is|what is|what are)\s+/i, "")
        .trim();
}

function normalizeComposerPrompt(text = "") {
    return String(text || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, "")
        .replace(/^(ok|okay|well|yeah|yes|sure)[,.\s]+/i, "")
        .replace(/^(and\s+)+/i, "")
        .trim();
}

function stripComposerLead(text = "") {
    return String(text || "")
        .replace(/^[\s,.!?-]+|[\s]+$/g, "")
        .replace(/^(ok|okay|well|yeah|yes|sure)[,.\s]+/i, "")
        .replace(/^(and\s+)+/i, "");
}

function stripComposerLeadPreserveTail(text = "") {
    return String(text || "")
        .replace(/^[\s,.!?-]+/g, "")
        .replace(/^(ok|okay|well|yeah|yes|sure)[,.\s]+/i, "")
        .replace(/^(and\s+)+/i, "");
}

function extractComposerSubject(session = null) {
    const source = normalizeComposerTopic(session?.routing?.lastTopicalUserPrompt || "");
    if (!source) return "";

    const patterns = [
        /^(?:latest version|docs|documentation|pricing|install|github|integration with [^ ]+)\s+(?:of|for)\s+(.+)$/i,
        /^(?:what about|how about|tell me about)\s+(.+)$/i,
        /^(?:how do|how does|what is|what are|where is|where are)\s+(.+)$/i,
    ];

    for (const pattern of patterns) {
        const match = source.match(pattern);
        if (match?.[1]) {
            return match[1]
                .replace(/\b(fdo|flexdevops)\b\s*/i, "")
                .replace(/\b(work|works|working|implemented|implementation|handled|manage|manages)$/i, "")
                .replace(/\?+$/g, "")
                .trim();
        }
    }

    return source
        .replace(/\b(fdo|flexdevops)\b\s*/i, "")
        .replace(/\b(work|works|working|implemented|implementation|handled|manage|manages)$/i, "")
        .replace(/\?+$/g, "")
        .trim();
}

function detectComposerLanguage(text = "") {
    const value = String(text || "");
    if (!value.trim()) return "en";
    if (/[\u4E00-\u9FFF]/.test(value)) return "zh";
    if (/[іїєґ]/i.test(value) || /[А-Яа-яЁёІіЇїЄєҐґ]/.test(value)) return "uk";
    if (/[ąćęłńóśźż]/i.test(value)) return "pl";
    if (/[äöüß]/i.test(value)) return "de";
    if (/[éèàùçêîôûëïü]/i.test(value)) return "fr";
    return "en";
}

function fallbackComposerTopicForRoute(session = null) {
    const route = String(session?.routing?.activeRoute || "general");
    const scope = String(session?.routing?.activeScope || "general");

    if (route === "fdo") {
        if (scope === "plugins") return "FDO plugins";
        if (scope === "settings") return "FDO settings";
        if (scope === "ui") return "FDO UI";
        if (scope === "trust") return "FDO trust settings";
        if (scope === "sdk") return "FDO SDK";
        return "FDO";
    }
    if (route === "weather") {
        return "the weather";
    }
    if (route === "web") {
        return "";
    }
    return "";
}

function collectComposerTopics(session = null, replyTo = null) {
    const topics = [];
    const addTopic = (value = "") => {
        const normalized = normalizeComposerTopic(value)
            .replace(/\b(latest version|documentation|docs|pricing|install|github|integration with [^ ]+)\s+(of|for)\s+/i, "")
            .replace(/\b(question|questions)\s+about\s+/i, "")
            .replace(/\s+/g, " ")
            .trim();
        if (!normalized) return;
        if (!topics.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
            topics.push(normalized);
        }
    };

    addTopic(extractComposerSubject(session));
    addTopic(session?.routing?.lastTopicalUserPrompt || "");
    addTopic(replyTo?.content || "");
    addTopic(fallbackComposerTopicForRoute(session));

    return topics.slice(0, 3);
}

function getRouteAwareComposerCandidates(session = null, replyTo = null) {
    const route = String(session?.routing?.activeRoute || "general");
    const scope = String(session?.routing?.activeScope || "general");
    const topics = collectComposerTopics(session, replyTo);
    const referenceText = String(replyTo?.content || topics[0] || fallbackComposerTopicForRoute(session));
    const language = detectComposerLanguage(referenceText);
    const candidates = [];
    const pushCandidate = (value = "") => {
        const normalized = String(value || "").replace(/\s+/g, " ").trim();
        if (!normalized) return;
        if (!candidates.some((candidate) => candidate.toLowerCase() === normalized.toLowerCase())) {
            candidates.push(normalized);
        }
    };

    for (const topic of topics) {
        if (route === "weather") {
            pushCandidate(`what is the weather in ${topic}`);
            pushCandidate(`and now in ${topic}`);
            pushCandidate(`what about tomorrow in ${topic}`);
            continue;
        }

        if (route === "web") {
            pushCandidate(`what about ${topic}`);
            pushCandidate(`latest version of ${topic}`);
            pushCandidate(`docs for ${topic}`);
            pushCandidate(`documentation for ${topic}`);
            pushCandidate(`pricing for ${topic}`);
            pushCandidate(`github for ${topic}`);
            pushCandidate(`integration with NodeJS for ${topic}`);
            pushCandidate(`integration with Python for ${topic}`);
            pushCandidate(`integration with JavaScript for ${topic}`);
            pushCandidate(`integration with PHP for ${topic}`);
            continue;
        }

        if (route === "fdo") {
            pushCandidate(`question about ${topic}`);
            pushCandidate(`what about ${topic}`);
            pushCandidate(`how does ${topic} work`);
            pushCandidate(`where is ${topic} implemented`);
            if (scope === "plugins") {
                pushCandidate(`how do FDO plugins work`);
                pushCandidate(`where is plugin loading implemented in FDO`);
            }
            if (scope === "settings") {
                pushCandidate(`what about settings in FDO`);
                pushCandidate(`where are AI assistant settings handled`);
            }
            if (scope === "ui") {
                pushCandidate(`what about the FDO UI`);
                pushCandidate(`which component manages ${topic}`);
            }
            continue;
        }

        pushCandidate(`what about ${topic}`);
        pushCandidate(`how about ${topic}`);
        pushCandidate(`tell me about ${topic}`);
        pushCandidate(`more about ${topic}`);
    }

    const languagePrompts = {
        uk: ["а далі про", "і що з", "ще про"],
        pl: ["i co z", "pytanie o", "więcej o"],
        de: ["und jetzt zu", "frage zu", "mehr zu"],
        fr: ["et pour", "question sur", "plus sur"],
        zh: ["那关于", "再说说", "还有"],
        en: ["and now about", "question about", "more about"],
    };
    const followups = languagePrompts[language] || languagePrompts.en;
    for (const topic of topics.slice(0, 2)) {
        for (const prefix of followups) {
            pushCandidate(`${prefix} ${topic}`);
        }
    }

    pushCandidate("what?");
    pushCandidate("how?");
    pushCandidate("why?");
    return candidates;
}

function applyComposerCanonicalReplacement(rawTarget = "") {
    const canonicalTokens = [
        { prefix: "f", replacement: "FDO" },
        { prefix: "fd", replacement: "FDO" },
        { prefix: "fdo", replacement: "FDO" },
        { prefix: "lat", replacement: "latest version" },
        { prefix: "late", replacement: "latest version" },
        { prefix: "lates", replacement: "latest version" },
        { prefix: "latest", replacement: "latest version" },
        { prefix: "doc", replacement: "docs" },
        { prefix: "docs", replacement: "docs" },
        { prefix: "git", replacement: "github" },
        { prefix: "py", replacement: "Python" },
        { prefix: "js", replacement: "JavaScript" },
        { prefix: "node", replacement: "NodeJS" },
        { prefix: "php", replacement: "PHP" },
    ];
    const normalizedTarget = normalizeComposerPrompt(rawTarget);

    const exact = canonicalTokens.find((item) => item.prefix === normalizedTarget);
    if (exact) return exact.replacement;

    const trailing = canonicalTokens.find((item) => new RegExp(`(^|\\s)${item.prefix}$`, "i").test(rawTarget));
    if (!trailing) return "";
    return rawTarget.replace(new RegExp(`${trailing.prefix}$`, "i"), trailing.replacement);
}

function getComposerCompletionCandidates(session = null, replyTo = null) {
    return getRouteAwareComposerCandidates(session, replyTo);
}

function buildComposerSuggestion(input = "", session = null, replyTo = null) {
    const raw = String(input || "");
    const trimmed = raw.trim();
    if (!trimmed || raw.includes("\n") || /[.!?…:]$/.test(trimmed)) return null;

    const candidates = getComposerCompletionCandidates(session, replyTo);
    const rawTarget = stripComposerLeadPreserveTail(raw);
    const normalizedInput = normalizeComposerPrompt(rawTarget);
    const activeTopic = extractComposerSubject(session);
    const leadingPart = raw.slice(0, Math.max(0, raw.length - rawTarget.length));
    const trailingWhitespace = rawTarget.match(/\s+$/)?.[0] || "";

    const buildResult = (fullCompletion) => ({
        replacement: `${leadingPart}${fullCompletion}${trailingWhitespace}`,
        ghostSuffix: fullCompletion.slice(rawTarget.trimEnd().length),
    });

    const canonicalReplacement = applyComposerCanonicalReplacement(rawTarget);
    if (canonicalReplacement) {
        return buildResult(canonicalReplacement);
    }

    if (activeTopic) {
        const conversationalTopicPrompts = [
            "question about",
            "and question about",
            "a question about",
            "another question about",
            "what about",
            "and what about",
            "how about",
            "and how about",
            "tell me about",
            "and tell me about",
            "more about",
            "and more about",
            "something about",
            "and something about",
        ];
        if (conversationalTopicPrompts.includes(normalizedInput)) {
            return buildResult(`${rawTarget} ${activeTopic}`);
        }

        const lowerTarget = rawTarget.toLowerCase();
        if (/(^|[\s])(late)$/.test(lowerTarget)) {
            return buildResult("latest version of " + activeTopic);
        }
        if (/(^|[\s])(lates)$/.test(lowerTarget)) {
            return buildResult("latest version of " + activeTopic);
        }
        if (/(^|[\s])(latest)$/.test(lowerTarget)) {
            return buildResult("latest version of " + activeTopic);
        }
        if (/(^|[\s])(latest version)$/.test(lowerTarget)) {
            return buildResult("latest version of " + activeTopic);
        }
    }

    const exactShortTriggers = new Set(["what", "how", "why", "latest", "docs", "pricing", "install", "setup", "github"]);
    if (normalizedInput.length < 4 && !exactShortTriggers.has(normalizedInput)) {
        return null;
    }

    if (activeTopic) {
        const latestPrompts = new Set([
            "latest",
            "the latest",
            "latest version",
            "what is latest",
            "what's latest",
            "what is the latest",
            "what is latest version",
            "what's latest version",
        ]);
        if (latestPrompts.has(normalizedInput)) {
            return buildResult(`latest version of ${activeTopic}`);
        }
        if (["docs", "documentation"].includes(normalizedInput)) {
            return buildResult(`docs for ${activeTopic}`);
        }
        if (normalizedInput === "question" || normalizedInput === "and question") {
            return buildResult(`${rawTarget} about ${activeTopic}`);
        }
        if (["pricing", "price", "install", "setup", "github", "repo", "website"].includes(normalizedInput)) {
            const fullCompletion = /install$/i.test(normalizedInput)
                ? `install ${activeTopic}`
                : `${normalizedInput} for ${activeTopic}`;
            return buildResult(fullCompletion);
        }
        if (/^integration with [^ ]+$/.test(normalizedInput)) {
            return buildResult(`${rawTarget} for ${activeTopic}`);
        }
    }

    if (!normalizedInput) return null;

    for (const candidate of candidates) {
        const candidateLower = normalizeComposerPrompt(candidate);
        if (candidateLower.startsWith(normalizedInput) && candidate.length > rawTarget.length) {
            return buildResult(candidate);
        }
    }
    return null;
}

const QUICK_EMOJIS = [
    "🙂", "😉", "🤔", "🔥", "✅", "👍", "👀", "🚀", "✨", "💡", "🎯", "🛠️", "🐛", "📎", "📌", "⚠️",
];


export const AiChatDialog = ({showAiChatDialog, setShowAiChatDialog}) => {
    const [session, setSession] = useState(null);
    const [sessionList, setSessionList] = useState([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [thinking, setThinking] = useState(false);
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [attachmentOpen, setAttachmentOpen] = useState(false);
    const [assistants, setAssistants] = useState([]);
    const [provider, setProvider] = useState("");
    const [model, setModel] = useState("");
    const [assistantId, setAssistantId] = useState("");
    const [streaming, setStreaming] = useState(false);
    const messagesEndRef = useRef(null);
    const streamingAssistantIdRef = useRef(null);
    const [stats, setStats] = useState(null);
    const [capabilities, setCapabilities] = useState(null);
    const [summarizingProgress, setSummarizingProgress] = useState(false);
    const [summarizingModel, setSummarizingModel] = useState("");
    const [temperature, setTemperature] = useState(0.7);
    const [attachFromUrlDialogOpen, setAttachFromUrlDialogOpen] = useState(false);
    const [attachments, setAttachments] = useState([]);
    const [replyTo, setReplyTo] = useState(null);
    const [showDebugDetails, setShowDebugDetails] = useState(false);
    const [selectedQuoteText, setSelectedQuoteText] = useState("");
    const [selectedQuoteRect, setSelectedQuoteRect] = useState(null);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const [enableComposerCompletion, setEnableComposerCompletion] = useState(true);
    const [composerFocused, setComposerFocused] = useState(false);
    const initialScrollDoneRef = useRef(false);
    const preferencesHydratedRef = useRef(false);
    const composerRef = useRef(null);

    const messages = session?.messages || [];
    const composerSuggestion = useMemo(
        () => enableComposerCompletion ? buildComposerSuggestion(input, session, replyTo) : null,
        [enableComposerCompletion, input, session, replyTo]
    );

    const scrollToBottom = (behavior = "smooth") => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                messagesEndRef.current?.scrollIntoView({behavior, block: "end"});
            });
        });
    };

    const chatAssistants = useMemo(() => (assistants || []).filter(a => a.purpose === 'chat'), [assistants]);
    const providerOptions = useMemo(() => {
        const uniq = Array.from(new Set(chatAssistants.map(a => a.provider)));
        return uniq.map(p => ({label: (p || '').charAt(0).toUpperCase() + (p || '').slice(1), value: p}));
    }, [chatAssistants]);
    const modelOptions = useMemo(() => {
        const filtered = chatAssistants.filter(a => !provider || a.provider === provider);
        const uniq = Array.from(new Set(filtered.map(a => a.model)));
        return uniq.map(m => ({label: m, value: m}));
    }, [chatAssistants, provider]);
    const assistantOptions = useMemo(() => {
        const filtered = chatAssistants.filter(a =>
            (!provider || a.provider === provider) &&
            (!model || a.model === model)
        );
        return filtered.map((assistant) => ({
            label: `${assistant.name} (${assistant.model})`,
            value: assistant.id,
        }));
    }, [chatAssistants, provider, model]);

    const resetDraftComposer = () => {
        setInput("");
        setReplyTo(null);
        setAttachments([]);
        setSelectedQuoteText("");
        setSelectedQuoteRect(null);
        setHistoryOpen(false);
        requestAnimationFrame(() => {
            const composer = document.querySelector("textarea");
            composer?.focus?.();
        });
    };

    const sessionCreate = async (name, list, { preferReuseEmpty = true } = {}) => {
        const requestedName = name || "New Chat";
        const allSessions = await window.electron.aiChat.getSessions();
        const existingEmpty = preferReuseEmpty
            ? [...(allSessions || [])]
                .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
                .find((item) => isUntouchedEmptySession(item))
            : null;

        const resolved = existingEmpty
            ? (existingEmpty.name === requestedName
                ? existingEmpty
                : await window.electron.aiChat.renameSession(existingEmpty.id, requestedName) || existingEmpty)
            : await window.electron.aiChat.createSession(requestedName);

        setSession(resolved);
        setSessionList((prev) => upsertSessionListItem(list || prev || [], resolved));
        resetDraftComposer();
        return resolved;
    }

    useEffect(() => {
        if (!showAiChatDialog) return;
        initialScrollDoneRef.current = false;
        preferencesHydratedRef.current = false;
        setReplyTo(null);
        (async () => {
            try {
                // sessions
                const sessions = await window.electron.aiChat.getSessions();
                if (sessions && sessions.length > 0) {
                    const mostRecent = sessions.reduce((latest, current) => {
                        return new Date(current.updatedAt) > new Date(latest.updatedAt) ? current : latest;
                    });
                    setSession(mostRecent);
                    const list = sessions.map(({id, name, updatedAt}) => ({
                        id,
                        name,
                        updatedAt,
                    }));
                    setSessionList(list);
                } else {
                    await sessionCreate("New Chat");
                }
                // assistants
                const list = await window.electron.settings.ai.getAssistants();
                setAssistants(list || []);
                const prefs = await window.electron.aiChat.getPreferences();
                const chatOnly = (list || []).filter(a => a.purpose === 'chat');
                const persistedAssistant = chatOnly.find(a => a.id === prefs?.assistantId);
                const persistedProvider = prefs?.provider || persistedAssistant?.provider || "";
                const persistedModel = prefs?.model || persistedAssistant?.model || "";
                const persistedAssistantMatches =
                    !!persistedAssistant &&
                    (!persistedProvider || persistedAssistant.provider === persistedProvider) &&
                    (!persistedModel || persistedAssistant.model === persistedModel);
                const defaultAssistant = chatOnly.find(a => a.default) || null;
                const firstAssistant = chatOnly[0] || null;
                const selectedAssistant =
                    (persistedAssistantMatches && persistedAssistant) ||
                    defaultAssistant ||
                    firstAssistant ||
                    null;

                setProvider(selectedAssistant?.provider || persistedProvider || "");
                setModel(selectedAssistant?.model || persistedModel || "");
                setAssistantId(selectedAssistant?.id || "");
                setStreaming(!!prefs?.streaming);
                setThinking(!!prefs?.thinking);
                setTemperature(typeof prefs?.temperature === "number" ? prefs.temperature : 0.7);
                setShowDebugDetails(!!prefs?.showDebugDetails);
                setEnableComposerCompletion(
                    typeof prefs?.enableComposerCompletion === "boolean"
                        ? prefs.enableComposerCompletion
                        : true
                );
                preferencesHydratedRef.current = true;
            } catch (e) {
                AppToaster.show({message: e.message, intent: "danger"});
            }
        })();
    }, [showAiChatDialog]);

    useEffect(() => {
        if (!showAiChatDialog) return;
        scrollToBottom(initialScrollDoneRef.current ? "smooth" : "auto");
        initialScrollDoneRef.current = true;
    }, [messages.length, showAiChatDialog]);

    useEffect(() => {
        if (!showAiChatDialog || !session?.id || initialScrollDoneRef.current) return;
        scrollToBottom("auto");
        initialScrollDoneRef.current = true;
    }, [showAiChatDialog, session?.id]);

    // Streaming event listeners
    useEffect(() => {
        if (!showAiChatDialog || !session?.id) return;
        const onDelta = (data) => {
            console.log("RAW STREAM DELTA:", JSON.stringify(data));
            if (!data || data.sessionId !== session?.id) return;
            setSession(prev => {
                if (!prev || prev.id !== data.sessionId) return prev;
                const msgs = [...(prev.messages || [])];
                let idx = msgs.findIndex(m => m.id === streamingAssistantIdRef.current);
                if (idx === -1) {
                    const id = streamingAssistantIdRef.current || crypto.randomUUID?.() || `a-${Math.random().toString(36).slice(2)}`;
                    streamingAssistantIdRef.current = id;
                    msgs.push({
                        id,
                        role: 'assistant',
                        content: '',
                        createdAt: new Date().toISOString(),
                        skeleton: true
                    });
                    idx = msgs.length - 1;
                }
                const m = {...msgs[idx]};
                if (data.type === 'content') {
                    const chunk = String(data.content || '');
                    m.content = mergeStreamChunk(m.content, chunk);
                    m.skeleton = false;
                } else if (data.type === 'thinking') {
                    m.thinking = mergeStreamChunk(m.thinking, data.content || '');
                }
                msgs[idx] = m;
                return {...prev, messages: msgs};
            });
        };
        const onDone = (data) => {
            if (!data || data.sessionId !== session?.id) return;
            setSession(prev => {
                if (!prev || prev.id !== data.sessionId) return prev;
                const msgs = [...(prev.messages || [])];
                const idx = msgs.findIndex(m => m.id === streamingAssistantIdRef.current);
                if (idx !== -1) msgs[idx] = {...msgs[idx], skeleton: false};
                return {...prev, messages: msgs};
            });
            setSending(false);
            streamingAssistantIdRef.current = null;
        };
        const onError = (data) => {
            if (!data || data.sessionId !== session?.id) return;
            setSession(prev => {
                if (!prev || prev.id !== data.sessionId) return prev;
                const msgs = [...(prev.messages || [])];
                const idx = msgs.findIndex(m => m.id === streamingAssistantIdRef.current);
                const errText = String(data.error || 'Error while streaming');
                if (idx !== -1) {
                    msgs[idx] = {...msgs[idx], skeleton: false, content: errText};
                } else {
                    const id = crypto.randomUUID?.() || `e-${Math.random().toString(36).slice(2)}`;
                    msgs.push({
                        id,
                        role: 'assistant',
                        content: errText,
                        createdAt: new Date().toISOString(),
                        skeleton: false
                    });
                }
                return {...prev, messages: msgs};
            });
            setSending(false);
            streamingAssistantIdRef.current = null;
        };
        const onStats = (data) => {
            // Only accept if it's for current session & dialog is visible
            if (data?.sessionId !== session.id) return;
            const activeStats = data.models?.[model];
            if (activeStats) {
                setStats(activeStats);
                setSession(prev =>
                    prev?.id === data.sessionId
                        ? {
                            ...prev,
                            stats: {
                                ...(prev.stats || {}),
                                models: {
                                    ...(prev.stats?.models || {}),
                                    [model]: activeStats,
                                },
                            },
                        }
                        : prev
                );
            }
        };
        const onSummaryStart = (data) => {
            if (data?.sessionId !== session.id) return;
            setSummarizingProgress(true);
            setSummarizingModel(data.model);
        }
        const onSummaryEnd = (data) => {
            if (data?.sessionId !== session.id) return;
            setSummarizingProgress(false);
        }
        window.electron.aiChat.on.compressionStart(onSummaryStart);
        window.electron.aiChat.on.compressionDone(onSummaryEnd);
        window.electron.aiChat.on.statsUpdate(onStats);
        window.electron.aiChat.on.streamDelta(onDelta);
        window.electron.aiChat.on.streamDone(onDone);
        window.electron.aiChat.on.streamError(onError);
        return () => {
            window.electron.aiChat.off.compressionStart(onSummaryStart);
            window.electron.aiChat.off.compressionDone(onSummaryEnd);
            window.electron.aiChat.off.statsUpdate(onStats);
            window.electron.aiChat.off.streamDelta(onDelta);
            window.electron.aiChat.off.streamDone(onDone);
            window.electron.aiChat.off.streamError(onError);
        };
    }, [showAiChatDialog, session?.id, model]);

    useEffect(() => {
        if (!session?.id) return;

        const activeStats =
            session.stats?.models?.[model] ??
            session.stats?.summary ??
            null;
        setStats(activeStats);
    }, [session?.id, session?.stats, model]);

    useEffect(() => {
        if (!model) return;
        window.electron.aiChat.getCapabilities(model, provider, assistantId)
            .then(caps => {
                setCapabilities(caps);
            })
            .catch(err => {
                AppToaster.show({message: `Capability load failed: ${err.message}`, intent: "warning"});
                console.warn("[AI Chat UI] capability load failed:", err)
            });
    }, [assistantId, model, provider]);

    useEffect(() => {
        if (!showAiChatDialog || !preferencesHydratedRef.current) return;
        window.electron.aiChat.savePreferences({
            provider,
            model,
            assistantId,
            streaming,
            thinking,
            temperature,
            showDebugDetails,
            enableComposerCompletion,
        }).catch((err) => {
            console.warn("[AI Chat UI] failed to save preferences:", err);
        });
    }, [assistantId, enableComposerCompletion, model, provider, showAiChatDialog, showDebugDetails, streaming, temperature, thinking]);

    useEffect(() => {
        if (!assistantOptions.length) {
            if (assistantId) {
                setAssistantId("");
            }
            return;
        }

        if (!assistantOptions.some((option) => option.value === assistantId)) {
            const matchingDefault = chatAssistants.find(a =>
                a.default &&
                (!provider || a.provider === provider) &&
                (!model || a.model === model)
            );
            setAssistantId(matchingDefault?.id || assistantOptions[0].value);
        }
    }, [assistantId, assistantOptions, chatAssistants, model, provider]);

    useEffect(() => {
        if (!capabilities) return;

        const supportsThinking = !!(capabilities.supportsThinking ?? capabilities.reasoning);
        const supportsStreaming = !!capabilities.streaming;

        if (!supportsThinking && thinking) {
            setThinking(false);
        }
        if (!supportsStreaming && streaming) {
            setStreaming(false);
        }
    }, [capabilities, streaming, thinking]);

    useEffect(() => {
        if (stats && stats.percentUsed > 90 && thinking) {
            setThinking(false);
        }
    }, [stats]);

    useEffect(() => {
        const el = composerRef.current;
        if (!el) return;
        el.style.height = "0px";
        const nextHeight = Math.min(Math.max(el.scrollHeight, 36), 200);
        el.style.height = `${nextHeight}px`;
    }, [input, showAiChatDialog]);

    useEffect(() => {
        document.addEventListener("click", (event) => {
            const target = event.target.closest("a");
            if (target && (target.href.startsWith("http") || target.href.startsWith("file://"))) {
                event.preventDefault();
                window.electron.system.openExternal(target.href)
            }
        });
    }, [])

    useEffect(() => {
        if (!showAiChatDialog) return;
        const updateSelection = () => {
            const text = getSelectedTextInDialog();
            const rect = text ? getSelectionRectInViewport() : null;
            setSelectedQuoteText(text);
            setSelectedQuoteRect(rect ? {
                top: rect.top + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width,
                height: rect.height,
            } : null);
        };
        document.addEventListener("selectionchange", updateSelection);
        window.addEventListener("scroll", updateSelection, true);
        window.addEventListener("resize", updateSelection);
        return () => {
            document.removeEventListener("selectionchange", updateSelection);
            window.removeEventListener("scroll", updateSelection, true);
            window.removeEventListener("resize", updateSelection);
        };
    }, [showAiChatDialog]);

    const hasAssistants = useMemo(() => (chatAssistants || []).length > 0, [chatAssistants]);
    const canSend = useMemo(() => !sending && (!!input.trim() || !!replyTo) && hasAssistants, [sending, input, hasAssistants, replyTo]);
    const buildReplyPreview = (message) => {
        const text = String(message?.content || "").replace(/\s+/g, " ").trim();
        return text.length > 140 ? `${text.slice(0, 140)}...` : text;
    };

    const onSend = async () => {
        const typedContent = input.trim();
        const content = typedContent;
        if ((!content && !replyTo) || !session || sending) return;
        const sendingSessionId = session.id;
        setSending(true);
        setInput("");


        // Optimistic UI: append user message and a skeleton assistant bubble
        const now = new Date().toISOString();
        const tempAssistantId = crypto.randomUUID?.() || `temp-${Math.random().toString(36).slice(2)}`;
        const optimistic = {
            ...session,
            messages: [
                ...(session.messages || []),
                {
                    id: crypto.randomUUID?.() || `u-${Math.random().toString(36).slice(2)}`,
                    role: 'user',
                    content: typedContent,
                    ...(replyTo ? {
                        replyTo: {
                            id: replyTo.id,
                            role: replyTo.role,
                            content: buildReplyPreview(replyTo),
                        },
                        replyContext: `Replying to ${replyTo.role === "assistant" ? "assistant" : "user"} message:\n${String(replyTo.content || "").replace(/\s+/g, " ").trim().slice(0, 500)}`,
                    } : {}),
                    createdAt: now,
                    attachments,
                },
                {
                    id: tempAssistantId,
                    role: 'assistant',
                    content: ' ',
                    createdAt: now,
                    skeleton: true,
                    thinkingRequested: thinking
                },
            ]
        };
        setSession((prev) => (prev?.id === sendingSessionId ? optimistic : prev));

        // Set streaming bubble id so deltas update this one
        streamingAssistantIdRef.current = tempAssistantId;
        try {
            const updated = await window.electron.aiChat.sendMessage({
                sessionId: sendingSessionId,
                content,
                think: thinking,
                stream: streaming || thinking,
                provider,
                model,
                assistantId,
                temperature,
                attachments,
                replyTo: replyTo ? { id: replyTo.id } : null,
            });
            // Replace with authoritative session from main (removes skeleton)
            setSession((prev) => (prev?.id === updated.id ? updated : prev));
            setSessionList((prev) => {
                const nextItem = {
                    id: updated.id,
                    name: updated.name,
                    updatedAt: updated.updatedAt,
                };
                const rest = (prev || []).filter((item) => item.id !== updated.id);
                return [nextItem, ...rest];
            });
            setAttachments([]);
            setReplyTo(null);
            setSelectedQuoteText("");
        } catch (e) {
            AppToaster.show({message: e.message, intent: "danger"});
            // Replace skeleton with error text locally if call failed
            setSession(prev => {
                if (prev?.id !== sendingSessionId) {
                    return prev;
                }
                const msgs = (prev?.messages || []).map(m => (
                    m.id === tempAssistantId ? {
                        ...m,
                        skeleton: false,
                        content: `Error: ${e?.message || 'Failed to send message'}`
                    } : m
                ));
                return {...(prev || session), messages: msgs};
            });
            // Important: do NOT clear attachments on error
        } finally {
            setSending(false);
        }
    };

    const onKeyDown = (e) => {
        const liveValue = composerRef.current?.value ?? input;
        const suggestion = enableComposerCompletion ? buildComposerSuggestion(liveValue, session, replyTo) : composerSuggestion;
        if (enableComposerCompletion && suggestion && (e.key === "Tab" || e.key === "ArrowRight")) {
            const el = composerRef.current;
            const cursorAtEnd = !el || (el.selectionStart === el.selectionEnd && el.selectionEnd === String(liveValue || "").length);
            if (cursorAtEnd) {
                e.preventDefault();
                setInput(suggestion.replacement);
                requestAnimationFrame(() => {
                    const field = composerRef.current;
                    if (!field) return;
                    const pos = suggestion.replacement.length;
                    field.focus();
                    field.setSelectionRange?.(pos, pos);
                });
                return;
            }
        }
        // Enter sends; Shift+Enter inserts newline; Cmd/Ctrl+Enter toggles Thinking
        if (e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
            if (!canSend) return;
            e.preventDefault();
            onSend();
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            setOptionsOpen(true);
        }
    };

    const onSessionChange = async (id) => {
        const sessions = await window.electron.aiChat.getSessions();
        const session = sessions.find(s => s.id === id);
        if (session) {
            setSession(session);
            setReplyTo(null);
        } else {
            setSession(null);
        }
    }

    const onNewConversationFromSelection = async () => {
        const selectedText = selectedQuoteText || getSelectedTextInDialog();
        if (!selectedText || sending) return;
        await sessionCreate(deriveSessionTitleFromText(selectedText), null, { preferReuseEmpty: true });
        setInput(selectedText);
    };

    const onReplyFromSelection = () => {
        const selectedText = selectedQuoteText || getSelectedTextInDialog();
        if (!selectedText || sending) return;
        insertIntoComposer(formatSelectionReplySnippet(selectedText));
        setSelectedQuoteText("");
        setSelectedQuoteRect(null);
    };

    const onOpenFromLocal = async () => {
        const data = await window.electron.system.openFileDialog({
            title: 'Select files to attach',
            buttonLabel: 'Attach',
            properties: ['openFile', 'multiSelections'],
        }, true)
        if (!data) return;
        const newAttachments = []
        const fileTypes = await window.electron.aiChat.detectAttachmentType(data)
        for (const file of data) {
            const basename = file.split(/[\\/]/).pop();
            newAttachments.push({
                name: basename,
                path: file,
                type: 'local',
                category: fileTypes.find(t => t.path === file)?.type,
            })
        }
        const newAttachmentsList = [...attachments, ...newAttachments];
        setAttachments(Array.from(new Map(newAttachmentsList.map(item => [item.path, item])).values()));
    }

    const onOpenFromUrl = (url) => {
        const makeShortenUrl = shortenUrl(url);
        if (!makeShortenUrl) return;
        const newAttachmentsList = [...attachments, {
            name: makeShortenUrl,
            path: url,
            type: 'url',
        }];
        setAttachments(Array.from(new Map(newAttachmentsList.map(item => [item.path, item])).values()));
    }

    const insertIntoComposer = (text) => {
        const addition = String(text || "");
        if (!addition) return;
        const el = composerRef.current;
        if (!el) {
            setInput((prev) => `${prev}${addition}`);
            return;
        }
        const start = el.selectionStart ?? String(input || "").length;
        const end = el.selectionEnd ?? start;
        const next = `${input.slice(0, start)}${addition}${input.slice(end)}`;
        setInput(next);
        requestAnimationFrame(() => {
            el.focus();
            const pos = start + addition.length;
            if (typeof el.setSelectionRange === "function") {
                el.setSelectionRange(pos, pos);
            }
        });
    };

    const onEmojiSelect = (emoji) => {
        insertIntoComposer(emoji);
        setEmojiOpen(false);
    };

    const onOpenFromSession = async (id) => {
        const sessions = await window.electron.aiChat.getSessions();
        const session = sessions.find(s => s.id === id);
        const newAttachmentsList = [...attachments, {
            name: session.name,
            path: session.id,
            type: 'session',
        }];
        setAttachments(Array.from(new Map(newAttachmentsList.map(item => [item.path, item])).values()));
    }

    const attachmentIntentType = (type) => {
        switch (type) {
            case 'local':
                return 'primary';
            case 'url':
                return 'success';
            case 'session':
                return 'warning';
            default:
                return 'none';
        }
    }

    return (
        <Dialog
            autoFocus={true}
            canEscapeKeyClose={true}
            canOutsideClickClose={true}
            isOpen={showAiChatDialog}
            isCloseButtonShown={true}
            onClose={() => setShowAiChatDialog(false)}
            title={<><Icon icon={"chat"} intent={"primary"} style={{paddingLeft: "3px"}} size={20}/><span
                className={"bp6-heading"}
                style={{fontSize: "1.2rem"}}>Chat with AI Assistant</span></>}
            style={{
                minWidth: 900,
                paddingBottom: 0,
                height: 620,
                padding: "5px",
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            {selectedQuoteText && selectedQuoteRect && (
                <div
                    className={styles.selectionAction}
                    style={{
                        top: Math.max(selectedQuoteRect.top - 40, 12),
                        left: Math.max(selectedQuoteRect.left + (selectedQuoteRect.width / 2) - 88, 12),
                    }}
                >
                    <button
                        type="button"
                        className={styles.selectionActionButton}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onNewConversationFromSelection}
                    >
                        <Icon icon="branch" size={12} />
                        <span>New chat</span>
                    </button>
                    <div className={styles.selectionActionDivider} />
                    <button
                        type="button"
                        className={styles.selectionActionButton}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={onReplyFromSelection}
                    >
                        <Icon icon="undo" size={12} />
                        <span>Reply</span>
                    </button>
                </div>
            )}
            <div style={{flex: 1, overflow: 'auto', padding: '0 1rem'}}>
                {!hasAssistants ? (
                    <NonIdealState
                        icon="manual"
                        title="No AI Assistants yet"
                        description="Add your first AI Assistant to integrate intelligent collaboration into your workflow."
                    />
                ) : (<>
                        {(messages || []).map(m => {
                            const isAssistant = m.role === 'assistant';
                            const isStreamingLive = isAssistant && (streamingAssistantIdRef.current === m.id) && sending;
                            const showActivityHeader = isAssistant && (m.skeleton || isStreamingLive);
                            const headerLabel = m.thinkingRequested ? 'Thinking…' : 'Responding…';
                            const sources = Array.isArray(m.sources) ? m.sources : [];
                            const sourceDetails = Array.isArray(m.sourceDetails) ? m.sourceDetails : [];
                            const toolsUsed = Array.isArray(m.toolsUsed) ? m.toolsUsed : [];
                            const toolErrors = Array.isArray(m.toolErrors) ? m.toolErrors : [];
                            const isClarification = !!m.clarification;
                            const sourceTypes = Array.from(new Set(
                                sourceDetails
                                    .map((item) => item?.sourceType)
                                    .filter(Boolean)
                            ));
                            const inspectableSourceDetails = sourceDetails
                                .map((item) => ({
                                    ...item,
                                    displaySnippet: formatInspectableSnippet(item),
                                }))
                                .filter((item) => item.displaySnippet);
                            const visibleEvidence = inspectableSourceDetails.slice(0, 2);
                            return (
                                <div key={m.id} style={{
                                    display: 'flex',
                                    justifyContent: isAssistant ? 'flex-start' : 'flex-end',
                                    margin: '8px 0'
                                }}>
                                    <div
                                        className={`${styles.bubble} ${isAssistant ? styles.assistantBubble : styles.userBubble}`}>
                                        {m.replyTo && (
                                            <div className={`${styles.replyQuote} ${isAssistant ? styles.replyQuoteAssistant : styles.replyQuoteUser}`}>
                                                <div className={styles.replyQuoteLabel}>
                                                    Replying to {m.replyTo.role === "assistant" ? "assistant" : "user"}
                                                </div>
                                                <div className={styles.replyQuoteContent}>{m.replyTo.content}</div>
                                            </div>
                                        )}
                                        {showActivityHeader && (
                                            <div className={styles.thinkingHeader}>
                                                <Spinner size={14} intent="none" style={{color: 'rgba(255, 255, 255, 0.92)'}}/>
                                                <span>{headerLabel}</span>
                                            </div>
                                        )}
                                        {isClarification && (
                                            <div style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 6,
                                                marginBottom: 8,
                                                fontSize: 12,
                                                fontWeight: 600,
                                                color: "rgba(255, 243, 199, 0.96)",
                                            }}>
                                                <Icon icon="help" size={12}/>
                                                <span>Needs clarification</span>
                                            </div>
                                        )}
                                        {isAssistant && m.thinking && (
                                            <div className={styles.thinkingBlock}>
                                                {m.thinking}
                                            </div>
                                        )}
                                        {m.role === 'user' && (m.content || m.contentAttachments) ? (
                                            <MarkdownRenderer text={m.content} attachments={m.contentAttachments} skeleton={m.skeleton} role={m.role}/>
                                        ) : (
                                            isAssistant ? <>
                                                <Tooltip content={costUsageTooltip(
                                                    m.inputTokens, m.outputTokens, m.local, m.totalTokens, m.inputCost, m.outputCost, m.totalCost
                                                )}>
                                                    <MarkdownRenderer text={m.content} skeleton={m.skeleton} role={m.role}/>
                                                </Tooltip>
                                                {m.grounded && (
                                                    <div style={{display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8}}>
                                                        <Tag minimal style={groundedTagStyle("success")}>Grounded</Tag>
                                                        {sourceTypes.map((type) => (
                                                            <Tag key={`${m.id}-${type}`} minimal style={groundedTagStyle()}>{sourceTypeLabel(type)}</Tag>
                                                        ))}
                                                        {Number.isFinite(m.retrievalConfidence) && (
                                                            <Tag minimal style={groundedTagStyle(m.retrievalConfidence < 0.55 ? "warning" : "default")}>
                                                                {formatConfidenceLabel(m.retrievalConfidence)}
                                                            </Tag>
                                                        )}
                                                        {m.retrievalConflict && (
                                                            <Tag minimal style={groundedTagStyle("warning")}>Mixed sources</Tag>
                                                        )}
                                                    </div>
                                                )}
                                                {sources.length > 0 && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 255, 255, 0.92)"}}>
                                                        <div style={{fontWeight: 600, marginBottom: 4, color: "rgba(255, 255, 255, 0.98)"}}>Sources used</div>
                                                        {sources.map((source) => (
                                                            isClickableUrl(source) ? (
                                                                <div
                                                                    key={`${m.id}-${source}`}
                                                                    onClick={(event) => openExternalUrl(event, source)}
                                                                    style={{cursor: "pointer"}}
                                                                >
                                                                    <a
                                                                        href={source}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        onClick={(event) => openExternalUrl(event, source)}
                                                                        style={{
                                                                            color: "rgba(214, 235, 255, 0.98)",
                                                                            textDecoration: "underline",
                                                                            wordBreak: "break-all",
                                                                            cursor: "pointer",
                                                                        }}
                                                                    >
                                                                        {source}
                                                                    </a>
                                                                </div>
                                                            ) : (
                                                                <div key={`${m.id}-${source}`}>{source}</div>
                                                            )
                                                        ))}
                                                    </div>
                                                )}
                                                {!showDebugDetails && visibleEvidence.length > 0 && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 255, 255, 0.92)"}}>
                                                        <div style={{fontWeight: 600, marginBottom: 4, color: "rgba(255, 255, 255, 0.98)"}}>Evidence</div>
                                                        <div style={{display: "flex", flexDirection: "column", gap: 8}}>
                                                            {visibleEvidence.map((item, index) => (
                                                                <div
                                                                    key={`${m.id}-${item.source}-evidence-${index}`}
                                                                    style={{
                                                                        padding: "8px 10px",
                                                                        borderRadius: 8,
                                                                        background: "rgba(0, 0, 0, 0.16)",
                                                                        border: "1px solid rgba(255, 255, 255, 0.08)",
                                                                    }}
                                                                >
                                                                    <div style={{fontWeight: 600, color: "rgba(255, 255, 255, 0.98)"}}>
                                                                        {isClickableUrl(item.source) ? (
                                                                            <a
                                                                                href={item.source}
                                                                                target="_blank"
                                                                                rel="noreferrer"
                                                                                onClick={(event) => openExternalUrl(event, item.source)}
                                                                                style={{
                                                                                    color: "rgba(214, 235, 255, 0.98)",
                                                                                    textDecoration: "underline",
                                                                                    wordBreak: "break-all",
                                                                                    cursor: "pointer",
                                                                                }}
                                                                            >
                                                                                {item.source}
                                                                            </a>
                                                                        ) : (
                                                                            item.source
                                                                        )}
                                                                    </div>
                                                                    <div style={{marginTop: 6, whiteSpace: "pre-wrap", color: "rgba(255, 255, 255, 0.92)"}}>
                                                                        {item.displaySnippet}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                                {showDebugDetails && sourceDetails.length > 0 && (
                                                    <details style={{marginTop: 8, fontSize: 12, color: "rgba(255, 255, 255, 0.92)"}}>
                                                        <summary style={{cursor: "pointer", fontWeight: 600, color: "rgba(255, 255, 255, 0.98)"}}>
                                                            Inspect retrieved snippets
                                                        </summary>
                                                        {inspectableSourceDetails.length > 0 ? (
                                                            <div style={{marginTop: 8, display: "flex", flexDirection: "column", gap: 8}}>
                                                                {inspectableSourceDetails.map((item, index) => (
                                                                    <div
                                                                        key={`${m.id}-${item.source}-${index}`}
                                                                        style={{
                                                                            padding: "8px 10px",
                                                                            borderRadius: 8,
                                                                            background: "rgba(0, 0, 0, 0.16)",
                                                                            border: "1px solid rgba(255, 255, 255, 0.08)",
                                                                        }}
                                                                    >
                                                                        <div style={{fontWeight: 600, color: "rgba(255, 255, 255, 0.98)"}}>
                                                                            {isClickableUrl(item.source) ? (
                                                                                <a
                                                                                    href={item.source}
                                                                                    target="_blank"
                                                                                    rel="noreferrer"
                                                                                    onClick={(event) => openExternalUrl(event, item.source)}
                                                                                    style={{
                                                                                        color: "rgba(214, 235, 255, 0.98)",
                                                                                        textDecoration: "underline",
                                                                                        wordBreak: "break-all",
                                                                                        cursor: "pointer",
                                                                                    }}
                                                                                >
                                                                                    {item.source}
                                                                                </a>
                                                                            ) : (
                                                                                item.source
                                                                            )}
                                                                        </div>
                                                                        {item.why && (
                                                                            <div style={{marginTop: 4, color: "rgba(255, 255, 255, 0.8)"}}>
                                                                                {item.why}
                                                                            </div>
                                                                        )}
                                                                        <div style={{marginTop: 6, whiteSpace: "pre-wrap", color: "rgba(255, 255, 255, 0.92)"}}>
                                                                            {item.displaySnippet}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div style={{marginTop: 8, color: "rgba(255, 255, 255, 0.82)"}}>
                                                                Retrieved help sources were implementation-heavy, so no readable snippet preview is shown here.
                                                            </div>
                                                        )}
                                                    </details>
                                                )}
                                                {m.grounded && Number.isFinite(m.retrievalConfidence) && m.retrievalConfidence < 0.55 && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 243, 199, 0.96)"}}>
                                                        Retrieval confidence is low, so this answer should be treated as a best-effort grounded response.
                                                    </div>
                                                )}
                                                {m.retrievalConflict && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 243, 199, 0.96)"}}>
                                                        Retrieved sources were mixed, so details may depend on which FDO source is authoritative for this question.
                                                    </div>
                                                )}
                                                {m.noSourceMatches && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 243, 199, 0.96)"}}>
                                                        No dedicated FDO sources matched this question exactly.
                                                    </div>
                                                )}
                                                {toolErrors.length > 0 && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 214, 214, 0.96)"}}>
                                                        <div style={{fontWeight: 600, marginBottom: 4, color: "rgba(255, 228, 228, 0.98)"}}>Tool issues</div>
                                                        {toolErrors.map((item) => (
                                                            <div key={`${m.id}-${item.name}`}>{item.name}: {item.error}</div>
                                                        ))}
                                                    </div>
                                                )}
                                                {showDebugDetails && toolsUsed.length > 0 && (
                                                    <div style={{marginTop: 8, fontSize: 12, color: "rgba(255, 255, 255, 0.86)"}}>
                                                        <div style={{fontWeight: 600, marginBottom: 4, color: "rgba(255, 255, 255, 0.94)"}}>Tools used</div>
                                                        {toolsUsed.map((toolName) => (
                                                            <div key={`${m.id}-${toolName}`}>{toolName}</div>
                                                        ))}
                                                    </div>
                                                )}
                                            </> : null
                                        )}
                                        {!m.skeleton && (
                                            <div style={{display: "flex", justifyContent: "flex-end", marginTop: 10}}>
                                                <Button
                                                    small
                                                    minimal
                                                    icon="undo"
                                                    text="Reply"
                                                    title="Reply to this message"
                                                    style={{
                                                        color: isAssistant ? "rgba(0, 0, 0, 0.72)" : "rgba(255, 255, 255, 0.72)",
                                                        background: "transparent",
                                                        border: "none",
                                                        boxShadow: "none",
                                                        padding: "2px 4px",
                                                        minHeight: "auto",
                                                        fontSize: 12,
                                                        lineHeight: 1.2,
                                                        opacity: 0.9,
                                                    }}
                                                    onClick={() => setReplyTo({
                                                        id: m.id,
                                                        role: m.role,
                                                        content: String(m.content || ""),
                                                    })}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef}/>
                    </>
                )}
            </div>
            <div
                className={Classes.DIALOG_FOOTER}
                style={{
                    borderTop: "1px solid var(--bp6-divider-color)",
                    padding: "0.5rem 1rem",
                    background: "var(--bp6-elevation-1)",
                }}
            >
                <ControlGroup fill={true} vertical={false} className={styles.composerControlRow}>
                    <Popover
                        isOpen={historyOpen}
                        onInteraction={(state) => setHistoryOpen(state)}
                        placement="top"
                        content={
                            <div style={{
                                padding: 12,
                                maxWidth: 320,
                                maxHeight: "300px",
                                flexDirection: "column",
                                display: "flex"
                            }}>
                                <div
                                    style={{
                                        position: "sticky",
                                        top: 0,
                                        zIndex: 2,
                                        background: "var(--pt-app-background-color, #fff)",
                                    }}
                                >
                                        <Menu>
                                        <MenuItem icon="add" text="New session" intent="primary"
                                                  onClick={() => sessionCreate("New Chat", sessionList)}/>
                                        <MenuDivider/>
                                    </Menu>
                                </div>
                                <div
                                    style={{
                                        overflowY: "auto",
                                        flex: "1 1 auto",
                                    }}
                                >
                                    <Menu>
                                        {[...sessionList]
                                            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(s => (
                                                <MenuItem key={s.id} intent={s.id === session.id ? "success" : "none"}
                                                          icon={s.id === session.id ? "tick" : null}
                                                          text={s.name}
                                                          onClick={() => onSessionChange(s.id)}
                                                />
                                            ))
                                        }
                                    </Menu>
                                </div>
                            </div>
                        }
                    >
                        <Button
                            icon="history"
                            variant={"minimal"}
                            title="Session History"
                            onClick={() => setHistoryOpen(v => !v)}
                        />
                    </Popover>
                    <Popover
                        isOpen={attachmentOpen}
                        onInteraction={(state) => setAttachmentOpen(state)}
                        placement="top"
                        content={
                            <div style={{
                                padding: 12,
                            }}>
                                <Menu>
                                    <MenuItem icon="clipboard-file" text="From local PDF/image" intent="primary" onClick={onOpenFromLocal}/>
                                    <MenuItem icon="globe-network-add" text="From image URL" intent="primary" onClick={() => setAttachFromUrlDialogOpen(true)}/>
                                    <MenuItem text="From session" icon="chat" intent="primary">
                                        {[...sessionList]
                                            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).filter(s => s.id !== session.id).map(s => (
                                                <MenuItem key={`attachment-${s.id}`}
                                                          text={s.name} onClick={() => onOpenFromSession(s.id)}
                                                />
                                            ))
                                        }
                                    </MenuItem>
                                </Menu>
                            </div>
                        }
                    >
                        <Button
                            icon="plus"
                            variant={"minimal"}
                            title={"Attach"}
                            onClick={() => setAttachmentOpen(v => !v)}
                        />
                    </Popover>
                    <div className={styles.composerInputShell}>
                        {enableComposerCompletion && composerFocused && composerSuggestion?.ghostSuffix && (
                            <textarea
                                aria-hidden="true"
                                tabIndex={-1}
                                readOnly
                                className={styles.composerInlineGhostArea}
                                value={`${input}${composerSuggestion.ghostSuffix}`}
                            />
                        )}
                        <textarea
                            placeholder={
                                hasAssistants
                                    ? (replyTo ? "Add a reply, or send immediately to continue from the selected message..." : "Type a message...")
                                    : "Add a Chat assistant in Settings to start chatting"
                            }
                            className={styles.composerNativeInput}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={onKeyDown}
                            onFocus={() => setComposerFocused(true)}
                            onBlur={() => setComposerFocused(false)}
                            disabled={sending || !hasAssistants}
                            autoFocus={true}
                            ref={composerRef}
                            rows={1}
                        />
                    </div>
                    <Popover
                        isOpen={emojiOpen}
                        onInteraction={(state) => setEmojiOpen(state)}
                        placement="top"
                        content={
                            <div className={styles.emojiPopover}>
                                {QUICK_EMOJIS.map((emoji) => (
                                    <button
                                        key={emoji}
                                        type="button"
                                        className={styles.emojiButton}
                                        onClick={() => onEmojiSelect(emoji)}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        }
                    >
                        <Button
                            variant={"minimal"}
                            title={"Insert emoji"}
                            onClick={() => setEmojiOpen(v => !v)}
                            text="🙂"
                            className={styles.emojiTriggerButton}
                        />
                    </Popover>
                    <Popover
                        isOpen={optionsOpen}
                        onInteraction={(state) => setOptionsOpen(state)}
                        placement="top"
                        content={
                            <div className={styles.composerOptionsPopover}>
                                <FormGroup label="Thinking mode">
                                    <Switch
                                        checked={thinking}
                                        onChange={(e) => {
                                            const next = e.target.checked;
                                            setThinking(next);
                                            if (next) {
                                                setStreaming(true);
                                            }
                                        }}
                                        innerLabelChecked="On"
                                        innerLabel="Off"
                                        disabled={!(capabilities?.supportsThinking ?? capabilities?.reasoning)}
                                    />
                                </FormGroup>
                                <FormGroup label="Streaming">
                                    <Switch
                                        checked={streaming}
                                        onChange={(e) => setStreaming(e.target.checked)}
                                        innerLabelChecked="On"
                                        innerLabel="Off"
                                        disabled={thinking || !capabilities?.streaming}
                                    />
                                    {thinking &&
                                        <div style={{fontSize: 11, opacity: 0.8, marginTop: 4}}>Auto-enabled while
                                            Thinking is ON</div>}
                                </FormGroup>
                                <FormGroup label="Debug tool details">
                                    <Switch
                                        checked={showDebugDetails}
                                        onChange={(e) => setShowDebugDetails(e.target.checked)}
                                        innerLabelChecked="On"
                                        innerLabel="Off"
                                    />
                                </FormGroup>
                                <FormGroup label="Smart completion">
                                    <Switch
                                        checked={enableComposerCompletion}
                                        onChange={(e) => setEnableComposerCompletion(e.target.checked)}
                                        innerLabelChecked="On"
                                        innerLabel="Off"
                                    />
                                    <div style={{fontSize: 11, opacity: 0.78, marginTop: 4}}>
                                        Optional Tab-to-complete hints. Off by default.
                                    </div>
                                </FormGroup>
                                <FormGroup label="Temperature">
                                    <Slider
                                        handleHtmlProps={{"aria-label": "temperature"}}
                                        labelStepSize={2}
                                        max={2}
                                        min={0}
                                        onChange={setTemperature}
                                        stepSize={0.1}
                                        value={temperature}
                                        vertical={false}
                                    />
                                </FormGroup>
                                <FormGroup label="Provider">
                                    <HTMLSelect
                                        options={providerOptions}
                                        value={provider}
                                        onChange={(e) => {
                                            const next = e.target.value;
                                            setProvider(next);
                                            // Auto-select the first model for this provider
                                            const nextModels = (chatAssistants.filter(a => a.provider === next).map(a => a.model));
                                            if (nextModels && nextModels.length > 0) {
                                                setModel(nextModels[0]);
                                            } else {
                                                setModel("");
                                            }
                                            setAssistantId("");
                                        }}
                                    />
                                </FormGroup>
                                <FormGroup label="Model">
                                    <HTMLSelect
                                        options={modelOptions}
                                        value={model}
                                        onChange={(e) => {
                                            setModel(e.target.value);
                                            setAssistantId("");
                                        }}
                                    />
                                </FormGroup>
                                <FormGroup label="Assistant">
                                    <HTMLSelect
                                        options={assistantOptions.length > 0 ? assistantOptions : [{ label: "No assistants available", value: "" }]}
                                        value={assistantId}
                                        onChange={(e) => setAssistantId(e.target.value)}
                                        disabled={assistantOptions.length === 0}
                                    />
                                </FormGroup>
                            </div>
                        }
                    >
                        <Button
                            icon="cog"
                            variant={"minimal"}
                            title={"Chat options (Cmd/Ctrl+Enter)"}
                            onClick={() => setOptionsOpen(v => !v)}
                        />
                    </Popover>
                    <Tooltip content={<span>
                        <div>Enter: Send message</div>
                        <div>Shift+Enter: New line</div>
                        <div>Cmd/Ctrl+Enter: Chat options</div>
                    </span>}>
                        <Button
                            intent="primary"
                            icon={sending ? "cloud-upload" : "send-message"}
                            variant={"minimal"}
                            title={"Send"}
                            onClick={onSend}
                            disabled={!canSend}
                        />
                    </Tooltip>
                </ControlGroup>
                {replyTo && (
                    <div style={{ marginTop: "6px" }}>
                        <div style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: "8px 10px",
                            borderRadius: 10,
                            background: "var(--bp6-elevation-2)",
                            border: "1px solid var(--bp6-divider-color)",
                        }}>
                            <div style={{minWidth: 0}}>
                                <div style={{fontSize: 12, fontWeight: 600, marginBottom: 2}}>
                                    Replying to {replyTo.role === "assistant" ? "assistant" : "user"}
                                </div>
                                <div style={{fontSize: 12, opacity: 0.85, whiteSpace: "pre-wrap"}}>
                                    {buildReplyPreview(replyTo)}
                                </div>
                            </div>
                            <Button minimal small icon="cross" disabled={sending} onClick={() => setReplyTo(null)} />
                        </div>
                    </div>
                )}
                {attachments.length > 0 && (
                    <div style={{ marginTop: "5px" }}>
                        <div style={{ marginBottom: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                            {attachments.map((a) => (
                                <Tag
                                    key={a.path}
                                    round
                                    onRemove={() => {
                                        if (sending) return;
                                        setAttachments(as => as.filter(aa => aa.path !== a.path))
                                    }}
                                    intent={attachmentIntentType(a.type)}
                                    style={{ cursor: "default" }}
                                >
                                    {a.name}
                                </Tag>
                            ))}
                        </div>
                    </div>
                )}
                {stats && (
                    <div
                        style={{
                            marginTop: "6px",
                            fontSize: "12px",
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        {/* 🔹 Label tag — model name or "Session Total" */}
                        {stats.lastModel && "Last used model: "}
                        <Tag
                            minimal
                            intent="none"
                            style={{opacity: stats.model ? 1 : 0.7}}
                        >
                            {stats.model || stats.lastModel || "Session Total"}
                        </Tag>

                        {/* 🔹 Usage / percentage tag */}
                        {stats.maxTokens && stats.percentUsed ? (
                            <>
                                <Tag
                                    minimal
                                    intent={
                                        stats.percentUsed > 80
                                            ? "danger"
                                            : stats.percentUsed > 50
                                                ? "warning"
                                                : "success"
                                    }
                                >
                                    {`${Math.round(stats.percentUsed)}% of ${stats.maxTokens.toLocaleString()} tokens`}
                                </Tag>
                                <Tag minimal intent="none">
                                    {`${(stats.estimatedUsed ?? 0).toLocaleString()} context tokens retained`}
                                </Tag>
                            </>
                        ) : (
                            <Tag minimal intent="none">
                                {`${(stats.totalTokens ?? 0).toLocaleString()} context tokens retained`}
                            </Tag>
                        )}

                        {/* 🔹 Details line */}
                        <span>
                          {(stats.assistantMessages ?? stats.totalMessages)
                              ? `• ${(stats.assistantMessages ?? stats.totalMessages)} assistant msg`
                              : stats.messageCount
                                  ? `• ${stats.messageCount} msg`
                                  : ""}
                        </span>
                    </div>
                )}
                {summarizingProgress && (
                    <div
                        style={{display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 8}}>
                        <Spinner size={14} intent="none" style={{color: '#000'}}/>
                        <span>Summarizing chat history for model {summarizingModel}...</span>
                    </div>
                )}
            </div>
            <AttachFromUrlDialog isOpen={attachFromUrlDialogOpen} setIsOpen={setAttachFromUrlDialogOpen} onSubmit={(url) => {onOpenFromUrl(url)}}/>
        </Dialog>
    )
}
