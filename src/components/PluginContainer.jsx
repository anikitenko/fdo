import {useEffect, useState} from "react";
import PropTypes from "prop-types";

export const PluginContainer = ({plugin}) => {
    const [height, setHeight] = useState("100vh");
    const [width, setWidth] = useState("100vh");

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

    // Convert plugin object to a JSON string and encode it for the URL
    const encodedPluginData = encodeURIComponent(JSON.stringify({}));

    useEffect(() => {
        if (!plugin) return;
        /*window.sdk.GetReady(plugin).then((ready) => {
            console.log("Plugin ready:", ready);
        })*/
    }, [plugin]);
    return (
        <div id={"plugin-container"} style={{height: "100%", margin: 0, padding: 0, overflow: "hidden"}}>
            <iframe
                title="Plugin Container ID"
                src={`#/plugin?data=${encodedPluginData}`}
                sandbox="allow-scripts"
                style={{width: width, height: height, border: "none", overflow: "hidden", boxSizing: "border-box"}}
            />
        </div>
    );
};
PluginContainer.propTypes = {
    plugin: PropTypes.string.isRequired
}
