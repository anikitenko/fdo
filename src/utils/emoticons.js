import emojiData from "emojibase-data/en/compact.json";

const FALLBACK_TEXT_REACTIONS = new Map([
    ["(facepalm)", "🤦"],
    ["(shrug)", "🤷"],
    ["(tableflip)", "(╯°□°)╯︵ ┻━┻"],
]);

const QUICK_EMOJI_FALLBACKS = new Map([
    ["thumbs up", "👍"],
    ["thumbs up: light skin tone", "👍🏻"],
    ["thumbs up: medium-light skin tone", "👍🏼"],
    ["thumbs up: medium skin tone", "👍🏽"],
    ["thumbs up: medium-dark skin tone", "👍🏾"],
    ["thumbs up: dark skin tone", "👍🏿"],
    ["flag: Ukraine", "🇺🇦"],
]);

const QUICK_CHAT_EMOJI_LABELS = [
    "slightly smiling face",
    "winking face",
    "thinking face",
    "face with tears of joy",
    "rolling on the floor laughing",
    "smiling face with smiling eyes",
    "smiling face with hearts",
    "melting face",
    "face with rolling eyes",
    "neutral face",
    "expressionless face",
    "face with hand over mouth",
    "zipper-mouth face",
    "face with monocle",
    "loudly crying face",
    "angry face",
    "fire",
    "sparkles",
    "collision",
    "warning",
    "check mark button",
    "cross mark",
    "light bulb",
    "bullseye",
    "eyes",
    "rocket",
    "hammer and wrench",
    "bug",
    "paperclip",
    "pushpin",
    "round pushpin",
    "thumbs up",
    "thumbs up: light skin tone",
    "thumbs up: medium skin tone",
    "thumbs up: medium-dark skin tone",
    "thumbs up: dark skin tone",
    "clapping hands",
    "folded hands",
    "red heart",
    "green heart",
    "blue heart",
    "purple heart",
    "flag: Ukraine",
];

