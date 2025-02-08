import {useEffect, useState} from "react";

export const PluginContainer = ({id}) => {
    const [plugin, setPlugin] = useState(null);
    const [height, setHeight] = useState("100vh");

    useEffect(() => {
        const updateHeight = () => {
            // Adjust height based on your layout, e.g., subtracting header/footer height
            const newHeight = window.innerHeight - 50; // Example for subtracting 50px (e.g., for a header)
            setHeight(`${newHeight}px`);
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
        window.electron.loadPlugin(id);
        window.electron.onPluginLoaded((loadedPlugin) => {
            setPlugin(loadedPlugin);
        });
    }, [id]);

    // Convert plugin object to a JSON string and encode it for the URL
    const encodedPluginData = encodeURIComponent(JSON.stringify(plugin));

    return (
        <div style={{height: "100%", margin: 0, padding: 0, overflow: "hidden"}}>
            <iframe
                src={`/plugin/?data=${encodedPluginData}`}
                sandbox="allow-scripts"
                style={{width: "100%", height: height, border: "none", overflow: "hidden", boxSizing: "border-box"}}
            />
        </div>
    );
};
