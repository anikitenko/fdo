function normalizeText(value = "") {
    return String(value || "").toLowerCase();
}

function isHostServiceQuery(query = "") {
    return /\b(?:ssh|terminals?|pty|x11|xquartz|git|secrets?|credentials?|submodules?|lfs)\b|listProfiles|SSHProfileSummary|watchStatus|remote commands?|persistent.*sav|json.*flush/i.test(query);
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
        "requestprivilegedactionfromenvelope",
        "getoperatortoolpreset",
        "listoperatortoolpresets",
        "createoperatortoolcapabilitypreset",
        "createoperatortoolactionrequest",
        "requestoperatortool",
        "declarecapabilities",
        "createscopedworkflowrequest",
        "requestscopedworkflow",
        "system.workflow.run",
        "process-sequence",
        "createclipboardreadactionrequest",
        "createclipboardwriteactionrequest",
        "createclipboardreadrequest",
        "createclipboardwriterequest",
        "requestclipboardread",
        "requestclipboardwrite",
        "system.clipboard.read",
        "system.clipboard.write",
        "describecapability",
        "parsemissingcapabilityerror",
        "runcapabilitypreflight",
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
        "requestprivilegedactionfromenvelope",
        "createprocessexecactionrequest",
        "createprivilegedactionbackendrequest",
        "createprivilegedactioncorrelationid",
        "runcapabilitypreflight",
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
    if (/(preview\/apply|preview apply|inspect\/act|inspect act|workflow)/.test(normalizedQuery)
        && /operator-(kubernetes|terraform)-plugin\.fixture\.ts$/i.test(pathText)) {
        score += transportLevelQuery ? 10 : 36;
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
    const hostServiceQuery = isHostServiceQuery(query);

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
            if (hostServiceQuery) {
                if (/fdo-host\/SECRETS_SSH_GIT\.md$/i.test(entry.path)) score += 90;
                if (/(?:^|\/)SECRETS_AND_SSH\.md$/i.test(entry.path)) score += 65;
                if (/\bSSHProfileSummary\s*=/.test(entry.content) && /profile|host|port|username|fingerprint|metadata|authenticationType/i.test(query)) score += 100;
            }
            return { entry, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));

    // Keep host policy and the installed SDK contract together instead of
    // allowing many chunks from one document to crowd out the other source.
    const evidence = hostServiceQuery ? [
        scored.find(({entry})=>/fdo-host\/SECRETS_SSH_GIT\.md$/i.test(entry.path)),
        scored.find(({entry})=>/(?:^|\/)SECRETS_AND_SSH\.md$/i.test(entry.path)),
        /status|watch|monitor|stream|cancel|flush|persist|remote command/i.test(query)
            ? scored.find(({entry})=>/(?:^|\/)FDO_HOST_REMOTE_COMMANDS_HANDOFF\.md$/i.test(entry.path)) : undefined,
        scored.find(({entry})=>/\bSSHProfileSummary\s*=/.test(entry.content)),
    ].filter(Boolean) : [];
    const selected = [...evidence, ...scored.filter(item=>!evidence.includes(item))];
    return selected.slice(0, limit).map(({ entry, score }) => {
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

export const SDK_KNOWLEDGE_BASELINE_QUERY = "FDO_SDK PluginRegistry DOM render metadata node:test";

export function shouldUseFdoSdkKnowledge({ prompt = "", code = "", error = "", context = "" } = {}) {
    // Every coding request is a plugin request. The installed SDK is the API,
    // including repairs, reviews, and prompts that never name a symbol.
    return normalizeText([prompt, code, error, context].filter(Boolean).join("\n")).length > 0;
}
