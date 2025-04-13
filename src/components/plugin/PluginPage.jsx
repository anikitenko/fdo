import React, {useEffect, useState} from "react";

export const PluginPage = () => {
    const [PluginComponent, SetPluginComponent] = useState(null);

    useEffect(() => {
        const iframeDocument = document;
        const head = iframeDocument.head;
        if (head) {
            // --- Remove all existing <style> tags ---
            head.querySelectorAll("style").forEach((styleTag) => {
                head.removeChild(styleTag);
            });

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

            // --- Inject PureCSS Styles ---
            const existingLink = head.querySelector("#purecss-link");
            if (existingLink) {
                head.removeChild(existingLink);
            }
            const linkTag = iframeDocument.createElement("link");
            linkTag.id = "purecss-link";
            linkTag.rel = "stylesheet";
            linkTag.href = "static://assets/css/pure-min.css";
            head.appendChild(linkTag);

            // --- Inject HighlightJS Styles ---
            const existingHjStyle = head.querySelector("#hjStyle");
            if (existingHjStyle) {
                head.removeChild(existingHjStyle);
            }
            const hjStyle = iframeDocument.createElement("link");
            hjStyle.id = "hjStyle";
            hjStyle.rel = "stylesheet";
            hjStyle.href = "static://assets/css/hljs/vs.min.css";
            head.appendChild(hjStyle);

            // --- Inject Notyf Styles ---
            const existingNotyfJSCss = head.querySelector("#notyfStyle");
            if (existingNotyfJSCss) {
                head.removeChild(existingNotyfJSCss);
            }
            const notyfJsStyle = iframeDocument.createElement("link");
            notyfJsStyle.id = "notyfStyle";
            notyfJsStyle.rel = "stylesheet";
            notyfJsStyle.href = "static://assets/css/notyf/notyf.min.css";
            head.appendChild(notyfJsStyle);

            // --- Inject FontAwesome JS ---
            const existingFontJS = head.querySelector("#font-awesome-script");
            const existingFontJsBrands = head.querySelector("#font-awesome-script-brands");
            const existingFontJsSolid = head.querySelector("#font-awesome-script-solid");
            const existingFontJsRegular = head.querySelector("#font-awesome-script-regular");
            if (existingFontJS) {
                head.removeChild(existingFontJS);
            }
            if (existingFontJsBrands) {
                head.removeChild(existingFontJsBrands);
            }
            if (existingFontJsSolid) {
                head.removeChild(existingFontJsSolid);
            }
            if (existingFontJsRegular) {
                head.removeChild(existingFontJsRegular);
            }
            const scriptTagFA = iframeDocument.createElement("script");
            scriptTagFA.id = "font-awesome-script";
            scriptTagFA.src = "static://assets/js/fa/fontawesome.min.js";
            head.appendChild(scriptTagFA);
            const scriptTagFaBrands = iframeDocument.createElement("script");
            scriptTagFaBrands.id = "font-awesome-script-brands";
            scriptTagFaBrands.src = "static://assets/js/fa/brands.min.js";
            head.appendChild(scriptTagFaBrands);
            const scriptTagFaSolid = iframeDocument.createElement("script");
            scriptTagFaSolid.id = "font-awesome-script-solid";
            scriptTagFaSolid.src = "static://assets/js/fa/solid.min.js";
            head.appendChild(scriptTagFaSolid);
            const scriptTagFaRegular = iframeDocument.createElement("script");
            scriptTagFaRegular.id = "font-awesome-script-regular";
            scriptTagFaRegular.src = "static://assets/js/fa/regular.min.js";
            head.appendChild(scriptTagFaRegular);

            // --- Inject Split JS ---
            const existingSplitJS = head.querySelector("#splitjs-script");
            if (existingSplitJS) {
                head.removeChild(existingSplitJS);
            }
            const scriptTagSplitJS = iframeDocument.createElement("script");
            scriptTagSplitJS.id = "splitjs-script";
            scriptTagSplitJS.src = "static://assets/js/split-grid.js";
            head.appendChild(scriptTagSplitJS);

            // --- Inject HighlightJS ---
            const existingHighlightJS = head.querySelector("#highlightJS-script");
            if (existingHighlightJS) {
                head.removeChild(existingHighlightJS);
            }
            const scriptHighlightJS = iframeDocument.createElement("script");
            scriptHighlightJS.id = "highlightJS-script";
            scriptHighlightJS.src = "static://assets/js/hljs/highlight.min.js";
            head.appendChild(scriptHighlightJS);

            // --- Inject Notyf JS ---
            const existingNotyfJS = head.querySelector("#notyf-script");
            if (existingNotyfJS) {
                head.removeChild(existingNotyfJS);
            }
            const scriptNotyfJS = iframeDocument.createElement("script");
            scriptNotyfJS.id = "notyf-script";
            scriptNotyfJS.src = "static://assets/js/notyf/notyf.min.js";
            head.appendChild(scriptNotyfJS);

            // --- Inject Goober JS ---
            const existingGooberJS = head.querySelector("#goober-script");
            if (existingGooberJS) {
                head.removeChild(existingGooberJS);
            }
            const scriptGooberJS = iframeDocument.createElement("script");
            scriptGooberJS.id = "goober-script";
            scriptGooberJS.src = "static://assets/node_modules/goober/dist/goober.umd.js";
            head.appendChild(scriptGooberJS);

            // --- Inject Ace JS ---
            const existingAceJS = head.querySelector("#ace-script");
            if (existingAceJS) {
                head.removeChild(existingAceJS);
            }
            const scriptAceJS = iframeDocument.createElement("script");
            scriptAceJS.id = "ace-script";
            scriptAceJS.src = "static://assets/js/ace/ace.js";
            head.appendChild(scriptAceJS);
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
                    console.error("Error rendering plugin:", error);
                }
            }
        };

        window.addEventListener("message", handleMessage);

        // Set timeout to auto-fail plugin after 5 seconds
        const pluginTimeout = setTimeout(() => {
            SetPluginComponent(() => () => <p>Plugin timed out!</p>);
        }, 5000);

        return () => {
            window.removeEventListener("message", handleMessage);
            clearTimeout(pluginTimeout);
        };
    }, []);

    return PluginComponent ? <PluginComponent React={React}/> :
        <p>Loading plugin...</p>;
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
