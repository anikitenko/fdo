// tools/search_web.js
/**
 * Web Search Tool for AI Chat
 * Uses DuckDuckGo instant results first, then falls back to HTML result scraping.
 */

import {SEARCH_WEB_ECOSYSTEMS} from "./search_web_ecosystems.js";

function stripHtml(value = "") {
    return String(value)
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

function decodeDuckDuckGoUrl(url = "") {
    try {
        const parsed = new URL(url);
        const uddg = parsed.searchParams.get("uddg");
        return uddg ? decodeURIComponent(uddg) : url;
    } catch {
        return url;
    }
}

function uniqueStrings(values = []) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        const normalized = String(value || "").trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(normalized);
    }
    return output;
}

const QUERY_STOPWORDS = new Set([
    "and", "can", "you", "search", "for", "something", "related", "to",
    "what", "about", "the", "this", "that", "these", "those", "does",
    "do", "did", "is", "are", "was", "were", "know", "me", "tell",
    "oh", "i", "was", "talking", "mean", "meant", "but", "it",
    "ok", "okay", "well", "sure", "yeah", "yes",
    "how", "why", "with", "from", "into", "your", "there", "here",
    "curious", "nodejs", "node", "js", "code", "integration", "implement",
]);

const LANGUAGE_ECOSYSTEMS = SEARCH_WEB_ECOSYSTEMS;

function fillTemplate(template = "", pkg = "") {
    const raw = String(pkg || "").trim();
    const encoded = encodeURIComponent(raw);
    return String(template || "")
        .replace(/\{pkgEncoded\}/g, encoded)
        .replace(/\{pkg\}/g, raw);
}

function buildHeuristicItems(ecosystem, pkg = "", title = "") {
    return (ecosystem?.heuristicSources || []).map((item) => ({
        title: String(item.title || "")
            .replace(/\{title\}/g, title)
            .replace(/\{pkg\}/g, pkg),
        snippet: String(item.snippet || "")
            .replace(/\{title\}/g, title)
            .replace(/\{pkg\}/g, pkg),
        url: fillTemplate(item.url || "", pkg),
    }));
}

function extractQueryTerms(query = "") {
    return uniqueStrings(
        String(query || "")
            .toLowerCase()
            .replace(/[^a-z0-9@._-]+/gi, " ")
            .split(/\s+/)
            .map((term) => term.trim())
            .filter((term) => term.length >= 3 && !QUERY_STOPWORDS.has(term))
    );
}

function extractAnchorTerms(query = "") {
    const terms = extractQueryTerms(query);
    const strongTerms = terms.filter((term) => term.length >= 5 || term.startsWith("@"));
    return (strongTerms.length > 0 ? strongTerms : terms).slice(0, 3);
}

function detectQueryEcosystems(query = "") {
    const q = String(query || "").toLowerCase();
    return LANGUAGE_ECOSYSTEMS.filter((ecosystem) => ecosystem.triggers.some((term) => q.includes(term)));
}

