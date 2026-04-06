import React, {useEffect, useRef, useState} from "react";
import {
    isTrustedParentPluginEvent,
    isValidPluginRenderMessage,
    isValidPluginUiResponseEvent,
} from "./utils/pluginRenderSecurity";

export const PluginPage = () => {
    const [PluginComponent, SetPluginComponent] = useState(null);
    const [pluginLoadError, setPluginLoadError] = useState("");
    const activeModuleUrlRef = useRef(null);

    useEffect(() => {
        const iframeDocument = document;
        const head = iframeDocument.head;
        if (head) {
            const meta = iframeDocument.createElement("meta");
            meta.httpEquiv = "Content-Security-Policy";
            meta.content = "" +
                "default-src 'self'; " +
                "script-src 'self' 'nonce-plugin-script-inject' blob: static://*; " +
                "style-src 'unsafe-inline' 'self' static://*; " +
                "object-src 'none';";

            // Remove existing CSP to prevent duplicates
            const existingCSP = head.querySelector("meta[http-equiv='Content-Security-Policy']");
            if (existingCSP) {
                head.removeChild(existingCSP);
            }

            // Append new CSP meta tag
            head.appendChild(meta);
        }
    }, []);

    useEffect(() => {
        const reportStage = (stage, message = "") => {
            window.parent.postMessage({ type: "PLUGIN_STAGE", stage, message }, "*");
        };
        let lastInteractionBridgeAt = 0;
        const bridgeInteractionToHost = (kind = "pointerdown") => {
            const now = Date.now();
            if (now - lastInteractionBridgeAt < 24) {
                return;
            }
            lastInteractionBridgeAt = now;
            window.parent.postMessage({ type: "PLUGIN_IFRAME_INTERACTION", kind }, "*");
        };
        const handlePointerDownBridge = () => bridgeInteractionToHost("pointerdown");
        const handleMouseDownBridge = () => bridgeInteractionToHost("mousedown");
        const handleTouchStartBridge = () => bridgeInteractionToHost("touchstart");

        const showPluginError = (message) => {
            const normalizedMessage = String(message || "The plugin failed to load.").trim();
            setPluginLoadError(normalizedMessage);
            reportStage("iframe-plugin-error", normalizedMessage);
            SetPluginComponent(() => () => (
                <div className="plugin-timeout-container">
                    <div className="plugin-timeout-box">
                        <div className="plugin-timeout-icon">⚠️</div>
                        <div className="plugin-timeout-title">Plugin failed to load</div>
                        <div className="plugin-timeout-message">{normalizedMessage}</div>
                    </div>
                </div>
            ));
        };

        const handleMessage = (event) => {
            if (!isTrustedParentPluginEvent(event, window.parent)) {
                return;
            }

            if (isValidPluginRenderMessage(event.data)) {
                try {
                    reportStage("iframe-render-message-received");
                    setPluginLoadError("");
                    const moduleURL = createESModule(event.data.content.code, event.data.content.onLoad);
                    reportStage("iframe-module-url-created");
                    const previousModuleUrl = activeModuleUrlRef.current;
                    activeModuleUrlRef.current = moduleURL;

                    if (previousModuleUrl) {
                        URL.revokeObjectURL(previousModuleUrl);
                    }

                    import(/* webpackIgnore: true */ moduleURL).then((pluginModule) => {
                        if (pluginModule.default) {
                            clearTimeout(pluginTimeout);
                            reportStage("iframe-module-imported");
                            // Assign the globally defined PluginComponent
                            SetPluginComponent(() => {
                                const DynamicComponent = pluginModule.default;
                                return (props) => <DynamicComponent {...props} />;
                            });
                            return;
                        }

                        const errorMessage = "Plugin module did not export a default component.";
                        reportStage("iframe-default-export-missing", errorMessage);
                        window.electron.notifications.add("Error rendering plugin", errorMessage, "danger");
                        showPluginError(errorMessage);
                    }).catch((error) => {
                        const errorMessage = error?.message || String(error);
                        reportStage("iframe-module-import-failed", errorMessage);
                        window.electron.notifications.add("Error rendering plugin", errorMessage, "danger");
                        showPluginError(errorMessage);
                    });
                } catch (error) {
                    const errorMessage = error?.message || String(error);
                    reportStage("iframe-render-handle-failed", errorMessage);
                    window.electron.notifications.add("Error rendering plugin", errorMessage, "danger");
                    showPluginError(errorMessage);
                }
            }
        };

        const blockPluginNavigation = (event) => {
            const anchor = event.target?.closest?.("a");
            if (!anchor) {
                return;
            }

            const rawHref = anchor.getAttribute("href") || "";
            if (!rawHref || rawHref === "#") {
                return;
            }

            let resolvedUrl;
            try {
                resolvedUrl = new URL(rawHref, window.location.href);
            } catch (_) {
                event.preventDefault();
                return;
            }

            if (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") {
                event.preventDefault();
                window.parent.postMessage({ type: "OPEN_EXTERNAL_LINK", url: resolvedUrl.href }, "*");
                return;
            }

            if (resolvedUrl.protocol === "plugin:" || resolvedUrl.protocol === "file:" || resolvedUrl.origin === window.location.origin) {
                event.preventDefault();
            }
        };

        const blockPluginFormSubmit = (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) {
                return;
            }

            const rawAction = form.getAttribute("action") || "";
            if (!rawAction) {
                event.preventDefault();
                return;
            }

            let resolvedUrl;
            try {
                resolvedUrl = new URL(rawAction, window.location.href);
            } catch (_) {
                event.preventDefault();
                return;
            }

            if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
                event.preventDefault();
            }
        };

        window.addEventListener("message", handleMessage);
        window.addEventListener("pointerdown", handlePointerDownBridge, true);
        window.addEventListener("mousedown", handleMouseDownBridge, true);
        window.addEventListener("touchstart", handleTouchStartBridge, true);
        document.addEventListener("click", blockPluginNavigation, true);
        document.addEventListener("submit", blockPluginFormSubmit, true);
        reportStage("iframe-listeners-ready");
        window.parent.postMessage({type: "PLUGIN_HELLO"}, "*");

        // Set timeout to auto-fail plugin after 5 seconds
        const pluginTimeout = setTimeout(() => {
            reportStage("iframe-load-timeout");
            showPluginError("The plugin failed to load. You might find more details in the notification panel.");
        }, 5000);

        return () => {
            window.removeEventListener("message", handleMessage);
            window.removeEventListener("pointerdown", handlePointerDownBridge, true);
            window.removeEventListener("mousedown", handleMouseDownBridge, true);
            window.removeEventListener("touchstart", handleTouchStartBridge, true);
            document.removeEventListener("click", blockPluginNavigation, true);
            document.removeEventListener("submit", blockPluginFormSubmit, true);
            clearTimeout(pluginTimeout);
            if (activeModuleUrlRef.current) {
                URL.revokeObjectURL(activeModuleUrlRef.current);
                activeModuleUrlRef.current = null;
            }
        };
    }, []);

    return PluginComponent ? (
        <PluginRuntimeErrorBoundary onError={(message) => {
            setPluginLoadError(message);
            window.parent.postMessage({ type: "PLUGIN_STAGE", stage: "iframe-render-crashed", message }, "*");
            window.electron.notifications.add("Error rendering plugin", message, "danger");
        }}>
            <PluginComponent React={React}/>
        </PluginRuntimeErrorBoundary>
    ) :
        <div style={{textAlign: "center", padding: "20px"}}><span className="plugin-page-loader"></span></div>;
}

class PluginRuntimeErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { errorMessage: "" };
    }

    static getDerivedStateFromError(error) {
        return {
            errorMessage: error?.message || String(error) || "The plugin UI crashed during render.",
        };
    }

    componentDidCatch(error) {
        const message = error?.message || String(error) || "The plugin UI crashed during render.";
        this.props.onError?.(message);
    }

    render() {
        if (this.state.errorMessage) {
            return (
                <div className="plugin-timeout-container">
                    <div className="plugin-timeout-box">
                        <div className="plugin-timeout-icon">⚠️</div>
                        <div className="plugin-timeout-title">Plugin failed to render</div>
                        <div className="plugin-timeout-message">{this.state.errorMessage}</div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * Creates a Blob-backed ES module for execution inside the sandboxed plugin iframe.
 * The real security boundary is the iframe sandbox plus host-side message validation,
 * not this runtime string wrapping.
 */
function createESModule(pluginCode, onLoad) {
    const pluginRenderExpression = normalizeTransformedPluginExpression(pluginCode);
    const wrappedCode = `
        export default function PluginComponent({React}) {
            const pluginRootRef = React.useRef(null);
            window.parent.postMessage({ type: "PLUGIN_STAGE", stage: "iframe-component-invoked", message: "" }, "*");

            window.createBackendReq = function(type, data) {
                return new Promise((resolve) => {
                    const requestId = "ui-message-" + Date.now() + "-" + Math.random().toString(36).slice(2);
                    const message = { type: "UI_MESSAGE_REQUEST", requestId, message: {handler: type, content: data} };
                    window.parent.postMessage(message, "*");
    
                    const listener = (event) => {
                        if (!(${isTrustedParentPluginEvent.toString()})(event, window.parent)) {
                            return;
                        }
                        if (!(${isValidPluginUiResponseEvent.toString()})(event.data, requestId)) {
                            return;
                        }
                        window.removeEventListener("message", listener);
                        if (event.data.error) {
                            resolve({ success: false, error: event.data.error });
                            return;
                        }
                        resolve(event.data.content);
                    };
                    window.addEventListener("message", listener);
                });
            };
            
            // Function to check if the element exists
            window.waitForElement = function(selector, callback, timeout = 5000) {
                const start = Date.now();
                
                const checkExist = setInterval(() => {
                    const element = document.querySelector(selector);
                    if (element && element.parentNode) {
                        clearInterval(checkExist);
                        callback(element);
                    }
                    if (Date.now() - start > timeout) {
                        clearInterval(checkExist);
                        console.error("Timeout: Element not found:", selector);
                    }
                }, 100);
            }
            
            window.executeInjectedScript = function (scriptContent) {
                const existingPlaceholder = document.getElementById("plugin-script-placeholder");
                if (!existingPlaceholder) {
                    return;
                }
                const scriptTag = document.createElement("script");
                scriptTag.type = "text/javascript";
                scriptTag.id = "plugin-script-placeholder";
                scriptTag.nonce = "plugin-script-inject";
                scriptTag.textContent = scriptContent;
                existingPlaceholder.replaceWith(scriptTag);
            }
            
            window.addGlobalEventListener = function(eventType, callback) {
                window.addEventListener(eventType, callback);
            }
            
            window.removeGlobalEventListener = function(eventType, callback) {
                window.removeEventListener(eventType, callback);
            }
            
            window.applyClassToSelector = function(className, selector) {
                const el = document.querySelector(selector);
                if (el && !el.classList.contains(className)) {
                    el.classList.add(className);
                }
            }
            
            React.useLayoutEffect(() => {
                window.parent.postMessage({ type: "PLUGIN_STAGE", stage: "iframe-layout-effect", message: "" }, "*");
            }, []);

            React.useEffect(() => {
                window.parent.postMessage({ type: "PLUGIN_STAGE", stage: "iframe-component-mounted", message: "" }, "*");

                const handleDocumentClick = (event) => {
                    const target = event.target.closest("a");
                    if (!target) {
                        return;
                    }
                    if (target.hasAttribute("data-no-external")) {
                        event.preventDefault();
                        return;
                    }

                    const rawHref = target.getAttribute("href") || "";
                    if (!rawHref || rawHref === "#") {
                        return;
                    }

                    let resolvedUrl;
                    try {
                        resolvedUrl = new URL(rawHref, window.location.href);
                    } catch (_) {
                        event.preventDefault();
                        return;
                    }

                    if (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") {
                        event.preventDefault();
                        window.parent.postMessage(
                            { type: "OPEN_EXTERNAL_LINK", url: resolvedUrl.href },
                            "*"
                        );
                        return;
                    }

                    if (resolvedUrl.protocol === "plugin:") {
                        event.preventDefault();
                    }
                };

                document.addEventListener("click", handleDocumentClick);
                
                const onLoadFn = ${onLoad}
                if (typeof onLoadFn === "function") {
                    try {
                        onLoadFn();
                    } catch (error) {
                        console.error("Error executing onLoad:", error);
                    }
                }

                requestAnimationFrame(() => {
                    const rootNode = pluginRootRef.current;
                    const domSummary = rootNode
                        ? "children=" + rootNode.childElementCount + "; text=" + (rootNode.textContent || "").trim().length
                        : "children=0; text=0";
                    window.parent.postMessage({ type: "PLUGIN_STAGE", stage: "iframe-dom-after-mount", message: domSummary }, "*");
                });
    
                return () => {
                    document.removeEventListener("click", handleDocumentClick);
                };
            }, []);
            
            const pluginRenderedNode = (${pluginRenderExpression});
            const renderHtmlString = typeof pluginRenderedNode === "string" && pluginRenderedNode.trim().startsWith("<");
            const pluginContent = renderHtmlString
                ? React.createElement("div", {
                    "data-plugin-root": "true",
                    ref: pluginRootRef,
                    dangerouslySetInnerHTML: { __html: pluginRenderedNode },
                })
                : React.createElement("div", { ref: pluginRootRef, "data-plugin-root": "true" }, pluginRenderedNode);

            return React.createElement(React.Fragment, null,
                pluginContent
            )
        }
    `;

    const blob = new Blob([wrappedCode], {type: "application/javascript"});
    return URL.createObjectURL(blob);
}

function normalizeTransformedPluginExpression(pluginCode) {
    if (typeof pluginCode !== "string") {
        throw new Error("Plugin render code must be a string.");
    }

    const trimmed = pluginCode.trim();
    if (!trimmed) {
        throw new Error("Plugin render code is empty.");
    }

    return trimmed.replace(/;+\s*$/, "");
}
