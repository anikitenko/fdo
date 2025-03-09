import {useEffect, useRef, useState} from "react";
import PropTypes from "prop-types";

export const PluginContainer = ({plugin}) => {
    const [height, setHeight] = useState("100vh");
    const [width, setWidth] = useState("100vh");
    const iframeRef = useRef(null);
    const [iframeReady, setIframeReady] = useState(false);
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
        if (iframeReady && iframeRef.current?.contentWindow) {
            iframeRef.current?.contentWindow?.postMessage({type: "PLUGIN_RENDER", content}, "*");
        }
    }, [iframeReady]);

    return (
        <div id={"plugin-container"} style={{height: "100%", margin: 0, padding: 0, overflow: "hidden"}}>
            <iframe
                ref={iframeRef}
                title="Plugin Container ID"
                src={`#/plugin`}
                sandbox="allow-scripts"
                style={{width: width, height: height, border: "none", overflow: "hidden", boxSizing: "border-box"}}
            />
        </div>
    );
};
PluginContainer.propTypes = {
    plugin: PropTypes.string.isRequired
}