function extractRequestedEcosystem(query = "") {
    const normalized = String(query || "")
        .toLowerCase()
        .replace(/[^a-z0-9#+._/-]+/g, " ")
        .trim();
    if (!normalized) return "";

    const patterns = [
        /\b(?:with|in|for|using)\s+([a-z0-9#+._/-]{2,})\b/i,
        /\b([a-z0-9#+._/-]{2,})\s+(?:integration|implementation|setup|sdk|client)\b/i,
    ];

    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    return "";
}

function normalizeSearchQuery(query = "") {
    return String(query || "")
        .replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, "")
        .replace(/^(and\s+can\s+you\s+)?search\s+(something\s+)?related\s+to\s+/i, "")
        .replace(/^(can\s+you\s+)?search\s+for\s+/i, "")
        .replace(/^(can\s+you\s+)?look\s+up\s+/i, "")
        .replace(/^(can\s+you\s+)?find\s+/i, "")
        .replace(/^(oh[,.\s]+)?(i\s+(was\s+)?)?talking\s+about\s+/i, "")
        .replace(/^(oh[,.\s]+)?i\s+(mean|meant)\s+/i, "")
        .replace(/^documents?\s+of\s+/i, "")
        .replace(/^files?\s+of\s+/i, "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildSpellingVariants(query = "") {
    const q = String(query || "").trim();
    if (!q) return [];
    const variants = [];

    const substitutionSets = [
        [/scht/gi, "st"],
        [/sch/gi, "sh"],
        [/eiin/gi, "ein"],
        [/epshtein/gi, "epstein"],
        [/epschtein/gi, "epstein"],
    ];

    for (const [pattern, replacement] of substitutionSets) {
        const variant = q.replace(pattern, replacement).trim();
        if (variant && variant.toLowerCase() !== q.toLowerCase()) {
            variants.push(variant);
        }
    }

    return uniqueStrings(variants);
}

function buildSearchVariants(query = "") {
    const original = String(query || "").trim();
    const normalized = normalizeSearchQuery(original);
    const spellingVariants = buildSpellingVariants(normalized);
    const variants = [original, normalized, ...spellingVariants];
    const anchorTerms = extractAnchorTerms(normalized);
    const productLikeTerm = anchorTerms[0] || "";
    const requestedEcosystem = extractRequestedEcosystem(normalized);

    if (/\bepstein\b/i.test(normalized) && /\bfiles?\b/i.test(normalized) && !/\bjeffrey\b/i.test(normalized)) {
        variants.push(normalized.replace(/\bepstein\b/i, "Jeffrey Epstein"));
    }

    if (/\bdocuments?\b/i.test(original) && normalized && !/\bdocuments?\b/i.test(normalized)) {
        variants.push(`${normalized} documents`);
    }

    const ecosystems = detectQueryEcosystems(normalized);
    const isDeveloperOrSdkQuery = /\b(sdk|integration|implement|implementation|tracing|observability|docs?|documentation|github)\b/i.test(normalized) || ecosystems.length > 0;

    if (productLikeTerm && normalized.split(/\s+/).length <= 6) {
        variants.push(`${productLikeTerm} documentation`);
        variants.push(`${productLikeTerm} github`);
    }

    if (productLikeTerm && isDeveloperOrSdkQuery) {
        if (requestedEcosystem) {
            variants.push(`${productLikeTerm} ${requestedEcosystem}`);
            variants.push(`${productLikeTerm} ${requestedEcosystem} integration`);
            variants.push(`${productLikeTerm} ${requestedEcosystem} docs`);
        }
        for (const ecosystem of ecosystems) {
            for (const term of ecosystem.variantTerms) {
                variants.push(`${productLikeTerm} ${term}`);
            }
        }
        if (ecosystems.length === 0) {
            variants.push(`${productLikeTerm} SDK`);
        }
        variants.push(`${productLikeTerm} official docs`);
        variants.push(`site:github.com ${productLikeTerm} ${normalized}`);
        variants.push(`site:${productLikeTerm.toLowerCase()}.com ${normalized}`);
    }

    if (/\blangfuse\b/i.test(normalized)) {
        variants.push("Langfuse documentation");
        variants.push("Langfuse GitHub");
        variants.push("Langfuse Node.js SDK");
        variants.push("site:langfuse.com Langfuse Node.js");
    }

    return uniqueStrings(variants).slice(0, 8);
}

function looksLikeLibraryQuery(query = "") {
    const q = String(query).toLowerCase();
    const triggers = [
        "library",
        "package",
        "npm",
        "python",
        "pypi",
        "nodejs",
        "node.js",
        "javascript",
        "typescript",
        "integration",
        "implementation",
        "install",
        "setup",
        "docs",
        "documentation",
        "usage",
        "example",
        "examples",
        ".js",
        ".ts",
        "api",
        "sdk",
    ];
    return triggers.some((term) => q.includes(term));
}

function shouldUseNpmSearch(query = "") {
    const q = String(query).toLowerCase();
    const ecosystems = detectQueryEcosystems(q).map((item) => item.id);
    if (ecosystems.includes("python")) return false;
    if (ecosystems.some((id) => !["node", "python"].includes(id))) return false;
    if (/\bnpm\b|\bpackage\b/.test(q)) return true;
    const anchors = extractAnchorTerms(q);
    if (anchors.length === 1 && looksLikeLibraryQuery(q)) return true;
    return anchors.length >= 1 && /\b(nodejs|node\.js|javascript|typescript|sdk|integration|implementation|install|setup)\b/.test(q);
}

function shouldUsePyPiSearch(query = "") {
    const q = String(query).toLowerCase();
    const ecosystems = detectQueryEcosystems(q).map((item) => item.id);
    if (ecosystems.includes("python")) return true;
    const anchors = extractAnchorTerms(q);
    return anchors.length >= 1 && /\b(python|sdk|integration|implementation|install|setup)\b/.test(q);
}

async function fetchNpmResults(query) {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`;
    const res = await fetch(url, {
        headers: {
            "Accept": "application/json",
        },
    });
    const data = await res.json();
    const objects = Array.isArray(data?.objects) ? data.objects : [];

    return objects.map((entry) => {
        const pkg = entry?.package || {};
        return {
            title: pkg.name || query,
            snippet: [pkg.description, pkg.version ? `version ${pkg.version}` : null]
                .filter(Boolean)
                .join(" • "),
            url: pkg.links?.npm || (pkg.name ? `https://www.npmjs.com/package/${pkg.name}` : ""),
        };
    }).filter((item) => item.title || item.snippet || item.url);
}

async function fetchExactNpmPackage(packageName = "") {
    const name = String(packageName || "").trim();
    if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        return null;
    }

    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: {
            "Accept": "application/json",
        },
    });
    if (!res.ok) {
        return null;
    }

    const data = await res.json();
    const latestVersion = data?.["dist-tags"]?.latest || "";
    return {
        title: data?.name || name,
        snippet: [data?.description, latestVersion ? `version ${latestVersion}` : null]
            .filter(Boolean)
            .join(" • "),
        url: `https://www.npmjs.com/package/${encodeURIComponent(data?.name || name)}`,
    };
}