function escapeRegex(value = "") {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAliasToEmojiMap() {
    const aliasMap = new Map();

    for (const item of emojiData) {
        const aliases = Array.isArray(item?.emoticon)
            ? item.emoticon
            : item?.emoticon
                ? [item.emoticon]
                : [];
        const emoji = String(item?.unicode || item?.emoji || "").trim();
        if (!emoji) continue;

        for (const alias of aliases) {
            const normalizedAlias = String(alias || "").trim();
            if (!normalizedAlias || aliasMap.has(normalizedAlias)) continue;
            aliasMap.set(normalizedAlias, emoji);
        }
    }

    for (const [alias, emoji] of FALLBACK_TEXT_REACTIONS.entries()) {
        if (!aliasMap.has(alias)) {
            aliasMap.set(alias, emoji);
        }
    }

    return aliasMap;
}

function buildLabelToEmojiMap() {
    const labelMap = new Map();

    for (const item of emojiData) {
        const label = String(item?.label || "").trim();
        const emoji = String(item?.unicode || item?.emoji || "").trim();
        if (!label || !emoji || labelMap.has(label)) continue;
        labelMap.set(label, emoji);
    }

    return labelMap;
}

function resolveEmojiByLabel(label = "") {
    const normalizedLabel = String(label || "").trim();
    if (!normalizedLabel) return null;

    const fallback = QUICK_EMOJI_FALLBACKS.get(normalizedLabel);
    if (fallback) {
        return { emoji: fallback, label: normalizedLabel };
    }

    const exact = EMOJI_LABEL_MAP.get(normalizedLabel);
    if (exact) {
        return { emoji: exact, label: normalizedLabel };
    }

    const lower = normalizedLabel.toLowerCase();
    const fuzzy = emojiData.find((item) => String(item?.label || "").trim().toLowerCase() === lower);
    if (fuzzy?.unicode) {
        return { emoji: String(fuzzy.unicode).trim(), label: String(fuzzy.label).trim() };
    }

    const prefix = emojiData.find((item) => String(item?.label || "").trim().toLowerCase().startsWith(lower));
    if (prefix?.unicode) {
        return { emoji: String(prefix.unicode).trim(), label: String(prefix.label).trim() };
    }

    return null;
}

const EMOTICON_ALIAS_MAP = buildAliasToEmojiMap();
const EMOJI_LABEL_MAP = buildLabelToEmojiMap();
const EMOTICON_PATTERNS = Array.from(EMOTICON_ALIAS_MAP.keys())
    .sort((a, b) => b.length - a.length)
    .map((alias) => ({
        alias,
        emoji: EMOTICON_ALIAS_MAP.get(alias),
        pattern: new RegExp(`(^|[\\s(])(${escapeRegex(alias)})(?=$|[\\s).,!?:;])`, "g"),
    }));

const EMOTICON_ALIASES = Array.from(EMOTICON_ALIAS_MAP.keys()).sort((a, b) => a.localeCompare(b));
const QUICK_CHAT_EMOJIS = QUICK_CHAT_EMOJI_LABELS
    .map((label) => resolveEmojiByLabel(label))
    .filter(Boolean);
const QUICK_CHAT_EMOJI_SET = new Set(QUICK_CHAT_EMOJIS.map((item) => item.emoji));
const SEARCHABLE_EMOJIS = emojiData
    .map((item) => {
        const emoji = String(item?.unicode || item?.emoji || "").trim();
        const label = String(item?.label || "").trim();
        if (!emoji || !label) return null;
        const aliases = Array.isArray(item?.emoticon)
            ? item.emoticon
            : item?.emoticon
                ? [item.emoticon]
                : [];
        const tags = Array.isArray(item?.tags) ? item.tags : [];
        return {
            emoji,
            label,
            aliases: aliases.map((alias) => String(alias || "").trim()).filter(Boolean),
            tags: tags.map((tag) => String(tag || "").trim()).filter(Boolean),
            group: Number.isFinite(item?.group) ? item.group : null,
        };
    })
    .filter(Boolean);

function replaceEmoticonsInPlainText(text = "") {
    let value = String(text || "");

    for (const entry of EMOTICON_PATTERNS) {
        value = value.replace(entry.pattern, `$1${entry.emoji}`);
    }

    for (const [alias, emoji] of FALLBACK_TEXT_REACTIONS.entries()) {
        value = value.replace(new RegExp(escapeRegex(alias), "gi"), emoji);
    }

    return value;
}

export function normalizeAsciiEmoticons(text = "") {
    const source = String(text || "");
    if (!source) return source;

    const fencedSegments = source.split(/(```[\s\S]*?```)/g);
    return fencedSegments
        .map((segment) => {
            if (/^```[\s\S]*```$/.test(segment)) {
                return segment;
            }
            return segment
                .split(/(`[^`\n]+`)/g)
                .map((inlineSegment) => /^`[^`\n]+`$/.test(inlineSegment)
                    ? inlineSegment
                    : replaceEmoticonsInPlainText(inlineSegment))
                .join("");
        })
        .join("");
}

export function getEmojiCompletionSuggestion(input = "") {
    const raw = String(input || "");
    if (!raw.trim()) return null;
    if (/\n/.test(raw)) return null;

    const trailingToken = raw.match(/(^|[\s(])([:;8xXoO><%][^\s`]*)$/);
    const fallbackToken = trailingToken || raw.match(/(^|[\s(])(\([a-z]+[a-z0-9_-]*\)?)$/i);
    const match = fallbackToken;
    if (!match?.[2]) return null;

    const token = String(match[2] || "");
    const normalizedToken = token.trim();
    if (!normalizedToken || normalizedToken.length < 2) return null;

    const candidateAlias = EMOTICON_ALIASES.find((alias) => alias.toLowerCase().startsWith(normalizedToken.toLowerCase()));
    if (!candidateAlias) return null;

    const emoji = EMOTICON_ALIAS_MAP.get(candidateAlias);
    if (!emoji) {
        return null;
    }

    const start = raw.length - token.length;
    return {
        replacement: `${raw.slice(0, start)}${emoji}`,
        ghostSuffix: emoji,
        alias: candidateAlias,
        emoji,
    };
}

export function getQuickEmojiPalette() {
    return QUICK_CHAT_EMOJIS;
}

export function searchEmojiPalette(query = "", { limit = 60 } = {}) {
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (!normalizedQuery) {
        return QUICK_CHAT_EMOJIS;
    }

    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    const results = SEARCHABLE_EMOJIS
        .map((item) => {
            const haystacks = [
                item.label.toLowerCase(),
                ...item.aliases.map((alias) => alias.toLowerCase()),
                ...item.tags.map((tag) => tag.toLowerCase()),
            ];
            let score = 0;

            for (const term of terms) {
                let matched = false;
                if (item.label.toLowerCase().startsWith(term)) {
                    score += 8;
                    matched = true;
                } else if (item.label.toLowerCase().includes(term)) {
                    score += 5;
                    matched = true;
                } else if (item.aliases.some((alias) => alias.toLowerCase().startsWith(term))) {
                    score += 6;
                    matched = true;
                } else if (haystacks.some((value) => value.includes(term))) {
                    score += 3;
                    matched = true;
                }

                if (!matched) {
                    return null;
                }
            }

            if (QUICK_CHAT_EMOJI_SET.has(item.emoji)) {
                score += 1;
            }

            return { ...item, score };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if ((a.group ?? 99) !== (b.group ?? 99)) return (a.group ?? 99) - (b.group ?? 99);
            return a.label.localeCompare(b.label);
        });

    const deduped = [];
    const seen = new Set();
    for (const item of results) {
        if (seen.has(item.emoji)) continue;
        seen.add(item.emoji);
        deduped.push(item);
        if (deduped.length >= limit) break;
    }

    return deduped;
}
