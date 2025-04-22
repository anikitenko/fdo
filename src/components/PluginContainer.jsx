import {useEffect, useRef, useState} from "react";
import PropTypes from "prop-types";
import {Spinner} from "@blueprintjs/core";

export const PluginContainer = ({plugin}) => {
    const [height, setHeight] = useState("100vh");
    const [width, setWidth] = useState("100vh");
    const iframeRef = useRef(null);
    const [iframeReady, setIframeReady] = useState(false);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [content, setContent] = useState("");

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
        const handlePluginMessages = (event) => {
            if (event.data?.type === "PLUGIN_HELLO") {
                setIframeReady(true)
            } else if (event.data?.type === "OPEN_EXTERNAL_LINK") {
                window.electron.system.openExternal(event.data.url)
            } else if (event.data?.type === "UI_MESSAGE") {
                window.electron.plugin.uiMessage(plugin, event.data.message).then(() => {})
                const handlePluginUiMessage = (data) => {
                    iframeRef.current.contentWindow?.postMessage({type: "UI_MESSAGE", content: data}, "*");
                };
                window.electron.plugin.off.uiMessage(handlePluginUiMessage);
                window.electron.plugin.on.uiMessage(handlePluginUiMessage);
                window.electron.plugin.off.uiMessage(handlePluginUiMessage);
            }
        };

        window.addEventListener("message", handlePluginMessages);

        return () => {
            window.removeEventListener("message", handlePluginMessages);
        };
    }, []);

    useEffect(() => {
        if (!plugin) return;
        // Call Electron to render the plugin
        window.electron.plugin.render(plugin).then(() => {})

        // Listen for Electron event and forward it to iframe
        const handlePluginRender = (data) => {
            setContent(data)
        };

        // Remove existing listeners to prevent duplication
        window.electron.plugin.off.render(handlePluginRender);

        // Add the event listener
        window.electron.plugin.on.render(handlePluginRender);

        return () => {
            window.electron.plugin.off.render(handlePluginRender);
        };
    }, [plugin]);

    useEffect(() => {
        if (iframeReady && iframeLoaded) {
            const safeCode = sanitizeCode(JSON.parse(content.render));
            const safeOnLoad = sanitizeCode(JSON.parse(content.onLoad));
            loadBabel().then((babel) => {
                if (!babel || typeof babel.transform !== "function") {
                    return;
                }
                const transformedCode = babel.transform("<>"+safeCode+"</>", {
                    presets: ["react"],
                }).code;
                iframeRef.current.contentWindow?.postMessage({type: "PLUGIN_RENDER", content: {code: transformedCode, onLoad: safeOnLoad}}, "*");
            })
        }
    }, [iframeLoaded, iframeReady]);

    return (
        <div id={"plugin-container"} style={{height: "100%", margin: 0, padding: 0, overflow: "hidden"}}>
            {!iframeLoaded && (
                <div style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "white",
                    zIndex: 1
                }}>
                    <Spinner size={100} intent={"primary"} />
                </div>
            )}
            <iframe
                ref={iframeRef}
                title="Plugin Container ID"
                src={"plugin://index.html"}
                sandbox="allow-scripts"
                onLoad={() => setIframeLoaded(true)}
                style={{width: width, height: height, border: "none", overflow: "hidden", boxSizing: "border-box"}}
            />
        </div>
    );
};
PluginContainer.propTypes = {
    plugin: PropTypes.string.isRequired
}

/**
 * Basic code sanitizer to prevent dangerous patterns
 * This is a simple regex-based check, can be improved.
 */
function sanitizeCode(code) {
    // Remove any attempt to access `window`, `document`, or global objects
    const forbiddenPatterns = [
        /globalThis\./g,
        /process\./g,
        /eval\(/g // Blocks eval()
    ];

    forbiddenPatterns.forEach((pattern) => {
        if (pattern.test(code)) {
            throw new Error("Unsafe code detected!");
        }
    });

    return code;
}

async function loadBabel() {
    return new Promise((resolve, reject) => {
        window.electron.system.getBabelPath().then(async (path) => {
            if (path.success) {
                try {
                    const babelFile = `static://assets/node_modules/@babel/standalone/babel.js`;
                    const script = document.createElement("script");
                    script.src = babelFile;
                    script.onload = () => {
                        if (window.Babel) {
                            resolve(window.Babel);
                        } else {
                            reject(new Error("❌ Babel script loaded but window.Babel is undefined"));
                        }
                    };
                    script.onerror = () => reject(new Error("❌ Failed to load Babel script"));
                    document.head.appendChild(script);
                } catch (error) {
                    reject(error);
                }
            } else {
                console.error("Failed to load Babel:", path.error);
                reject(new Error("Failed to load Babel"));
            }
        });
    });
}
