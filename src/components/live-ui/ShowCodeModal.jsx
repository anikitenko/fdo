import {Dialog, DialogBody, Spinner} from "@blueprintjs/core";
import React, {useEffect} from "react";
import {useReactFlow} from "@xyflow/react";

import * as prettier from "prettier/standalone"
import parserBabel from "prettier/plugins/babel";
import * as prettierPluginEstree from "prettier/plugins/estree";
import {generateCodeFromNode} from "./utils/generateCodeFromNode";

import hljs from "../../assets/js/hljs/highlight.min"
import "../../assets/css/hljs/vs.min.css"

export const ShowCodeModal = ({showCode, setShowCode}) => {
    const {toObject} = useReactFlow()
    const data = toObject()
    const [code, setCode] = React.useState(null);
    const [prettyCode, setPrettyCode] = React.useState(null);
    const [prettyCodeProgress, setPrettyCodeProgress] = React.useState(true);
    useEffect(() => {
        if (!showCode) return
        setPrettyCodeProgress(true)
        const nodeMap = Object.fromEntries(data.nodes.map(n => [n.id, n]));
        const edgeMap = groupEdgesBySource(data.edges);
        const roots = findRootNodes(data.nodes, data.edges);

        const trees = roots.map(root => buildDependencyTree(root.id, edgeMap, nodeMap));
        const codes = []
        for (const tree of trees) {
            if (!tree) continue
            if (tree.type !== "customNode") continue
            console.log(tree)
            codes.push(generateCodeFromNode(tree))
        }
        setCode(codes.join("\n"));
        setPrettyCodeProgress(false)
    }, [showCode]);

    useEffect(() => {
        async function formatCode() {
            setPrettyCodeProgress(true)
            if (!code) return
            const formatted = await prettier.format(code, { parser: "babel", plugins: [parserBabel, prettierPluginEstree] })

            setPrettyCode(formatted);
        }

        formatCode().then(() => {setPrettyCodeProgress(false)});
    }, [code]);

    useEffect(() => {
        if (!prettyCode || !showCode) return

        document.querySelectorAll('pre code').forEach((block) => {
            if (!block.hasAttribute('data-highlighted')) {
                hljs.highlightElement(block);
            }
        });
    }, [prettyCode, showCode])
    return (
        <Dialog isOpen={showCode} title="Generated code" icon="document-code" style={{width: "800px"}} onClose={() => setShowCode(false)}>
            <DialogBody style={{padding: 0}}>
                {prettyCodeProgress === false ?  <pre style={{margin: "0"}}><code className="language-javascript">{prettyCode}</code></pre> : <Spinner />}
            </DialogBody>
        </Dialog>
    )
}

const buildDependencyTree = (sourceId, edgeMap, nodeMap) => {
    const node = nodeMap[sourceId];
    if (!node) return null;

    const children = (edgeMap[sourceId] || []).map(edge => ({
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        node: buildDependencyTree(edge.target, edgeMap, nodeMap)
    }));

    return {
        id: node.id,
        data: node.data,
        type: node.type,
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