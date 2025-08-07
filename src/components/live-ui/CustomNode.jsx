import {Handle, NodeToolbar, Position} from "@xyflow/react";
import {Button, Card, Icon} from "@blueprintjs/core";
import React from "react";
import PropTypes from "prop-types";

export const CustomNode = ({ data, selected, isConnectable, setPropsShow }) => {
    return (
        <>
            <NodeToolbar>
                <Button icon={"cog"} size={"small"} intent={"primary"} text={"Show Properties"}
                        onClick={() => {
                            setPropsShow(true)
                        }}/>
            </NodeToolbar>

            <Card selected={selected} interactive={true} style={{cursor: "inherit", padding: "5px", position: "relative", background: data.color ? data.color : "white" }}>
                <div style={{marginBottom: "5px"}}>
                    <Icon icon={"many-to-one"} size={8}/>
                    <span className={"bp6-heading"} style={{fontSize: "0.8rem", padding: "0 5px", verticalAlign: "sub"}}>{data.label}</span>
                    <Icon icon={"flow-branch"} size={8}/>
                </div>
            </Card>

            <Handle type="target" position={Position.Left} isConnectable={isConnectable}/>
            <Handle type="source" position={Position.Right} isConnectable={isConnectable}/>
        </>
    );
}
CustomNode.propTypes = {
    data: PropTypes.object,
    selected: PropTypes.bool,
    isConnectable: PropTypes.bool,
    setPropsShow: PropTypes.func
}
