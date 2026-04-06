function normalizeText(value = "") {
    return String(value || "").toLowerCase();
}

function tokenizeQuery(query = "") {
    return normalizeText(query)
        .split(/[^a-z0-9_@./-]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2);
}

function unique(values = []) {
    return Array.from(new Set(values.filter(Boolean)));
}

function isOperatorStyleQuery(query = "") {
    const text = normalizeText(query);
    const operatorSignals = [
        "system.process.exec",
        "system.process.scope",
        "createprocessexecactionrequest",
        "createscopedprocessexecactionrequest",
        "createprivilegedactioncorrelationid",
        "createprivilegedactionbackendrequest",
        "requestprivilegedaction",
        "getoperatortoolpreset",
        "listoperatortoolpresets",
        "createoperatortoolcapabilitypreset",
        "createoperatortoolactionrequest",
        "requestoperatortool",
        "describecapability",
        "parsemissingcapabilityerror",
        "isprivilegedactionsuccessresponse",
        "isprivilegedactionerrorresponse",
        "unwrapprivilegedactionresponse",
        "docker desktop",
        "docker cli",
        "kubectl",
        "kubernetes",
        "helm",
        "terraform",
        "ansible",
        "aws-cli",
        "aws cli",
        "gcloud",
        "azure-cli",
        "azure cli",
        "podman",
        "kustomize",
        "gh",
        "github cli",
        "git",
        "vault",
        "nomad",
        "operator plugin",
        "operator console",
        "operator-style",
        "scoped execution",
        "host-mediated execution",
    ];
    return operatorSignals.some((signal) => text.includes(signal));
}

function isTransportLevelOperatorQuery(query = "") {
    const text = normalizeText(query);
    const transportSignals = [
        "transport-level",
        "transport level",
        "low-level transport",
        "low level transport",
        "debug privileged transport",
        "debug transport",
        "transport debugging",
        "debugging",
        "requestprivilegedaction",
        "createprocessexecactionrequest",
        "createprivilegedactionbackendrequest",
        "createprivilegedactioncorrelationid",
        "non-curated action family",
        "non curated action family",
        "raw request envelope",
        "request envelope",
    ];
    return transportSignals.some((signal) => text.includes(signal));
}

function getOperatorFixtureBoost(entryPath = "", query = "") {
    const pathText = String(entryPath || "");
    const normalizedQuery = normalizeText(query);
    const transportLevelQuery = isTransportLevelOperatorQuery(query);
    let score = 0;

    if (/examples\/fixtures\/operator-kubernetes-plugin\.fixture\.ts$/i.test(pathText)) score += transportLevelQuery ? 18 : 44;
    if (/examples\/fixtures\/operator-terraform-plugin\.fixture\.ts$/i.test(pathText)) score += transportLevelQuery ? 18 : 44;
    if (/examples\/fixtures\/operator-custom-tool-plugin\.fixture\.ts$/i.test(pathText)) score += transportLevelQuery ? 18 : 44;
    if (/docs\/OPERATOR_PLUGIN_PATTERNS\.md$/i.test(pathText)) score += transportLevelQuery ? 36 : 24;
    if (/examples\/09-operator-plugin\.ts$/i.test(pathText)) score += transportLevelQuery ? 28 : 12;
    if (/README\.md$/i.test(pathText)) score += transportLevelQuery ? 4 : 8;

    if (/(kubernetes|kubectl|cluster)/.test(normalizedQuery) && /operator-kubernetes-plugin\.fixture\.ts$/i.test(pathText)) {
        score += transportLevelQuery ? 16 : 40;
    }
    if (/terraform/.test(normalizedQuery) && /operator-terraform-plugin\.fixture\.ts$/i.test(pathText)) {
        score += transportLevelQuery ? 16 : 40;
    }
    if (/(internal|custom|host-specific|host specific|internal-runner)/.test(normalizedQuery) && /operator-custom-tool-plugin\.fixture\.ts$/i.test(pathText)) {
        score += transportLevelQuery ? 16 : 40;
    }

    return score;
}

