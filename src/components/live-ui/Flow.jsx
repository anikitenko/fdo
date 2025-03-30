import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
    addEdge,
    Background,
    BackgroundVariant,
    Controls,
    getConnectedEdges,
    getIncomers,
    getOutgoers,
    MiniMap,
    Panel,
    ReactFlow,
    useEdgesState,
    useNodesState,
    useReactFlow,
    useStoreApi
} from "@xyflow/react";
import {Button, ButtonGroup} from "@blueprintjs/core";
import {CustomNode} from "./CustomNode.jsx"

import * as styles from "../css/LiveUI.module.css"
import classNames from "classnames";
import {RightSidePanel} from "./RightSidePanel";
import {ShowCodeModal} from "./ShowCodeModal.jsx";
import NodesSidebar from "./NodesSidebar.jsx";
import {ConcatNode} from "./ConcatNode.jsx";
import { useDnD } from './DnDContext.jsx';
import {ToArrayNode} from "./ToArrayNode.jsx";
import {IfExprNode} from "./IfExprNode.jsx";
import {ConditionNode} from "./ConditionNode.jsx";

export const Flow = (props) => {
    const store = useStoreApi();
    const [type] = useDnD();
    const [nodes, setNodes, onNodesChange] = useNodesState([
        {id: '1', type: 'customNode', position: {x: 0, y: 0}, data: {id: '1', label: "Node"}},
    ]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const copiedNodeRef = useRef(null);
    const [propsShow, setPropsShow] = useState(false)
    const reactFlowWrapper = useRef(null);
    const [rfInstance, setRfInstance] = useState(null);
    const [showCode, setShowCode] = useState(false)
    const mousePosition = useRef({x: window.innerWidth / 2, y: window.innerHeight / 2});

    const getId = () => Math.random().toString(36).substring(2, 9)

    const {getNodes, getEdges, screenToFlowPosition, getInternalNode, setViewport} = useReactFlow();

    const getClosestEdge = useCallback((node) => {
        const { nodeLookup } = store.getState();
        const internalNode = getInternalNode(node.id);

        if (!internalNode || !internalNode.internals?.positionAbsolute) return null;

        const sourcePos = internalNode.internals.positionAbsolute;
        const sourceHandles = internalNode.internals.handleBounds?.source;
        if (!sourceHandles || sourceHandles.length === 0) return null;

        let closestNode = null;
        let closestTargetHandle = null;
        let closestSourceHandle = null;
        let minDistance = 60;

        for (const otherNode of nodeLookup.values()) {
            if (otherNode.id === node.id || !otherNode.internals?.positionAbsolute) continue;

            const targetPos = otherNode.internals.positionAbsolute;
            const targetHandles = otherNode.internals.handleBounds?.target;
            if (!targetHandles || targetHandles.length === 0) continue;

            for (const targetHandle of targetHandles) {
                for (const sourceHandle of sourceHandles) {
                    const dx = (targetPos.x + targetHandle.x) - (sourcePos.x + sourceHandle.x);
                    const dy = (targetPos.y + targetHandle.y) - (sourcePos.y + sourceHandle.y);
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < minDistance) {
                        minDistance = distance;
                        closestNode = otherNode;
                        closestTargetHandle = targetHandle;
                        closestSourceHandle = sourceHandle;
                    }
                }
            }
        }

        if (!closestNode || !closestTargetHandle || !closestSourceHandle) return null;

        const edge = {
            id: `${node.id}-${closestNode.id}`,
            source: node.id,
            target: closestNode.id,
            sourceHandle: closestSourceHandle.id,
            targetHandle: closestTargetHandle.id,
        };

        const valid = isValidConnection(edge);
        return valid ? edge : null;
    }, [getInternalNode]);

    const onConnect = useCallback(
        (params) => setEdges((eds) => addEdge(params, eds)),
        [setEdges],
    );

    const onDragOver = useCallback((event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onConnectEnd = useCallback(
        (event, connectionState) => {
            if (connectionState.fromHandle.id === "condition" || connectionState.fromHandle.type === "target") {
                return
            }
            // when a connection is dropped on the pane it's not valid
            if (!connectionState.isValid) {
                // we need to remove the wrapper bounds, in order to get the correct position
                const id = getId();
                const { clientX, clientY } =
                    'changedTouches' in event ? event.changedTouches[0] : event;
                const newNode = {
                    id,
                    position: screenToFlowPosition({
                        x: clientX,
                        y: clientY,
                    }),
                    data: { label: `Node ${id}` },
                    type: 'customNode',
                };

                setNodes((nds) => nds.concat(newNode));
                setEdges((eds) =>
                    eds.concat({ id, source: connectionState.fromNode.id, sourceHandle: connectionState.fromHandle.id, target: id }),
                );
                setSelectedNodeId(id);
                setPropsShow(true);
            }
        },
        [screenToFlowPosition],
    );

    const onDrop = useCallback(
        (event) => {
            event.preventDefault();

            // check if the dropped element is valid
            if (!type) {
                return;
            }

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });
            const newNode = {
                id: getId(),
                type,
                position,
                data: { label: `${type}` },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [screenToFlowPosition, type],
    );

    const onNodesDelete = useCallback(
        (deleted) => {
            setEdges(
                deleted.reduce((acc, node) => {
                    const incomers = getIncomers(node, nodes, edges);
                    const outgoers = getOutgoers(node, nodes, edges);
                    const connectedEdges = getConnectedEdges([node], edges);

                    const remainingEdges = acc.filter(
                        (edge) => !connectedEdges.includes(edge),
                    );

                    const createdEdges = incomers.flatMap(({id: source}) =>
                        outgoers.map(({id: target}) => ({
                            id: `${source}->${target}`,
                            source,
                            target,
                        })),
                    );

                    return [...remainingEdges, ...createdEdges];
                }, edges),
            );
        },
        [nodes, edges],
    );

    const onNodeDrag = useCallback(
        (_, node) => {
            const closeEdge = getClosestEdge(node);

            setEdges((es) => {
                const nextEdges = es.filter((e) => e.className !== classNames(styles.temp));

                if (
                    closeEdge &&
                    !nextEdges.find(
                        (ne) =>
                            ne.source === closeEdge.source && ne.target === closeEdge.target,
                    )
                ) {
                    closeEdge.className = classNames(styles.temp);
                    nextEdges.push(closeEdge);
                }

                return nextEdges;
            });
        },
        [getClosestEdge, setEdges],
    );

    const onNodeDragStop = useCallback(
        (_, node) => {
            const closeEdge = getClosestEdge(node);

            setEdges((es) => {
                const nextEdges = es.filter((e) => e.className !== classNames(styles.temp));

                if (
                    closeEdge &&
                    !nextEdges.find(
                        (ne) =>
                            ne.source === closeEdge.source && ne.target === closeEdge.target,
                    )
                ) {
                    nextEdges.push(closeEdge);
                }

                return nextEdges;
            });
        },
        [getClosestEdge],
    );

    const onNodeClick = useCallback((event, node) => {
        setSelectedNodeId(node.id);
    }, []);

    const handleKeyDown = useCallback(
        (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selectedNodeId) {
                copiedNodeRef.current = nodes.find((n) => n.id === selectedNodeId);
            }

            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && copiedNodeRef.current) {
                const copied = copiedNodeRef.current;
                const newId = getId();

                // Convert to flow space
                const flowPosition = screenToFlowPosition({
                    x: mousePosition.current.x - 100,
                    y: mousePosition.current.y - 50
                });
                const newNode = {
                    id: newId,
                    position: flowPosition,
                    type: copied.type,
                    data: {...copied.data, id: newId, label: `${copied.data.label} (copy)`},
                };
                setNodes((nds) => nds.concat(newNode));
                setSelectedNodeId(newId);
                setPropsShow(true);
            }
        },
        [selectedNodeId, nodes]
    );

    const isValidConnection = useCallback(
        (connection) => {
            const typeConditions = ["ifCondition", "ifExpr"]
            const nodes = getNodes();
            const edges = getEdges();

            if (connection.sourceHandle === "condition" || connection.targetHandle === "condition") {
                return connection.sourceHandle === "condition" && connection.targetHandle === "condition"
            }

            if (!connection.sourceHandle && !connection.targetHandle) {
                const sourceType = getInternalNode(connection.source).type
                const targetType = getInternalNode(connection.target).type
                if (!typeConditions.includes(sourceType) && typeConditions.includes(targetType)) {
                    return null
                }
            }

            if (connection.source === connection.target) return false;

            const visited = new Set();

            const hasCycle = (nodeId) => {
                if (visited.has(nodeId)) return false;
                visited.add(nodeId);

                const outgoers = getOutgoers(
                    {id: nodeId},
                    nodes,
                    edges
                );

                for (const outgoer of outgoers) {
                    if (outgoer.id === connection.source) return true;
                    if (hasCycle(outgoer.id)) return true;
                }

                return false;
            };

            return !hasCycle(connection.target);
        },
        [getNodes, getEdges]
    );

    const onSave = useCallback(() => {
        if (rfInstance) {
            const flow = rfInstance.toObject();
            localStorage.setItem("ui-flow", JSON.stringify(flow));
        }
    }, [rfInstance]);

    const onRestore = useCallback(() => {
        const restoreFlow = async () => {
            const flow = JSON.parse(localStorage.getItem("ui-flow"));

            if (flow) {
                const { x = 0, y = 0, zoom = 1 } = flow.viewport;
                setNodes(flow.nodes || []);
                setEdges(flow.edges || []);
                await setViewport({x, y, zoom});
            }
        };

        restoreFlow().then(() => {});
    }, [setNodes, setViewport]);

    const nodeTypes = useMemo(
        () => ({
            customNode: (props) => <CustomNode setPropsShow={setPropsShow} {...props} />,
            concat: (props) => <ConcatNode {...props} />,
            toArray: (props) => <ToArrayNode {...props} />,
            ifExpr: (props) => <IfExprNode {...props} />,
            ifCondition: (props) => <ConditionNode {...props} />,
        }), [props])

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    useEffect(() => {
        const handleMouseMove = (e) => {
            mousePosition.current = {x: e.clientX, y: e.clientY};
        };
        window.addEventListener("mousemove", handleMouseMove);
        return () => window.removeEventListener("mousemove", handleMouseMove);
    }, []);

    return (
        <div className={classNames(styles.wrapper)} ref={reactFlowWrapper}>
            <ReactFlow
                {...props}
                onInit={setRfInstance}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 2 }}
                isValidConnection={isValidConnection}
                onConnect={onConnect}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onConnectEnd={onConnectEnd}
                onNodesDelete={onNodesDelete}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={(event, node) => {
                    if (node.type === "customNode") {
                        setSelectedNodeId(node.id)
                        setPropsShow(true)
                    }
                }}
                nodes={nodes}
                edges={edges}
            >
                <Background color="#ff0000" variant={BackgroundVariant.Dots} bgColor={"#f8f8f8"}/>
                <MiniMap nodeStrokeWidth={3}/>
                <Controls/>
                <Panel position="top-left">
                    <NodesSidebar />
                </Panel>
                <Panel position="top-right">
                    <ButtonGroup vertical={false}>
                        <Button icon={"redo"} text={"Restore"} intent={"none"} onClick={onRestore}/>
                        <Button icon={"saved"} text={"Save"} intent={"primary"} onClick={onSave}/>
                        <Button icon={"document-code"} text={"Show code"} intent={"success"} onClick={() => setShowCode(true)}/>
                    </ButtonGroup>
                    <RightSidePanel setNodes={setNodes} propsShow={propsShow} setPropsShow={setPropsShow} selectedNodeId={selectedNodeId}/>
                </Panel>
                <ShowCodeModal setShowCode={setShowCode} showCode={showCode} />
            </ReactFlow>
        </div>
    );
}
