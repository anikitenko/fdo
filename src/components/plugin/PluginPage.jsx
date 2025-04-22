import React, {useEffect, useState} from "react";

export const PluginPage = () => {
    const [PluginComponent, SetPluginComponent] = useState(null);

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
        window.parent.postMessage({type: "PLUGIN_HELLO"}, "*");

        const handleMessage = (event) => {
            if (event.data?.type === "PLUGIN_RENDER") {
                try {
                    const moduleURL = createESModule(event.data.content.code, event.data.content.onLoad);

                    import(/* webpackIgnore: true */ moduleURL).then((pluginModule) => {
                        if (pluginModule.default) {
                            clearTimeout(pluginTimeout);
                            // Assign the globally defined PluginComponent
                            SetPluginComponent(() => {
                                const DynamicComponent = pluginModule.default;
                                return (props) => <DynamicComponent {...props} />;
                            })
                        }
                    })
                } catch (error) {
                    window.electron.notifications.add("Error rendering plugin", error, "danger")
                }
            }
        };

        window.addEventListener("message", handleMessage);

        // Set timeout to auto-fail plugin after 5 seconds
        const pluginTimeout = setTimeout(() => {
            SetPluginComponent(() => () => (
                <div className="plugin-timeout-container">
                    <div className="plugin-timeout-box">
                        <div className="plugin-timeout-icon">🔌</div>
                        <div className="plugin-timeout-title">Plugin timed out!</div>
                        <div className="plugin-timeout-message">
                            The plugin failed to load. You might find more details in the notification panel.
                        </div>
                    </div>
                </div>
            ));
        }, 5000);

        return () => {
            window.removeEventListener("message", handleMessage);
            clearTimeout(pluginTimeout);
        };
    }, []);

    return PluginComponent ? <PluginComponent React={React}/> :
        <div style={{textAlign: "center", padding: "20px"}}><span className="plugin-page-loader"></span></div>;
}

/**
 * Securely creates an ES Module from string JavaScript code
 */
function createESModule(pluginCode, onLoad) {
    const wrappedCode = `
        export default function PluginComponent({React}) {
            window.createBackendReq = function(type, data) {
                return new Promise((resolve) => {
                    const message = { type: "UI_MESSAGE", message: {handler: type, content: data} };
                    window.parent.postMessage(message, "*");
    
                    const listener = (event) => {
                        if (event.data?.type === "UI_MESSAGE") {
                            window.removeEventListener("message", listener);
                            resolve(event.data.content);
                        }
                    };
                    window.removeEventListener("message", listener);
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
            
            React.useEffect(() => {
                document.addEventListener("click", (event) => {
                    const target = event.target.closest("a");
                    if (target && target.hasAttribute("data-no-external")) {
                        event.preventDefault();
                        return;
                    }
                    if (target && target.href.startsWith("http")) {
                        event.preventDefault();
                        window.parent.postMessage(
                            { type: "OPEN_EXTERNAL_LINK", url: target.href },
                            "*"
                        );
                    }
                });
                
                const onLoadFn = ${onLoad}
                if (typeof onLoadFn === "function") {
                    try {
                        onLoadFn();
                    } catch (error) {
                        console.error("Error executing onLoad:", error);
                    }
                }
    
                return () => {
                    document.removeEventListener("click", () => {});
                };
                
            }, []);
            
            return ${pluginCode}
        }
    `;

    const blob = new Blob([wrappedCode], {type: "application/javascript"});
    return URL.createObjectURL(blob);
}