export function extractSdkSymbols(content = "") {
    const symbols = new Set();
    const patterns = [
        /\bexport\s+(?:default\s+)?class\s+([A-Za-z0-9_]+)/g,
        /\bexport\s+interface\s+([A-Za-z0-9_]+)/g,
        /\bexport\s+type\s+([A-Za-z0-9_]+)/g,
        /\bexport\s+enum\s+([A-Za-z0-9_]+)/g,
        /\bexport\s+function\s+([A-Za-z0-9_]+)/g,
        /\b(?:class|interface|type|enum|function)\s+([A-Za-z0-9_]+)/g,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            symbols.add(match[1]);
        }
    }

    return Array.from(symbols);
}

function chunkFileContent(content = "", maxChars = 1800) {
    const lines = String(content || "").split("\n");
    const chunks = [];
    let current = [];
    let currentLength = 0;

    for (const line of lines) {
        const nextLength = currentLength + line.length + 1;
        if (current.length > 0 && nextLength > maxChars) {
            chunks.push(current.join("\n"));
            current = [line];
            currentLength = line.length + 1;
        } else {
            current.push(line);
            currentLength = nextLength;
        }
    }

    if (current.length > 0) {
        chunks.push(current.join("\n"));
    }

    return chunks.length > 0 ? chunks : [String(content || "")];
}

export function buildFdoSdkKnowledgeIndex(files = []) {
    const index = [];

    for (const file of files) {
        if (!file?.path || typeof file.content !== "string") continue;
        if (!/\.(d\.ts|ts|tsx|md|txt|json)$/i.test(file.path)) continue;

        const chunks = chunkFileContent(file.content);
        const allSymbols = extractSdkSymbols(file.content);

        chunks.forEach((content, chunkIndex) => {
            const symbols = allSymbols.filter((symbol) => content.includes(symbol));
            index.push({
                id: `${file.path}#${chunkIndex}`,
                path: file.path,
                chunkIndex,
                content,
                preview: content.slice(0, 280),
                symbols: symbols.length > 0 ? symbols : allSymbols.slice(0, 8),
                searchableText: normalizeText(`${file.path}\n${allSymbols.join(" ")}\n${content}`),
            });
        });
    }

    return index;
}

