import React, {useEffect, useRef, useState} from "react";
import PropTypes from "prop-types";
import {Button, Spinner} from "@blueprintjs/core";
import {useBabelWorker} from "./plugin/utils/useBabelWorker";
import {pluginTrace} from "../utils/pluginTrace";
import {AppToaster} from "./AppToaster.jsx";
import {parseMissingCapabilityDiagnosticsFromError} from "../utils/parseMissingCapabilitiesFromError";
import {
    isAllowedPluginExternalUrl,
    normalizePluginJsxSource,
    isTrustedPluginFrameEvent,
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
            // Raw string, not JSON. Serialize it for the sandbox parser.
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

export const PluginContainer = ({plugin, onStageChange, onCapabilityDenied, onRequestCommandBar}) => {
    const BUILD_MARKER = "plugin-container-2026-04-10-iframe-layout-recovery-v8";
    const iframeRef = useRef(null);
    const [iframeReady, setIframeReady] = useState(false);
    const [iframeHelloNonce, setIframeHelloNonce] = useState(0);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [content, setContent] = useState("");
    const [hostDocument, setHostDocument] = useState("");
    const [pluginCanRender, setPluginCanRender] = useState(false);
    const [iframeMounted, setIframeMounted] = useState(false);
    const [hostError, setHostError] = useState("");
    const [debugStage, setDebugStage] = useState("mounting");
    const [renderAttempt, setRenderAttempt] = useState(0);
    const [showRecovery, setShowRecovery] = useState(false);
    const requestedInitRef = useRef(false);
    const showPluginStageDebug = (
        localStorage.getItem("fdo:plugin-stage-debug-ui") === "1"
        && (window.__E2E__ === true || localStorage.getItem("fdo:plugin-stage-debug-ui-force") === "1")
    );
    const iframeSandbox = window.__E2E__ === true
        ? "allow-scripts allow-same-origin"
        : "allow-scripts";
    const enableTransformUpgrade = false;
    const runtimePollStartedAtRef = useRef(0);
    const contentRef = useRef(content);
    const latestRenderPayloadRef = useRef(null);
    const renderSessionStartedAtRef = useRef(0);
    const ttfpReportedRef = useRef(false);
    const lastMirroredIframeInteractionAtRef = useRef(0);
    const lastCapabilityDeniedToastAtRef = useRef(0);
    const iframeLoaderRecoveryAttemptsRef = useRef(0);
    const iframeHelloRecoveryAttemptsRef = useRef(0);
    const lastPostedRenderSignatureRef = useRef("");
    const lastIncomingRenderSignatureRef = useRef("");
    const lastIncomingRenderAtRef = useRef(0);
    const lastIframeRepaintAtRef = useRef(0);
    const lastRenderPostAtRef = useRef(0);
    const lastRenderStageAtRef = useRef(0);
    const renderStageWatchdogRecoveryAttemptsRef = useRef(0);
    const iframeCollapsedLayoutRecoveryAttemptsRef = useRef(0);
    const onCapabilityDeniedRef = useRef(onCapabilityDenied);
    const onRequestCommandBarRef = useRef(onRequestCommandBar);
    const iframeStyleLockTimerRef = useRef(null);
    const enforceIframePresentation = (reason = "unspecified") => {
        const iframeNode = iframeRef.current;
        if (!iframeNode) return;
        iframeNode.style.setProperty("position", "static", "important");
        iframeNode.style.setProperty("inset", "auto", "important");
        iframeNode.style.setProperty("display", "block", "important");
        iframeNode.style.setProperty("width", "100%", "important");
        iframeNode.style.setProperty("height", "100%", "important");
        iframeNode.style.setProperty("min-width", "1px", "important");
        iframeNode.style.setProperty("min-height", "1px", "important");
        iframeNode.style.setProperty("flex", "1 1 auto", "important");
        iframeNode.style.setProperty("vertical-align", "top", "important");
        iframeNode.style.setProperty("visibility", "visible", "important");
        iframeNode.style.setProperty("opacity", "1", "important");
        iframeNode.style.setProperty("background", "#ffffff", "important");
        try {
            const computed = window.getComputedStyle(iframeNode);
            console.info("[PLUGIN_CONTAINER_IFRAME_STYLE]", JSON.stringify({
                plugin,
                reason,
                position: computed.position,
                display: computed.display,
                visibility: computed.visibility,
                opacity: computed.opacity,
                zIndex: computed.zIndex,
            }));
        } catch (_) {
            // no-op
        }
    };
    const startIframeStyleLock = (reason = "unspecified") => {
        if (iframeStyleLockTimerRef.current) {
            window.clearInterval(iframeStyleLockTimerRef.current);
            iframeStyleLockTimerRef.current = null;
        }
        let ticks = 0;
        enforceIframePresentation(`${reason}:start`);
        iframeStyleLockTimerRef.current = window.setInterval(() => {
            ticks += 1;
            enforceIframePresentation(`${reason}:tick-${ticks}`);
            if (ticks >= 24) {
                if (iframeStyleLockTimerRef.current) {
                    window.clearInterval(iframeStyleLockTimerRef.current);
                    iframeStyleLockTimerRef.current = null;
                }
            }
        }, 120);
    };
    const postRenderMessageToIframe = (normalizedPayload, mode) => {
        if (!iframeRef.current?.contentWindow || !normalizedPayload) {
            return;
        }
        const fallbackCode = JSON.stringify(normalizedPayload.render);
        console.info("[PLUGIN_CONTAINER_POST_TO_IFRAME]", JSON.stringify({
            plugin,
            renderAttempt,
            iframeLoaded,
            iframeReady,
            mode,
            codeLength: String(fallbackCode || "").length,
        }));
        iframeRef.current.contentWindow.postMessage({
            type: "PLUGIN_RENDER",
            content: {
                code: fallbackCode,
                onLoad: normalizedPayload.onLoad,
            },
        }, "*");
    };
    const nudgeIframeRepaint = () => {
        const iframeNode = iframeRef.current;
        if (!iframeNode) return;
        const now = Date.now();
        if (now - lastIframeRepaintAtRef.current < 120) {
            return;
        }
        lastIframeRepaintAtRef.current = now;
        iframeNode.style.willChange = "transform, opacity";
        iframeNode.style.transform = "translateZ(0)";
        iframeNode.style.opacity = "0.999";
        requestAnimationFrame(() => {
            const node = iframeRef.current;
            if (!node) return;
            node.style.transform = "none";
            node.style.opacity = "1";
            requestAnimationFrame(() => {
                const nodeFinal = iframeRef.current;
                if (!nodeFinal) return;
                nodeFinal.style.willChange = "auto";
            });
        });
    };

    const { transform } = useBabelWorker();
    const logRenderMetric = (event, metadata = {}) => {
        try {
            if (typeof window?.electron?.startup?.logMetric === "function") {
                window.electron.startup.logMetric(`plugin-render:${event}`, {
                    plugin,
                    ...metadata,
                });
            }
        } catch (_) {
            // ignore diagnostics errors
        }
    };

    const stageToken = String(debugStage || "").split(":")[0];
    const statusLabelByStage = {
        mounting: "Preparing plugin host",
        "host-document-loaded": "Loading plugin frame",
        "iframe-loaded": "Starting plugin frame",
        "iframe-ready": "Connecting plugin runtime",
        "waiting-runtime-status": "Checking plugin runtime",
        "requesting-plugin-init": "Initializing plugin",
        "plugin-inited": "Preparing plugin UI",
        "requesting-plugin-render": "Rendering plugin UI",
        "plugin-render-received": "Finalizing plugin UI",
        "posting-render-to-iframe": "Finalizing plugin UI",
        "posting-render-fallback-html": "Rendering plugin UI (fallback mode)",
    };
    const userStatusLabel = hostError
        ? "Plugin UI failed to load"
        : (statusLabelByStage[stageToken] || "Loading plugin UI");

    useEffect(() => {
        console.info("[PLUGIN_CONTAINER_BUILD]", BUILD_MARKER);
    }, [BUILD_MARKER]);

    useEffect(() => {
        onCapabilityDeniedRef.current = onCapabilityDenied;
    }, [onCapabilityDenied]);

    useEffect(() => {
        onRequestCommandBarRef.current = onRequestCommandBar;
    }, [onRequestCommandBar]);

    const handleRetry = () => {
        setShowRecovery(false);
        setHostError("");
        setDebugStage("retrying-plugin-render");
        setRenderAttempt((prev) => prev + 1);
    };

    useEffect(() => {
        pluginTrace("container.stage", {plugin, stage: debugStage});
        onStageChange?.(debugStage);
    }, [debugStage, onStageChange]);

    useEffect(() => {
        contentRef.current = content;
        if (content?.render) {
            latestRenderPayloadRef.current = content;
        }
    }, [content]);

    useEffect(() => {
        setIframeReady(false);
        setIframeHelloNonce(0);
        setIframeLoaded(false);
        setContent("");
        lastPostedRenderSignatureRef.current = "";
        lastIncomingRenderSignatureRef.current = "";
        lastIncomingRenderAtRef.current = 0;
        lastRenderPostAtRef.current = 0;
        lastRenderStageAtRef.current = 0;
        renderStageWatchdogRecoveryAttemptsRef.current = 0;
        iframeCollapsedLayoutRecoveryAttemptsRef.current = 0;
        latestRenderPayloadRef.current = null;
        setPluginCanRender(false);
        setIframeMounted(false);
        setHostError("");
        iframeLoaderRecoveryAttemptsRef.current = 0;
        iframeHelloRecoveryAttemptsRef.current = 0;
        renderSessionStartedAtRef.current = Date.now();
        ttfpReportedRef.current = false;
        let cancelled = false;

        window.fetch("static://host/plugin_host.html")
            .then((response) => response.text())
            .then((html) => {
                if (!cancelled) {
                    setHostError("");
                    setDebugStage("host-document-loaded");
                    setHostDocument(rewritePluginHostHtml(html));
                }
            })
            .catch((error) => {
                console.error("Plugin host document failed to load:", error);
                if (!cancelled) {
                    setHostError(error?.message || String(error));
                    setDebugStage("host-document-failed");
                }
            });

        return () => {
            cancelled = true;
        };
    }, [renderAttempt]);

    useEffect(() => {
        const handlePluginUiMessage = (payload) => {
            if (!payload || payload.id !== plugin) return;
            if (!iframeRef.current?.contentWindow) return;
            iframeRef.current?.contentWindow?.postMessage({type: "UI_MESSAGE", content: payload.content}, "*");
        };

        const handlePluginMessages = (event) => {
            const activeIframeWindow = iframeRef.current?.contentWindow;
            const strictSourceMatch = Boolean(activeIframeWindow && event?.source === activeIframeWindow);
            if (!strictSourceMatch && isTrustedPluginFrameEvent(event, activeIframeWindow)) {
                console.info("[PLUGIN_CONTAINER_IFRAME_EVENT_IGNORED]", JSON.stringify({
                    plugin,
                    reason: "source_mismatch",
                    type: String(event?.data?.type || ""),
                }));
            }
            if (!strictSourceMatch) {
                return;
            }

            if (event.data.type === "PLUGIN_HELLO") {
                logRenderMetric("iframe_stage", { stage: "PLUGIN_HELLO" });
                console.info("[PLUGIN_CONTAINER_IFRAME_STAGE]", JSON.stringify({
                    plugin,
                    stage: "PLUGIN_HELLO",
                }));
                startIframeStyleLock("hello");
                setIframeReady(true);
                setIframeHelloNonce((prev) => prev + 1);
                setDebugStage("iframe-ready");
            } else if (event.data.type === "PLUGIN_STAGE" && typeof event.data.stage === "string") {
                logRenderMetric("iframe_stage", { stage: event.data.stage, message: event.data.message || "" });
                console.info("[PLUGIN_CONTAINER_IFRAME_STAGE]", JSON.stringify({
                    plugin,
                    stage: event.data.stage,
                    message: event.data.message || "",
                }));
                if (
                    event.data.stage === "iframe-render-message-received"
                    || event.data.stage === "iframe-module-url-created"
                    || event.data.stage === "iframe-module-imported"
                    || event.data.stage === "iframe-component-invoked"
                    || event.data.stage === "iframe-component-mounted"
                    || event.data.stage === "iframe-dom-after-mount"
                ) {
                    lastRenderStageAtRef.current = Date.now();
                }
                if (event.data.stage === "iframe-dom-after-mount") {
                    const stageMessage = String(event.data.message || "");
                    const collapsedLayout = (
                        stageMessage.includes("rootRect=0x0")
                        || stageMessage.includes("docElRect=0x0")
                        || stageMessage.includes("bodyRect=0x0")
                    );
                    if (!collapsedLayout) {
                        iframeCollapsedLayoutRecoveryAttemptsRef.current = 0;
                    } else if (iframeCollapsedLayoutRecoveryAttemptsRef.current < 2) {
                        iframeCollapsedLayoutRecoveryAttemptsRef.current += 1;
                        setDebugStage("iframe-layout-collapsed-retry");
                        setRenderAttempt((prev) => prev + 1);
                        return;
                    }
                }
                if (event.data.stage === "iframe-dom-after-mount") {
                    setIframeMounted(true);
                    nudgeIframeRepaint();
                }
                if (event.data.stage === "iframe-dom-after-mount" && !ttfpReportedRef.current) {
                    ttfpReportedRef.current = true;
                    const ttfpMs = Math.max(0, Date.now() - (renderSessionStartedAtRef.current || Date.now()));
                    pluginTrace("container.metric.ttfp", {plugin, ttfpMs});
                    try {
                        window.__FDO_PLUGIN_METRICS__ = window.__FDO_PLUGIN_METRICS__ || [];
                        window.__FDO_PLUGIN_METRICS__.push({
                            metric: "plugin_ttfp_ms",
                            plugin,
                            value: ttfpMs,
                            ts: Date.now(),
                        });
                        if (window.__FDO_PLUGIN_METRICS__.length > 500) {
                            window.__FDO_PLUGIN_METRICS__.shift();
                        }
                    } catch (_) {
                        // Best-effort diagnostics only.
                    }
                }
                setDebugStage(event.data.message ? `${event.data.stage}: ${event.data.message}` : event.data.stage);
            } else if (event.data.type === "OPEN_EXTERNAL_LINK") {
                if (isAllowedPluginExternalUrl(event.data.url)) {
                    window.electron.system.openExternal(event.data.url);
                }
            } else if (event.data.type === "PLUGIN_IFRAME_INTERACTION") {
                const iframeNode = iframeRef.current;
                if (!iframeNode) {
                    return;
                }
                const now = Date.now();
                if (now - lastMirroredIframeInteractionAtRef.current < 24) {
                    return;
                }
                lastMirroredIframeInteractionAtRef.current = now;

                // Mirror iframe interactions into host DOM so Blueprint "outside click"
                // logic can dismiss open overlays/popovers while plugin iframe is focused.
                const pointerDown = typeof window.PointerEvent === "function"
                    ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true })
                    : new MouseEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, button: 0 });
                const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, button: 0 });
                const click = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, button: 0 });
                iframeNode.dispatchEvent(pointerDown);
                iframeNode.dispatchEvent(mouseDown);
                iframeNode.dispatchEvent(click);
            } else if (event.data.type === "PLUGIN_SHORTCUT" && event.data.shortcut === "command-bar") {
                onRequestCommandBarRef.current?.();
            } else if (event.data.type === "UI_MESSAGE_REQUEST") {
                if (typeof event.data.requestId !== "string" || !isValidPluginUiRequestMessage(event.data.message)) {
                    return;
                }

                window.electron.plugin.uiMessage(plugin, event.data.message).then((response) => {
                    if (response?.ok === false) {
                        const missingCapabilityDiagnostics = parseMissingCapabilityDiagnosticsFromError(response?.error || "");
                        const missingCapabilities = missingCapabilityDiagnostics.map((item) => item.capability);
                        const privilegedFailure = (
                            isPrivilegedFailureCode(response?.code)
                            || missingCapabilities.length > 0
                        );
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
                        if (privilegedFailure) {
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
                });
            } else if (event.data.type === "UI_MESSAGE") {
                if (!isValidPluginUiRequestMessage(event.data.message)) {
                    return;
                }

                window.electron.plugin.uiMessage(plugin, event.data.message).then(() => {});
            }
        };

        window.electron.plugin.on.uiMessage(handlePluginUiMessage);
        window.addEventListener("message", handlePluginMessages);

        return () => {
            if (iframeStyleLockTimerRef.current) {
                window.clearInterval(iframeStyleLockTimerRef.current);
                iframeStyleLockTimerRef.current = null;
            }
            window.electron.plugin.off.uiMessage(handlePluginUiMessage);
            window.removeEventListener("message", handlePluginMessages);
        };
    }, [plugin, renderAttempt]);

    useEffect(() => {
        let cancelled = false;

        setPluginCanRender(false);
        requestedInitRef.current = false;
        runtimePollStartedAtRef.current = Date.now();
        setDebugStage("waiting-runtime-status");

        if (!plugin) {
            return () => {
                cancelled = true;
            };
        }

        const pollRuntimeStatus = async () => {
            if (cancelled) return;
            try {
                const result = await window.electron.plugin.getRuntimeStatus([plugin]);
                if (cancelled) {
                    return;
                }

                const status = result.statuses?.[0];
                pluginTrace("container.runtimeStatus", {
                    plugin,
                    success: !!result?.success,
                    loading: !!status?.loading,
                    loaded: !!status?.loaded,
                    ready: !!status?.ready,
                    inited: !!status?.inited,
                });
                if (status?.inited) {
                    setPluginCanRender(true);
                    setDebugStage("plugin-inited");
                    return;
                }

                if (!result?.success) {
                    setDebugStage("runtime-status-unavailable");
                }

                if (status?.ready && !status?.inited && !requestedInitRef.current) {
                    requestedInitRef.current = true;
                    setDebugStage("requesting-plugin-init");
                    const initResult = await window.electron.plugin.init(plugin);
                    if (initResult?.success === false) {
                        requestedInitRef.current = false;
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("Plugin runtime status polling failed:", error);
                    setDebugStage("runtime-status-poll-failed");
                }
            }

            if (cancelled) {
                return;
            }

            if (Date.now() - runtimePollStartedAtRef.current > 12000) {
                setHostError("Plugin initialization timed out. Retry loading the plugin UI.");
                setDebugStage("plugin-runtime-timeout");
                return;
            }

            window.setTimeout(pollRuntimeStatus, 250);
        };

        pollRuntimeStatus();

        return () => {
            cancelled = true;
        };
    }, [plugin, renderAttempt]);

    useEffect(() => {
        if (!plugin) return;
        const handlePluginRender = (payload) => {
            if (!payload) {
                logRenderMetric("event_ignored", { reason: "empty_payload" });
                console.info("[PLUGIN_CONTAINER_RENDER_EVENT_IGNORED]", JSON.stringify({
                    plugin,
                    reason: "empty_payload",
                }));
                return;
            }
            if (payload.id !== plugin) {
                logRenderMetric("event_ignored", {
                    reason: "id_mismatch",
                    payloadId: payload.id || "",
                });
                console.info("[PLUGIN_CONTAINER_RENDER_EVENT_IGNORED]", JSON.stringify({
                    plugin,
                    payloadId: payload.id || "",
                    reason: "id_mismatch",
                }));
                return;
            }
            logRenderMetric("event_received", {
                payloadId: payload.id || "",
                hasContent: !!payload?.content,
            });
            console.info("[PLUGIN_CONTAINER_RENDER_EVENT]", JSON.stringify({
                plugin,
                payloadId: payload.id || "",
                hasContent: !!payload?.content,
                contentKeys: payload?.content && typeof payload.content === "object"
                    ? Object.keys(payload.content)
                    : [],
            }));
            pluginTrace("container.render.payload", {plugin});
            const normalizedContent = normalizeIncomingRenderContent(payload.content);
            if (!normalizedContent) {
                logRenderMetric("event_invalid_payload", {});
                setHostError("Invalid plugin render payload received from runtime.");
                setDebugStage("plugin-render-payload-invalid");
                return;
            }
            logRenderMetric("event_normalized", {
                hasRender: typeof normalizedContent?.render === "string",
                hasOnLoad: typeof normalizedContent?.onLoad === "string",
            });

            const incomingSignature = `${normalizedContent.render.length}:${normalizedContent.onLoad.length}:${normalizedContent.render.slice(0, 128)}:${normalizedContent.onLoad.slice(0, 64)}`;
            const incomingNow = Date.now();
            if (
                incomingSignature === lastIncomingRenderSignatureRef.current
                && (incomingNow - lastIncomingRenderAtRef.current) < 250
            ) {
                logRenderMetric("event_ignored", { reason: "duplicate_payload_burst" });
                return;
            }
            lastIncomingRenderSignatureRef.current = incomingSignature;
            lastIncomingRenderAtRef.current = incomingNow;

            latestRenderPayloadRef.current = normalizedContent;
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
            if (cancelled || contentRef.current?.render) {
                return;
            }
            if (attempt >= MAX_RENDER_REQUEST_ATTEMPTS) {
                const finalizeTimeout = async () => {
                    let runtimeHint = "";
                    try {
                        const statusResult = await window.electron.plugin.getRuntimeStatus([plugin]);
                        const status = statusResult?.statuses?.[0] || null;
                        if (status?.diagnosticsLastError) {
                            runtimeHint = ` Runtime reported: ${status.diagnosticsLastError}`;
                        }
                    } catch (_) {
                        // Best-effort diagnostics only.
                    }
                    const suffix = errorText ? ` ${errorText}` : "";
                    setHostError(`Plugin render request timed out after retries.${suffix}${runtimeHint}`);
                    setDebugStage("plugin-render-request-timeout");
                    pluginTrace("container.render.request.timeout", {plugin, attempts: attempt, reason, error: errorText, runtimeHint});
                };
                void finalizeTimeout();
                return;
            }

            const delayMs = RENDER_BACKOFF_DELAYS_MS[Math.min(attempt - 1, RENDER_BACKOFF_DELAYS_MS.length - 1)];
            setDebugStage("plugin-render-request-retry-pending");
            pluginTrace("container.render.request.retry-scheduled", {
                plugin,
                attempt,
                nextAttempt: attempt + 1,
                reason,
                delayMs,
                error: errorText,
            });
            scheduledRetryTimer = window.setTimeout(() => {
                scheduledRetryTimer = null;
                requestRender("retry");
            }, delayMs);
        };

        const requestRender = async (source = "initial") => {
            if (cancelled || contentRef.current?.render) {
                return;
            }

            attempt += 1;
            setDebugStage(attempt === 1 ? "requesting-plugin-render" : `requesting-plugin-render-retry-${attempt}`);
            pluginTrace("container.render.request", {plugin, attempt, source});
            try {
                const result = await window.electron.plugin.render(plugin);
                if (cancelled || contentRef.current?.render) {
                    return;
                }
                if (result?.success === false) {
                    const errorText = result.error || "";
                    pluginTrace("container.render.request.rejected", {plugin, attempt, error: errorText});
                    scheduleRetry("render-rejected", errorText);
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
                if (cancelled || contentRef.current?.render) {
                    return;
                }
                const errorText = error?.message || String(error);
                console.error("Plugin render request failed:", error);
                pluginTrace("container.render.request.error", {plugin, attempt, error: errorText});
                scheduleRetry("render-request-error", errorText);
            }
        };

        requestRender("initial");

        return () => {
            cancelled = true;
            if (scheduledRetryTimer) {
                window.clearTimeout(scheduledRetryTimer);
            }
            window.electron.plugin.off.render(handlePluginRender);
        };
    }, [plugin, pluginCanRender, renderAttempt]);

    useEffect(() => {
        const run = async () => {
            try {
                if (!iframeLoaded || !content?.render) {
                    return;
                }

                const renderSignatureBase = `${renderAttempt}:${iframeHelloNonce}:${String(content?.render || "").length}:${String(content?.onLoad || "").length}`;
                const renderSignature = `${renderSignatureBase}:${iframeReady ? "ready" : "pending"}`;
                if (lastPostedRenderSignatureRef.current === renderSignature) {
                    return;
                }
                lastPostedRenderSignatureRef.current = renderSignature;

                const normalized = normalizePluginRenderPayload(content);
                const safeCode = "<>" + normalizePluginJsxSource(normalized.render) + "</>";
                const postRenderPayload = (code) => {
                    lastRenderPostAtRef.current = Date.now();
                    console.info("[PLUGIN_CONTAINER_POST_TO_IFRAME]", JSON.stringify({
                        plugin,
                        renderAttempt,
                        iframeLoaded,
                        iframeReady,
                        mode: code === JSON.stringify(normalized.render) ? "fallback_html_fastpath" : "transformed_upgrade",
                        codeLength: String(code || "").length,
                    }));
                    iframeRef.current?.contentWindow?.postMessage({
                        type: "PLUGIN_RENDER",
                        content: {
                            code,
                            onLoad: normalized.onLoad
                        }
                    }, "*");
                };
                // Post only after iframe listener readiness. Posting before PLUGIN_HELLO
                // creates duplicate render churn during fast plugin switching.
                if (!iframeReady) {
                    setDebugStage("waiting-iframe-ready");
                    return;
                }

                // Always post a fast HTML fallback first so packaged builds never time out
                // while waiting for Babel worker startup.
                const fallbackCode = JSON.stringify(normalized.render);
                logRenderMetric("post_to_iframe", { mode: "fallback_html_fastpath" });
                setDebugStage("posting-render-fallback-html");
                postRenderPayload(fallbackCode);

                if (!enableTransformUpgrade) {
                    setDebugStage("plugin-render-received");
                    return;
                }

                try {
                    const transformedCode = await transform(safeCode);
                    // Upgrade render only when transform produced a different payload.
                    if (typeof transformedCode === "string" && transformedCode !== fallbackCode) {
                        logRenderMetric("post_to_iframe", { mode: "transformed_upgrade" });
                        setDebugStage("posting-render-to-iframe");
                        postRenderPayload(transformedCode);
                    }
                } catch (transformError) {
                    AppToaster.show({
                        message: `Plugin render fallback: JSX transform failed; rendering HTML fallback. ${transformError?.message || String(transformError)}`,
                        intent: "warning",
                    });
                }
            } catch (err) {
                console.error("Plugin render preparation error:", err);
                setHostError(err?.message || String(err));
                setDebugStage("plugin-render-preparation-failed");
            }
        };

        run();
    }, [iframeLoaded, iframeReady, iframeHelloNonce, content, renderAttempt]);

    useEffect(() => {
        if (hostError || !iframeLoaded || !iframeReady || !content?.render) {
            return;
        }

        const timer = window.setTimeout(() => {
            const lastPostAt = lastRenderPostAtRef.current || 0;
            const lastStageAt = lastRenderStageAtRef.current || 0;
            if (!lastPostAt) {
                return;
            }
            if (lastStageAt >= lastPostAt) {
                renderStageWatchdogRecoveryAttemptsRef.current = 0;
                return;
            }
            if (renderStageWatchdogRecoveryAttemptsRef.current >= 1) {
                return;
            }
            renderStageWatchdogRecoveryAttemptsRef.current += 1;
            setDebugStage("iframe-stage-watchdog-retry");
            setRenderAttempt((prev) => prev + 1);
        }, 1600);

        return () => {
            window.clearTimeout(timer);
        };
    }, [hostError, iframeLoaded, iframeReady, content, renderAttempt]);

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

        return () => {
            window.clearTimeout(timer);
        };
    }, [hostError, content, iframeLoaded, iframeReady, debugStage, iframeMounted]);

    useEffect(() => {
        if (hostError || !iframeLoaded || !content?.render) {
            return;
        }

        const timer = window.setTimeout(() => {
            const bodyHtml = String(iframeRef.current?.contentDocument?.body?.innerHTML || "");
            const stuckOnLoader = bodyHtml.includes("plugin-page-loader");
            if (!stuckOnLoader) {
                iframeLoaderRecoveryAttemptsRef.current = 0;
                return;
            }

            if (iframeLoaderRecoveryAttemptsRef.current >= 2) {
                return;
            }

            iframeLoaderRecoveryAttemptsRef.current += 1;
            setDebugStage("iframe-loader-stuck-retry");
            setRenderAttempt((prev) => prev + 1);
        }, 5000);

        return () => {
            window.clearTimeout(timer);
        };
    }, [hostError, iframeLoaded, content, renderAttempt]);

    useEffect(() => {
        if (hostError || !iframeLoaded || iframeReady) {
            return;
        }

        const timer = window.setTimeout(() => {
            if (hostError || iframeReady) {
                return;
            }
            if (iframeHelloRecoveryAttemptsRef.current >= 2) {
                return;
            }
            iframeHelloRecoveryAttemptsRef.current += 1;
            setDebugStage("iframe-hello-missing-retry");
            setRenderAttempt((prev) => prev + 1);
        }, 2200);

        return () => {
            window.clearTimeout(timer);
        };
    }, [hostError, iframeLoaded, iframeReady, renderAttempt]);

    return (
        <div id={"plugin-container"} style={{
            position: "relative",
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
            background: "#ffffff",
            zIndex: 1,
        }}>
            {(!hostDocument || !iframeLoaded || (!content?.render && !iframeMounted && !iframeReady)) && (
                <div style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "white",
                    zIndex: 3
                }}>
                    {hostError ? (
                        <div style={{maxWidth: "560px", padding: "24px", textAlign: "left"}}>
                            <h2 style={{marginTop: 0, color: "#1f2933"}}>Plugin UI failed to load</h2>
                            <p style={{marginBottom: 0, color: "#394b59"}}>{hostError}</p>
                            <div style={{display: "flex", gap: "8px", marginTop: "16px"}}>
                                <Button intent="primary" text="Retry" onClick={handleRetry} />
                            </div>
                            {showPluginStageDebug && (
                                <p style={{marginTop: "12px", marginBottom: 0, fontSize: "12px", opacity: 0.8}}>
                                    Stage: {debugStage}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div style={{display: "flex", flexDirection: "column", alignItems: "center", gap: "12px"}}>
                            <Spinner size={100} intent={"primary"} />
                            <div style={{fontSize: "13px", color: "#394b59"}}>{userStatusLabel}</div>
                            {showRecovery && (
                                <div style={{display: "flex", gap: "8px"}}>
                                    <Button intent="primary" text="Retry Loading" onClick={handleRetry} />
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
                title="Plugin Container ID"
                srcDoc={hostDocument}
                sandbox={iframeSandbox}
                referrerPolicy="no-referrer"
                onLoad={() => {
                    startIframeStyleLock("onload");
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
                    verticalAlign: "top",
                    border: "none",
                    position: "static",
                    inset: "auto",
                    visibility: "visible",
                    opacity: 1,
                    overflow: "hidden",
                    boxSizing: "border-box",
                    background: "#ffffff",
                    zIndex: 2,
                }}
            />
        </div>
    );
};
PluginContainer.propTypes = {
    plugin: PropTypes.string.isRequired,
    onStageChange: PropTypes.func,
    onCapabilityDenied: PropTypes.func,
    onRequestCommandBar: PropTypes.func,
}