async function fetchPyPiResults(query) {
    const anchors = extractAnchorTerms(query);
    const packageNames = uniqueStrings([
        ...anchors,
        ...anchors.map((term) => term.replace(/^@/, "")),
    ]).slice(0, 3);

    const results = [];
    for (const name of packageNames) {
        if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) continue;
        const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
            headers: {
                "Accept": "application/json",
            },
        }).catch(() => null);
        if (!res?.ok) continue;
        const data = await res.json().catch(() => null);
        if (!data?.info?.name) continue;
        results.push({
            title: data.info.name,
            snippet: [data.info.summary, data.info.version ? `version ${data.info.version}` : null]
                .filter(Boolean)
                .join(" • "),
            url: `https://pypi.org/project/${encodeURIComponent(data.info.name)}/`,
        });
    }

    return dedupeResults(results);
}

async function fetchInstantResults(query) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url);
    const data = await res.json();

    const related = Array.isArray(data.RelatedTopics)
        ? data.RelatedTopics.flatMap((item) => {
            if (item?.Text && item?.FirstURL) {
                return [{ title: item.Text, snippet: item.Text, url: item.FirstURL }];
            }
            if (Array.isArray(item?.Topics)) {
                return item.Topics
                    .filter((topic) => topic?.Text && topic?.FirstURL)
                    .map((topic) => ({ title: topic.Text, snippet: topic.Text, url: topic.FirstURL }));
            }
            return [];
        })
        : [];

    const results = [];
    if (data.AbstractURL || data.Abstract) {
        results.push({
            title: data.Heading || query,
            snippet: data.Abstract || data.Heading || query,
            url: data.AbstractURL || "",
        });
    }
    results.push(...related);
    return results.filter((item) => item.url || item.snippet);
}

