import React, {useEffect, useMemo, useRef, useState} from "react";
import PropTypes from "prop-types";
import {Button, Spinner} from "@blueprintjs/core";
import {pluginTrace} from "../utils/pluginTrace";
import {AppToaster} from "./AppToaster.jsx";
import {parseMissingCapabilityDiagnosticsFromError} from "../utils/parseMissingCapabilitiesFromError";
import {
    isAllowedPluginExternalUrl,
    isValidPluginUiRequestMessage,
    normalizePluginRenderPayload,
} from "./plugin/utils/pluginRenderSecurity";

function rewritePluginHostHtml(html) {
    if (typeof html !== "string") {
        return "";
    }

    return html.replace(/\b(src|href)="\.\/([^"]+)"/g, (_match, attr, assetPath) => {
        return `${attr}="static://host/${assetPath}"`;
    });
}

function toSerializedStringSegment(value, fallback = "") {
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === "string") {
                return value;
            }
        } catch (_) {
            // Raw string, not JSON.
        }
        return JSON.stringify(value);
    }

    if (value == null) {
        return JSON.stringify(fallback);
    }

    return JSON.stringify(String(value));
}

function normalizeIncomingRenderContent(rawContent) {
    if (rawContent && typeof rawContent === "object") {
        if (typeof rawContent.render === "string") {
            return {
                render: toSerializedStringSegment(rawContent.render),
                onLoad: toSerializedStringSegment(rawContent.onLoad, "() => {}"),
            };
        }

        if (typeof rawContent.html === "string") {
            return {
                render: JSON.stringify(rawContent.html),
                onLoad: toSerializedStringSegment(rawContent.onLoad, "() => {}"),
            };
        }
    }

    if (typeof rawContent === "string") {
        try {
            const parsed = JSON.parse(rawContent);
            if (parsed && typeof parsed === "object" && typeof parsed.render === "string") {
                return {
                    render: toSerializedStringSegment(parsed.render),
                    onLoad: toSerializedStringSegment(parsed.onLoad, "() => {}"),
                };
            }
            if (typeof parsed === "string") {
                return {
                    render: JSON.stringify(parsed),
                    onLoad: JSON.stringify("() => {}"),
                };
            }
        } catch (_) {
            return {
                render: JSON.stringify(rawContent),
                onLoad: JSON.stringify("() => {}"),
            };
        }
    }

    return null;
}

function emitIframeMetric(metric, plugin, extra = {}) {
    try {
        window.__FDO_PLUGIN_METRICS__ = window.__FDO_PLUGIN_METRICS__ || [];
        window.__FDO_PLUGIN_METRICS__.push({
            metric,
            plugin,
            ts: Date.now(),
            ...extra,
        });
        if (window.__FDO_PLUGIN_METRICS__.length > 1000) {
            window.__FDO_PLUGIN_METRICS__.shift();
        }
    } catch (_) {
        // Best-effort metrics only.
    }
}

function isPrivilegedFailureCode(code = "") {
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) return false;
    if (normalized === "CAPABILITY_DENIED") return true;
    if (normalized === "CANCELLED") return true;
    if (normalized === "OS_ERROR") return true;
    if (normalized === "CONFIRMATION_DENIED") return true;
    if (normalized.startsWith("PROCESS_")) return true;
    if (normalized.startsWith("STEP_")) return true;
    if (normalized.startsWith("SCOPE_")) return true;
    if (normalized.startsWith("WORKFLOW_")) return true;
    if (normalized.startsWith("CLIPBOARD_")) return true;
    if (normalized.endsWith("_POLICY_DENIED")) return true;
    return false;
}

function isPrivilegedValidationFailure({code = "", error = ""} = {}) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (normalizedCode !== "VALIDATION_FAILED") {
        return false;
    }
    const text = String(error || "").trim();
    return /\bhost privileged action\b/i.test(text);
}

