import {
    Button,
    Dialog,
    DialogBody,
    DialogFooter,
    Divider,
    FormGroup,
    InputGroup,
    MenuItem
} from "@blueprintjs/core";
import React, {useEffect, useState} from "react";

import * as styles from './css/CreatePluginDialog.module.css'
import {AppToaster} from "./AppToaster.jsx";
import {Select} from "@blueprintjs/select";
import PropTypes from "prop-types";

export const CreatePluginDialog = ({show, close, name, parentPluginSelect}) => {
    const [uploadLoading, setUploadLoading] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [pluginName, setPluginName] = useState('');
    const [pluginUrl, setPluginUrl] = useState('');
    const [updateInitial, setUpdateInitial] = useState(true);
    const [pluginContent, setPluginContent] = useState("");
    const pluginTemplates = [
        {title: "Blank", value: "blank"},
        {title: "Horizontally divided", value: "horDivided"},
        {title: "Vertically divided", value: "verDivided"}
    ]
    const [pluginTemplate, setPluginTemplate] = useState({title: "Blank", value: "blank"});

    const dialogClose = () => {
        close()
        setUploadLoading(false)
    }

    const handleFileUpload = async () => {
        setUploadLoading(true);
        const selectedFilePath = await window.electron.OpenFileDialog();
        if (!selectedFilePath) {
            setUploadLoading(false);
            return
        }
        const pluginData = await window.electron.GetPluginData(selectedFilePath);
        if (pluginData) {
            if (pluginData.success) {
                setPluginContent(pluginData.content);
                setPluginName(pluginData.metadata.name);
                setUpdateInitial(false);
            } else {
                (await AppToaster).show({message: `Error: ${pluginData.error}`, intent: "danger"});
            }
        } else {
            (await AppToaster).show({message: "Problem with uploading file", intent: "danger"});
        }
        setUploadLoading(false);
    };

    const createPlugin = () => {
        setCreateLoading(true);
        window.electron.SavePlugin({data: pluginContent, name: pluginName}).then(async (result) => {
            if (result) {
                if (result.success) {
                    (await AppToaster).show({message: "New plugin was added and activated!", intent: "success"});
                    let plugin = {};
                    plugin.id = result.pluginID;
                    plugin.name = result.metadata.name;
                    plugin.description = result.metadata.description;
                    plugin.icon = result.metadata.icon;
                    plugin.version = result.metadata.version;
                    parentPluginSelect(plugin);
                    close()
                } else {
                    (await AppToaster).show({message: `Error: ${result.error}`, intent: "danger"});
                }
            } else {
                (await AppToaster).show({message: "Problem with saving plugin", intent: "danger"});
            }
        })
        setCreateLoading(false);
    }

    useEffect(() => {
        setPluginName(name)
    }, [name])

    return (
        <Dialog isOpen={show} onClose={dialogClose} title={"Create Plugin"} canEscapeKeyClose={false}
                canOutsideClickClose={false}>
            <DialogBody useOverflowScrollContainer={false}>
                {updateInitial && (
                    <FormGroup
                        label="Name"
                        labelFor="plugin-name"
                        fill={true}
                    >
                        <InputGroup id={"plugin-name"} onValueChange={setPluginName}
                                    placeholder="Name of plugin" fill={true} autoFocus={true}/>
                    </FormGroup>
                )}
                <FormGroup
                    label="Template"
                    labelFor="plugin-template"
                    labelInfo={"(required)"}
                    fill={true}
                >
                    <Select
                        id={"plugin-template"}
                        items={pluginTemplates}
                        itemRenderer={
                            (item, {handleClick, handleFocus, modifiers, query}) => (
                                <MenuItem
                                    active={modifiers.active}
                                    disabled={modifiers.disabled}
                                    key={item.value}
                                    onClick={handleClick}
                                    onFocus={handleFocus}
                                    roleStructure="listoption"
                                    text={item.title}
                                />
                            )
                        }
                        popoverProps={
                            {
                                minimal: true,
                                matchTargetWidth: true,
                            }
                        }
                        onItemSelect={setPluginTemplate}
                        filterable={false}
                        fill={true}
                    >
                        <Button fill={true} text={pluginTemplate.title} endIcon="double-caret-vertical"/>
                    </Select>
                </FormGroup>
                <div style={{marginBottom: "10px", textAlign: "-webkit-center"}}>
                    <div className={`${styles[`new-template-image-${pluginTemplate.value}`]}`}></div>
                </div>
                <Button fill={true} text={"Open editor"} intent={"primary"}
                              endIcon={"share"}
                        onClick={() => {
                            if (!pluginName) {
                                (async () => {
                                    AppToaster.show({message: "Please enter plugin name", intent: "warning"});
                                })()
                                return
                            }
                            window.electron.openEditorWindow({name: pluginName, template: pluginTemplate.value})
                            dialogClose()
                        }
                }/>
                <Divider />
                <FormGroup
                    label="...or you may upload your plugin:"
                    labelFor="plugin-upload"
                >
                    <Button id={"plugin-upload"} loading={uploadLoading} icon="upload" text="Upload"
                            onClick={async () => {
                                if (!pluginName) {
                                    await (async () => {
                                        AppToaster.show({message: "Please enter plugin name", intent: "warning"});
                                    })()
                                    return
                                }
                                await handleFileUpload()
                            }}/>
                </FormGroup>
                <Divider />
                <FormGroup
                    label="...or you may download from URL:"
                    labelFor="plugin-from-url"
                >
                    <InputGroup id={"plugin-from-url"} value={pluginUrl} onValueChange={setPluginUrl}
                                placeholder="https://dl.plugins.fdo.alexvwan.me/example-plugin"
                                fill={true} rightElement={<Button text={"Download"} />}/>
                </FormGroup>
            </DialogBody>
            <DialogFooter actions={<Button onClick={createPlugin} loading={createLoading}
                                           intent="success">Create</Button>}></DialogFooter>
        </Dialog>
    )
}
CreatePluginDialog.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func,
    name: PropTypes.string,
    parentPluginSelect: PropTypes.func
}
