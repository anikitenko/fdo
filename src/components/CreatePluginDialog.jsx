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
    Spinner, Card, Callout, HTMLSelect
} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";
import PluginCompatibilityNotice from './plugin/PluginCompatibilityNotice';

import * as styles from './css/CreatePluginDialog.module.css'
import {PLUGIN_TEMPLATES, resolvePluginTemplate} from "../utils/plugins/authoring/pluginTemplateCatalog";
import PropTypes from "prop-types";
import {validateNewPluginName} from '../utils/plugins/authoring/pluginNameValidation';
import {archiveDraftAndRelease, archivedDrafts, restoreArchivedDraft} from './editor/utils/draftIdRelease';
import {sanitizeBlueprintIcon} from "../utils/presentation/blueprintIcons";

export const CreatePluginDialog = ({show, close}) => {
    const [uploadLoading, setUploadLoading] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [pluginName, setPluginName] = useState('');
    const [importPreview, setImportPreview] = useState(null);
    const [importMode, setImportMode] = useState('bundle');
    const [importError, setImportError] = useState('');
    const [draftBusy, setDraftBusy] = useState(false);
    const [draftMessage, setDraftMessage] = useState('');
    const [updateInitial, setUpdateInitial] = useState(true);
    const [pluginTemplate, setPluginTemplate] = useState('blank');
    const selectedTemplate = resolvePluginTemplate(pluginTemplate);
    const [nameTouched, setNameTouched] = useState(false);
    const [nameInventory, setNameInventory] = useState({status: 'loading', plugins: []});
    const [openingEditor, setOpeningEditor] = useState(false);
    const [, refreshStorage] = useState(0);
    const inventoryEpoch = useRef(0);
    const openingRef = useRef(null);
    const uploadingRef = useRef(false);
    const previewRef = useRef(null);
    const hasSavedWorkspace = id => localStorage.getItem(`sandbox_${id}`) !== null;
    const validation = validateNewPluginName(pluginName, {plugins: nameInventory.plugins, hasSavedWorkspace});
    const pluginMetadata = importMode === 'build' ? importPreview?.sourceMetadata || importPreview?.metadata : importPreview?.metadata;
    const importCompatibility = importMode === 'build' ? importPreview?.sourceCompatibility : importPreview?.compatibility;
    const importMetadataError = (importMode === 'build' ? importPreview?.sourceMetadataError : importPreview?.metadataError)
        || (importCompatibility?.status === 'incompatible' ? importCompatibility.summary : '');
    let archives = [];
    try {archives = archivedDrafts(localStorage, validation.id);} catch { /* Storage errors are shown during validation. */ }
    const nameError = (nameTouched || !!pluginName) && !validation.valid;
    useEffect(() => {setDraftMessage('');}, [pluginName]);
    useEffect(() => {if (importPreview) previewRef.current?.scrollIntoView?.({block: 'start'});}, [importPreview]);
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
        void refreshNameInventory();
        const onStorage = event => {
            if (event.key === null || event.key?.startsWith('sandbox_')) refreshStorage(value => value + 1);
        };
        const onFocus = () => { if (!openingRef.current && !uploadingRef.current) void refreshNameInventory(); };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', onFocus);
        return () => {
            inventoryEpoch.current += 1;
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', onFocus);
        };
    }, [show]);

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
        setImportPreview(null); setImportError(''); setDraftMessage(''); setDraftBusy(false);
        setUpdateInitial(true);
        setPluginName('');
        setPluginTemplate('blank');
    }

    const dialogClose = () => {
        close()
        setUploadLoading(false)
        handleReset()
    }

    const changeDraftReservation = async (archiveKey = null) => {
        const id = validation.id, epoch = inventoryEpoch.current;
        setDraftBusy(true); setDraftMessage('');
        try {
            const plugins = await loadPluginInventory();
            const check = validateNewPluginName(id, {plugins});
            if (!check.valid) {if (inventoryEpoch.current === epoch) setDraftMessage(check.message); return;}
            const guard = await window.electron.plugin.checkDraftRelease(id);
            if (!guard?.success) {if (inventoryEpoch.current === epoch) setDraftMessage(guard?.error || 'Could not verify whether the ID can be released safely. Restart FDO and try again.'); return;}
            if (inventoryEpoch.current !== epoch) return;
            if (archiveKey) restoreArchivedDraft(localStorage, id, archiveKey);
            else archiveDraftAndRelease(localStorage, id);
            setNameInventory({status: 'ready', plugins});
            refreshStorage(value => value + 1);
            setDraftMessage(archiveKey ? 'Draft restored. Resume it to continue editing.' : 'ID released. Your draft is archived below and can be restored.');
        } catch (error) {if (inventoryEpoch.current === epoch) setDraftMessage(error.message);}
        finally {if (inventoryEpoch.current === epoch) setDraftBusy(false);}
    };
    const draftControls = <>
        {validation.code === 'workspace_exists' && <Button size="small" variant="minimal" icon="unlock" type="button" loading={draftBusy}
            disabled={openingEditor || nameInventory.status !== 'ready'} onClick={() => changeDraftReservation()}>Safe release ID</Button>}
        {draftMessage && <div aria-live="polite">{draftMessage}</div>}
        {archives.length > 0 && <details><summary>Archived drafts ({archives.length})</summary>
            <p>Releasing an ID keeps a recovery copy. Restoring never replaces a current draft or installed plugin.</p>
            {archives.map(archive => <div key={archive.key}><Button size="small" variant="minimal" type="button" disabled={!validation.valid || draftBusy || openingEditor}
                onClick={() => changeDraftReservation(archive.key)}>Restore draft · {new Date(archive.createdAt).toLocaleString()}</Button></div>)}
        </details>}
    </>;
    const handleFileUpload = async () => {
        if (uploadingRef.current) return;
        uploadingRef.current = true;
        setUploadLoading(true); setImportError('');
        const epoch = inventoryEpoch.current;
        try {
            const directory = await window.electron.system.openFileDialog({title: 'Select plugin project or exported plugin folder', buttonLabel: 'Inspect folder', properties: ['openDirectory']});
            if (!directory) return;
            const preview = await window.electron.plugin.inspectFolder(directory);
            if (inventoryEpoch.current !== epoch) return;
            if (!preview?.success) {setImportError(preview?.error || 'The selected folder could not be inspected.'); return;}
            const plugins = await loadPluginInventory();
            if (inventoryEpoch.current !== epoch) return;
            setImportPreview(preview);
            setPluginName(preview.proposedId);
            setImportMode(preview.hasCompiled ? 'bundle' : 'build');
            setNameTouched(true);
            setUpdateInitial(false);
            setNameInventory({status: 'ready', plugins});
        } catch (error) {if (inventoryEpoch.current === epoch) setImportError(error.message);}
        finally {uploadingRef.current = false; setUploadLoading(false);}
    };
    const createPlugin = async () => {
        if (createLoading || !validation.valid || !importPreview) return;
        setCreateLoading(true); setImportError('');
        try {
            const plugins = await loadPluginInventory();
            const latest = validateNewPluginName(pluginName, {plugins, hasSavedWorkspace});
            setNameInventory({status: 'ready', plugins});
            if (!latest.valid) {setImportError(latest.message); return;}
            const result = await window.electron.plugin.installFolder({token: importPreview.token, id: latest.id, mode: importMode});
            if (!result?.success) {setImportError(result?.error || 'The plugin was not imported.'); return;}
            dialogClose();
        } catch (error) {setImportError(error.message);}
        finally {setCreateLoading(false);}
    };

    return (
        <Dialog autoFocus={true}
                canEscapeKeyClose={false}
                canOutsideClickClose={false}
                isOpen={show}
                isCloseButtonShown={!createLoading}
                onClose={createLoading ? undefined : dialogClose}
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
                            {draftControls}
                            {validation.code === 'workspace_exists' && <Button size="small" variant="minimal" type="button" disabled={openingEditor || nameInventory.status !== 'ready'} onClick={event => openEditor(event, 'resume')}>Resume saved workspace</Button>}
                            {validation.code === 'plugin_exists' && <Button size="small" variant="minimal" type="button" disabled={openingEditor || nameInventory.status !== 'ready'} onClick={event => openEditor(event, 'existing')}>Open existing plugin</Button>}
                        </div>}
                    >
                        <InputGroup id={"plugin-name"} value={pluginName} onValueChange={value => {setPluginName(value); setNameTouched(true);}}
                                    disabled={openingEditor || draftBusy} onBlur={() => setNameTouched(true)}
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
                {importPreview && <div ref={previewRef}><Card>
                    <div style={{display: 'flex', alignItems: 'center', gap: 8}}><Icon icon={sanitizeBlueprintIcon(pluginMetadata?.icon)} size={24}/><strong>{pluginMetadata?.name || 'Plugin folder'}</strong></div>
                    <p>{pluginMetadata?.description}</p>
                    <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
                        <Tag>{importPreview.hasCompiled ? 'Compiled runtime found' : 'Source project'}</Tag>
                        {importPreview.hasSource && <Tag>Source included</Tag>}
                        <Tag>{importPreview.fileCount} files</Tag>
                        <Tag>{pluginMetadata?.version || 'Version missing'}</Tag>
                    </div>
                    <PluginCompatibilityNotice report={importCompatibility}/>
                    <FormGroup label="Plugin ID" labelFor="import-plugin-id" helperText={<>{validation.message}{draftControls}</>} intent={!validation.valid ? 'danger' : 'none'} style={{marginTop: 16}}>
                        <InputGroup id="import-plugin-id" value={pluginName} disabled={createLoading || draftBusy} onValueChange={setPluginName}/>
                    </FormGroup>
                    <p className="bp6-text-muted">{importPreview.hasSource ? `Source: ${importPreview.sourceEntry}. ` : ''}{importPreview.hasCompiled ? `Runtime: ${importPreview.entryPoint}.` : 'A runtime bundle will be built locally.'}</p>
                    <FormGroup label="Import as" labelFor="plugin-import-mode">
                        <HTMLSelect id="plugin-import-mode" value={importMode} disabled={createLoading} onChange={event => setImportMode(event.target.value)} options={[
                            ...(importPreview.hasCompiled ? [{value: 'bundle', label: 'Install existing compiled bundle'}] : []),
                            ...(importPreview.hasSource ? [{value: 'build', label: 'Build from source and install'}] : []),
                        ]}/>
                    </FormGroup>
                    <Callout icon="info-sign" title={importMode === 'build' ? 'Build and sign locally' : 'Preserve the exported bundle'}>
                        {importMode === 'build' ? 'FDO compiles the source using its existing build pipeline and signs it with the default root certificate. Package install/build scripts are not run.'
                            : importPreview.signed ? 'The supplied signature is verified before installation. Source files and binary assets are preserved.' : 'This bundle is unsigned. Review and sign it in Manage Plugins before using it.'}
                        <p>Files are snapshotted when inspected. Select the folder again to include later changes.</p>
                        <p>Imported plugins stay inactive and receive no capability grants. Existing plugins are never overwritten.</p>
                        {importMode === 'bundle' && importPreview.hasSource && <p>If the source changed after the last build, choose Build from source and install.</p>}
                    </Callout>
                    {importMetadataError && <Callout intent="danger" title="Cannot use this import mode">{importMetadataError} Correct the folder and select it again, or choose another available import mode.</Callout>}
                </Card></div>}
                {importError && <Callout intent="danger" role="alert" title="Import did not complete" style={{marginTop: 12}}>{importError}</Callout>}
                <Divider/>
                <FormGroup
                    label="Import an existing plugin folder"
                    labelFor="plugin-upload"
                >
                    <p className="bp6-text-muted">Select a folder containing package.json. FDO detects source projects and compiled exports, including exports that contain both.</p>
                    <Button id={"plugin-upload"} aria-label="Select folder" loading={uploadLoading} disabled={openingEditor || createLoading} icon="upload" text="Select folder"
                            onClick={async () => {
                                await handleFileUpload()
                            }}/>
                    {!updateInitial && (
                        <Button icon="reset" text="Reset" disabled={createLoading} intent={"warning"}
                                onClick={handleReset}/>
                    )}
                </FormGroup>
            </DialogBody>
            {!updateInitial && <DialogFooter actions={<Button onClick={createPlugin} loading={createLoading} disabled={!validation.valid || draftBusy || !!importMetadataError || nameInventory.status !== 'ready'}
                                           intent="success">{importMode === 'build' ? 'Build and install plugin' : 'Install compiled plugin'}</Button>}/>}
        </Dialog>
    )
}
CreatePluginDialog.propTypes = {
    show: PropTypes.bool,
    close: PropTypes.func,
}
