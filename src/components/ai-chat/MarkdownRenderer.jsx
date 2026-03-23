import React from "react";
import Markdown from 'markdown-to-jsx'

import * as styles from "./MarkdownRenderer.module.scss";
import classnames from "classnames";
import { normalizeAsciiEmoticons } from "../../utils/emoticons.js";

const AnchorScopeContext = React.createContext({
    anchorPrefix: "",
    anchorCountsRef: null,
    containerRef: null,
});

function flattenTextContent(node) {
    return React.Children.toArray(node)
        .map((child) => {
            if (typeof child === "string") return child;
            if (!React.isValidElement(child)) return "";
            return flattenTextContent(child.props?.children);
        })
        .join("");
}

function slugifyHeadingId(value = "") {
    return String(value || "")
        .toLowerCase()
        .trim()
        .replace(/[`~!@#$%^&*()+={}|[\]\\:;"'<>,.?/]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function unwrapMarkdownLinkHref(value = "") {
    let current = String(value || "").trim();
    while (current) {
        const match = current.match(/^\[[^\]]*]\((.+)\)$/);
        if (!match) {
            break;
        }
        const next = String(match[1] || "").trim();
        if (!next || next === current) {
            break;
        }
        current = next;
    }
    return current;
}

function splitMarkdownAndCodeFences(text = "") {
    const source = String(text || "");
    if (!source) return [];

    const fencePattern = /(^|\n)```(?!`)([a-z0-9_+-]+)?[ \t]*\n([\s\S]*?)\n```(?!`)(?=\n|$)/gi;
    const segments = [];
    let cursor = 0;
    let match;

    while ((match = fencePattern.exec(source)) !== null) {
        const matchStart = match.index + match[1].length;
        const markdownChunk = source.slice(cursor, matchStart);
        if (markdownChunk) {
            segments.push({ type: "markdown", content: markdownChunk });
        }
        segments.push({
            type: "code",
            language: String(match[2] || "").trim().toLowerCase(),
            content: String(match[3] || "").replace(/\n$/, ""),
        });
        cursor = matchStart + match[0].length - match[1].length;
    }

    const tail = source.slice(cursor);
    if (tail) {
        segments.push({ type: "markdown", content: tail });
    }

    return segments.length ? segments : [{ type: "markdown", content: source }];
}

function autolinkPlainUrls(text = "") {
    const source = String(text || "");
    if (!source) return source;

    const fencedSegments = source.split(/(```[\s\S]*?```)/g);
    return fencedSegments
        .map((segment) => {
            if (/^```[\s\S]*```$/.test(segment)) {
                return segment;
            }
            return segment
                .split(/(`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g)
                .map((inlineSegment) => {
                    if (/^`[^`\n]+`$/.test(inlineSegment) || /^\[[^\]]+\]\([^)]+\)$/.test(inlineSegment)) {
                        return inlineSegment;
                    }
                    return inlineSegment.replace(
                        /(?<!\]\()(?<!["'(])\b(https?:\/\/[^\s<)]+[^\s<.,!?;:)])/gi,
                        (match) => `[${match}](${match})`
                    );
                })
                .join("");
        })
        .join("");
}

function resolveReferenceStyleLinks(text = "") {
    const source = String(text || "");
    if (!source) return source;

    const definitions = new Map();
    const withoutDefinitions = source.replace(
        /(^|\n)\[([^\]]+)]\s*:\s*(<[^>\n]+>|[^\s\n]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*(?=\n|$)/g,
        (_, prefix, label, target) => {
            const normalizedLabel = String(label || "").trim().toLowerCase();
            const normalizedTarget = String(target || "").trim().replace(/^<|>$/g, "");
            if (normalizedLabel && normalizedTarget) {
                definitions.set(normalizedLabel, normalizedTarget);
            }
            return prefix;
        }
    );

    if (!definitions.size) {
        return source;
    }

    const protectedSegments = withoutDefinitions.split(/(`[^`\n]+`|\[[^\]]+\]\([^)]+\))/g);
    return protectedSegments
        .map((segment) => {
            if (/^`[^`\n]+`$/.test(segment) || /^\[[^\]]+\]\([^)]+\)$/.test(segment)) {
                return segment;
            }

            let nextSegment = segment.replace(
                /\[([^\]]+)]\[([^\]]+)]/g,
                (match, textLabel, referenceLabel) => {
                    const resolved = definitions.get(String(referenceLabel || "").trim().toLowerCase());
                    return resolved ? `[${textLabel}](${resolved})` : match;
                }
            );

            nextSegment = nextSegment.replace(
                /\[([^\]]+)]\[\]/g,
                (match, textLabel) => {
                    const resolved = definitions.get(String(textLabel || "").trim().toLowerCase());
                    return resolved ? `[${textLabel}](${resolved})` : match;
                }
            );

            nextSegment = nextSegment.replace(
                /(^|[^\]!])\[([^\]]+)](?!\(|\[)/g,
                (match, prefix, textLabel) => {
                    const resolved = definitions.get(String(textLabel || "").trim().toLowerCase());
                    return resolved ? `${prefix}[${textLabel}](${resolved})` : match;
                }
            );

            return nextSegment;
        })
        .join("");
}

const STATUS_PATTERNS = [
    { pattern: /(^|[\s(>])((?:✅|🟢)?\s*Active)(?=$|[\s),.!?:;])/g, variant: "active" },
    { pattern: /(^|[\s(>])((?:⚠️|🕒|🟡|⬜|◻️|☐)?\s*Pending)(?=$|[\s),.!?:;])/g, variant: "pending" },
    { pattern: /(^|[\s(>])((?:⚠️|🔴)?\s*Inactive)(?=$|[\s),.!?:;])/g, variant: "inactive" },
    { pattern: /(^|[\s(>])((?:❌|⛔|🔴)?\s*Blocked)(?=$|[\s),.!?:;])/g, variant: "blocked" },
];

const EXACT_STATUS_VARIANTS = [
    { pattern: /^(?:✅|🟢|\[x\])?\s*active$/i, variant: "active" },
    { pattern: /^(?:⚠️|🕒|🟡|⬜|◻️|☐|\[ \])?\s*pending$/i, variant: "pending" },
    { pattern: /^(?:⚠️|🔴)?\s*inactive$/i, variant: "inactive" },
    { pattern: /^(?:❌|⛔|🔴)?\s*blocked$/i, variant: "blocked" },
];
const STATUS_ICONS = {
    active: "✅",
    pending: "🕒",
    inactive: "⚠️",
    blocked: "❌",
};

function renderStatusAwareText(text = "") {
    const source = String(text || "");
    if (!source) return source;

    const matches = [];
    for (const { pattern, variant } of STATUS_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            matches.push({
                start: match.index + match[1].length,
                end: match.index + match[0].length,
                prefix: match[1],
                value: match[2],
                variant,
            });
        }
    }

    if (matches.length === 0) {
        return source;
    }

    matches.sort((a, b) => a.start - b.start);
    const filtered = [];
    for (const match of matches) {
        const previous = filtered[filtered.length - 1];
        if (previous && match.start < previous.end) continue;
        filtered.push(match);
    }

    const parts = [];
    let cursor = 0;
    filtered.forEach((match, index) => {
        if (match.start > cursor) {
            parts.push(source.slice(cursor, match.start));
        }
        parts.push(
            <span key={`status-${match.start}-${index}`}>
                {match.prefix}
                <span className={`status-pill status-pill--${match.variant}`}>{match.value}</span>
            </span>
        );
        cursor = match.end;
    });
    if (cursor < source.length) {
        parts.push(source.slice(cursor));
    }

    return parts;
}

function detectExactStatusVariant(text = "") {
    const normalized = String(text || "").trim();
    if (!normalized) return null;
    const match = EXACT_STATUS_VARIANTS.find((item) => item.pattern.test(normalized));
    return match?.variant || null;
}

function extractTaskListStatusData(node, state = { hasCheckbox: false, checked: false, textParts: [], complex: false }) {
    if (typeof node === "string") {
        const value = node.replace(/\s+/g, " ").trim();
        if (value) {
            state.textParts.push(value);
        }
        return state;
    }

    if (!React.isValidElement(node)) {
        return state;
    }

    if (node.type === "input" && node.props?.type === "checkbox") {
        state.hasCheckbox = true;
        state.checked = !!node.props?.checked;
        return state;
    }

    const children = React.Children.toArray(node.props?.children);
    if (!children.length) {
        state.complex = true;
        return state;
    }

    children.forEach((child) => extractTaskListStatusData(child, state));
    return state;
}

function enhanceMarkdownChildren(children) {
    return React.Children.map(children, (child) => {
        if (typeof child === "string") {
            return renderStatusAwareText(child);
        }
        if (!React.isValidElement(child)) {
            return child;
        }
        if (child.type === "code" || child.type === "pre" || child.props?.className?.includes?.("status-pill")) {
            return child;
        }
        if (!child.props?.children) {
            return child;
        }
        return React.cloneElement(child, {
            ...child.props,
            children: enhanceMarkdownChildren(child.props.children),
        });
    });
}

function createStatusAwareComponent(tagName) {
    return ({ children, ...props }) => React.createElement(
        tagName,
        props,
        enhanceMarkdownChildren(children)
    );
}

function createHeadingComponent(tagName) {
    return ({ children, ...props }) => {
        const { anchorPrefix, anchorCountsRef } = React.useContext(AnchorScopeContext);
        const text = flattenTextContent(children);
        const slug = slugifyHeadingId(text);
        let id;
        if (slug) {
            const nextCount = (anchorCountsRef?.current?.get(slug) || 0) + 1;
            anchorCountsRef?.current?.set(slug, nextCount);
            id = `${anchorPrefix}-${slug}${nextCount > 1 ? `-${nextCount}` : ""}`;
        }
        return React.createElement(
            tagName,
            {
                ...props,
                id: id || undefined,
                "data-anchor-slug": slug || undefined,
            },
            enhanceMarkdownChildren(children)
        );
    };
}

function normalizeAnchorHref(href = "") {
    const rawHref = unwrapMarkdownLinkHref(href);
    if (!rawHref) return rawHref;
    if (rawHref.startsWith("#")) {
        return `#${slugifyHeadingId(rawHref.slice(1))}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref) || rawHref.startsWith("/") || rawHref.startsWith("?")) {
        return rawHref;
    }
    if (/^[a-z0-9][a-z0-9 -]*$/i.test(rawHref)) {
        return `#${slugifyHeadingId(rawHref)}`;
    }
    return rawHref;
}

function findBestAnchorTarget(containerRef, targetSlug) {
    const scopeRoot = containerRef?.current || document;
    const localTarget = scopeRoot.querySelector?.(`[data-anchor-slug="${targetSlug}"]`);
    if (localTarget) {
        return localTarget;
    }

    const allTargets = Array.from(document.querySelectorAll(`[data-anchor-slug="${targetSlug}"]`));
    if (allTargets.length === 0) {
        return null;
    }

    const currentRoot = containerRef?.current;
    if (!currentRoot) {
        return allTargets[0];
    }

    const precedingTargets = allTargets.filter((candidate) =>
        !!(candidate.compareDocumentPosition(currentRoot) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
    if (precedingTargets.length > 0) {
        return precedingTargets[precedingTargets.length - 1];
    }

    const followingTargets = allTargets.filter((candidate) =>
        !!(candidate.compareDocumentPosition(currentRoot) & Node.DOCUMENT_POSITION_PRECEDING)
    );
    return followingTargets[0] || allTargets[0];
}

function AnchorLink({ href = "", children, ...props }) {
    const { containerRef } = React.useContext(AnchorScopeContext);
    const normalizedHref = normalizeAnchorHref(href);
    const isExternalHref = /^(https?:\/\/|file:\/\/|mailto:)/i.test(normalizedHref);

    const handleClick = (event) => {
        if (isExternalHref) {
            event.preventDefault();
            event.stopPropagation();
            window.electron?.system?.openExternal?.(normalizedHref);
            return;
        }

        if (!normalizedHref.startsWith("#")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const targetId = normalizedHref.slice(1);
        if (!targetId) return;
        const target = findBestAnchorTarget(containerRef, targetId);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    return React.createElement("a", {
        ...props,
        href: normalizedHref,
        onClick: handleClick,
    }, children);
}

function StatusAwareListItem({ children, ...props }) {
    const items = React.Children.toArray(children);
    const taskStatusData = items.reduce((acc, child) => extractTaskListStatusData(child, acc), {
        hasCheckbox: false,
        checked: false,
        textParts: [],
        complex: false,
    });
    const statusText = taskStatusData.textParts.join(" ").trim();
    const statusVariant = detectExactStatusVariant(statusText);

    if (!taskStatusData.hasCheckbox || !statusVariant || !statusText) {
        return React.createElement("li", props, enhanceMarkdownChildren(children));
    }
    const statusLabel = statusText.replace(/^\[(?: |x|X)\]\s*/i, "").trim();
    const statusIcon = STATUS_ICONS[statusVariant] || (taskStatusData.checked ? "☑" : "☐");

    return React.createElement(
        "li",
        props,
        <span className={`status-pill status-pill--${statusVariant}`}>
            <span>{statusIcon}</span>
            <span>{statusLabel}</span>
        </span>,
    );
}

const markdownOptions = {
    overrides: {
        a: { component: AnchorLink },
        h1: { component: createHeadingComponent("h1") },
        h2: { component: createHeadingComponent("h2") },
        h3: { component: createHeadingComponent("h3") },
        h4: { component: createHeadingComponent("h4") },
        h5: { component: createHeadingComponent("h5") },
        h6: { component: createHeadingComponent("h6") },
        p: { component: createStatusAwareComponent("p") },
        li: { component: StatusAwareListItem },
        td: { component: createStatusAwareComponent("td") },
        th: { component: createStatusAwareComponent("th") },
    },
};

function renderMarkdownSegment(content, key) {
    const normalized = autolinkPlainUrls(resolveReferenceStyleLinks(normalizeAsciiEmoticons(content)));
    if (!normalized.trim()) {
        return null;
    }

    return (
        <Markdown key={key} options={markdownOptions}>
            {normalized}
        </Markdown>
    );
}

function renderCodeSegment(segment, key) {
    return (
        <div key={key} className={styles.codeBlockWrap}>
            {segment.language ? (
                <div className={styles.codeBlockLanguage}>{segment.language}</div>
            ) : null}
            <pre>
                <code>{segment.content}</code>
            </pre>
        </div>
    );
}

export default function MarkdownRenderer({ skeleton, text, attachments, role }) {
    const anchorPrefix = React.useId().replace(/:/g, "");
    const containerRef = React.useRef(null);
    const anchorCountsRef = React.useRef(new Map());
    const combinedText = attachments ? `${String(text || "")}\n\n${String(attachments || "")}` : String(text || "");
    const segments = splitMarkdownAndCodeFences(combinedText);
    anchorCountsRef.current = new Map();

    return (
        <AnchorScopeContext.Provider value={{ anchorPrefix, anchorCountsRef, containerRef }}>
            <div
                ref={containerRef}
                className={classnames(skeleton ? 'bp6-skeleton' : styles["markdown-body"], role !== "user" && "markdown-body")}
            >
                {segments.map((segment, index) => (
                    segment.type === "code"
                        ? renderCodeSegment(segment, `code-${index}`)
                        : renderMarkdownSegment(segment.content, `markdown-${index}`)
                ))}
            </div>
        </AnchorScopeContext.Provider>
    );
}
