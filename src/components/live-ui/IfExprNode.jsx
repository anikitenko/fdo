import {Handle, Position} from "@xyflow/react";
import React from "react";
import PropTypes from "prop-types";
import {Diamond} from "./shapes/Diamond.jsx";

export const IfExprNode = ({ isConnectable }) => {
    const w =  40;
    const h = 40;
    return (
        <div style={{ width: w, height: h }}>
            <Diamond width={w} height={h} strokeWidth={1} fontSize={10} />
            <Handle type="target" id="condition" position={Position.Left} isConnectable={isConnectable}/>
            <Handle type="source" id="true" position={Position.Top} isConnectable={isConnectable}/>
            <Handle type="source" id="false" position={Position.Bottom} isConnectable={isConnectable}/>
        </div>
    );
}
IfExprNode.propTypes = {
    isConnectable: PropTypes.bool,
}
