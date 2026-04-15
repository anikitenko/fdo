import React, {useEffect, useRef, useState} from "react";
import {
    isTrustedParentPluginEvent,
    isValidPluginRenderMessage,
    isValidPluginUiResponseEvent,
} from "./utils/pluginRenderSecurity";
import {buildRuntimeSecurityPolicy} from "../../utils/pluginCapabilities";
import {isNetworkTargetAllowed} from "../../utils/networkScopeRegistry";

const NETWORK_CAPABILITY = "system.network";
const NETWORK_HTTPS_CAPABILITY = "system.network.https";
const NETWORK_HTTP_CAPABILITY = "system.network.http";
const NETWORK_WEBSOCKET_CAPABILITY = "system.network.websocket";

function getGrantedPluginCapabilities() {
    const metaTag = document.querySelector('meta[name="fdo-plugin-capabilities"]');
    const raw = metaTag?.getAttribute("content") || "[]";
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string" && value.trim()) : [];
    } catch (_) {
        return [];
    }
}

function hasGrantedCapability(capabilities = [], capability = "") {
    const normalizedCapability = String(capability || "").trim();
    return (Array.isArray(capabilities) ? capabilities : []).some((value) => String(value || "").trim() === normalizedCapability);
}

function parseUrlProtocol(input, fallbackBase = window.location.href) {
    try {
        return new URL(String(input || ""), fallbackBase).protocol;
    } catch (_) {
        return "";
    }
}

