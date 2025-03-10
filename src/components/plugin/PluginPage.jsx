import React, {useEffect, useState} from "react";

export const PluginPage = () => {
    const [PluginComponent, setPluginComponent] = useState(null);

    useEffect(() => {
        const iframeDocument = document;
        const head = iframeDocument.head;
        if (head) {
            const meta = iframeDocument.createElement("meta");
            meta.httpEquiv = "Content-Security-Policy";
            meta.content = "" +
                "default-src 'self'; " +
                "script-src 'self' blob:; " +
                "style-src 'self'; " +
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
        window.parent.postMessage({ type: "PLUGIN_HELLO" }, "*");

        const handleMessage = (event) => {
            if (event.data?.type === "PLUGIN_RENDER") {
                try {
                    const moduleURL = createESModule(event.data.content);

                    import(/* webpackIgnore: true */ moduleURL).then((pluginModule) => {
                        if (pluginModule.default) {
                            clearTimeout(pluginTimeout);
                            // Assign the globally defined PluginComponent
                            setPluginComponent(() => () => pluginModule.default(React));
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
            setPluginComponent(() => () => <p>Plugin timed out!</p>);
        }, 5000);

        return () => {
            window.removeEventListener("message", handleMessage);
            clearTimeout(pluginTimeout);
        };
    }, []);

    return PluginComponent ? <PluginComponent /> : <p>Loading plugin...</p>;
}

/**
 * Securely creates an ES Module from string JavaScript code
 */
function createESModule(pluginCode) {
    const wrappedCode = `
        export default function PluginComponent(React) {
            return ${pluginCode}
        }
    `;

    const blob = new Blob([wrappedCode], { type: "application/javascript" });
    return URL.createObjectURL(blob);
}
