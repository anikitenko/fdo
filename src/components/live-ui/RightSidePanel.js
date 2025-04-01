import {Button, Collapse, Drawer, DrawerSize, FormGroup, HTMLSelect, InputGroup} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";
import {withTheme} from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import {useStore} from '@xyflow/react';
import {v4 as uuidv4} from 'uuid';

import Tribute from "tributejs";
import "tributejs/dist/tribute.css"

import cssData from 'mdn-data/css/properties.json';

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
    const nodesKeyframe = useStore((state) =>
        state.nodes.find((n) => n.data?.methodName === "createStyleKeyframe")
    )
    const Form = withTheme(Bp5Theme);
    const parser = DOMMetadataParser(domMetadata);

    const [saveLoading, setSaveLoading] = useState(false)
    const nodesWithKeyframe = useRef([])
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
    const [dataFromConstructor, setDataFromConstructor] = useState({})
    const [dataFromMethod, setDataFromMethod] = useState({})

    const constructorPropsSchema = mapParamsToSchema(constructorParams);
    const methodPropsSchema = mapParamsToSchema(methodParams)

    const formConstructorRef = useRef(null);
    const formMethodRef = useRef(null);

    const getPossibleValuesForStyles = (property) => {
        const syntax = cssData[property]?.syntax || "";
        return syntax
            .split('|')
            .map(s => s.trim())
            .filter(v => v && !v.includes('<')) // ignore <length>, <color> etc.
    }

    const getStyleValueSuggestions = (propName = "") => {
        const values = getPossibleValuesForStyles(propName);
        return values.map(v => ({key: v, value: v}));
    };

    const getStyles = (name = "") => {
        return Object.keys(cssData)
            .filter((key) => key.includes(name))
            .map((key) => ({
                value: `${key}`,
                key: `${key}`,
            }));
    };

    const tribute = new Tribute({
        collection: [
            {
                trigger: '$',
                values: function (text, cb) {
                    cb([...nodesWithKeyframe.current])
                },
                noMatchTemplate: function () {
                    return '<span style="visibility: hidden;"></span>';
                },
                selectTemplate: function (item) {
                    if (item.original.value.startsWith("keyframes.")) {
                        return `$${item.original.value}`;
                    }
                },
                menuItemLimit: 25,
            },
            {
                values: [
                    {key: "Generate Random", value: "generateRandom"},
                    {key: "Generate Random (hex)", value: "generateRandomHex"},
                    {key: "Generate Random (hex) (short)", value: "generateRandomHexShort"},
                    {key: "Generate UUID", value: "uuid"},
                    {key: "Date now", value: "dateNow"},
                ],
                noMatchTemplate: function () {
                    return '<span style="visibility: hidden;"></span>';
                },
                selectTemplate: function (item) {
                    if (item.original.value === "generateRandom") {
                        return (Math.random() + 1).toString(36).substring(2)
                    }
                    if (item.original.value === "uuid") {
                        return uuidv4()
                    }
                    if (item.original.value === "dateNow") {
                        return Date.now().toString()
                    }
                    if (item.original.value === "generateRandomHex") {
                        return Math.floor(Math.random() * 16777215).toString(16);
                    }
                    if (item.original.value === "generateRandomHexShort") {
                        return Math.floor(Math.random() * 65535).toString(16);
                    }
                },
                menuItemLimit: 25,
            },
            {
                trigger: '.',
                values: function (text, cb) {
                    const styles = getStyles(text);
                    cb([...styles])
                },
                noMatchTemplate: function () {
                    return '<span style="visibility: hidden;"></span>';
                },
                selectTemplate: function (item) {
                    return item.original.value
                },
                menuItemLimit: 25,
            },
            {
                trigger: ':',
                values: function (text, cb) {
                    const inputEl = tribute.current?.element;
                    const formGroup = inputEl?.closest(".bp5-form-group");

                    if (!formGroup) return cb([]);

                    const label = formGroup.querySelector("label")?.textContent?.trim();

                    if (!label) return cb([]);
                    cb([...getStyleValueSuggestions(label)])
                },
                noMatchTemplate: function () {
                    return '<span style="visibility: hidden;"></span>';
                },
                selectTemplate: function (item) {
                    return item.original.value
                },
                menuItemLimit: 25,
            }]
    })

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
        if (!nodesKeyframe) return
        nodesWithKeyframe.current = [{...nodesKeyframe}].filter((n) => n !== undefined).map((n) => {
            return {
                value: `keyframes.${n.data.label}`,
                key: `keyframes.${n.data.label}`,
            }
        })
    }, [nodesKeyframe]);

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

    useEffect(() => {
        const observer = new MutationObserver(() => {
            document.querySelectorAll('input').forEach((input) => {
                if (!input.hasAttribute('data-tribute-attached')) {
                    tribute.attach(input);
                    input.setAttribute('data-tribute-attached', 'true');
                }
            });
        });

        observer.observe(document.body, {childList: true, subtree: true});

        return () => observer.disconnect();
    }, [])

    return (
        <Drawer isOpen={propsShow} onClose={() => resetAndClose()} size={DrawerSize.STANDARD}>
            <div style={{padding: "10px", overflowY: "auto"}}>
                <FormGroup helperText="Set pretty node label" label="Node label" labelFor="node-label">
                    <InputGroup id="node-label" value={nodeValue} onValueChange={(v) => setNodeValue(v)}
                                placeholder="Node label placeholder"/>
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
                    <FormGroup helperText={constructorHelperText} label="Node class constructor"
                               labelFor="node-class-constructor"
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
                    <div style={{marginTop: 20, marginBottom: "10px"}}>
                        <Button onClick={() => setConstructorParamsShow(!constructorParamsShow)}
                                text={`${constructorParamsShow ? "Hide" : "Show"} constructor parameters`}
                                fill={true}
                                intent={"primary"}
                                style={{marginBottom: "10px"}}
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
                                    "ui:submitButtonOptions": {norender: true},
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
                <div style={{marginTop: 20, marginBottom: "10px"}}>
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
                            "ui:submitButtonOptions": {norender: true},
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
                }}/>
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