export function searchFdoSdkKnowledge(index = [], query = "", options = {}) {
    const { limit = 6 } = options;
    const terms = unique(tokenizeQuery(query));
    const operatorStyleQuery = isOperatorStyleQuery(query);

    if (terms.length === 0) {
        return index.slice(0, limit).map(({ searchableText, ...entry }) => entry);
    }

    const scored = index
        .map((entry) => {
            let score = 0;
            for (const term of terms) {
                if (entry.path.toLowerCase().includes(term)) score += 8;
                if (entry.symbols.some((symbol) => symbol.toLowerCase() === term)) score += 12;
                if (entry.symbols.some((symbol) => symbol.toLowerCase().includes(term))) score += 6;
                if (entry.searchableText.includes(term)) score += 3;
            }
            if (operatorStyleQuery) {
                score += getOperatorFixtureBoost(entry.path, query);
            }
            return { entry, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));

    return scored.slice(0, limit).map(({ entry, score }) => {
        const { searchableText, ...rest } = entry;
        return { ...rest, score };
    });
}

export function formatSdkKnowledgeContext(results = []) {
    if (!Array.isArray(results) || results.length === 0) {
        return "";
    }

    let context = "Relevant FDO SDK knowledge (from bundled @anikitenko/fdo-sdk):\n";
    for (const result of results) {
        const symbolLine = result.symbols?.length ? `Symbols: ${result.symbols.join(", ")}\n` : "";
        context += `\nSDK File: ${result.path}\n${symbolLine}\`\`\`typescript\n${result.content}\n\`\`\`\n`;
    }
    return `${context}\n---\n\n`;
}

export function shouldUseFdoSdkKnowledge({ action = "", prompt = "", code = "", error = "", context = "" } = {}) {
    const normalizedAction = String(action || "").toLowerCase();
    const explicitHaystack = normalizeText([prompt, code, error].filter(Boolean).join("\n"));
    const contextHaystack = normalizeText(context);
    if (!explicitHaystack && !contextHaystack) {
        return false;
    }

    const strongSignals = [
        "@anikitenko/fdo-sdk",
        "fdo_sdk",
        "fdointerface",
        "pluginmetadata",
        "domtable",
        "dombutton",
        "dominput",
        "domtext",
        "domlink",
        "dommedia",
        "domsemantic",
        "domnested",
        "window.createbackendreq",
        "requestprivilegedaction",
        "createprivilegedactionbackendrequest",
        "requestoperatortool",
        "createoperatortoolactionrequest",
        "createoperatortoolcapabilitypreset",
        "requestscopedprocessexec",
        "createscopedprocessexecactionrequest",
        "createcapabilitybundle",
        "createfilesystemcapabilitybundle",
        "createprocesscapabilitybundle",
        "describecapability",
        "parsemissingcapabilityerror",
        "fdo plugin",
        "plugin render",
        "render(): string",
    ];

    const broadSignals = [
        "fdo",
        "plugin",
        "sdk",
        "metadata",
        "init()",
        "render()",
    ];
    const operatorSignals = [
        "system.process.exec",
        "system.process.scope",
        "createprocessexecactionrequest",
        "createprocessscopecapability",
        "requireprocessscopecapability",
        "createscopedprocessexecactionrequest",
        "requestscopedprocessexec",
        "createprivilegedactioncorrelationid",
        "createprivilegedactionbackendrequest",
        "requestprivilegedaction",
        "getoperatortoolpreset",
        "listoperatortoolpresets",
        "createoperatortoolcapabilitypreset",
        "createoperatortoolactionrequest",
        "requestoperatortool",
        "createcapabilitybundle",
        "createfilesystemcapabilitybundle",
        "createprocesscapabilitybundle",
        "describecapability",
        "parsemissingcapabilityerror",
        "isprivilegedactionsuccessresponse",
        "isprivilegedactionerrorresponse",
        "unwrapprivilegedactionresponse",
        "privilegedactionresponse",
        "privilegedactionsuccessresponse",
        "privilegedactionerrorresponse",
        "docker desktop",
        "docker desktop-like",
        "docker cli",
        "kubectl",
        "kubernetes",
        "helm",
        "terraform",
        "ansible",
        "aws-cli",
        "aws cli",
        "gcloud",
        "azure-cli",
        "azure cli",
        "podman",
        "kustomize",
        "gh",
        "github cli",
        "git",
        "vault",
        "nomad",
        "operator console",
        "operator-style",
        "scoped execution",
        "scoped tool execution",
        "host-mediated execution",
    ];
    const bestPracticeSignals = [
        "best practice",
        "best practices",
        "production grade",
        "production-grade",
        "according to sdk",
        "follow sdk",
        "sdk guidance",
        "sdk conventions",
        "recommended pattern",
        "recommended approach",
        "security",
        "capabilities",
        "privileged",
    ];
    const pluginGuidanceSignals = [
        "fdo",
        "plugin",
        "sdk",
        "metadata",
        "render",
        "init()",
        "pluginmetadata",
        "capabilities",
        "privileged",
    ];

    if (
        bestPracticeSignals.some((signal) => explicitHaystack.includes(signal))
        && pluginGuidanceSignals.some((signal) => explicitHaystack.includes(signal))
    ) {
        return true;
    }

    if (strongSignals.some((signal) => explicitHaystack.includes(signal))) {
        return true;
    }

    if (pluginGuidanceSignals.some((signal) => explicitHaystack.includes(signal))
        && operatorSignals.some((signal) => explicitHaystack.includes(signal))) {
        return true;
    }

    const explicitBroadHits = broadSignals.filter((signal) => explicitHaystack.includes(signal)).length;
    if (normalizedAction === "plan") {
        return explicitBroadHits >= 1;
    }

    if (explicitBroadHits >= 2) {
        return true;
    }

    const contextBroadHits = broadSignals.filter((signal) => contextHaystack.includes(signal)).length;
    return contextBroadHits >= 2 && explicitHaystack.includes("existing");
}
