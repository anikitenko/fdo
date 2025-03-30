import {Handle, Position} from "@xyflow/react";
import React from "react";
import PropTypes from "prop-types";
import {Hexagon} from "./shapes/Hexagon.jsx";

export const ConditionNode = ({ isConnectable }) => {
    const w =  70;
    const h = 45;
    return (
        <div style={{ width: w, height: h }}>
            <Hexagon width={w} height={h} fontSize={10} strokeWidth={1} />
            <Handle type="source" id="condition" position={Position.Right} isConnectable={isConnectable}/>
            <Handle type="target" position={Position.Left} isConnectable={isConnectable}/>
        </div>
    );
}
ConditionNode.propTypes = {
    isConnectable: PropTypes.bool,
}