import {useEffect, useState} from "react";

export const PluginPage = () => {
    const [pluginContent, setPluginContent] = useState("");

    useEffect(() => {
        window.parent.postMessage({ type: "PLUGIN_HELLO" }, "*");

        const handleMessage = (event) => {
            if (event.data?.type === "PLUGIN_RENDER") {
                setPluginContent(event.data.content);
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    return (pluginContent);
}