async function fetchHtmlResults(query) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FDO/1.0; +https://duckduckgo.com/)",
        },
    });
    const html = await res.text();

    const results = [];
    const resultBlocks = html.match(/<div class="result__body">[\s\S]*?<\/div>\s*<\/div>/g) || [];
    for (const block of resultBlocks.slice(0, 8)) {
        const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;

        const rawUrl = linkMatch[1];
        const title = stripHtml(linkMatch[2]);
        const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
            || block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
        const snippet = stripHtml(snippetMatch?.[1] || "");
        const decodedUrl = decodeDuckDuckGoUrl(rawUrl);

        results.push({
            title,
            snippet,
            url: decodedUrl,
        });
    }

    return results.filter((item) => item.title || item.snippet || item.url);
}

async function fetchUrlTitle(url = "") {
    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; FDO/1.0; +https://duckduckgo.com/)",
        },
        redirect: "follow",
    });
    if (!res.ok) {
        return null;
    }
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = stripHtml(titleMatch?.[1] || "");
    return {
        title: title || url,
        snippet: title || "",
        url: res.url || url,
    };
}

async function fetchDirectDeveloperSourceFallback(query = "") {
    const anchors = extractAnchorTerms(query);
    const productLikeTerm = anchors[0] || "";
    if (!productLikeTerm) {
        return [];
    }
    const ecosystems = detectQueryEcosystems(query);
    const requestedEcosystem = extractRequestedEcosystem(query);

    const candidates = [];
    const exactNpm = await fetchExactNpmPackage(productLikeTerm).catch(() => null);
    if (exactNpm && (ecosystems.length === 0 || ecosystems.some((item) => item.id === "node"))) {
        candidates.push(exactNpm);
    }
    if (ecosystems.length === 0 || ecosystems.some((item) => item.id === "python")) {
        const pyPiResults = await fetchPyPiResults(query).catch(() => []);
        candidates.push(...pyPiResults);
    }

    const likelyUrls = uniqueStrings([
        `https://${productLikeTerm}.com/docs`,
        `https://docs.${productLikeTerm}.com`,
        `https://${productLikeTerm}.com`,
        `https://github.com/${productLikeTerm}/${productLikeTerm}`,
        requestedEcosystem ? `https://${productLikeTerm}.com/docs/${requestedEcosystem}` : "",
        ...ecosystems.flatMap((ecosystem) => (ecosystem.directUrlTemplates || []).map((template) => fillTemplate(template, productLikeTerm))),
    ]);

    for (const url of likelyUrls) {
        const result = await fetchUrlTitle(url).catch(() => null);
        if (result) {
            candidates.push(result);
        }
    }

    return dedupeResults(candidates);
}

