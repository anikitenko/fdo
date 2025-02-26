import {Button} from "@blueprintjs/core";
import {useLocation} from "react-router-dom";

export const PluginPage = () => {
    const location = useLocation();

    // Extract plugin data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));

    return (
        <>
            <p>Plugin Content: {pluginData?.id || "No data received"}</p>
            <Button intent="primary">BlueprintJS Button</Button>
        </>
    );
}
