import {operationError} from '../utils/desktop/notificationContent';
import {
    Button,
    Dialog,
    DialogBody,
    DialogFooter,
    Divider,
    FormGroup,
    Icon,
    InputGroup,
    Tag,
    Spinner
} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";

import * as styles from './css/CreatePluginDialog.module.css'
import {AppToaster} from "./AppToaster.jsx";
import {PLUGIN_TEMPLATES, resolvePluginTemplate} from "../utils/plugins/authoring/pluginTemplateCatalog";
import PropTypes from "prop-types";
import {validateNewPluginName} from '../utils/plugins/authoring/pluginNameValidation';
import {sanitizeBlueprintIcon} from "../utils/presentation/blueprintIcons";

export const CreatePluginDialog = ({show, close}) => {
    const [uploadLoading, setUploadLoading] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [pluginName, setPluginName] = useState('');
    const [pluginMetadata, setPluginMetadata] = useState(null)
    const [pluginUrl, setPluginUrl] = useState('');
    const [updateInitial, setUpdateInitial] = useState(true);
    const [pluginContent, setPluginContent] = useState('');
    const [pluginEntrypoint, setPluginEntrypoint] = useState('');
    const [pluginTemplate, setPluginTemplate] = useState('blank');
    const selectedTemplate = resolvePluginTemplate(pluginTemplate);
    const [nameTouched, setNameTouched] = useState(false);
    const [nameInventory, setNameInventory] = useState({status: 'loading', plugins: []});
    const [openingEditor, setOpeningEditor] = useState(false);
    const [, refreshStorage] = useState(0);
    const inventoryEpoch = useRef(0);
    const openingRef = useRef(null);
    const hasSavedWorkspace = id => localStorage.getItem(`sandbox_${id}`) !== null;
    const validation = validateNewPluginName(pluginName, {plugins: nameInventory.plugins, hasSavedWorkspace});
    const nameError = (nameTouched || !!pluginName) && !validation.valid;
    const loadPluginInventory = async () => {
        const response = await window.electron.plugin.getAll();
        if (response?.success === false || !Array.isArray(response?.plugins)) throw new Error('Plugin list unavailable.');
        return response.plugins;
    };
    const refreshNameInventory = async () => {
        const epoch = ++inventoryEpoch.current;
        setNameInventory(previous => ({...previous, status: 'loading'}));
        try {
            const plugins = await loadPluginInventory();
            if (inventoryEpoch.current === epoch) setNameInventory({status: 'ready', plugins});
        } catch {
            if (inventoryEpoch.current === epoch) setNameInventory({status: 'error', plugins: []});
        }
    };
    useEffect(() => {
        if (!show) {
            openingRef.current = null;
            setOpeningEditor(false);
            return;
        }
        if (!updateInitial) return;
        void refreshNameInventory();
        const onStorage = event => {
            if (event.key === null || event.key?.startsWith('sandbox_')) refreshStorage(value => value + 1);
        };
        const onFocus = () => { if (!openingRef.current) void refreshNameInventory(); };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', onFocus);
        return () => {
            inventoryEpoch.current += 1;
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', onFocus);
        };
    }, [show, updateInitial]);

    const openEditor = async (event, mode = 'new') => {
        event?.preventDefault();
        setNameTouched(true);
        if (openingRef.current || nameInventory.status !== 'ready') return;
        if (mode === 'new' && !validation.valid) return;
        const requestToken = {};
        openingRef.current = requestToken;
        setOpeningEditor(true);
        const epoch = inventoryEpoch.current;
        try {
            // Recheck just before opening; another window may have created a plugin.
            const plugins = await loadPluginInventory();
            if (inventoryEpoch.current !== epoch) return;
            setNameInventory({status: 'ready', plugins});
            const latest = validateNewPluginName(pluginName, {plugins, hasSavedWorkspace});
            if (mode === 'new' && !latest.valid) return;
            if (mode === 'resume' && latest.code !== 'workspace_exists') return;
            if (mode === 'existing' && latest.code !== 'plugin_exists') return;
            const name = mode === 'existing' ? latest.existingPlugin.id : latest.name;
            window.electron.system.openEditorWindow(mode === 'new' ? {name, template: selectedTemplate.value} : {name});
            dialogClose();
        } catch {
            if (inventoryEpoch.current === epoch) setNameInventory({status: 'error', plugins: []});
        } finally {
            if (openingRef.current === requestToken) {
                openingRef.current = null;
                setOpeningEditor(false);
            }
        }
    };

    const handleReset = () => {
        inventoryEpoch.current += 1;
        openingRef.current = null;
        setNameTouched(false);
        setOpeningEditor(false);
        setPluginMetadata(null)
        setUpdateInitial(true);
        setPluginName('');
        setPluginTemplate('blank');
        setPluginContent('');
        setPluginEntrypoint('');
    }

    const dialogClose = () => {
        close()
        setUploadLoading(false)
        handleReset()
    }

    const normalizeImportedMetadata = (metadata) => ({
        ...metadata,
        icon: typeof metadata?.icon === "string" ? metadata.icon.toLowerCase() : metadata?.icon,
    });

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
                const metadata = normalizeImportedMetadata(pluginData.metadata)

                setPluginContent(pluginData.content);
                setPluginName(pluginData.metadata.name);
                setPluginMetadata(metadata);
                setPluginEntrypoint(pluginData.entryPoint);
                setUpdateInitial(false);
            } else {
                (await AppToaster).show({message: operationError("Could not import the selected plugin directory", pluginData.error, "Check its entry file and metadata, then select the directory again."), intent: "danger"});
            }
        } else {
            (await AppToaster).show({message: "The selected plugin directory could not be read. Check file access, then select it again.", intent: "danger"});
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
                    close()
                } else {
                    (await AppToaster).show({message: operationError(`Could not add ${pluginName || "the plugin"}`, result.error, "Review the plugin metadata and installation before trying again."), intent: "danger"});
                }
            } else {
                (await AppToaster).show({message: `Could not add ${pluginName || "the plugin"}. Check disk access and try again.`, intent: "danger"});
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
                    width: 760,
                    maxWidth: 'calc(100vw - 32px)',
                    paddingBottom: 0
                }}
        >
            <DialogBody>
                {updateInitial && (
                    <form onSubmit={openEditor}>
                    <FormGroup
                        label="Name"
                        labelFor="plugin-name"
                        fill={true}
                        intent={nameError ? 'danger' : validation.valid && nameInventory.status === 'ready' ? 'success' : 'none'}
                        helperText={<div id="plugin-name-feedback" className={styles.nameFeedback} role="status" aria-live="polite">
                            <div>{nameError ? validation.message : nameInventory.status === 'error'
                                ? 'Could not check existing plugin names. Try again.' : nameInventory.status === 'loading'
                                    ? 'Checking existing plugin names…' : validation.valid ? validation.message : 'Use a descriptive name for your plugin.'}</div>
                            {validation.id && <div>Plugin ID: <code>{validation.id}</code></div>}
                            {nameInventory.status === 'error' && <Button size="small" variant="minimal" type="button" icon="refresh" onClick={refreshNameInventory}>Retry name check</Button>}
                            {validation.code === 'workspace_exists' && <Button size="small" variant="minimal" type="button" disabled={openingEditor || nameInventory.status !== 'ready'} onClick={event => openEditor(event, 'resume')}>Resume saved workspace</Button>}
                            {validation.code === 'plugin_exists' && <Button size="small" variant="minimal" type="button" disabled={openingEditor || nameInventory.status !== 'ready'} onClick={event => openEditor(event, 'existing')}>Open existing plugin</Button>}
                        </div>}
                    >
                        <InputGroup id={"plugin-name"} value={pluginName} onValueChange={value => {setPluginName(value); setNameTouched(true);}}
                                    disabled={openingEditor} onBlur={() => setNameTouched(true)}
                                    aria-describedby="plugin-name-feedback" aria-invalid={nameError || nameInventory.status === 'error'}
                                    rightElement={nameInventory.status === 'loading' ? <Spinner size={16}/> : validation.valid && nameInventory.status === 'ready' ? <Icon icon="tick" intent="success"/> : undefined}
                                    placeholder="Name of plugin" fill={true} autoFocus={true}/>
                    </FormGroup>

                <fieldset className={styles.templateFieldset}>
                    <legend>Choose a starting point</legend>
                    <p className={styles.templateHint}>Every template includes runnable code, tests and SKILL.md. No AI request or credentials are required.</p>
                    <div className={styles.templateGrid}>
                        {PLUGIN_TEMPLATES.map(template => <Button key={template.value} type="button"
                            className={`${styles.templateCard} ${pluginTemplate === template.value ? styles.selectedTemplate : ''}`}
                            aria-label={`${template.title} template`} disabled={openingEditor} aria-pressed={pluginTemplate === template.value}
                            onClick={() => setPluginTemplate(template.value)}>
                            <div className={styles.templateTitle}><Icon icon={template.icon}/><strong>{template.title}</strong>
                                {pluginTemplate === template.value && <Icon icon="tick" intent="success"/>}</div>
                            <p>{template.description}</p>
                        </Button>)}
                    </div>
                    <div className={styles.templateFeatures} aria-live="polite">
                        <span>Included:</span> {selectedTemplate.features.map(feature => <Tag key={feature} variant="minimal">{feature}</Tag>)}
                    </div>
                </fieldset>
                <Button fill type="submit" text={`Open editor · ${selectedTemplate.title}`} intent="primary"
                        endIcon="share" loading={openingEditor} disabled={!validation.valid || nameInventory.status !== 'ready' || openingEditor}/>
                    </form>
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
                            <Icon icon={sanitizeBlueprintIcon(pluginMetadata.icon)} intent="primary" size={24} />
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
                    <Button id={"plugin-upload"} loading={uploadLoading} disabled={openingEditor} icon="upload" text="Select folder"
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
            {!updateInitial && <DialogFooter actions={<Button onClick={createPlugin} loading={createLoading} disabled={!pluginName || !pluginContent}
                                           intent="success">Save imported plugin</Button>}/>}
        </Dialog>
    )
}
CreatePluginDialog.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func,
}
