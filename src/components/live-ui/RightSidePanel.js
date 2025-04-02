import {
    Button,
    Collapse,
    Dialog,
    DialogBody,
    Drawer,
    DrawerSize,
    FormGroup,
    HTMLSelect,
    InputGroup
} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";
import {withTheme} from "@rjsf/core";
import validator from "@rjsf/validator-ajv8";
import {useStore} from '@xyflow/react';
import {v4 as uuidv4} from 'uuid';

import Tribute from "tributejs";
import "tributejs/dist/tribute.css"

import {HexColorPicker} from "react-colorful";

import cssData from 'mdn-data/css/properties.json';

import * as styles from "../css/LiveUI.module.css"

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
    const [dialogHelperShow, setDialogHelperShow] = useState(false)
    const [dialogHelperType, setDialogHelperType] = useState("")
    const [dialogHelperOutput, setDialogHelperOutput] = useState("")
    const dialogHelperResolveRef = useRef(null)
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

    const toCamelCase = (str) => {
        return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    }

    const toKebabCase = (str) => {
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2') // insert dash before uppercase
            .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2') // handle things like msTransform
            .toLowerCase();
    }

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

    const updateInputById = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;

        el.focus()
        el.value = value
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const showDialogHelper = ({ type }) => {
        return new Promise((resolve) => {
            setDialogHelperType(type);
            setDialogHelperShow(true);
            dialogHelperResolveRef.current = resolve;
        });
    }

    const tribute = new Tribute({
        containerClass: "bp5-menu bp5-small bp5-elevation-4 tribute-container",
        selectClass: styles["selectedClass"],
        itemClass: styles["helperItemClass"],
        searchOpts: {
            pre: '<b style="margin: 0">',
            post: '</b>',
            skip: false
        },
        collection: [
            {
                trigger: '$',
                values: function (text, cb) {
                    cb([...nodesWithKeyframe.current])
                },
                menuItemTemplate: function (item) {
                    return `<a class="bp5-menu-item" tabindex="0">${item.string}</a>`
                },
                selectTemplate: function (item) {
                    return `$${item.original.value}`;
                },
                menuItemLimit: 25,
            },
            {
                trigger: '>',
                values: [
                    {key: "Pick a color", value: "pickColor"},
                    {key: "Date now", value: "dateNow"},
                    {key: "Generate Random", value: "generateRandom"},
                    {key: "Generate Random (hex)", value: "generateRandomHex"},
                    {key: "Generate Random (hex) (short)", value: "generateRandomHexShort"},
                    {key: "Generate UUID", value: "uuid"},
                ],
                menuItemTemplate: function (item) {
                    return `<a class="bp5-menu-item" tabindex="0">${item.string}</a>`
                },
                selectTemplate: function (item) {
                    const inputElement = tribute.current?.element
                    const elId = inputElement?.id
                    if (item.original.value === "generateRandom") {
                        updateInputById(elId, (Math.random() + 1).toString(36).substring(2))
                    }
                    if (item.original.value === "uuid") {
                        updateInputById(elId, uuidv4())
                    }
                    if (item.original.value === "dateNow") {
                        updateInputById(elId, Date.now().toString())
                    }
                    if (item.original.value === "generateRandomHex") {
                        updateInputById(elId, Math.floor(Math.random() * 16777215).toString(16))
                    }
                    if (item.original.value === "generateRandomHexShort") {
                        updateInputById(elId, Math.floor(Math.random() * 65535).toString(16))
                    }
                    if (item.original.value === "pickColor") {
                        showDialogHelper({ type: "color" }).then((pickedColor) => {
                            updateInputById(elId, pickedColor)
                        });
                    }
                },
                menuItemLimit: 25,
            },
            {
                trigger: '@',
                values: function (text, cb) {
                    const styles = getStyles(text);
                    cb([...styles])
                },
                menuItemTemplate: function (item) {
                    return `<a class="bp5-menu-item" tabindex="0">${item.string}</a>`
                },
                selectTemplate: function (item) {
                    return toCamelCase(item.original.value)
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
                    cb([...getStyleValueSuggestions(toKebabCase(label))])
                },
                menuItemTemplate: function (item) {
                    return `<a class="bp5-menu-item" tabindex="0">${item.string}</a>`
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
            <Dialog isOpen={dialogHelperShow} shouldReturnFocusOnClose={true} onClose={() => {
                setDialogHelperShow(false);
                const selected = dialogHelperOutput;
                setDialogHelperOutput("");
                setDialogHelperType("");

                if (dialogHelperResolveRef.current) {
                    dialogHelperResolveRef.current(selected);
                    dialogHelperResolveRef.current = null;
                }
            }}>
                <DialogBody>
                    {dialogHelperType === "color" && (
                        <HexColorPicker color={dialogHelperOutput} onChange={setDialogHelperOutput} style={{width: "auto"}} />
                    )}
                </DialogBody>
            </Dialog>
        </Drawer>
    )
}
RightSidePanel.propTypes = {
    setNodes: PropTypes.func.isRequired,
    propsShow: PropTypes.bool.isRequired,
    setPropsShow: PropTypes.func.isRequired,
    selectedNodeId: PropTypes.string
}