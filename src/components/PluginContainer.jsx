import {useEffect, useRef, useState} from "react";
import PropTypes from "prop-types";

export const PluginContainer = ({plugin}) => {
    const [height, setHeight] = useState("100vh");
    const [width, setWidth] = useState("100vh");
    const iframeRef = useRef(null);
    const [iframeReady, setIframeReady] = useState(false);
    const [iframeLoaded, setIframeLoaded] = useState(false);
    const [content, setContent] = useState("")

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
        const handleHandshake = (event) => {
            if (event.data?.type === "PLUGIN_HELLO") {
                setIframeReady(true)
            }
        };

        window.addEventListener("message", handleHandshake);

        return () => {
            window.removeEventListener("message", handleHandshake);
        };
    }, []);

    useEffect(() => {
        if (!plugin) return;

        // Call Electron to render the plugin
        window.electron.pluginRender(plugin).then(() => {})

        // Listen for Electron event and forward it to iframe
        const handlePluginRender = (data) => {
            setContent(data)
        };

        window.electron.onPluginRender(handlePluginRender);

        return () => {
            window.electron.offPluginRender(handlePluginRender);
        };
    }, [plugin]);

    useEffect(() => {
        if (iframeReady && iframeLoaded) {
            const safeCode = sanitizeCode(content);
            loadBabel().then((babel) => {
                if (!babel || typeof babel.transform !== "function") {
                    console.error("❌ Babel module does not contain a transform() function:", babel);
                    return;
                }
                const transformedCode = babel.transform(safeCode, {
                    presets: ["react"]
                }).code;
                iframeRef.current.contentWindow?.postMessage({type: "PLUGIN_RENDER", content: transformedCode}, "*");
            })
        }
    }, [iframeLoaded, iframeReady]);

    return (
        <div id={"plugin-container"} style={{height: "100%", margin: 0, padding: 0, overflow: "hidden"}}>
            <iframe
                ref={iframeRef}
                title="Plugin Container ID"
                src={`#/plugin`}
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
        /window\./g,
        /document\./g,
        /globalThis\./g,
        /process\./g,
        /require\(/g, // Blocks Node.js imports (for safety)
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
        window.electron.GetBabelPath().then(async (path) => {
            if (path.success) {
                try {
                    const babelFile = `static://assets/node_modules/@babel/standalone/babel.js`;
                    const script = document.createElement("script");
                    script.src = babelFile;
                    script.onload = () => {
                        if (window.Babel) {
                            console.log("✅ Babel loaded successfully from window.Babel");
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