export const PluginPage = () => {
    const [PluginComponent, SetPluginComponent] = useState(null);
    const [pluginLoadError, setPluginLoadError] = useState("");
    const activeModuleUrlRef = useRef(null);

    useEffect(() => {
        const iframeDocument = document;
        const head = iframeDocument.head;
        const grantedCapabilities = getGrantedPluginCapabilities();
        const runtimePolicy = buildRuntimeSecurityPolicy(grantedCapabilities);
        const hasNetworkBase = hasGrantedCapability(grantedCapabilities, NETWORK_CAPABILITY);
        const allowHttps = hasNetworkBase && runtimePolicy?.networkAccess?.https === true;
        const allowHttp = hasNetworkBase && runtimePolicy?.networkAccess?.http === true;
        const allowWebSocket = hasNetworkBase && runtimePolicy?.networkAccess?.websocket === true;
        const networkScopes = Array.isArray(runtimePolicy?.networkScopes) ? runtimePolicy.networkScopes : [];
        const connectSrc = [
            allowHttps ? "https:" : "",
            allowHttp ? "http:" : "",
            allowWebSocket ? "wss:" : "",
            allowWebSocket ? "ws:" : "",
        ].filter(Boolean);
        if (head) {
            const meta = iframeDocument.createElement("meta");
            meta.httpEquiv = "Content-Security-Policy";
            meta.content = "" +
                "default-src 'self'; " +
                "script-src 'self' 'nonce-plugin-script-inject' blob: static://*; " +
                "style-src 'unsafe-inline' 'self' static://*; " +
                `connect-src ${connectSrc.length > 0 ? connectSrc.join(" ") : "'none'"}; ` +
                "worker-src 'none'; " +
                "child-src 'none'; " +
                "frame-src 'none'; " +
                "img-src 'self' data: blob: static://*; " +
                "font-src 'self' data: static://*; " +
                "object-src 'none'; " +
                "base-uri 'none'; " +
                "form-action 'none';";

            // Remove existing CSP to prevent duplicates
            const existingCSP = head.querySelector("meta[http-equiv='Content-Security-Policy']");
            if (existingCSP) {
                head.removeChild(existingCSP);
            }

            // Append new CSP meta tag
            head.appendChild(meta);
        }

        const denyNetworkAccess = (apiName, requiredCapability = "") => {
            const suffix = requiredCapability
                ? ` Grant "${NETWORK_CAPABILITY}" and "${requiredCapability}" to allow this transport.`
                : ` Grant "${NETWORK_CAPABILITY}" and the matching transport capability to allow this operation.`;
            throw new Error(
                `Network access denied for "${apiName}".${suffix}`
            );
        };

        const getServiceWorkerContainer = () => {
            try {
                return navigator?.serviceWorker || null;
            } catch (_) {
                return null;
            }
        };

        const ensureScopeAllowed = (transport, urlLike, capability = "") => {
            const parsed = (() => {
                try {
                    return new URL(String(urlLike || ""), window.location.href);
                } catch (_) {
                    return null;
                }
            })();
            const hostname = parsed?.hostname || "";
            const port = parsed?.port || "";
            const scheme = (parsed?.protocol || "").replace(/:$/, "");
            const allowed = isNetworkTargetAllowed({
                transport,
                scheme,
                hostname,
                port,
            }, networkScopes);
            if (!allowed) {
                throw new Error(
                    `Network target denied for "${transport}" to "${String(urlLike || "")}". Grant "${NETWORK_CAPABILITY}", "${capability}", and a matching "system.network.scope.<scope-id>" capability.`
                );
            }
        };

        const originalFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
        const originalXmlHttpRequestOpen = window.XMLHttpRequest?.prototype?.open;
        const originalWebSocket = window.WebSocket;
        const originalEventSource = window.EventSource;
        const originalWorker = window.Worker;
        const originalSharedWorker = window.SharedWorker;
        const serviceWorkerContainer = getServiceWorkerContainer();
        const originalSendBeacon = typeof navigator?.sendBeacon === "function"
            ? navigator.sendBeacon.bind(navigator)
            : null;
        const originalServiceWorkerRegister = typeof serviceWorkerContainer?.register === "function"
            ? serviceWorkerContainer.register.bind(serviceWorkerContainer)
            : null;
        const originalServiceWorkerGetRegistration = typeof serviceWorkerContainer?.getRegistration === "function"
            ? serviceWorkerContainer.getRegistration.bind(serviceWorkerContainer)
            : null;
        const originalServiceWorkerGetRegistrations = typeof serviceWorkerContainer?.getRegistrations === "function"
            ? serviceWorkerContainer.getRegistrations.bind(serviceWorkerContainer)
            : null;
        const originalRTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

        if (originalFetch) {
            window.fetch = function guardedFetch(input, init) {
                const protocol = parseUrlProtocol(typeof input === "string" ? input : input?.url);
                if (protocol === "https:" && allowHttps) {
                    ensureScopeAllowed("fetch", typeof input === "string" ? input : input?.url, NETWORK_HTTPS_CAPABILITY);
                    return originalFetch(input, init);
                }
                if (protocol === "http:" && allowHttp) {
                    ensureScopeAllowed("fetch", typeof input === "string" ? input : input?.url, NETWORK_HTTP_CAPABILITY);
                    return originalFetch(input, init);
                }
                if (protocol === "https:") {
                    return denyNetworkAccess("fetch", NETWORK_HTTPS_CAPABILITY);
                }
                if (protocol === "http:") {
                    return denyNetworkAccess("fetch", NETWORK_HTTP_CAPABILITY);
                }
                return denyNetworkAccess("fetch");
            };
        }

        if (typeof originalXmlHttpRequestOpen === "function") {
            window.XMLHttpRequest.prototype.open = function guardedXmlHttpRequestOpen(method, url, ...rest) {
                const protocol = parseUrlProtocol(url);
                if (protocol === "https:" && allowHttps) {
                    ensureScopeAllowed("xhr", url, NETWORK_HTTPS_CAPABILITY);
                    return originalXmlHttpRequestOpen.call(this, method, url, ...rest);
                }
                if (protocol === "http:" && allowHttp) {
                    ensureScopeAllowed("xhr", url, NETWORK_HTTP_CAPABILITY);
                    return originalXmlHttpRequestOpen.call(this, method, url, ...rest);
                }
                if (protocol === "https:") {
                    return denyNetworkAccess("XMLHttpRequest", NETWORK_HTTPS_CAPABILITY);
                }
                if (protocol === "http:") {
                    return denyNetworkAccess("XMLHttpRequest", NETWORK_HTTP_CAPABILITY);
                }
                return denyNetworkAccess("XMLHttpRequest");
            };
        }

        if (typeof originalWebSocket === "function") {
            window.WebSocket = function guardedWebSocket(url, protocols) {
                if (!allowWebSocket) {
                    return denyNetworkAccess("WebSocket", NETWORK_WEBSOCKET_CAPABILITY);
                }
                ensureScopeAllowed("websocket", url, NETWORK_WEBSOCKET_CAPABILITY);
                return new originalWebSocket(url, protocols);
            };
        }

        if (typeof originalEventSource === "function") {
            window.EventSource = function guardedEventSource(url, configuration) {
                const protocol = parseUrlProtocol(url);
                if (protocol === "https:" && allowHttps) {
                    ensureScopeAllowed("eventsource", url, NETWORK_HTTPS_CAPABILITY);
                    return new originalEventSource(url, configuration);
                }
                if (protocol === "http:" && allowHttp) {
                    ensureScopeAllowed("eventsource", url, NETWORK_HTTP_CAPABILITY);
                    return new originalEventSource(url, configuration);
                }
                if (protocol === "https:") {
                    return denyNetworkAccess("EventSource", NETWORK_HTTPS_CAPABILITY);
                }
                if (protocol === "http:") {
                    return denyNetworkAccess("EventSource", NETWORK_HTTP_CAPABILITY);
                }
                return denyNetworkAccess("EventSource");
            };
        }

        if (typeof originalWorker === "function") {
            window.Worker = function guardedWorker() {
                return denyNetworkAccess("Worker");
            };
        }

        if (typeof originalSharedWorker === "function") {
            window.SharedWorker = function guardedSharedWorker() {
                return denyNetworkAccess("SharedWorker");
            };
        }

        if (originalSendBeacon && navigator) {
            navigator.sendBeacon = function guardedSendBeacon(url) {
                const protocol = parseUrlProtocol(url);
                if (protocol === "https:" && allowHttps) {
                    ensureScopeAllowed("fetch", url, NETWORK_HTTPS_CAPABILITY);
                    return originalSendBeacon(url);
                }
                if (protocol === "http:" && allowHttp) {
                    ensureScopeAllowed("fetch", url, NETWORK_HTTP_CAPABILITY);
                    return originalSendBeacon(url);
                }
                if (protocol === "https:") {
                    return denyNetworkAccess("sendBeacon", NETWORK_HTTPS_CAPABILITY);
                }
                if (protocol === "http:") {
                    return denyNetworkAccess("sendBeacon", NETWORK_HTTP_CAPABILITY);
                }
                return denyNetworkAccess("sendBeacon");
            };
        }

        if (originalServiceWorkerRegister && serviceWorkerContainer) {
            serviceWorkerContainer.register = function guardedServiceWorkerRegister() {
                return Promise.reject(new Error('Network access denied for "serviceWorker.register". Service workers are disabled inside plugin iframes.'));
            };
        }

        if (originalServiceWorkerGetRegistration && serviceWorkerContainer) {
            serviceWorkerContainer.getRegistration = function guardedServiceWorkerGetRegistration() {
                return Promise.resolve(undefined);
            };
        }

        if (originalServiceWorkerGetRegistrations && serviceWorkerContainer) {
            serviceWorkerContainer.getRegistrations = function guardedServiceWorkerGetRegistrations() {
                return Promise.resolve([]);
            };
        }

        if (typeof originalRTCPeerConnection === "function") {
            const blockedPeerConnection = function blockedPeerConnection() {
                throw new Error('Network access denied for "RTCPeerConnection". WebRTC transports are disabled inside plugin iframes.');
            };
            window.RTCPeerConnection = blockedPeerConnection;
            window.webkitRTCPeerConnection = blockedPeerConnection;
            window.mozRTCPeerConnection = blockedPeerConnection;
        }

        return () => {
            if (originalFetch) {
                window.fetch = originalFetch;
            }
            if (typeof originalXmlHttpRequestOpen === "function") {
                window.XMLHttpRequest.prototype.open = originalXmlHttpRequestOpen;
            }
            if (originalWebSocket) {
                window.WebSocket = originalWebSocket;
            }
            if (originalEventSource) {
                window.EventSource = originalEventSource;
            }
            if (originalWorker) {
                window.Worker = originalWorker;
            }
            if (originalSharedWorker) {
                window.SharedWorker = originalSharedWorker;
            }
            if (originalSendBeacon && navigator) {
                navigator.sendBeacon = originalSendBeacon;
            }
            if (originalServiceWorkerRegister && serviceWorkerContainer) {
                serviceWorkerContainer.register = originalServiceWorkerRegister;
            }
            if (originalServiceWorkerGetRegistration && serviceWorkerContainer) {
                serviceWorkerContainer.getRegistration = originalServiceWorkerGetRegistration;
            }
            if (originalServiceWorkerGetRegistrations && serviceWorkerContainer) {
                serviceWorkerContainer.getRegistrations = originalServiceWorkerGetRegistrations;
            }
            if (typeof originalRTCPeerConnection === "function") {
                window.RTCPeerConnection = originalRTCPeerConnection;
                window.webkitRTCPeerConnection = originalRTCPeerConnection;
                window.mozRTCPeerConnection = originalRTCPeerConnection;
            }
        };
    }, []);

    useEffect(() => {
        const reportStage = (stage, message = "") => {
            window.parent.postMessage({ type: "PLUGIN_STAGE", stage, message }, "*");
        };
        const collectLayout = () => {
            const docElRect = document?.documentElement?.getBoundingClientRect?.() || null;
            const bodyRect = document?.body?.getBoundingClientRect?.() || null;
            const rootNode = document?.getElementById?.("plugin-root");
            const rootRect = rootNode?.getBoundingClientRect?.() || null;
            const viewport = {
                width: Math.round(window.innerWidth || 0),
                height: Math.round(window.innerHeight || 0),
            };
            return {
                viewport,
                docElRect: {
                    width: Math.round(docElRect?.width || 0),
                    height: Math.round(docElRect?.height || 0),
                },
                bodyRect: {
                    width: Math.round(bodyRect?.width || 0),
                    height: Math.round(bodyRect?.height || 0),
                },
                rootRect: {
                    width: Math.round(rootRect?.width || 0),
                    height: Math.round(rootRect?.height || 0),
                },
            };
        };
        const emitLayoutReady = () => {
            const layout = collectLayout();
            const nonZero = (
                layout.docElRect.width > 0
                && layout.docElRect.height > 0
                && layout.bodyRect.width > 0
                && layout.bodyRect.height > 0
                && layout.rootRect.width > 0
                && layout.rootRect.height > 0
            );
            window.parent.postMessage({
                type: "PLUGIN_LAYOUT_READY",
                layout,
                nonZero,
            }, "*");
            return nonZero;
        };
        let lastInteractionBridgeAt = 0;
        let layoutReadyInterval = null;
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
        const handleKeyDownBridge = (event) => {
            const key = String(event?.key || "").toLowerCase();
            if (!(event.metaKey || event.ctrlKey) || key !== "k") {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            window.parent.postMessage({ type: "PLUGIN_SHORTCUT", shortcut: "command-bar" }, "*");
        };

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
                    clearTimeout(pluginTimeout);
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
        window.addEventListener("keydown", handleKeyDownBridge, true);
        document.addEventListener("click", blockPluginNavigation, true);
        document.addEventListener("submit", blockPluginFormSubmit, true);
        reportStage("iframe-listeners-ready");
        window.parent.postMessage({type: "PLUGIN_HELLO"}, "*");
        if (!emitLayoutReady()) {
            let attempts = 0;
            layoutReadyInterval = window.setInterval(() => {
                attempts += 1;
                if (emitLayoutReady() || attempts >= 20) {
                    if (layoutReadyInterval) {
                        window.clearInterval(layoutReadyInterval);
                        layoutReadyInterval = null;
                    }
                }
            }, 120);
        }

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
            window.removeEventListener("keydown", handleKeyDownBridge, true);
            document.removeEventListener("click", blockPluginNavigation, true);
            document.removeEventListener("submit", blockPluginFormSubmit, true);
            clearTimeout(pluginTimeout);
            if (layoutReadyInterval) {
                window.clearInterval(layoutReadyInterval);
                layoutReadyInterval = null;
            }
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
                    const normalizedMessage = (
                        type === "UI_MESSAGE" &&
                        data &&
                        typeof data === "object"
                    )
                        ? {
                            handler: (typeof data.handler === "string" && data.handler.trim()) ? data.handler.trim() : "requestPrivilegedAction",
                            content: Object.prototype.hasOwnProperty.call(data, "content") ? data.content : data,
                        }
                        : {
                            handler: type,
                            content: data,
                        };
                    const message = { type: "UI_MESSAGE_REQUEST", requestId, message: normalizedMessage };
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
                const waitForHostWindowLoad = (timeoutMs = 1800) => {
                    if (document.readyState === "complete") {
                        return Promise.resolve();
                    }
                    return new Promise((resolve) => {
                        let done = false;
                        const finish = () => {
                            if (done) return;
                            done = true;
                            window.removeEventListener("load", onWindowLoaded);
                            resolve();
                        };
                        const onWindowLoaded = () => {
                            finish();
                        };
                        window.addEventListener("load", onWindowLoaded, { once: true });
                        setTimeout(finish, timeoutMs);
                    });
                };
                const waitForHostStylesheets = (timeoutMs = 1400) => {
                    const styleLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
                    if (styleLinks.length === 0) {
                        return Promise.resolve();
                    }
                    return new Promise((resolve) => {
                        let done = false;
                        const finish = () => {
                            if (done) return;
                            done = true;
                            styleLinks.forEach((linkEl) => {
                                linkEl.removeEventListener("load", onLinkReady);
                                linkEl.removeEventListener("error", onLinkReady);
                            });
                            resolve();
                        };
                        const isLinkReady = (linkEl) => {
                            if (!linkEl?.sheet) return false;
                            try {
                                // Accessing cssRules confirms the sheet is parsed.
                                void linkEl.sheet.cssRules;
                                return true;
                            } catch (_) {
                                // SecurityError still means stylesheet exists and is loaded.
                                return true;
                            }
                        };
                        const allReady = () => styleLinks.every(isLinkReady);
                        const onLinkReady = () => {
                            if (allReady()) {
                                finish();
                            }
                        };
                        if (allReady()) {
                            finish();
                            return;
                        }
                        styleLinks.forEach((linkEl) => {
                            linkEl.addEventListener("load", onLinkReady);
                            linkEl.addEventListener("error", onLinkReady);
                        });
                        setTimeout(finish, timeoutMs);
                    });
                };

                const assetProbeStartedAt = Date.now();
                Promise.allSettled([
                    waitForHostWindowLoad(1800),
                    waitForHostStylesheets(1400),
                ]).finally(() => {
                    window.parent.postMessage({
                        type: "PLUGIN_STAGE",
                        stage: "iframe-host-styles-ready",
                        message: "waitedMs=" + String(Math.max(0, Date.now() - assetProbeStartedAt)),
                    }, "*");

                    const onLoadFn = ${onLoad}
                    if (typeof onLoadFn === "function") {
                        try {
                            onLoadFn();
                        } catch (error) {
                            console.error("Error executing onLoad:", error);
                        }
                    }
                    requestAnimationFrame(() => {
                        if (document?.documentElement) {
                            document.documentElement.style.setProperty("visibility", "visible", "important");
                            document.documentElement.style.setProperty("opacity", "1", "important");
                        }
                        const rootNode = pluginRootRef.current;
                        if (document?.body) {
                            document.body.style.margin = "0";
                            document.body.style.setProperty("visibility", "visible", "important");
                            document.body.style.setProperty("opacity", "1", "important");
                        }
                        if (rootNode) {
                            rootNode.style.setProperty("display", "block", "important");
                            rootNode.style.setProperty("width", "100%", "important");
                            rootNode.style.setProperty("height", "100%", "important");
                            rootNode.style.setProperty("min-width", "1px", "important");
                            rootNode.style.setProperty("min-height", "1px", "important");
                            rootNode.style.setProperty("visibility", "visible", "important");
                            rootNode.style.setProperty("opacity", "1", "important");
                        }
                        const viewportW = Math.round(window.innerWidth || 0);
                        const viewportH = Math.round(window.innerHeight || 0);
                        let rootRect = rootNode?.getBoundingClientRect?.() || null;
                        let docElRect = document?.documentElement?.getBoundingClientRect?.() || null;
                        let bodyRect = document?.body?.getBoundingClientRect?.() || null;
                        const rootStyle = rootNode ? window.getComputedStyle(rootNode) : null;
                        let viewportFallbackApplied = false;
                        const collapsedLayout = (
                            viewportW > 0
                            && viewportH > 0
                            && (
                                Math.round(docElRect?.width || 0) === 0
                                || Math.round(docElRect?.height || 0) === 0
                                || Math.round(bodyRect?.width || 0) === 0
                                || Math.round(bodyRect?.height || 0) === 0
                                || (rootNode && (
                                    Math.round(rootRect?.width || 0) === 0
                                    || Math.round(rootRect?.height || 0) === 0
                                ))
                            )
                        );
                        if (collapsedLayout) {
                            viewportFallbackApplied = true;
                            if (document?.documentElement) {
                                document.documentElement.style.setProperty("display", "block", "important");
                                document.documentElement.style.setProperty("width", viewportW + "px", "important");
                                document.documentElement.style.setProperty("height", viewportH + "px", "important");
                                document.documentElement.style.setProperty("min-width", viewportW + "px", "important");
                                document.documentElement.style.setProperty("min-height", viewportH + "px", "important");
                                document.documentElement.style.setProperty("overflow", "auto", "important");
                            }
                            if (document?.body) {
                                document.body.style.setProperty("display", "block", "important");
                                document.body.style.setProperty("width", viewportW + "px", "important");
                                document.body.style.setProperty("height", viewportH + "px", "important");
                                document.body.style.setProperty("min-width", viewportW + "px", "important");
                                document.body.style.setProperty("min-height", viewportH + "px", "important");
                                document.body.style.setProperty("overflow", "auto", "important");
                            }
                            if (rootNode) {
                                rootNode.style.setProperty("width", viewportW + "px", "important");
                                rootNode.style.setProperty("height", viewportH + "px", "important");
                                rootNode.style.setProperty("min-width", viewportW + "px", "important");
                                rootNode.style.setProperty("min-height", viewportH + "px", "important");
                            }
                            docElRect = document?.documentElement?.getBoundingClientRect?.() || null;
                            bodyRect = document?.body?.getBoundingClientRect?.() || null;
                            rootRect = rootNode?.getBoundingClientRect?.() || null;
                        }
                        const probeEl = document.elementFromPoint(
                            Math.max(0, Math.floor(window.innerWidth / 2)),
                            Math.max(0, Math.floor(window.innerHeight / 2)),
                        );

                        const domSummary = rootNode
                            ? "children=" + rootNode.childElementCount
                                + "; text=" + (rootNode.textContent || "").trim().length
                                + "; visibleText=" + (rootNode.innerText || "").trim().length
                                + "; rootRect=" + Math.round(rootRect?.width || 0) + "x" + Math.round(rootRect?.height || 0)
                                + "; rootDisplay=" + String(rootStyle?.display || "")
                                + "; rootVisibility=" + String(rootStyle?.visibility || "")
                                + "; rootOpacity=" + String(rootStyle?.opacity || "")
                                + "; viewport=" + viewportW + "x" + viewportH
                                + "; docElRect=" + Math.round(docElRect?.width || 0) + "x" + Math.round(docElRect?.height || 0)
                                + "; bodyRect=" + Math.round(bodyRect?.width || 0) + "x" + Math.round(bodyRect?.height || 0)
                                + "; viewportFallback=" + String(viewportFallbackApplied)
                                + "; probeTag=" + String(probeEl?.tagName || "")
                            : "children=0; text=0; visibleText=0";
                        window.parent.postMessage({ type: "PLUGIN_STAGE", stage: "iframe-dom-after-mount", message: domSummary }, "*");

                        // Force a compositor repaint in packaged Electron when iframe content mounts
                        // but the texture is not visually refreshed.
                        if (document?.body) {
                            document.body.style.setProperty("will-change", "transform, opacity", "important");
                            document.body.style.setProperty("transform", "translateZ(0)", "important");
                            document.body.style.setProperty("opacity", "0.999", "important");
                            requestAnimationFrame(() => {
                                if (!document?.body) return;
                                document.body.style.setProperty("transform", "none", "important");
                                document.body.style.setProperty("opacity", "1", "important");
                                requestAnimationFrame(() => {
                                    if (!document?.body) return;
                                    document.body.style.setProperty("will-change", "auto", "important");
                                });
                            });
                        }
                    });
                });
    
                return () => {
                    document.removeEventListener("click", handleDocumentClick);
                };
            }, []);
            
            const normalizeLegacyStyledHtml = (rawHtml) => {
                if (typeof rawHtml !== "string" || rawHtml.indexOf("<style") === -1) {
                    return rawHtml;
                }
                const tick = String.fromCharCode(96);
                const slash = String.fromCharCode(92);
                try {
                    const template = document.createElement("template");
                    template.innerHTML = rawHtml;
                    const nodesWithClassNameAttr = template.content.querySelectorAll("[classname]");
                    nodesWithClassNameAttr.forEach((node) => {
                        const className = String(node?.getAttribute?.("classname") || "").trim();
                        if (className && !node.getAttribute("class")) {
                            node.setAttribute("class", className);
                        }
                        node.removeAttribute("classname");
                    });
                    const styleNodes = template.content.querySelectorAll("style");
                    styleNodes.forEach((styleNode) => {
                        const cssText = String(styleNode?.textContent || "");
                        const trimmedCss = cssText.trim();
                        const openDirect = "{" + tick;
                        const closeDirect = tick + "}";
                        const openEscaped = "{" + slash + tick;
                        const closeEscaped = slash + tick + "}";

                        let normalizedCss = cssText;
                        if (trimmedCss.startsWith(openDirect) && trimmedCss.endsWith(closeDirect)) {
                            normalizedCss = trimmedCss.slice(openDirect.length, trimmedCss.length - closeDirect.length);
                        } else if (trimmedCss.startsWith(openEscaped) && trimmedCss.endsWith(closeEscaped)) {
                            normalizedCss = trimmedCss.slice(openEscaped.length, trimmedCss.length - closeEscaped.length);
                        }

                        if (normalizedCss !== cssText) {
                            styleNode.textContent = normalizedCss;
                        }
                    });
                    return template.innerHTML;
                } catch (_) {
                    return rawHtml;
                }
            };

            const pluginRenderedNodeRaw = (${pluginRenderExpression});
            const pluginRenderedNode = typeof pluginRenderedNodeRaw === "string"
                ? normalizeLegacyStyledHtml(pluginRenderedNodeRaw)
                : pluginRenderedNodeRaw;
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
