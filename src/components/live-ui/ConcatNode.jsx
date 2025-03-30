import {Handle, Position} from "@xyflow/react";
import React from "react";
import PropTypes from "prop-types";
import {RoundedRectangle} from "./shapes/RoundedRectangle.jsx";

export const ConcatNode = ({ isConnectable }) => {
    const w =  60;
    const h = 25;
    return (
        <div style={{ width: w, height: h }}>
            <RoundedRectangle width={w} height={h} fontSize={10} radius={5} strokeWidth={1} />
            <Handle type="target" position={Position.Left} isConnectable={isConnectable}/>
            <Handle type="source" position={Position.Right} isConnectable={isConnectable}/>
        </div>
    );
}
ConcatNode.propTypes = {
    isConnectable: PropTypes.bool,
}