function shouldSurfacePluginBackendFailure(code = "") {
    const normalized = String(code || "").trim().toUpperCase();
    return normalized === "PLUGIN_BACKEND_EMPTY_RESPONSE"
        || normalized === "PLUGIN_BACKEND_HANDLER_NOT_REGISTERED"
        || normalized === "PLUGIN_BACKEND_TIMEOUT";
}

export const PluginContainer = ({
    plugin,
    active = true,
    onStageChange,
    onCapabilityDenied,
    onRequestCommandBar,
}) => {
    const iframeRef = useRef(null);
    const onCapabilityDeniedRef = useRef(onCapabilityDenied);
    const onRequestCommandBarRef = useRef(onRequestCommandBar);
    const contentRef = useRef("");
    const requestedInitRef = useRef(false);
    const lastCapabilityDeniedToastAtRef = useRef(0);
    const lastPostedRenderSignatureRef = useRef("");
    const lastIncomingRenderSignatureRef = useRef("");
    const lastIncomingRenderAtRef = useRef(0);
    const renderPostedAtRef = useRef(0);
    const renderMountedAtRef = useRef(0);
    const lastCapabilityDeniedDigestRef = useRef("");
    const helloRecoveryAttemptsRef = useRef(0);
    const layoutRecoveryAttemptsRef = useRef(0);
    const stageRecoveryAttemptsRef = useRef(0);

    const [hostDocument, setHostDocument] = useState("");
    const [hostError, setHostError] = useState("");
    const [debugStage, setDebugStage] = useState("mounting");
    const [renderAttempt, setRenderAttempt] = useState(0);
    const [showRecovery, setShowRecovery] = useState(false);
    const [pluginCanRender, setPluginCanRender] = useState(false);
    const [content, setContent] = useState("");
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [iframeHello, setIframeHello] = useState(false);
    const [iframeLayoutReady, setIframeLayoutReady] = useState(false);
    const [iframeMounted, setIframeMounted] = useState(false);

    const showPluginStageDebug = (
        localStorage.getItem("fdo:plugin-stage-debug-ui") === "1"
        && (window.__E2E__ === true || localStorage.getItem("fdo:plugin-stage-debug-ui-force") === "1")
    );
    const iframeSandbox = window.__E2E__ === true
        ? "allow-scripts allow-same-origin"
        : "allow-scripts";
    const iframeReady = iframeHello && iframeLayoutReady;

    const stageToken = useMemo(() => String(debugStage || "").split(":")[0], [debugStage]);
    const statusLabelByStage = {
        mounting: "Preparing plugin host",
        "host-document-loaded": "Loading plugin frame",
        "iframe-loaded": "Starting plugin frame",
        "iframe-ready": "Connecting plugin runtime",
        "waiting-runtime-status": "Checking plugin runtime",
        "requesting-plugin-init": "Initializing plugin",
        "plugin-inited": "Preparing plugin UI",
        "requesting-plugin-render": "Rendering plugin UI",
        "plugin-render-received": "Rendering plugin UI",
        "posting-render": "Finalizing plugin UI",
    };
    const userStatusLabel = hostError
        ? "Plugin UI failed to load"
        : (statusLabelByStage[stageToken] || "Loading plugin UI");

    const handleRetry = () => {
        setShowRecovery(false);
        setHostError("");
        setDebugStage("retrying-plugin-render");
        setRenderAttempt((prev) => prev + 1);
    };

    const reportCapabilityDenied = ({
        details = "",
        code = "",
        correlationId = "",
        missingCapabilityDiagnostics = [],
        extraDetails = null,
    } = {}) => {
        const normalizedDetails = String(details || "").trim();
        const diagnostics = Array.isArray(missingCapabilityDiagnostics) && missingCapabilityDiagnostics.length > 0
            ? missingCapabilityDiagnostics
            : parseMissingCapabilityDiagnosticsFromError(normalizedDetails);
        const missingCapabilities = diagnostics.map((item) => item.capability).filter(Boolean);
        const privilegedFailure = isPrivilegedFailureCode(code) || missingCapabilities.length > 0;
        if (!privilegedFailure) {
            return false;
        }
        const digest = [
            String(code || "").trim(),
            String(correlationId || "").trim(),
            missingCapabilities.join(","),
            normalizedDetails.slice(0, 300),
            String(extraDetails?.scope || "").trim(),
            String(extraDetails?.command || "").trim(),
        ].join(":");
        if (digest === lastCapabilityDeniedDigestRef.current) {
            return true;
        }
        lastCapabilityDeniedDigestRef.current = digest;
        onCapabilityDeniedRef.current?.({
            pluginId: plugin,
            missingCapabilities,
            missingCapabilityDiagnostics: diagnostics,
            details: normalizedDetails || "Capability denied.",
            code: String(code || "").trim(),
            correlationId: String(correlationId || "").trim(),
            extraDetails,
        });
        return true;
    };

    const reportCapabilityDeniedFromText = (detailsText = "", code = "", extraDetails = null, correlationId = "") => {
        return reportCapabilityDenied({
            details: detailsText,
            code,
            correlationId,
            extraDetails,
        });
    };

    const reportCapabilityDeniedFromAudit = (event = {}) => {
        const errorCode = String(event?.error?.code || "").trim();
        const errorMessage = String(event?.error?.message || event?.error || "").trim();
        const workflowId = String(event?.workflowId || "").trim();
        const extraDetails = workflowId
            ? {
                workflowId,
                kind: String(event?.workflowKind || "").trim(),
                scope: String(event?.scope || "").trim(),
                title: String(event?.workflowTitle || "").trim(),
                status: String(event?.workflowStatus || "").trim(),
                command: String(event?.command || "").trim(),
                args: Array.isArray(event?.args) ? event.args : [],
                cwd: String(event?.cwd || "").trim(),
            }
            : {
                scope: String(event?.scope || "").trim(),
                command: String(event?.command || "").trim(),
                args: Array.isArray(event?.args) ? event.args : [],
                cwd: String(event?.cwd || "").trim(),
            };
        return reportCapabilityDenied({
            details: errorMessage,
            code: errorCode,
            correlationId: String(event?.correlationId || "").trim(),
            extraDetails,
        });
    };

    useEffect(() => {
        onCapabilityDeniedRef.current = onCapabilityDenied;
    }, [onCapabilityDenied]);

    useEffect(() => {
        onRequestCommandBarRef.current = onRequestCommandBar;
    }, [onRequestCommandBar]);

    useEffect(() => {
        onStageChange?.(debugStage);
    }, [debugStage, onStageChange]);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    useEffect(() => {
        setIframeLoaded(false);
        setIframeHello(false);
        setIframeLayoutReady(false);
        setIframeMounted(false);
        setHostError("");
        setContent("");
        setPluginCanRender(false);
        setShowRecovery(false);
        requestedInitRef.current = false;
        lastPostedRenderSignatureRef.current = "";
        lastIncomingRenderSignatureRef.current = "";
        lastIncomingRenderAtRef.current = 0;
        renderPostedAtRef.current = 0;
        renderMountedAtRef.current = 0;
        helloRecoveryAttemptsRef.current = 0;
        layoutRecoveryAttemptsRef.current = 0;
        stageRecoveryAttemptsRef.current = 0;
        let cancelled = false;

        window.fetch("static://host/plugin_host.html")
            .then((response) => response.text())
            .then((html) => {
                if (cancelled) return;
                setHostDocument(rewritePluginHostHtml(html));
                setDebugStage("host-document-loaded");
            })
            .catch((error) => {
                if (cancelled) return;
                setHostError(error?.message || String(error));
                setDebugStage("host-document-failed");
            });

        return () => {
            cancelled = true;
        };
    }, [plugin, renderAttempt]);

    useEffect(() => {
        let cancelled = false;
        setPluginCanRender(false);
        requestedInitRef.current = false;
        setDebugStage("waiting-runtime-status");

        if (!plugin) {
            return () => {
                cancelled = true;
            };
        }

        const startedAt = Date.now();
        const pollRuntimeStatus = async () => {
            if (cancelled) return;
            try {
                const result = await window.electron.plugin.getRuntimeStatus([plugin]);
                if (cancelled) return;

                const status = result.statuses?.[0];
                pluginTrace("container.runtimeStatus", {
                    plugin,
                    success: !!result?.success,
                    loading: !!status?.loading,
                    loaded: !!status?.loaded,
                    ready: !!status?.ready,
                    inited: !!status?.inited,
                });

                if (status?.diagnosticsLastError) {
                    reportCapabilityDeniedFromText(String(status.diagnosticsLastError || ""), String(status?.diagnosticsLastCode || ""));
                }

                if (status?.lastPrivilegedAudit?.success === false && status?.lastPrivilegedAudit?.error?.code) {
                    reportCapabilityDeniedFromAudit(status.lastPrivilegedAudit);
                }

                if (status?.inited) {
                    setPluginCanRender(true);
                    setDebugStage("plugin-inited");
                    return;
                }

                if (status?.ready && !status?.inited && !requestedInitRef.current) {
                    requestedInitRef.current = true;
                    setDebugStage("requesting-plugin-init");
                    const initResult = await window.electron.plugin.init(plugin);
                    if (initResult?.success === false) {
                        reportCapabilityDeniedFromText(String(initResult?.error || ""), String(initResult?.code || ""));
                        requestedInitRef.current = false;
                    }
                }
            } catch (_) {
                if (!cancelled) {
                    setDebugStage("runtime-status-poll-failed");
                }
            }

            if (cancelled) return;
            if (Date.now() - startedAt > 12000) {
                setHostError("Plugin initialization timed out. Retry loading the plugin UI.");
                setDebugStage("plugin-runtime-timeout");
                return;
            }
            window.setTimeout(pollRuntimeStatus, 250);
        };

        pollRuntimeStatus().catch(() => {});

        return () => {
            cancelled = true;
        };
    }, [plugin, renderAttempt]);

    useEffect(() => {
        if (!plugin) return;

        const handlePluginRender = (payload) => {
            if (!payload || payload.id !== plugin) {
                return;
            }
            const normalizedContent = normalizeIncomingRenderContent(payload.content);
            if (!normalizedContent) {
                setHostError("Invalid plugin render payload received from runtime.");
                setDebugStage("plugin-render-payload-invalid");
                return;
            }

            const incomingSignature = `${normalizedContent.render.length}:${normalizedContent.onLoad.length}:${normalizedContent.render.slice(0, 128)}:${normalizedContent.onLoad.slice(0, 64)}`;
            const incomingNow = Date.now();
            if (
                incomingSignature === lastIncomingRenderSignatureRef.current
                && (incomingNow - lastIncomingRenderAtRef.current) < 250
            ) {
                return;
            }
            lastIncomingRenderSignatureRef.current = incomingSignature;
            lastIncomingRenderAtRef.current = incomingNow;
            setHostError("");
            setDebugStage("plugin-render-received");
            setContent(normalizedContent);
        };

        window.electron.plugin.off.render(handlePluginRender);
        window.electron.plugin.on.render(handlePluginRender);

        if (!pluginCanRender) {
            return () => {
                window.electron.plugin.off.render(handlePluginRender);
            };
        }

        const MAX_RENDER_REQUEST_ATTEMPTS = 5;
        const RENDER_BACKOFF_DELAYS_MS = [250, 500, 900, 1400, 2000];
        let cancelled = false;
        let scheduledRetryTimer = null;
        let attempt = 0;

        const scheduleRetry = (reason, errorText = "") => {
            if (cancelled || contentRef.current?.render) return;

            if (attempt >= MAX_RENDER_REQUEST_ATTEMPTS) {
                setHostError(`Plugin render request timed out after retries.${errorText ? ` ${errorText}` : ""}`);
                setDebugStage(`plugin-render-request-timeout:${reason}`);
                return;
            }

            const delayMs = RENDER_BACKOFF_DELAYS_MS[Math.min(attempt - 1, RENDER_BACKOFF_DELAYS_MS.length - 1)];
            setDebugStage("plugin-render-request-retry-pending");
            scheduledRetryTimer = window.setTimeout(() => {
                scheduledRetryTimer = null;
                requestRender("retry");
            }, delayMs);
        };

        const requestRender = async (source = "initial") => {
            if (cancelled || contentRef.current?.render) return;

            attempt += 1;
            setDebugStage(attempt === 1 ? "requesting-plugin-render" : `requesting-plugin-render-retry-${attempt}`);
            try {
                const result = await window.electron.plugin.render(plugin);
                if (cancelled || contentRef.current?.render) return;
                if (result?.success === false) {
                    reportCapabilityDeniedFromText(String(result?.error || ""), String(result?.code || ""));
                    scheduleRetry("render-rejected", result.error || "");
                    return;
                }
                const watchdogMs = Math.min(1100 + attempt * 250, 2200);
                scheduledRetryTimer = window.setTimeout(() => {
                    scheduledRetryTimer = null;
                    if (!contentRef.current?.render) {
                        scheduleRetry("render-payload-timeout");
                    }
                }, watchdogMs);
            } catch (error) {
                if (cancelled || contentRef.current?.render) return;
                reportCapabilityDeniedFromText(String(error?.message || String(error || "")), "");
                scheduleRetry("render-request-error", error?.message || String(error));
            }
        };

        requestRender("initial").catch(() => {});

        return () => {
            cancelled = true;
            if (scheduledRetryTimer) {
                window.clearTimeout(scheduledRetryTimer);
            }
            window.electron.plugin.off.render(handlePluginRender);
        };
    }, [plugin, pluginCanRender, renderAttempt]);

    useEffect(() => {
        const handlePluginUiMessage = (payload) => {
            if (!payload || payload.id !== plugin) return;
            iframeRef.current?.contentWindow?.postMessage({type: "UI_MESSAGE", content: payload.content}, "*");
        };

        const handlePluginMessages = (event) => {
            const activeIframeWindow = iframeRef.current?.contentWindow;
            if (!activeIframeWindow || event?.source !== activeIframeWindow) {
                return;
            }

            if (event.data.type === "PLUGIN_HELLO") {
                setIframeHello(true);
                setDebugStage("iframe-ready");
                return;
            }

            if (event.data.type === "PLUGIN_LAYOUT_READY") {
                const layout = event.data.layout || {};
                const docW = Number(layout?.docElRect?.width || 0);
                const docH = Number(layout?.docElRect?.height || 0);
                const bodyW = Number(layout?.bodyRect?.width || 0);
                const bodyH = Number(layout?.bodyRect?.height || 0);
                const rootW = Number(layout?.rootRect?.width || 0);
                const rootH = Number(layout?.rootRect?.height || 0);
                if (docW > 0 && docH > 0 && bodyW > 0 && bodyH > 0 && rootW > 0 && rootH > 0) {
                    setIframeLayoutReady(true);
                }
                return;
            }

            if (event.data.type === "PLUGIN_STAGE" && typeof event.data.stage === "string") {
                if (event.data.stage === "iframe-dom-after-mount") {
                    setIframeMounted(true);
                    renderMountedAtRef.current = Date.now();
                    if (layoutRecoveryAttemptsRef.current > 0 || stageRecoveryAttemptsRef.current > 0) {
                        emitIframeMetric("plugin_iframe_recovery_success", plugin, {
                            layoutRecoveries: layoutRecoveryAttemptsRef.current,
                            stageRecoveries: stageRecoveryAttemptsRef.current,
                        });
                    }
                    layoutRecoveryAttemptsRef.current = 0;
                    stageRecoveryAttemptsRef.current = 0;
                }
                const nextStage = event.data.message
                    ? `${event.data.stage}: ${event.data.message}`
                    : event.data.stage;
                setDebugStage(nextStage);
                return;
            }

            if (event.data.type === "OPEN_EXTERNAL_LINK") {
                if (isAllowedPluginExternalUrl(event.data.url)) {
                    window.electron.system.openExternal(event.data.url);
                }
                return;
            }

            if (event.data.type === "PLUGIN_SHORTCUT" && event.data.shortcut === "command-bar") {
                onRequestCommandBarRef.current?.();
                return;
            }

            if (event.data.type === "PLUGIN_IFRAME_INTERACTION") {
                try {
                    window.dispatchEvent(new CustomEvent("fdo:plugin-iframe-interaction", {
                        detail: {
                            pluginId: plugin,
                            kind: String(event?.data?.kind || "").trim(),
                        },
                    }));
                } catch (_) {
                    // Best-effort bridge for host UI dismissal behavior.
                }
                return;
            }

            if (event.data.type === "UI_MESSAGE_REQUEST") {
                if (typeof event.data.requestId !== "string" || !isValidPluginUiRequestMessage(event.data.message)) {
                    return;
                }

                const handlerName = String(event?.data?.message?.handler || "").trim();
                const isPrivilegedHandler = handlerName === "requestPrivilegedAction" || handlerName === "__host.privilegedAction";
                window.electron.plugin.uiMessage(plugin, event.data.message).then((response) => {
                    const hasErrorCode = typeof response?.code === "string" && response.code.trim().length > 0;
                    const failedResponse = response?.ok === false || response?.success === false || hasErrorCode;
                    if (failedResponse) {
                        const missingCapabilityDiagnostics = parseMissingCapabilityDiagnosticsFromError(response?.error || "");
                        const missingCapabilities = missingCapabilityDiagnostics.map((item) => item.capability);
                        const privilegedFailure = (
                            isPrivilegedFailureCode(response?.code)
                            || isPrivilegedValidationFailure({code: response?.code, error: response?.error})
                            || (isPrivilegedHandler && failedResponse)
                            || missingCapabilities.length > 0
                        );
                        const backendBridgeFailure = shouldSurfacePluginBackendFailure(response?.code);
                        const now = Date.now();
                        if (now - lastCapabilityDeniedToastAtRef.current > 1500) {
                            lastCapabilityDeniedToastAtRef.current = now;
                            AppToaster.show({
                                message: response?.code === "CAPABILITY_DENIED"
                                    ? `Plugin "${plugin}" is missing required permission${missingCapabilities.length > 1 ? "s" : ""}.`
                                    : `Plugin "${plugin}" host action failed: ${response?.code || "UNKNOWN_ERROR"}.`,
                                intent: response?.code === "CAPABILITY_DENIED" ? "warning" : "danger",
                            });
                        }
                        if (privilegedFailure || backendBridgeFailure) {
                            onCapabilityDeniedRef.current?.({
                                pluginId: plugin,
                                missingCapabilities,
                                missingCapabilityDiagnostics,
                                details: response?.error || "Capability denied.",
                                code: response?.code,
                                correlationId: response?.correlationId || "",
                                extraDetails: response?.details || response?.result || null,
                            });
                        }
                    }
                    iframeRef.current?.contentWindow?.postMessage({
                        type: "UI_MESSAGE_RESPONSE",
                        requestId: event.data.requestId,
                        content: response,
                    }, "*");
                }).catch((error) => {
                    iframeRef.current?.contentWindow?.postMessage({
                        type: "UI_MESSAGE_RESPONSE",
                        requestId: event.data.requestId,
                        error: error?.message || String(error),
                    }, "*");
                    if (isPrivilegedHandler) {
                        const detailsText = error?.message || String(error) || "Privileged host action failed.";
                        const surfaced = reportCapabilityDenied({
                            details: detailsText,
                            code: String(error?.code || "PLUGIN_UI_BRIDGE_ERROR"),
                            correlationId: "",
                            extraDetails: null,
                        });
                        if (!surfaced) {
                            onCapabilityDeniedRef.current?.({
                                pluginId: plugin,
                                missingCapabilities: [],
                                missingCapabilityDiagnostics: [],
                                details: detailsText,
                                code: String(error?.code || "PLUGIN_UI_BRIDGE_ERROR"),
                                correlationId: "",
                                extraDetails: null,
                            });
                        }
                    }
                });
                return;
            }

            if (event.data.type === "UI_MESSAGE") {
                if (!isValidPluginUiRequestMessage(event.data.message)) {
                    return;
                }
                window.electron.plugin.uiMessage(plugin, event.data.message).then(() => {});
            }
        };

        window.electron.plugin.on.uiMessage(handlePluginUiMessage);
        window.addEventListener("message", handlePluginMessages);
        return () => {
            window.electron.plugin.off.uiMessage(handlePluginUiMessage);
            window.removeEventListener("message", handlePluginMessages);
        };
    }, [plugin, renderAttempt]);

    useEffect(() => {
        if (!iframeLoaded || !iframeReady || !content?.render) {
            return;
        }
        const normalized = normalizePluginRenderPayload(content);
        const signature = `${renderAttempt}:${normalized.render.length}:${normalized.onLoad.length}`;
        if (lastPostedRenderSignatureRef.current === signature) {
            return;
        }
        lastPostedRenderSignatureRef.current = signature;
        renderPostedAtRef.current = Date.now();
        renderMountedAtRef.current = 0;
        setDebugStage("posting-render");
        iframeRef.current?.contentWindow?.postMessage({
            type: "PLUGIN_RENDER",
            content: {
                code: JSON.stringify(normalized.render),
                onLoad: normalized.onLoad,
            },
        }, "*");
    }, [content, iframeLoaded, iframeReady, renderAttempt]);

    useEffect(() => {
        if (!hostError || !hostError.trim()) return;
        setShowRecovery(true);
    }, [hostError]);

    useEffect(() => {
        if (hostError || !iframeLoaded || iframeHello) {
            return;
        }
        const timer = window.setTimeout(() => {
            if (iframeHello) return;
            if (helloRecoveryAttemptsRef.current >= 2) {
                setHostError("The plugin frame did not respond. Reload the plugin frame.");
                emitIframeMetric("plugin_iframe_terminal_failure", plugin, {reason: "hello_missing"});
                return;
            }
            helloRecoveryAttemptsRef.current += 1;
            emitIframeMetric("plugin_iframe_recovery_attempt", plugin, {reason: "hello_missing"});
            setRenderAttempt((prev) => prev + 1);
        }, 2200);
        return () => window.clearTimeout(timer);
    }, [hostError, iframeLoaded, iframeHello, plugin]);

    useEffect(() => {
        if (hostError || !iframeLoaded || !iframeHello || iframeLayoutReady) {
            return;
        }
        const timer = window.setTimeout(() => {
            if (iframeLayoutReady) return;
            emitIframeMetric("plugin_iframe_layout_collapsed", plugin, {reason: "pre_render_geometry_zero"});
            if (layoutRecoveryAttemptsRef.current >= 2) {
                setHostError("Plugin frame layout is unstable. Reload the plugin frame.");
                emitIframeMetric("plugin_iframe_terminal_failure", plugin, {reason: "layout_not_ready"});
                return;
            }
            layoutRecoveryAttemptsRef.current += 1;
            emitIframeMetric("plugin_iframe_recovery_attempt", plugin, {reason: "layout_not_ready"});
            setRenderAttempt((prev) => prev + 1);
        }, 1800);
        return () => window.clearTimeout(timer);
    }, [hostError, iframeLoaded, iframeHello, iframeLayoutReady, plugin]);

    useEffect(() => {
        if (hostError || !iframeLoaded || !iframeReady || !content?.render) {
            return;
        }
        const timer = window.setTimeout(() => {
            if (renderMountedAtRef.current > renderPostedAtRef.current) {
                return;
            }
            if (stageRecoveryAttemptsRef.current >= 1) {
                setHostError("The plugin failed to load. You might find more details in the notification panel.");
                emitIframeMetric("plugin_iframe_terminal_failure", plugin, {reason: "dom_after_mount_missing"});
                return;
            }
            stageRecoveryAttemptsRef.current += 1;
            emitIframeMetric("plugin_iframe_recovery_attempt", plugin, {reason: "dom_after_mount_missing"});
            setRenderAttempt((prev) => prev + 1);
        }, 2200);
        return () => window.clearTimeout(timer);
    }, [hostError, iframeLoaded, iframeReady, content, plugin]);

    useEffect(() => {
        if (hostError || content?.render || iframeMounted) {
            setShowRecovery(false);
            return;
        }
        const timer = window.setTimeout(() => {
            if (!content?.render) {
                setShowRecovery(true);
            }
        }, 8000);
        return () => window.clearTimeout(timer);
    }, [hostError, content, iframeMounted]);

    const shouldShowLoadingOverlay = active && (
        !hostDocument
        || !iframeLoaded
        || (!content?.render && !iframeMounted && !iframeReady)
    );

    return (
        <div
            id={active ? "plugin-container" : undefined}
            data-plugin-id={plugin}
            data-plugin-active={active ? "true" : "false"}
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "stretch",
                justifyContent: "stretch",
                height: "100%",
                width: "100%",
                minHeight: 0,
                minWidth: 0,
                margin: 0,
                padding: 0,
                overflow: "hidden",
                background: "transparent",
                opacity: active ? 1 : 0,
                visibility: active ? "visible" : "hidden",
                pointerEvents: active ? "auto" : "none",
                zIndex: active ? 2 : 1,
                transition: "opacity 120ms ease",
            }}
        >
            {shouldShowLoadingOverlay && (
                <div style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: hostError ? "rgba(255, 255, 255, 0.97)" : "transparent",
                    zIndex: 3,
                }}>
                    {hostError ? (
                        <div style={{maxWidth: "560px", padding: "24px", textAlign: "left"}}>
                            <h2 style={{marginTop: 0, color: "#1f2933"}}>Plugin UI failed to load</h2>
                            <p style={{marginBottom: 0, color: "#394b59"}}>{hostError}</p>
                            <div style={{display: "flex", gap: "8px", marginTop: "16px"}}>
                                <Button intent="primary" text="Reload plugin frame" onClick={handleRetry}/>
                            </div>
                            {showPluginStageDebug && (
                                <p style={{marginTop: "12px", marginBottom: 0, fontSize: "12px", opacity: 0.8}}>
                                    Stage: {debugStage}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div style={{display: "flex", flexDirection: "column", alignItems: "center", gap: "12px"}}>
                            <Spinner size={100} intent={"primary"}/>
                            <div style={{fontSize: "13px", color: "#394b59"}}>{userStatusLabel}</div>
                            {showRecovery && (
                                <div style={{display: "flex", gap: "8px"}}>
                                    <Button intent="primary" text="Retry Loading" onClick={handleRetry}/>
                                </div>
                            )}
                            {showPluginStageDebug && (
                                <div style={{fontSize: "12px", color: "#5f6b7c"}}>Stage: {debugStage}</div>
                            )}
                        </div>
                    )}
                </div>
            )}
            <iframe
                key={`${plugin}:${renderAttempt}`}
                ref={iframeRef}
                title={active ? "Plugin Container ID" : `Plugin Container ID (inactive:${plugin})`}
                data-plugin-id={plugin}
                data-plugin-active={active ? "true" : "false"}
                aria-hidden={!active}
                srcDoc={hostDocument}
                sandbox={iframeSandbox}
                referrerPolicy="no-referrer"
                onLoad={() => {
                    setIframeLoaded(true);
                    setDebugStage("iframe-loaded");
                }}
                style={{
                    width: "100%",
                    height: "100%",
                    minWidth: "1px",
                    minHeight: "1px",
                    display: "block",
                    flex: "1 1 auto",
                    border: "none",
                    position: "static",
                    inset: "auto",
                    visibility: "visible",
                    opacity: 1,
                    overflow: "hidden",
                    boxSizing: "border-box",
                    background: "transparent",
                }}
            />
        </div>
    );
};

PluginContainer.propTypes = {
    plugin: PropTypes.string.isRequired,
    active: PropTypes.bool,
    onStageChange: PropTypes.func,
    onCapabilityDenied: PropTypes.func,
    onRequestCommandBar: PropTypes.func,
};