function buildHeuristicDeveloperSourceFallback(query = "") {
    const anchors = extractAnchorTerms(query);
    const productLikeTerm = anchors[0] || "";
    if (!productLikeTerm) {
        return [];
    }

    const normalized = String(productLikeTerm).toLowerCase();
    const titleName = productLikeTerm;
    const ecosystems = detectQueryEcosystems(query);
    const requestedEcosystem = extractRequestedEcosystem(query);

    const candidates = [
        {
            title: `${titleName} Docs`,
            snippet: `Likely official documentation source for ${titleName}.`,
            url: `https://${normalized}.com/docs`,
        },
        {
            title: `${titleName} Website`,
            snippet: `Likely official website for ${titleName}.`,
            url: `https://${normalized}.com`,
        },
        {
            title: `${titleName} GitHub`,
            snippet: `Likely GitHub repository for ${titleName}.`,
            url: `https://github.com/${normalized}/${normalized}`,
        },
        ...(requestedEcosystem ? [{
            title: `${titleName} ${requestedEcosystem} docs`,
            snippet: `Likely ${requestedEcosystem} documentation entry for ${titleName}.`,
            url: `https://${normalized}.com/docs/${requestedEcosystem}`,
        }] : []),
        ...(ecosystems.length > 0
            ? ecosystems.flatMap((ecosystem) => buildHeuristicItems(ecosystem, normalized, titleName))
            : [
                {
                    title: `${titleName} npm package`,
                    snippet: `Likely npm package page for ${titleName}.`,
                    url: `https://www.npmjs.com/package/${normalized}`,
                },
                {
                    title: `${titleName} PyPI package`,
                    snippet: `Likely PyPI package page for ${titleName}.`,
                    url: `https://pypi.org/project/${normalized}/`,
                },
            ]),
    ];

    return dedupeResults(candidates);
}

