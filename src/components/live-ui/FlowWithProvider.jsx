import {ReactFlowProvider} from "@xyflow/react";
import React from "react";
import {Flow} from "./Flow.jsx";
import {DnDProvider} from "./DnDContext.jsx";

export const FlowWithProvider = (props) => {
    return (
        <ReactFlowProvider>
            <DnDProvider>
                <Flow {...props} />
            </DnDProvider>
        </ReactFlowProvider>
    );
}