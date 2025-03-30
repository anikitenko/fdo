import {Dialog, DialogBody} from "@blueprintjs/core";
import React, {useEffect} from "react";
import {useReactFlow} from "@xyflow/react";

export const ShowCodeModal = ({showCode, setShowCode}) => {
    const {toObject} = useReactFlow()
    const data = toObject()
    const [trees, setTrees] = React.useState([]);
    useEffect(() => {
        if (!showCode) return
        const nodeMap = Object.fromEntries(data.nodes.map(n => [n.id, n]));
        const edgeMap = groupEdgesBySource(data.edges);
        const roots = findRootNodes(data.nodes, data.edges);

        const trees = roots.map(root => buildDependencyTree(root.id, edgeMap, nodeMap));
        setTrees(trees);
    }, [showCode]);
    return (
        <Dialog isOpen={showCode} title="Generated code" icon="document-code" style={{width: "800px"}} onClose={() => setShowCode(false)}>
            <DialogBody>
                <pre>
                    <code>{JSON.stringify(trees)}</code>
                </pre>
            </DialogBody>
        </Dialog>
    )
}

const buildDependencyTree = (sourceId, edgeMap, nodeMap) => {
    const node = nodeMap[sourceId];
    if (!node) return null;

    const children = (edgeMap[sourceId] || []).map(edge => ({
        edgeType: edge.type,
        node: buildDependencyTree(edge.target, edgeMap, nodeMap)
    }));

    return {
        id: node.id,
        data: node.data,
        children
    };
}

const findRootNodes = (nodes, edges) => {
    const allTargets = new Set(edges.map(e => e.target));
    return nodes.filter(n => !allTargets.has(n.id));
}

const groupEdgesBySource = (edges) => {
    const map = {};
    edges.forEach(edge => {
        if (!map[edge.source]) map[edge.source] = [];
        map[edge.source].push({
            target: edge.target,
            type: edge.type
        });
    });
    return map;
}