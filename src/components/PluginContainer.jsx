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

export const PluginContainer = ({plugin, onStageChange, onCapabilityDenied}) => {
    const [height, setHeight] = useState("100vh");
    const [width, setWidth] = useState("100%");
    const iframeRef = useRef(null);
    const [iframeReady, setIframeReady] = useState(false);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [content, setContent] = useState("");
    const [hostDocument, setHostDocument] = useState("");
    const [pluginCanRender, setPluginCanRender] = useState(false);
    const [hostError, setHostError] = useState("");
    const [debugStage, setDebugStage] = useState("mounting");
    const [renderAttempt, setRenderAttempt] = useState(0);
    const [showRecovery, setShowRecovery] = useState(false);
    const requestedInitRef = useRef(false);
    const showPluginStageDebug = (
        localStorage.getItem("fdo:plugin-stage-debug-ui") === "1"
        && (window.__E2E__ === true || localStorage.getItem("fdo:plugin-stage-debug-ui-force") === "1")
    );
    const runtimePollStartedAtRef = useRef(0);
    const contentRef = useRef(content);
    const renderSessionStartedAtRef = useRef(0);
    const ttfpReportedRef = useRef(false);
    const lastMirroredIframeInteractionAtRef = useRef(0);
    const lastCapabilityDeniedToastAtRef = useRef(0);

    const { transform } = useBabelWorker();

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
    }, [content]);

    useEffect(() => {
        const updateHeight = () => {
            const newHeight = window.innerHeight - 50;
            const newWidth = window.innerWidth - 50;
            setHeight(`${newHeight}px`);
            setWidth(`${newWidth}px`);
        };

        window.addEventListener("resize", updateHeight); // Handle resizing

        // Initial height calculation
        updateHeight();

        // Cleanup on unmount
        return () => {
            window.removeEventListener("resize", updateHeight);
        };
    }, []);

    useEffect(() => {
        setIframeReady(false);
        setIframeLoaded(false);
        setContent("");
        setPluginCanRender(false);
        setHostError("");
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
            if (!isTrustedPluginFrameEvent(event, iframeRef.current?.contentWindow)) {
                return;
            }

            if (event.data.type === "PLUGIN_HELLO") {
                setIframeReady(true);
                setDebugStage("iframe-ready");
            } else if (event.data.type === "PLUGIN_STAGE" && typeof event.data.stage === "string") {
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
            } else if (event.data.type === "UI_MESSAGE_REQUEST") {
                if (typeof event.data.requestId !== "string" || !isValidPluginUiRequestMessage(event.data.message)) {
                    return;
                }

                window.electron.plugin.uiMessage(plugin, event.data.message).then((response) => {
                    if (response?.ok === false && response?.code === "CAPABILITY_DENIED") {
                        const missingCapabilityDiagnostics = parseMissingCapabilityDiagnosticsFromError(response?.error || "");
                        const missingCapabilities = missingCapabilityDiagnostics.map((item) => item.capability);
                        const now = Date.now();
                        if (now - lastCapabilityDeniedToastAtRef.current > 1500) {
                            lastCapabilityDeniedToastAtRef.current = now;
                            AppToaster.show({
                                message: `Plugin "${plugin}" is missing required permission${missingCapabilities.length > 1 ? "s" : ""}.`,
                                intent: "warning",
                            });
                        }
                        onCapabilityDenied?.({
                            pluginId: plugin,
                            missingCapabilities,
                            missingCapabilityDiagnostics,
                            details: response?.error || "Capability denied.",
                            code: response?.code,
                            correlationId: response?.correlationId || "",
                        });
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
            window.electron.plugin.off.uiMessage(handlePluginUiMessage);
            window.removeEventListener("message", handlePluginMessages);
        };
    }, [plugin, renderAttempt, onCapabilityDenied]);

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
            if (!payload || payload.id !== plugin) return;
            pluginTrace("container.render.payload", {plugin});
            const normalizedContent = normalizeIncomingRenderContent(payload.content);
            if (!normalizedContent) {
                setHostError("Invalid plugin render payload received from runtime.");
                setDebugStage("plugin-render-payload-invalid");
                return;
            }
            setHostError("");
            setDebugStage("plugin-render-received");
            setContent(normalizedContent);
        };

        window.electron.plugin.off.render(handlePluginRender);
        window.electron.plugin.on.render(handlePluginRender);
        setContent("");
        setHostError("");

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
                const suffix = errorText ? ` ${errorText}` : "";
                setHostError(`Plugin render request timed out after retries.${suffix}`);
                setDebugStage("plugin-render-request-timeout");
                pluginTrace("container.render.request.timeout", {plugin, attempts: attempt, reason, error: errorText});
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
                if (iframeReady && iframeLoaded && content?.render) {
                    const normalized = normalizePluginRenderPayload(content);
                    const safeCode = "<>" + normalizePluginJsxSource(normalized.render) + "</>";
                    try {
                        const transformedCode = await transform(safeCode);
                        setDebugStage("posting-render-to-iframe");
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "PLUGIN_RENDER",
                            content: {
                                code: transformedCode,
                                onLoad: normalized.onLoad
                            }
                        }, "*");
                    } catch (transformError) {
                        // Fallback: keep plugin UI usable for HTML-string render payloads
                        // even when JSX transformation fails.
                        const fallbackCode = JSON.stringify(normalized.render);
                        setDebugStage("posting-render-fallback-html");
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "PLUGIN_RENDER",
                            content: {
                                code: fallbackCode,
                                onLoad: normalized.onLoad
                            }
                        }, "*");
                        AppToaster.show({
                            message: `Plugin render fallback: JSX transform failed; rendering HTML fallback. ${transformError?.message || String(transformError)}`,
                            intent: "warning",
                        });
                    }
                }
            } catch (err) {
                console.error("Plugin render preparation error:", err);
                setHostError(err?.message || String(err));
                setDebugStage("plugin-render-preparation-failed");
            }
        };

        run();
    }, [iframeLoaded, iframeReady, content, renderAttempt]);

    useEffect(() => {
        if (hostError || content?.render) {
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
    }, [hostError, content, iframeLoaded, iframeReady, debugStage]);

    return (
        <div id={"plugin-container"} style={{position: "relative", height: "100%", margin: 0, padding: 0, overflow: "hidden"}}>
            {(!hostDocument || !iframeLoaded || !content?.render) && (
                <div style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "white",
                    zIndex: 1
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
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                onLoad={() => {
                    setIframeLoaded(true);
                    setDebugStage("iframe-loaded");
                }}
                style={{width: width, height: height, border: "none", overflow: "hidden", boxSizing: "border-box"}}
            />
        </div>
    );
};
PluginContainer.propTypes = {
    plugin: PropTypes.string.isRequired,
    onStageChange: PropTypes.func,
    onCapabilityDenied: PropTypes.func,
}
