import { settings } from "../../utils/store.js";
import crypto from "crypto";

const LANGFUSE_INGEST_PATH = "/api/public/ingestion";
const PROMPT_VERSION = "fdo-ai-chat-v1";

function envBool(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function getLangfuseConfig() {
    const stored = settings.get("ai.observability.langfuse", {}) || {};
    const enabled = typeof process?.env?.LANGFUSE_ENABLED !== "undefined"
        ? envBool(process.env.LANGFUSE_ENABLED)
        : !!stored.enabled;
    const host = String(process?.env?.LANGFUSE_HOST || stored.host || "").trim().replace(/\/+$/, "");
    const publicKey = String(process?.env?.LANGFUSE_PUBLIC_KEY || stored.publicKey || "").trim();
    const secretKey = String(process?.env?.LANGFUSE_SECRET_KEY || stored.secretKey || "").trim();
    const environment = String(process?.env?.LANGFUSE_ENV || stored.environment || "production").trim() || "production";
    const release = String(process?.env?.LANGFUSE_RELEASE || stored.release || "").trim() || null;
    return {
        enabled: enabled && !!host && !!publicKey && !!secretKey,
        host,
        publicKey,
        secretKey,
        environment,
        release,
    };
}

function pruneMetadata(value) {
    if (value === null || typeof value === "undefined") return null;
    if (typeof value === "string") {
        return value.length > 2000 ? `${value.slice(0, 1997)}...` : value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => pruneMetadata(item));
    }
    if (typeof value === "object") {
        const out = {};
        for (const [key, entry] of Object.entries(value)) {
            if (typeof entry === "undefined") continue;
            out[key] = pruneMetadata(entry);
        }
        return out;
    }
    return String(value);
}

async function sendLangfuseBatch(config, batch = []) {
    if (!config.enabled || batch.length === 0) return false;
    const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
    const res = await fetch(`${config.host}${LANGFUSE_INGEST_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
            batch,
            metadata: {
                sdk_integration: "fdo-ai-chat",
                sdk_name: "fdo-ai-chat",
                sdk_version: "1",
                prompt_version: PROMPT_VERSION,
            },
        }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Langfuse ingestion failed (${res.status}): ${text || res.statusText}`);
    }
    return true;
}

function createNoopSpan() {
    return {
        annotate() {},
        finish() {},
        fail() {},
    };
}

export function createAiObservabilityTrace({
    name = "ai-chat-turn",
    sessionId = null,
    userId = null,
    input = null,
    metadata = {},
} = {}) {
    const config = getLangfuseConfig();
    if (!config.enabled) {
        return {
            enabled: false,
            id: null,
            startSpan: () => createNoopSpan(),
            update() {},
            async finish() {},
            async fail() {},
        };
    }

    const traceId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const traceMetadata = {
        ...pruneMetadata(metadata),
        promptVersion: PROMPT_VERSION,
    };
    const spans = [];
    let traceOutput = null;
    let traceStatus = null;
    let flushed = false;

    function startSpan(spanName, { input: spanInput = null, metadata: spanMetadata = {} } = {}) {
        const span = {
            id: crypto.randomUUID(),
            name: spanName,
            input: spanInput,
            metadata: pruneMetadata(spanMetadata),
            startTime: new Date().toISOString(),
            endTime: null,
            output: null,
            statusMessage: null,
        };
        spans.push(span);
        return {
            annotate(extra = {}) {
                span.metadata = {
                    ...(span.metadata || {}),
                    ...pruneMetadata(extra),
                };
            },
            finish({ output = null, metadata: extra = {}, statusMessage = null } = {}) {
                span.endTime = new Date().toISOString();
                span.output = output;
                span.statusMessage = statusMessage;
                span.metadata = {
                    ...(span.metadata || {}),
                    ...pruneMetadata(extra),
                };
            },
            fail(error, extra = {}) {
                span.endTime = new Date().toISOString();
                span.statusMessage = String(error?.message || error || "Unknown error");
                span.metadata = {
                    ...(span.metadata || {}),
                    ...pruneMetadata(extra),
                    failed: true,
                };
            },
        };
    }

    async function flush(failed = false) {
        if (flushed) return;
        flushed = true;
        const finishedAt = new Date().toISOString();
        const batch = [
            {
                id: crypto.randomUUID(),
                type: "trace-create",
                timestamp: finishedAt,
                body: {
                    id: traceId,
                    name,
                    sessionId,
                    userId,
                    input,
                    output: traceOutput,
                    environment: config.environment,
                    release: config.release,
                    metadata: pruneMetadata({
                        ...traceMetadata,
                        statusMessage: traceStatus,
                        failed,
                        startedAt,
                        finishedAt,
                    }),
                },
            },
        ];

        for (const span of spans) {
            batch.push({
                id: crypto.randomUUID(),
                type: "span-create",
                timestamp: span.startTime,
                body: {
                    id: span.id,
                    traceId,
                    name: span.name,
                    input: span.input,
                    startTime: span.startTime,
                    metadata: pruneMetadata(span.metadata),
                },
            });
            batch.push({
                id: crypto.randomUUID(),
                type: "span-update",
                timestamp: span.endTime || finishedAt,
                body: {
                    id: span.id,
                    traceId,
                    endTime: span.endTime || finishedAt,
                    output: span.output,
                    statusMessage: span.statusMessage,
                    metadata: pruneMetadata(span.metadata),
                },
            });
        }

        try {
            await sendLangfuseBatch(config, batch);
            console.log("[Langfuse] Trace exported", {
                traceId,
                sessionId,
                spans: spans.length,
                name,
            });
        } catch (error) {
            console.warn("[Langfuse] Trace export failed", {
                traceId,
                sessionId,
                error: String(error?.message || error),
            });
        }
    }

    return {
        enabled: true,
        id: traceId,
        startSpan,
        update(extra = {}) {
            Object.assign(traceMetadata, pruneMetadata(extra));
        },
        async finish({ output = null, metadata: extra = {}, statusMessage = null } = {}) {
            traceOutput = output;
            traceStatus = statusMessage;
            Object.assign(traceMetadata, pruneMetadata(extra));
            await flush(false);
        },
        async fail(error, extra = {}) {
            traceStatus = String(error?.message || error || "Unknown error");
            Object.assign(traceMetadata, pruneMetadata(extra));
            await flush(true);
        },
    };
}

export function getObservabilityPromptVersion() {
    return PROMPT_VERSION;
}
