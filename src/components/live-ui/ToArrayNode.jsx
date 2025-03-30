import {Handle, Position} from "@xyflow/react";
import React from "react";
import PropTypes from "prop-types";
import {Cylinder} from "./shapes/Cylinder.jsx";

export const ToArrayNode = ({ isConnectable }) => {
    const w =  70;
    const h = 45;
    return (
        <div style={{width: w, height: h}}>
            <Cylinder strokeWidth={1} fontSize={10} width={w} height={h} />
            <Handle type="target" position={Position.Left} isConnectable={isConnectable} style={{ left: 10 }}/>
            <Handle type="source" position={Position.Right} isConnectable={isConnectable} style={{ right: 10 }}/>
        </div>
    );
}

ToArrayNode.propTypes = {
    isConnectable: PropTypes.bool,
}