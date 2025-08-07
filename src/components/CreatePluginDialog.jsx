import {
    Button,
    Dialog,
    DialogBody,
    DialogFooter,
    Divider,
    FormGroup,
    Icon,
    InputGroup,
    MenuItem
} from "@blueprintjs/core";
import React, {useState} from "react";

import * as styles from './css/CreatePluginDialog.module.css'
import {AppToaster} from "./AppToaster.jsx";
import {Select} from "@blueprintjs/select";
import PropTypes from "prop-types";

export const CreatePluginDialog = ({show, close}) => {
    const [uploadLoading, setUploadLoading] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [pluginName, setPluginName] = useState('');
    const [pluginMetadata, setPluginMetadata] = useState(null)
    const [pluginUrl, setPluginUrl] = useState('');
    const [updateInitial, setUpdateInitial] = useState(true);
    const [pluginContent, setPluginContent] = useState('');
    const [pluginEntrypoint, setPluginEntrypoint] = useState('');
    const pluginTemplates = [
        {title: "Blank", value: "blank"},
        {title: "Horizontally divided", value: "horDivided"},
        {title: "Vertically divided", value: "verDivided"}
    ]
    const [pluginTemplate, setPluginTemplate] = useState({title: "Blank", value: "blank"});

    const handleReset = () => {
        setPluginMetadata(null)
        setUpdateInitial(true);
        setPluginName('');
        setPluginContent('');
        setPluginEntrypoint('');
    }

    const dialogClose = () => {
        close()
        setUploadLoading(false)
        handleReset()
    }

    const handleFileUpload = async () => {
        setUploadLoading(true);
        const selectedPluginPath = await window.electron.system.openFileDialog({
            title: 'Select plugin directory',
            buttonLabel: 'Select',
            properties: ['openDirectory'],
        })
        if (!selectedPluginPath) {
            setUploadLoading(false);
            return
        }
        const pluginData = await window.electron.plugin.getData(selectedPluginPath);
        if (pluginData) {
            if (pluginData.success) {
                const metadata = pluginData.metadata
                metadata.icon = metadata.icon.toLowerCase()

                setPluginContent(pluginData.content);
                setPluginName(pluginData.metadata.name);
                setPluginMetadata(metadata);
                setPluginEntrypoint(pluginData.entryPoint);
                setUpdateInitial(false);
            } else {
                (await AppToaster).show({message: `Error: ${pluginData.error}`, intent: "danger"});
            }
        } else {
            (await AppToaster).show({message: "Problem with opening plugin directory", intent: "danger"});
        }
        setUploadLoading(false);
    };

    const createPlugin = () => {
        setCreateLoading(true);
        window.electron.plugin.save({
            name: pluginName,
            content: pluginContent,
            metadata: pluginMetadata,
            entrypoint: pluginEntrypoint
        }).then(async (result) => {
            if (result) {
                if (result.success) {
                    (await AppToaster).show({message: "New plugin was added!", intent: "success"});
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

    return (
        <Dialog autoFocus={true}
                canEscapeKeyClose={false}
                canOutsideClickClose={false}
                isOpen={show}
                isCloseButtonShown={true}
                onClose={dialogClose}
                className={styles["create-plugin-dialog"]}
                title={<><Icon icon={"console"} intent={"primary"} size={20}/><span className={"bp6-heading"}
                                                                                    style={{fontSize: "1.2rem"}}>Create Plugin</span></>}
                style={{
                    minWidth: 600,
                    paddingBottom: 0
                }}
        >
            <DialogBody useOverflowScrollContainer={false}>
                {updateInitial && (
                    <>
                    <FormGroup
                        label="Name"
                        labelFor="plugin-name"
                        fill={true}
                    >
                        <InputGroup id={"plugin-name"} onValueChange={setPluginName}
                                    placeholder="Name of plugin" fill={true} autoFocus={true}/>
                    </FormGroup>

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
                            (item, {handleClick, handleFocus, modifiers}) => (
                                <MenuItem
                                    active={modifiers.active}
                                    disabled={modifiers.disabled}
                                    key={item.value}
                                    onClick={handleClick}
                                    onFocus={handleFocus}
                                    selected={item.value === pluginTemplate?.value}
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
                        <Button fill={true} text={pluginTemplate?.title ?? "Select a template"} endIcon="double-caret-vertical"/>
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
                            window.electron.system.openEditorWindow({name: pluginName, template: pluginTemplate.value})
                            dialogClose()
                        }
                        }/>
                <Divider/>
                    </>
                )}
                {pluginMetadata && (
                    <div style={{
                        backgroundColor: "#f5f8fa",
                        padding: "1rem",
                        borderRadius: "10px",
                        boxShadow: "0 1px 5px rgba(0,0,0,0.1)",
                        fontSize: "1rem",
                        lineHeight: "1.8"
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
                            <span style={{ fontSize: "1.5rem" }}>🧩</span>
                            <Icon icon={pluginMetadata.icon.toLowerCase()} intent="primary" size={24} />
                            <span style={{ fontWeight: "bold", fontSize: "1.2rem" }}>{pluginMetadata.name}</span>
                        </div>

                        <div>🔖 <b>Version:</b> {pluginMetadata.version}</div>
                        <div>👨‍💻 <b>Author:</b> {pluginMetadata.author}</div>

                        <div style={{ marginTop: "0.75rem" }}>
                            📝 <b>Description:</b>
                            <div style={{ marginTop: "0.25rem", backgroundColor: "#ffffff", padding: "0.5rem", borderRadius: "6px", color: "#394b59" }}>
                                {pluginMetadata.description}
                            </div>
                        </div>
                    </div>
                )}
                <Divider/>
                <FormGroup
                    label="...or you may upload your plugin:"
                    labelFor="plugin-upload"
                >
                    <Button id={"plugin-upload"} loading={uploadLoading} icon="upload" text="Select folder"
                            onClick={async () => {
                                await handleFileUpload()
                            }}/>
                    {!updateInitial && (
                        <Button icon="reset" text="Reset" intent={"warning"}
                                onClick={handleReset}/>
                    )}
                </FormGroup>
                <Divider/>
                <FormGroup
                    label="...or you may download from URL:"
                    labelFor="plugin-from-url"
                >
                    <InputGroup id={"plugin-from-url"} value={pluginUrl} onValueChange={setPluginUrl}
                                placeholder="https://dl.plugins.fdo.alexvwan.me/example-plugin"
                                fill={true} rightElement={<Button text={"Download"}/>}/>
                </FormGroup>
            </DialogBody>
            <DialogFooter actions={<Button onClick={createPlugin} loading={createLoading} disabled={!pluginName || !pluginContent}
                                           intent="success">Save</Button>}></DialogFooter>
        </Dialog>
    )
}
CreatePluginDialog.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func,
}
