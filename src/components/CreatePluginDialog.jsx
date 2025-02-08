import {Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup} from "@blueprintjs/core";
import React, {useEffect, useState} from "react";

import CodeMirror from "@uiw/react-codemirror";
import {json} from '@codemirror/lang-json';
import {okaidia} from '@uiw/codemirror-theme-okaidia';

import './css/CreatePluginDialog.css'
import {AppToaster} from "./AppToaster.jsx";

export const CreatePluginDialog = ({show, close, name, parentPluginSelect}) => {
    const [uploadLoading, setUploadLoading] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [pluginName, setPluginName] = useState('');
    const [updateInitial, setUpdateInitial] = useState(true);
    const [pluginContent, setPluginContent] = useState("");

    const dialogClose = () => {
        close()
        setUploadLoading(false)
    }

    const onPluginContentChange = React.useCallback((val) => {
        setPluginContent(val);
    }, []);

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
                (await AppToaster).show({ message: `Error: ${pluginData.error}`, intent: "danger" });
            }
        } else {
            (await AppToaster).show({ message: "Problem with uploading file", intent: "danger" });
        }
        setUploadLoading(false);
    };

    const handlePluginNameChange = (name) => {
        setPluginName(name)
        if (updateInitial) {
            window.electron.SamplePlugin(name).then ((content) => {
                setPluginContent(content);
            })
        }
    }

    const createPlugin = () => {
        setCreateLoading(true);
        window.electron.SavePlugin({data: pluginContent, name: pluginName}).then (async (result) => {
            if (result) {
                if (result.success) {
                    (await AppToaster).show({message: "New plugin was added and activated!", intent: "success" });
                    let plugin = {};
                    plugin.id = result.pluginID;
                    plugin.name = result.metadata.name;
                    plugin.description = result.metadata.description;
                    plugin.icon = result.metadata.icon;
                    plugin.version = result.metadata.version;
                    parentPluginSelect(plugin);
                    close()
                } else {
                    (await AppToaster).show({ message: `Error: ${result.error}`, intent: "danger" });
                }
            } else {
                (await AppToaster).show({message: "Problem with saving plugin", intent: "danger"});
            }
        })
        setCreateLoading(false);
    }

    useEffect(() => {
        window.electron.SamplePlugin(name).then ((content) => {
            setPluginContent(content);
        })
        setPluginName(name)
    }, [name])

    return (
        <Dialog isOpen={show} onClose={dialogClose} title={"Create Plugin"} canEscapeKeyClose={false}
                canOutsideClickClose={false}>
            <DialogBody useOverflowScrollContainer={false}>
                {updateInitial === true && (
                    <FormGroup
                        label="Name"
                        labelFor="plugin-name"
                    >
                        <InputGroup id={"plugin-name"} value={pluginName} onValueChange={handlePluginNameChange}
                                    placeholder="Name of plugin"/>
                    </FormGroup>
                )}
                <FormGroup
                    label="Content"
                    labelFor="plugin-content"
                    labelInfo="(required)"
                >
                    <div id={"plugin-content"}>
                        <CodeMirror
                            value={pluginContent}
                            autoFocus={true}
                            options={{
                                theme: "default",
                                lineNumbers: true,
                            }}
                            extensions={[json()]}
                            onChange={onPluginContentChange}
                            theme={okaidia}
                        />
                    </div>
                </FormGroup>
                <FormGroup
                    label="...or you may upload your plugin:"
                    labelFor="plugin-upload"
                >
                    <Button id={"plugin-upload"} loading={uploadLoading} icon="upload" text="Upload" onClick={handleFileUpload}/>
                </FormGroup>
            </DialogBody>
            <DialogFooter actions={<Button onClick={createPlugin} loading={createLoading} intent="success">Create</Button>}></DialogFooter>
        </Dialog>
    )
}