function dedupeResults(results = []) {
    const seen = new Set();
    const deduped = [];

    for (const result of results) {
        const key = (result.url || result.title || result.snippet || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(result);
    }

    return deduped;
}

function isUsefulResult(result = {}, query = "") {
    const haystack = [result.title, result.snippet, result.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const q = String(query || "").toLowerCase();
    if (!haystack) return false;
    if (haystack.includes("no results")) return false;
    if (haystack.includes("duckduckgo")) return false;
    const meaningfulTerms = extractAnchorTerms(q);
    if (meaningfulTerms.length === 0) return true;
    const matchedCount = meaningfulTerms.filter((term) => haystack.includes(term)).length;
    if (meaningfulTerms.length >= 2) {
        return matchedCount >= 2;
    }
    return matchedCount >= 1;
}

function scoreWebResult(result = {}, query = "") {
    const haystack = [result.title, result.snippet, result.url]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    const anchorTerms = extractAnchorTerms(query);
    const url = String(result.url || "").toLowerCase();
    let score = 0;
    const reasons = [];

    for (const term of anchorTerms) {
        if (haystack.includes(term)) {
            score += 3;
            reasons.push(`term:${term}`);
        }
    }

    if (result.title) {
        const title = String(result.title).toLowerCase();
        for (const term of anchorTerms) {
            if (title.includes(term)) {
                score += 2;
                reasons.push(`title:${term}`);
            }
        }
    }

    const ecosystems = detectQueryEcosystems(query);
    const ecosystemTrustedMatch = ecosystems.some((ecosystem) => ecosystem.trustedDomains.some((domain) => url.includes(domain)));

    if (/langfuse\.com|github\.com\/langfuse|npmjs\.com\/package\/langfuse|pypi\.org\/project\/langfuse/.test(url)) {
        score += 5;
        reasons.push("official-ish-domain");
    } else if (ecosystemTrustedMatch || /github\.com|npmjs\.com|pypi\.org|docs\./.test(url)) {
        score += 2;
        reasons.push("trusted-dev-domain");
    }

    const matchedAnchors = anchorTerms.filter((term) => haystack.includes(term)).length;
    if (anchorTerms.length > 0 && matchedAnchors === 0) {
        score -= 6;
        reasons.push("missing-anchor");
    } else if (anchorTerms.length >= 2 && matchedAnchors < 2) {
        score -= 4;
        reasons.push("partial-anchor-match");
    }

    return { score, reasons };
}

function buildSummary(query, results = []) {
    if (results.length === 0) {
        return `No useful web results found for "${query}".`;
    }

    return [
        `Top web results for "${query}":`,
        ...results.map((result, index) => {
            const parts = [`${index + 1}. ${result.title || result.url}`];
            if (result.snippet) parts.push(result.snippet);
            if (result.url) parts.push(result.url);
            return parts.join("\n");
        }),
    ].join("\n\n");
}

export const searchWebTool = {
    name: "search_web",
    description: "Search the web for recent or external information using DuckDuckGo results",
    input_schema: {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query, e.g., 'LLM.js usage examples'" },
        },
        required: ["query"],
    },

    shouldActivate(prompt) {
        if (!prompt) return false;
        const q = String(prompt).toLowerCase();
        const triggers = [
            "search", "find", "look up", "current", "latest", "today",
            "recent", "news", "update", "google", "web", "internet",
        ];
        return triggers.some(k => q.includes(k));
    },

    async handler(input) {
        try {
            const query = String(input?.query || "").trim();
            if (!query) return { name: "search_web", ok: false, results: [], sources: [], error: "Query is required" };

            const variants = buildSearchVariants(query);
            let results = [];
            let usedQueries = [];

            for (const variant of variants) {
                const instantResults = await fetchInstantResults(variant).catch(() => []);
                let variantResults = instantResults;

                if (shouldUseNpmSearch(variant)) {
                    const npmResults = await fetchNpmResults(variant).catch(() => []);
                    variantResults = dedupeResults([...variantResults, ...npmResults]);
                }

                if (shouldUsePyPiSearch(variant)) {
                    const pyPiResults = await fetchPyPiResults(variant).catch(() => []);
                    variantResults = dedupeResults([...variantResults, ...pyPiResults]);
                }

                if (variantResults.length < 3) {
                    const htmlResults = await fetchHtmlResults(variant).catch(() => []);
                    variantResults = dedupeResults([...variantResults, ...htmlResults]);
                } else {
                    variantResults = dedupeResults(variantResults);
                }

                const usefulResults = variantResults
                    .filter((result) => isUsefulResult(result, query))
                    .map((result) => {
                        const ranking = scoreWebResult(result, query);
                        return {
                            ...result,
                            _score: ranking.score,
                            _why: ranking.reasons,
                        };
                    })
                    .filter((result) => result._score >= 0)
                    .sort((a, b) => b._score - a._score);
                if (usefulResults.length > 0) {
                    usedQueries.push(variant);
                    results = dedupeResults([...results, ...usefulResults]);
                }

                if (results.length >= 5) {
                    break;
                }
            }

            if (results.length === 0) {
                const directFallbackResults = await fetchDirectDeveloperSourceFallback(query).catch(() => []);
                if (directFallbackResults.length > 0) {
                    usedQueries.push("[direct-developer-fallback]");
                    results = dedupeResults(directFallbackResults);
                }
            }

            if (results.length === 0 && /\b(nodejs|node\.js|javascript|typescript|sdk|integration|implementation|docs?|documentation|github|observability|tracing)\b/i.test(query)) {
                const heuristicFallbackResults = buildHeuristicDeveloperSourceFallback(query);
                if (heuristicFallbackResults.length > 0) {
                    usedQueries.push("[heuristic-developer-fallback]");
                    results = dedupeResults(heuristicFallbackResults);
                }
            }

            const rankedResults = results
                .map((result) => {
                    const ranking = scoreWebResult(result, query);
                    return {
                        ...result,
                        _score: Number.isFinite(result._score) ? result._score : ranking.score,
                        _why: Array.isArray(result._why) ? result._why : ranking.reasons,
                    };
                })
                .sort((a, b) => b._score - a._score);
            const topResults = rankedResults.slice(0, 6);
            return {
                name: "search_web",
                ok: true,
                query,
                text: buildSummary(query, topResults),
                results: topResults,
                sources: topResults.map((item) => ({
                    source: item.url,
                    why: item.title || item.snippet || query,
                })),
                data: {
                    heading: "Web Search Results",
                    usedQueries,
                    results: topResults.map(({_score, _why, ...item}) => ({
                        ...item,
                        score: _score,
                        why: _why,
                    })),
                },
            };
        } catch (err) {
            return { name: "search_web", ok: false, results: [], sources: [], error: String(err?.message || err) };
        }
    },
};
