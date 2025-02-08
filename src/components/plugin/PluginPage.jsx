import {Button} from "@blueprintjs/core";
import {useLocation} from "react-router-dom";
import {useEffect} from "react";

export const PluginPage = () => {
    const location = useLocation();

    // Extract plugin data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));

    useEffect(() => {
        const iframeDocument = document;

        // Create a style element to inject
        const style = document.createElement("style");
        style.innerHTML = `
            body {
                all: unset !important;
                background: white !important;
                color: black !important;
                margin: 0 !important;
                padding: 0 !important;
                font-family: Arial, sans-serif !important;
            }

            /* Add more scoped styles here */
        `;
        iframeDocument.head.appendChild(style);

        return () => {
            iframeDocument.head.removeChild(style); // Clean up on unmount
        };
    }, []);
    return (
        <>
            <p>Plugin Content: {pluginData?.id || "No data received"}</p>
            <Button intent="primary">BlueprintJS Button</Button>
        </>
    );
}
