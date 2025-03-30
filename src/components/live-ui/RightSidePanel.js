import {Button, Collapse, Drawer, DrawerSize, FormGroup, HTMLSelect, InputGroup} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";
import {withTheme} from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import {useStore} from '@xyflow/react';

import PropTypes from "prop-types";

import domMetadata from "@anikitenko/fdo-sdk/dist/dom-metadata.json"
import {DOMMetadataParser} from "./utils/DOMMetadataParser";
import {mapParamsToSchema} from "./utils/mapParamsToSchema";
import {Bp5Theme} from "@anikitenko/bp5-rjsf-theme";
import {AppToaster} from "../AppToaster.jsx";

const ColorMap = {
    "DOM": "#f0f0f0",
    "DOMButton": "#d0ebff",
    "DOMInput": "#fff3bf",
    "DOMLink": "#e5dbff",
    "DOMMisc": "#ffdce5",
    "DOMNested": "#c5f6fa",
    "DOMText": "#fff9db",
}

export const RightSidePanel = ({setNodes, propsShow, setPropsShow, selectedNodeId}) => {
    const node = useStore((state) =>
        selectedNodeId ? state.nodes.find((n) => n.id === selectedNodeId) : null
    );
    const Form = withTheme(Bp5Theme);
    const parser = DOMMetadataParser(domMetadata);
    const [saveLoading, setSaveLoading] = useState(false)
    const [nodeValue, setNodeValue] = useState("")
    const [nodeClass, setNodeClass] = useState("")
    const [constructorIndex, setConstructorIndex] = useState(0);
    const [constructorParams, setConstructorParams] = useState([]);
    const [methodParams, setMethodParams] = useState([]);
    const [nodeClassConstructors, setNodeClassConstructors] = useState([])
    const [nodeClassMethods, setNodeClassMethods] = useState([])
    const [selectedMethod, setSelectedMethod] = useState("")
    const [methodHelperInfo, setMethodHelperInfo] = useState("")
    const [constructorHelperInfo, setConstructorHelperInfo] = useState("")
    const [constructorHelperText, setConstructorHelperText] = useState("Set Node class constructor")
    const [constructorParamsShow, setConstructorParamsShow] = useState(true)
    const constructorPropsSchema = mapParamsToSchema(constructorParams);
    const methodPropsSchema = mapParamsToSchema(methodParams)
    const formConstructorRef = useRef(null);
    const formMethodRef = useRef(null);
    const [dataFromConstructor, setDataFromConstructor] = useState({})
    const [dataFromMethod, setDataFromMethod] = useState({})

    const resetAndClose = () => {
        setDataFromConstructor({})
        setDataFromMethod({})
        setPropsShow(false)
    }

    const isValidData = (data) => {
        if (data == null) return false;

        if (typeof data === 'string') return true;

        if (Array.isArray(data)) {
            return data.every((v) => typeof v === 'string');
        }

        if (typeof data === 'object') {
            const values = Object.values(data);
            if (values.length === 0) return false;

            return values.every((v) => isValidData(v));
        }

        return false;
    };

    useEffect(() => {
        if (!node) return
        let className = parser.getClasses()[0]

        if (node?.data?.className) {
            className = node.data.className
        }
        if (node?.data?.constructorIndex) {
            setConstructorIndex(node.data.constructorIndex)
        }

        if (node?.data?.constructor) {
            setDataFromConstructor(node.data.constructor)
        }
        if (node?.data?.method) {
            setDataFromMethod(node.data.method)
        }
        setNodeClass(className)
        setNodeValue(node.data.label)
    }, [node]);

    useEffect(() => {
        if (!nodeClass || !node) return
        const constructors = parser.getConstructors(nodeClass);
        if (constructors.length > 0) {
            setNodeClassConstructors(constructors.map((ctor, idx) => ({label: `Number #${idx}`, value: idx})));
            const params = constructors[constructorIndex]?.parameters || [];
            setConstructorParams(params);
            setConstructorHelperText(constructors[constructorIndex].constructor)
            setConstructorHelperInfo(`(${constructors[constructorIndex].description})`)
        } else {
            setNodeClassConstructors([]);
            setConstructorParams([]);
        }
        const methods = parser.getMethods(nodeClass);
        setNodeClassMethods(methods.filter((m) => !m.uiSkip).map((m) => ({value: m.name, label: m.uiName})))

        let methodName = methods[0].name
        if (node?.data?.methodName && methods.some((m) => m.name === node.data.methodName)) {
            methodName = node.data.methodName
        }
        setSelectedMethod(methodName)
    }, [node, nodeClass, constructorIndex]);

    useEffect(() => {
        if (!selectedMethod) return;
        const method = parser.getMethod(nodeClass, selectedMethod);
        setMethodHelperInfo(method?.description)
        setMethodParams(method?.parameters || []);
    }, [selectedMethod]);

    return (
        <Drawer isOpen={propsShow} onClose={() => resetAndClose()} size={DrawerSize.STANDARD}>
            <div style={{padding: "10px", overflowY: "auto"}}>
                <FormGroup helperText="Set pretty node label" label="Node label" labelFor="node-label">
                    <InputGroup id="node-label" value={nodeValue} onValueChange={(v) => setNodeValue(v)} placeholder="Node label placeholder"/>
                </FormGroup>
                <FormGroup helperText="Set Node class" label="Node class" labelFor="node-class">
                    <HTMLSelect id={"node-class"}
                                placeholder={"Set Node class..."}
                                value={nodeClass}
                                options={parser.getClasses()}
                                onChange={(e) => setNodeClass(e.target.value)} fill={true}
                    />
                </FormGroup>
                {nodeClassConstructors.length > 0 && (
                    <FormGroup helperText={constructorHelperText} label="Node class constructor" labelFor="node-class-constructor"
                               labelInfo={constructorHelperInfo}>
                        <HTMLSelect
                            id="node-class-constructor"
                            options={nodeClassConstructors}
                            value={constructorIndex}
                            onChange={(e) => setConstructorIndex(Number(e.target.value))}
                            fill={true}
                        />
                    </FormGroup>
                )}
                {constructorParams.length > 0 && (
                    <div style={{ marginTop: 20, marginBottom: "10px" }}>
                        <Button onClick={() => setConstructorParamsShow(!constructorParamsShow)}
                                text={`${constructorParamsShow ? "Hide" : "Show"} constructor parameters`}
                                fill={true}
                                intent={"primary"}
                                style={{ marginBottom: "10px" }}
                        />
                        <Collapse isOpen={constructorParamsShow} keepChildrenMounted={true}>
                            <Form
                                schema={constructorPropsSchema}
                                ref={formConstructorRef}
                                formData={dataFromConstructor}
                                onChange={(data) => {
                                    setDataFromConstructor(data.formData)
                                }}
                                validator={validator}
                                uiSchema={{
                                    "ui:submitButtonOptions": { norender: true },
                                }}
                                focusOnFirstError={true}
                            />
                        </Collapse>
                    </div>
                )}
                <FormGroup helperText={methodHelperInfo} label="Node class method" labelFor="node-class-method">
                    <HTMLSelect
                        id="node-class-method"
                        options={nodeClassMethods}
                        value={selectedMethod}
                        onChange={(e) => setSelectedMethod(e.target.value)}
                        fill={true}
                    />
                </FormGroup>
                <div style={{ marginTop: 20, marginBottom: "10px" }}>
                    <Form
                        schema={methodPropsSchema}
                        ref={formMethodRef}
                        formData={dataFromMethod}
                        onChange={(data) => {
                            if (!isValidData(data.formData)) {
                                return
                            }
                            setDataFromMethod(data.formData)
                        }}
                        validator={validator}
                        uiSchema={{
                            "ui:submitButtonOptions": { norender: true },
                        }}
                        focusOnFirstError={true}
                        omitExtraData={true}
                        liveOmit={true}
                    />
                </div>
                <Button intent={"success"} text={"Save"} icon={"saved"} loading={saveLoading} onClick={async () => {
                    setSaveLoading(true)
                    const dataToAdd = {
                        constructor: {},
                        method: {}
                    }
                    if (formConstructorRef.current) {
                        const resultConstructor = formConstructorRef.current.validateFormWithFormData(dataFromConstructor)
                        if (!resultConstructor) {
                            (AppToaster).show({message: `Constructor validation error!`, intent: "danger"});
                            setSaveLoading(false)
                            return
                        }
                        dataToAdd.constructor = dataFromConstructor
                    }
                    if (formMethodRef.current) {
                        const resultMethod = formMethodRef.current.validateFormWithFormData(dataFromMethod)
                        if (!resultMethod) {
                            (AppToaster).show({message: `Method validation error!`, intent: "danger"});
                            setSaveLoading(false)
                            return
                        }
                        dataToAdd.method = dataFromMethod
                    }
                    setNodes((nds) =>
                        nds.map((node) => {
                            if (node.id === selectedNodeId) {
                                return {
                                    ...node,
                                    data: {
                                        ...node.data,
                                        color: ColorMap[nodeClass],
                                        className: nodeClass,
                                        methodName: selectedMethod,
                                        label: nodeValue,
                                        constructorIndex: constructorIndex,
                                        ...dataToAdd
                                    },
                                };
                            }

                            return node;
                        }),
                    )
                    setSaveLoading(false);
                    resetAndClose();
                    (AppToaster).show({message: `Saved!`, intent: "success"})
                }} />
            </div>
        </Drawer>
    )
}
RightSidePanel.propTypes = {
    setNodes: PropTypes.func,
    propsShow: PropTypes.bool,
    setPropsShow: PropTypes.func,
    selectedNodeId: PropTypes.string
}