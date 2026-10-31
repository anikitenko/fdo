import DeploymentRequirements from '../plugin/DeploymentRequirements';
import {sdkComponentContextKey} from './utils/sdkComponentContext';
import {ActionManager} from './ActionManager';
import {ExistingBindingEditor} from './ExistingBindingEditor';
import PluginAuthoringContract from '../plugin/PluginAuthoringContract';
import {PluginSupportEditor} from './PluginSupportEditor';
import {BackendResultEditor} from './BackendResultEditor';
import {ClassNamesEditor,InputKindEditor} from './ElementBasicsEditors';
import {BackendActionEditor} from './BackendActionEditor';
import {HtmlInlineStyleEditor} from './HtmlInlineStyleEditor';
import {ActionSimulationEditor} from './ActionSimulationEditor';
import {LocalActionEditor} from './LocalActionEditor';
import {SdkAsyncActionEditor} from './SdkAsyncActionEditor';
import {SdkOverlayOpenerEditor} from './SdkOverlayOpenerEditor';
import {SdkToastActionEditor} from './SdkToastActionEditor';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Button, Callout, Card, Checkbox, FormGroup, HTMLSelect, InputGroup, NonIdealState, Spinner, Tag, TextArea, useHotkeys, KeyComboTag} from '@blueprintjs/core';
import {SdkComponentCatalog} from './SdkComponentCatalog';
import {SdkComponentEditor} from './SdkComponentEditor';
import {AttributeEditor} from './AttributeEditor';
import {EditorSection} from './EditorSection';
import {breakpointFormError, breakpointFromInput, sameBreakpoint, breakpointOptionValue, breakpointLabel, breakpointPreviewWidth, breakpointBoundaryPreviews, compareBreakpoints} from '../../utils/plugins/authoring/liveUi/cssResponsive';
import {CSS_STATES} from '../../utils/plugins/authoring/liveUi/cssStates';
import {classNameError} from '../../utils/plugins/authoring/liveUi/classNames';
import {CssColorPicker} from './CssColorPicker';
import {CssLengthEditor} from './CssLengthEditor';
import {CssSpacingEditor} from './CssSpacingEditor';
import {CssPropertyPicker} from './CssPropertyPicker';
import {browserCssProperties, cssValuePresets, isVisualCssProperty} from '../../utils/plugins/authoring/liveUi/cssProperties';
import {createPreviewSurface} from './utils/previewDocument';
import * as styles from './WorkspacePreview.module.css';

const writableStyle = style => !!(style?.declarations?.length || style?.canAddDeclarations || style?.availableProperties?.length);
const editableStyle = style => writableStyle(style) || !!style?.states?.some(writableStyle);

export function WorkspacePreview({sessionId}) {
    const [workspace, setWorkspace] = useState(null), [connectionError, setConnectionError] = useState('');
    const [preview, setPreview] = useState({status: 'loading'}), [retry, setRetry] = useState(0);
    const [metadata, setMetadata] = useState({status: 'loading'}), [metadataRetry, setMetadataRetry] = useState(0);
    const [query, setQuery] = useState(''), [selectedId, setSelectedId] = useState('');
    const [draft, setDraft] = useState(null), [mode, setMode] = useState('text'), [value, setValue] = useState('');
    const [supportAcknowledged, setSupportAcknowledged] = useState(false);
    const [keepCheckpoint, setKeepCheckpoint] = useState(false);
    const [collectionContext,setCollectionContext]=useState(new Map());
    useEffect(()=>setCollectionContext(new Map()),[workspace?.workspaceId]);
    const rememberItem=(element,key)=>{
        if(!element?.sdkComponent?.collection?.items.some(row=>row.key===key)) return;
        const context=sdkComponentContextKey(element,display.elements || []);
        setCollectionContext(previous=>previous.get(context)===key ? previous : new Map(previous).set(context,key));
    };
    const focusComponentContent = useRef(false);
    useEffect(() => {
        if (focusComponentContent.current) {
            focusComponentContent.current = false;
            document.querySelector('[aria-label="Component content"]')?.scrollIntoView?.({block: 'nearest'});
        }
    }, [selectedId]);
    const [assignedStyle, setAssignedStyle] = useState('');
    const [newClassName, setNewClassName] = useState(''), [newStyleFile, setNewStyleFile] = useState('');
    const [classNameTouched, setClassNameTouched] = useState(false);
    const newClassError = classNameError(newClassName);
    const focusNewStyle = useRef(false);
    const cssEditIntent = useRef(false);
    const [component, setComponent] = useState('text');
    const [styleIndex, setStyleIndex] = useState(0), [property, setProperty] = useState('');
    const [cssScope, setCssScope] = useState('element'), [cssState, setCssState] = useState('base');
    const [cssBreakpoint, setCssBreakpoint] = useState(null), [previewWidth, setPreviewWidth] = useState(null);
    const [dialogId, setDialogId] = useState('');
    const [simulation,setSimulation] = useState(null);
    const [readyToken, setReadyToken] = useState('');
    const [framePreviewCommand, setFramePreviewCommand] = useState(null);
    const [customWidth, setCustomWidth] = useState('600'), [customUpperWidth, setCustomUpperWidth] = useState('900');
    const [customRuleType, setCustomRuleType] = useState('max'), [breakpointTouched, setBreakpointTouched] = useState(false);
    const customWidthError = breakpointFormError(customRuleType, customWidth, customUpperWidth);
    const customBreakpoint = customWidthError ? null : breakpointFromInput(customRuleType, customWidth, customUpperWidth);
    const [working, setWorking] = useState(''), [feedback, setFeedback] = useState(''), [editError, setEditError] = useState('');
    const latest = useRef(0), draftGeneration = useRef(0), lastReady = useRef(null), iframe = useRef(null), moveHandler = useRef(null), proposalBusy = useRef(false), inspectedId = useRef(null), cssValueInput = useRef(null);
    const cssProperties = useMemo(() => browserCssProperties(window), []);
    const display = draft?.preview || preview;
    const surface = useMemo(() => display.status === 'ready' ? createPreviewSurface(display) : null, [display]);
    const previewReady = !!surface && readyToken === surface.token;
    const activeDialogId = surface?.dialogs.some(item => item.id === dialogId) ? dialogId : '';
    const overlayLabel = surface?.dialogs.some(item => item.overlayKind !== 'native-dialog') ? 'Overlay' : 'Dialog';
    const activeOverlay = surface?.dialogs.find(item => item.id === activeDialogId);
    const selectionIntent = useRef({generation: 0, id: ''});
    const chooseElement = id => {
        selectionIntent.current = {generation: selectionIntent.current.generation + 1, id};
        const node=surface?.tree.find(item=>item.id===id);
        if(node?.collectionKey) rememberItem((display.elements || []).find(item=>item.id===node.componentId),node.collectionKey);
        setSelectedId(id);
        setDialogId(surface?.tree.find(item => item.id === id)?.dialogId || '');
    };
    const elements = display.elements || [];
    const selected = elements.find(item => item.id === selectedId);
    const containingComponent = !selected?.sdkComponent && elements.find(item => item.sdkComponent && item.id === (surface?.tree.find(node => node.id === selectedId)?.componentId || surface?.tree.find(node => node.id === selectedId)?.dialogId));
    const containingItem=containingComponent?.sdkComponent?.collection?.items?.find(row=>row.key===surface?.tree.find(node=>node.id===selectedId)?.collectionKey);
    const selectedStyle = selected?.styles?.[styleIndex];
    const customWidthKnown = selectedStyle?.responsive?.some(context => sameBreakpoint(context.breakpoint, customBreakpoint));
    const breakpointChoices = [...(selectedStyle?.responsive || [])];
    if (cssBreakpoint != null && !breakpointChoices.some(context => sameBreakpoint(context.breakpoint, cssBreakpoint))) breakpointChoices.push({breakpoint: cssBreakpoint, missing: true});
    breakpointChoices.sort((a, b) => compareBreakpoints(a.breakpoint, b.breakpoint));
    const selectedContext = cssBreakpoint == null ? selectedStyle : selectedStyle?.responsive?.find(item => sameBreakpoint(item.breakpoint, cssBreakpoint));
    const selectedRule = cssState === 'base' ? selectedContext : selectedContext?.states?.find(item => item.state === cssState);
    const cssChanged = !!(selectedRule && property && value.trim() && selectedRule.declarations.find(item => item.property === property)?.value !== value.trim());
    const styleUses = (surface?.tree || []).filter(item => item.styles?.some(style => style.file === selectedStyle?.file && style.key === selectedStyle?.key)).length;
    const textUses = selected?.text ? (surface?.tree || []).filter(item => item.text?.file === selected.text.file && item.text.start === selected.text.start).length : 0;
    const isolationBlocked = cssScope === 'element' && (!selectedStyle?.draftLocal || styleUses !== 1) && selectedStyle?.isolationReason;
    const recovery = !draft && workspace?.recovery;
    const sourceConflicted = !!recovery || !!draft && (draft.revision !== workspace?.revision || workspace?.disconnected);
    const targetBlocked = workspace?.authoringContract?.compatibility.status === 'incompatible';
    useEffect(()=>{if(workspace?.focus==='deployment'){const section=document.querySelector('[aria-label="Plugin deployment requirements"]');const disclosure=section?.querySelector('details');if(disclosure)disclosure.open=true;const inspector=section?.closest('aside');if(inspector)inspector.scrollTop=0;}},[workspace?.focusRequest]);
    const metadataDraft=!!(draft?.supportOnly || draft?.deploymentOnly);
    const conflicted = sourceConflicted || targetBlocked || metadataDraft;
    const draftConflicted = sourceConflicted || targetBlocked && !metadataDraft;

    useEffect(() => {
        let alive = true, received = false;
        const unsubscribe = window.electron.liveUi.subscribe(state => {
            received = true;
            if (alive) {setWorkspace(state); setConnectionError('');}
        });
        window.electron.liveUi.read(sessionId).then(state => {if (alive && !received) setWorkspace(state);}).catch(error => {if (alive) setConnectionError(error.message);});
        return () => {alive = false; unsubscribe(); draftGeneration.current++;};
    }, [sessionId]);
    useEffect(() => {
        let alive = true;
        setMetadata({status: 'loading'});
        window.electron.system.getFdoSdkDomMetadata().then(result => {
            if (!result?.success || !Array.isArray(result.metadata)) throw new Error(result?.error || 'SDK metadata is unavailable.');
            if (alive) setMetadata({...result, status: 'ready'});
        }).catch(error => {if (alive) setMetadata({status: 'error', message: error.message});});
        return () => {alive = false;};
    }, [metadataRetry]);
    useEffect(() => {
        if (!workspace) return;
        if (workspace.disconnected) {
            setPreview(lastReady.current || {status: 'error', message: 'The IDE disconnected before a preview was available. Reopen Live UI from the IDE.'});
            return;
        }
        const generation = ++latest.current;
        setPreview({status: 'loading'});
        const timer = setTimeout(() => {
            window.electron.liveUi.preview(sessionId, workspace.revision).then(result => {
                if (generation === latest.current && result.revision === workspace.revision && result.status !== 'stale') {
                    if (result.status === 'ready') lastReady.current = result;
                    setPreview(result);
                }
            }).catch(error => {if (generation === latest.current) setPreview({status: 'error', message: error.message});});
        }, 200);
        return () => {latest.current++; clearTimeout(timer);};
    }, [sessionId, workspace?.revision, workspace?.disconnected, retry]);
    useEffect(() => {if (!draft && !working) setSelectedId('');}, [workspace?.revision]);
    useEffect(() => {
        const selection = workspace?.selection;
        if (!selection || draft || working || preview.revision !== workspace.revision) return;
        const point = selection.line * 100000 + selection.column;
        const matches = elements.filter(item => item.location.path === selection.path && item.location.line * 100000 + item.location.column <= point && item.location.endLine * 100000 + item.location.endColumn >= point);
        matches.sort((a, b) => (a.location.endLine - a.location.line) * 100000 + a.location.endColumn - a.location.column - ((b.location.endLine - b.location.line) * 100000 + b.location.endColumn - b.location.column));
        if (matches[0]) setSelectedId(matches[0].id);
    }, [workspace?.selection, preview.revision]);
    useEffect(() => {
        const containing = surface?.tree.find(item => item.id === selectedId)?.dialogId;
        if (containing) setDialogId(containing);
        else if (selectedId || !surface?.dialogs.some(item => item.id === dialogId)) setDialogId('');
    }, [surface, selectedId]);
    useEffect(() => {
        const onMessage = event => {
            if (event.source !== iframe.current?.contentWindow || event.origin !== 'null' || event.data?.token !== surface?.token) return;
            if (event.data.type === 'fdo-ui-ready') {setReadyToken(event.data.token); return;}
            if (event.data.type === 'fdo-ui-dialog-closed' && event.data.id === activeDialogId) {setDialogId(''); return;}
            if (working || conflicted) return;
            if (event.data.type === 'fdo-ui-local-result' && ['ran','reset','loading','success','error'].includes(event.data.status)
                && (event.data.status === 'reset' || elements.some(item=>item.id === event.data.id && item.localActionSimulation))) setSimulation({token:surface.token,id:event.data.id,status:event.data.status});
            if (event.data.type === 'fdo-ui-select' && elements.some(item => item.id === event.data.id)) chooseElement(event.data.id);
            if (event.data.type === 'fdo-ui-hotkey' && ['ArrowUp', 'ArrowDown'].includes(event.data.key)) {
                document.dispatchEvent(new KeyboardEvent('keydown', {key: event.data.key, code: event.data.key, altKey: true, bubbles: true, cancelable: true}));
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [surface, elements, draft, working, conflicted, activeDialogId]);
    const highlight = () => {
        iframe.current?.contentWindow?.postMessage({type: 'fdo-ui-ready-check', token: surface?.token}, '*');
        iframe.current?.contentWindow?.postMessage({type: 'fdo-ui-dialog', token: surface?.token, id: activeDialogId}, '*');
        iframe.current?.contentWindow?.postMessage({type: 'fdo-ui-highlight', token: surface?.token, id: selectedId, state: mode === 'css' ? cssState : 'base'}, '*');
    };
    useEffect(highlight, [surface, selectedId, cssState, mode, activeDialogId, readyToken]);
    useEffect(() => {
        // A draft can replace srcDoc before the new frame installs its bridge.
        // Deliver explicit previews only to their authenticated document.
        if (!framePreviewCommand || framePreviewCommand.token !== surface?.token || readyToken !== surface.token) return;
        iframe.current?.contentWindow?.postMessage(framePreviewCommand, '*');
    }, [framePreviewCommand, surface?.token, readyToken]);
    useEffect(() => {
        const retainCss = inspectedId.current === selectedId && (mode === 'css' || cssEditIntent.current) && editableStyle(selected?.styles?.[styleIndex]);
        if (inspectedId.current !== selectedId) {
            cssEditIntent.current = false;
            setCssScope('element'); setCssState('base'); setCssBreakpoint(null); setBreakpointTouched(false); setClassNameTouched(false); setNewClassName(selected ? selected.tag + '-style' : '');
            setNewStyleFile(selected?.styleSheets?.[0]?.file || '');
        }
        inspectedId.current = selectedId;
        const nextIndex = retainCss ? styleIndex : Math.max(0, selected?.styles?.findIndex(editableStyle) ?? 0);
        const nextStyle = selected?.styles?.[nextIndex];
        const nextContext = cssBreakpoint == null ? nextStyle : nextStyle?.responsive?.find(item => sameBreakpoint(item.breakpoint, cssBreakpoint));
        const nextRule = cssState === 'base' ? nextContext : nextContext?.states?.find(item => item.state === cssState);
        const nextProperty = retainCss && nextRule && (nextRule.declarations.some(item => item.property === property) || (nextRule.canAddDeclarations && isVisualCssProperty(property) && !nextRule.presentProperties?.includes(property))) ? property : '';
        setStyleIndex(nextIndex); setProperty(nextProperty); setMode(retainCss ? 'css' : selected?.text || selected?.htmlLiteral ? 'text' : 'css');
        setValue(retainCss ? nextRule?.declarations.find(item => item.property === nextProperty)?.value || '' : selected?.text?.value || '');
        setAssignedStyle(''); setEditError('');
    }, [selectedId, display]);
    useEffect(() => {
        if (focusNewStyle.current && mode === 'css' && !working) {
            document.getElementById('visual-property')?.focus(); focusNewStyle.current = false;
        }
    }, [display, mode, working, cssBreakpoint, cssState]);
    const focus = async () => {
        try {const result = await window.electron.liveUi.focusIde(sessionId); if (!result.success) setEditError(result.error);}
        catch (error) {setEditError(error.message);}
    };
    const reveal = async () => {
        try {await window.electron.liveUi.reveal(sessionId, preview.revision, selectedId);}
        catch (error) {setEditError(error.message);}
    };
    const revealBinding = async target => {
        try {await window.electron.liveUi.reveal(sessionId,preview.revision,selectedId,target);}
        catch(error){setEditError(error.message);}
    };
    const editWithAi = async () => {
        try {await window.electron.liveUi.editWithAi(sessionId, preview.revision, selectedId);}
        catch (error) {setEditError(error.message);}
    };
    const propose = async (operation = {}) => {
        const supportRequest = ['compatibility','deployment'].includes(operation.kind);
        const detailedRequest = supportRequest || operation.kind === 'sdk-handler';
        const policyOperation = ['compatibility','deployment'].includes(operation.kind) || metadataDraft && ['undo', 'redo'].includes(operation.kind);
        if (proposalBusy.current || working || sourceConflicted || (targetBlocked || metadataDraft) && !policyOperation || workspace?.disconnected) {
            return detailedRequest ? {status: 'busy', message: workspace?.disconnected ? 'Reconnect to the IDE to change workspace source.'
                : sourceConflicted ? 'The workspace changed. Resolve or discard the existing draft before trying again.' : 'Wait for the current operation to finish, then try again.'} : false;
        }
        proposalBusy.current = true;
        const generation = ++draftGeneration.current;
        const selectionGeneration = selectionIntent.current.generation;
        setWorking('preview'); setEditError(''); setFeedback('');
        // Validation failures intentionally share this boundary with operation failures.
        try {
            if (!operation.kind && mode === 'css' && isolationBlocked) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(isolationBlocked);
            }
            if (!operation.kind && mode === 'css' && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports(property, value)) {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error('This is not a valid CSS value for ' + property + '.');
            }
            const result = await window.electron.liveUi.propose(sessionId, {revision: workspace.revision, elementId: selectedId, draftId: draft?.id, kind: mode, value, component,
                styleFile: selectedStyle?.file, styleKey: selectedStyle?.key, property, scope: cssScope, state: cssState, breakpoint: cssBreakpoint, ...operation});
            if (generation !== draftGeneration.current) return;
            if (detailedRequest && result.status !== 'ready') return result;
            if (result.status !== 'ready') {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(result.message || 'Could not prepare this edit.');
            }
            setDraft(result); setSupportAcknowledged(false);
            if (selectionIntent.current.generation !== selectionGeneration) setSelectedId(result.selectionMap?.[selectionIntent.current.id] || '');
            else if (result.selectedId !== undefined) setSelectedId(result.selectedId);
            if (!draft) setKeepCheckpoint(false);
            if (operation.kind === 'style') {setCssScope('element'); setCssState('base'); setCssBreakpoint(null);}
            if (operation.kind === 'css' && operation.action === 'create-rule') {
                cssEditIntent.current = true; setMode('css'); setCssState('base');
                setCssBreakpoint(operation.breakpoint); setPreviewWidth(breakpointPreviewWidth(operation.breakpoint));
                setProperty(''); setValue(''); focusNewStyle.current = true;
            }
            if (operation.kind === 'create-style') {
                cssEditIntent.current = true;
                setCssScope('element'); setCssState('base'); setCssBreakpoint(null); setStyleIndex(0); setProperty(''); setValue(''); setMode('css'); focusNewStyle.current = true;
            }
            return detailedRequest ? {status: 'ready'} : true;
        } catch (error) {
            if (detailedRequest) return {status: 'error', message: error.message};
            if (generation === draftGeneration.current) setEditError(error.message);
            return false;
        }
        finally {proposalBusy.current = false; if (generation === draftGeneration.current) setWorking('');}
    };
    const chooseCustomBreakpoint = () => {
        setBreakpointTouched(true);
        if (working || conflicted || workspace?.disconnected || customWidthError || (!customWidthKnown && isolationBlocked)) return;
        const width = customBreakpoint;
        if (customWidthKnown) {
            cssEditIntent.current = true; setMode('css'); setCssState('base'); setCssBreakpoint(width); setPreviewWidth(breakpointPreviewWidth(width));
            setProperty(''); setValue('');
            focusNewStyle.current = !(sameBreakpoint(cssBreakpoint, width) && cssState === 'base' && mode === 'css');
            document.getElementById('visual-property')?.focus();
        } else propose({kind: 'css', action: 'create-rule', breakpoint: width, state: 'base'});
    };
    const canMoveUp = !working && !conflicted && !workspace?.disconnected && selected?.structure?.position?.up && !selected.structure.position.ambiguous;
    const canMoveDown = !working && !conflicted && !workspace?.disconnected && selected?.structure?.position?.down && !selected.structure.position.ambiguous;
    moveHandler.current = direction => {
        if (direction === 'up' ? canMoveUp : canMoveDown) propose({kind: 'move', direction});
    };
    const hotkeys = useMemo(() => ['up', 'down'].map(direction => ({
        combo: 'alt+arrow' + direction, label: 'Move selected element ' + direction, group: 'Live UI editor', global: true,
        allowInInput: false, preventDefault: true, disabled: !(direction === 'up' ? canMoveUp : canMoveDown),
        onKeyDown: event => {if (!event.repeat) moveHandler.current(direction);},
    })), [canMoveUp, canMoveDown]);
    useHotkeys(hotkeys);
    const apply = async () => {
        setWorking('apply'); setEditError('');
        // Validation failures intentionally share this boundary with operation failures.
        try {
            const result = await window.electron.liveUi.apply(sessionId, draft.id, {keepCheckpoint, ...(draft.supportOnly ? {confirmSupportChange: supportAcknowledged} : {})});
            if (result.status !== 'applied') {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(result.message || 'The edit was not applied.');
            }
            setDraft(null); setSelectedId('');
            setFeedback((draft.deploymentOnly?'Deployment declaration applied. Rebuild and redeploy the plugin before exporting. ':draft.supportOnly ? 'Support declaration applied to the workspace. Rebuild and redeploy to update the installed plugin. ' : 'Applied. ')
                + 'Restore point: ' + result.restorePoint + '. Current snapshot: ' + result.snapshot + (result.changes ? '. ' + result.changes + ' design changes grouped' + (result.checkpointKept ? '; checkpoint kept' : '; working snapshot saved') : '') + (result.warning ? '. ' + result.warning : ''));
        } catch (error) {setEditError(error.message);}
        finally {setWorking('');}
    };
    const discard = async () => {
        setWorking('discard'); setEditError('');
        try {
            await window.electron.liveUi.discardDraft(sessionId, draft?.id);
            draftGeneration.current++; setDraft(null); setSelectedId('');
            setWorkspace(current => ({...current, recovery: null}));
            setFeedback('Draft discarded. Workspace files are unchanged.');
        } catch (error) {setEditError(error.message);}
        finally {setWorking('');}
    };
    const restoreDraft = async () => {
        setWorking('restore'); setEditError('');
        const generation = ++draftGeneration.current;
        // Validation failures intentionally share this boundary with operation failures.
        try {
            const result = await window.electron.liveUi.restoreDraft(sessionId);
            if (generation !== draftGeneration.current) return;
            if (result.status !== 'ready') {
                //noinspection ExceptionCaughtLocallyJS
                throw new Error(result.message || 'Could not restore the draft.');
            }
            setDraft(result); setSupportAcknowledged(false); setSelectedId(result.selectedId || ''); setKeepCheckpoint(false);
            setWorkspace(current => ({...current, recovery: null}));
            setFeedback('Visual draft restored. Review the changes, continue editing, or apply through IDE validation.');
        } catch (error) {if (generation === draftGeneration.current) setEditError(error.message);}
        finally {if (generation === draftGeneration.current) setWorking('');}
    };
    if (connectionError) return <NonIdealState icon="disconnected" title="Workspace unavailable" description={connectionError}/>;
    if (!workspace) return <NonIdealState icon={<Spinner/>} title="Connecting to IDE…"/>;
    const catalog = (metadata.metadata || []).map(item => ({item, methods: item.methods.filter(method => !method.uiSkip && (item.className.toLowerCase().includes(query.toLowerCase()) || (method.name + ' ' + (method.uiName || '')).toLowerCase().includes(query.toLowerCase())))})).filter(entry => entry.methods.length || entry.item.className.toLowerCase().includes(query.toLowerCase()));
    return <main className={'bp6-dark ' + styles.page}>
        <header className={styles.header}>
            <div><h1>Live UI · {workspace.name}</h1><p>Snapshot {workspace.snapshot || 'unsaved'} · Revision {workspace.revision.slice(0, 8)}</p></div>
            <Button icon="application" onClick={focus}>Show IDE</Button>
        </header>
        <div className={styles.workspaceRequirements}><PluginAuthoringContract context={workspace.authoringContract} disclosureComponent={EditorSection}>
            {workspace.authoringContract && <PluginSupportEditor context={draft?.supportOnly && draft.patches?.length
                ? {...workspace.authoringContract, declaredRequirements: draft.supportPolicy.requirements} : workspace.authoringContract}
                disabled={!!working || sourceConflicted || workspace.disconnected || !!draft && !draft.supportOnly} onReview={propose}/>}
        </PluginAuthoringContract></div>
        {workspace.disconnected && <Callout intent="warning" title="IDE disconnected">The last preview is retained. Reopen Live UI from the IDE to reconnect.</Callout>}
        {recovery && <Callout intent={recovery.status === 'available' ? 'primary' : 'warning'} title={recovery.status === 'available' ? 'Saved visual draft found' : 'Saved draft needs attention'}>
            <p>{recovery.message}</p>
            <Button icon="history" disabled={!!working || workspace.disconnected || recovery.status !== 'available'} loading={working === 'restore'} onClick={restoreDraft}>Restore visual draft</Button>{' '}
            <Button disabled={!!working} onClick={discard}>Discard saved draft</Button>
        </Callout>}
        {feedback && <Callout intent="success" role="status">{feedback}</Callout>}
        <div className={styles.layout}>
            <aside className={styles.catalog} aria-label="UI structure">
                <h2>Elements</h2>
                <p className="bp6-text-muted">Select in the preview or this list. Computed content stays editable in the IDE.</p>
                <div role="list" aria-label="Preview elements">
                    {(surface?.tree || []).map(item => <div role="listitem" key={item.id} style={{paddingLeft: item.depth * 10}}>
                        <Button variant="minimal" fill active={selectedId === item.id} disabled={!!working || sourceConflicted || workspace.disconnected} className={styles.element}
                            onClick={() => chooseElement(item.id)} text={item.label} title={item.location.path + ':' + item.location.line}/>
                    </div>)}
                </div>
                <EditorSection className={styles.sdk} title="SDK catalog" icon="code-block" description="Components and DOM helpers from your SDK">
                    {metadata.status === 'loading' ? <Spinner size={20}/> : metadata.status === 'error' ? <Callout intent="warning" title="SDK metadata unavailable">{metadata.message}<Button onClick={() => setMetadataRetry(v => v + 1)}>Retry metadata</Button></Callout> : <>
                        <p>Installed SDK {metadata.sdkVersion} · {(metadata.components || []).length} components · {(metadata.metadata || []).length} helper classes</p>
                        <InputGroup aria-label="Search SDK catalog" placeholder="Search SDK…" value={query} onValueChange={setQuery}/>
                        <SdkComponentCatalog components={metadata.components || []} elements={elements} selected={selected} disabled={!!working || conflicted || workspace.disconnected} query={query} onAdd={identity=>propose({kind:'insert-sdk-component',component:identity})} onSelect={chooseElement}/>
                        {metadata.authoringContracts?.components && metadata.authoringContracts.components.status !== 'supported' && <Callout intent="warning" title="SDK components unavailable">{metadata.authoringContracts.components.message || 'This installed SDK has no supported component contract. DOM helpers remain available.'}</Callout>}
                        {catalog.length === 0 && !(metadata.components || []).some(item=>(item.name + ' ' + item.identity + ' ' + item.create + ' ' + item.mount).toLowerCase().includes(query.toLowerCase())) && <NonIdealState icon="search" title={(metadata.metadata || []).length ? 'No matching SDK helpers' : 'No SDK helpers available'}/>}
                        {catalog.map(({item, methods}) => <EditorSection key={item.className} className={styles.helper} title={item.className} icon="code" description={methods.length + (methods.length === 1 ? " method" : " methods")}>
                            {item.constructors.map((ctor, index) => <p key={index}>new {item.className}({ctor.parameters.map(param => param.name + (param.optional ? '?' : '') + ': ' + param.type).join(', ')})</p>)}
                            {methods.map(method => <Card key={method.name} compact className={styles.method}><strong>{method.uiName || method.name}</strong><p>{method.description}</p><code>{method.name}({method.parameters.map(param => param.name + (param.optional ? '?' : '') + ': ' + param.type).join(', ')})</code><p>{method.returns}</p></Card>)}
                        </EditorSection>)}
                    </>}
                </EditorSection>
            </aside>
            <section className={styles.canvas} aria-label="UI preview">
                <div className={styles.toolbar}><Button icon="refresh" disabled={workspace.disconnected || !!draft || !!working} onClick={() => setRetry(v => v + 1)}>Refresh preview</Button><div className={styles.previewControls}>{previewWidth != null && <><Tag minimal>{previewWidth}px viewport</Tag><Button size="small" onClick={() => setPreviewWidth(null)}>Fit preview</Button></>}<Tag minimal>Selection mode · Local action simulation</Tag></div></div>
                {!!surface?.dialogs.length && <div className={styles.dialogControls} aria-label={overlayLabel + ' design preview'}>
                    <FormGroup label={overlayLabel + ' preview'} labelFor="visual-dialog-preview"><HTMLSelect id="visual-dialog-preview" value={activeDialogId} disabled={!!working || conflicted || workspace.disconnected}
                        options={[{value: '', label: overlayLabel === 'Dialog' ? 'Dialogs closed' : 'Overlays closed'}, ...surface.dialogs.map(item => ({value: item.id, label: (item.overlayKind === 'popover' ? 'Popover · ' : item.overlayKind === 'custom-dialog' ? 'Custom dialog · ' : '') + item.label + ' · ' + item.location.path + ':' + item.location.line}))]}
                        onChange={event => {if (event.target.value) chooseElement(event.target.value); else setDialogId('');}}/></FormGroup>
                    <Button icon="repeat" disabled={!activeDialogId || !!working || !previewReady} onClick={() => iframe.current?.contentWindow?.postMessage({type: 'fdo-ui-replay-overlay', token: surface?.token, id: activeDialogId}, '*')}>Replay entrance</Button>
                    <Button icon="cross" disabled={!activeDialogId || !!working} onClick={() => setDialogId('')}>Close {overlayLabel.toLowerCase()} preview</Button>
                    <small>Design preview only. Select an overlay child to reveal it. Escape closes the preview; plugin handlers are not run.</small>
                    {activeOverlay?.overlayKind === 'custom-dialog' && <small>Reveals this root only; authored positioning is retained. If its CSS still hides it, preview uses display: block. Other hidden ancestors, class toggles and custom backdrops are not simulated.</small>}
                </div>}
                <div className={styles.arrange} aria-label="Arrange selected element">
                    <span className="bp6-text-muted">{selected ? selected.label : 'Select an element to arrange'}</span>
                        {selected?.structure?.position && !selected?.structure.position.ambiguous && <FormGroup label="Position in container" labelFor="visual-position">
                            <HTMLSelect id="visual-position" fill value={String(selected?.structure.position.index)} disabled={!!working || conflicted || workspace.disconnected} onChange={event => propose({kind: 'move', index: Number(event.target.value)})}
                                options={Array.from({length: selected?.structure.position.count}, (_, index) => ({value: String(index), disabled:selected?.structure.position.allowedIndices ? !selected.structure.position.allowedIndices.includes(index) : false, label: String(index + 1) + (index === 0 ? ' · First' : index === selected?.structure.position.count - 1 ? ' · Last' : '')}))}/>
                        </FormGroup>}
                        {selected?.htmlLiteral && <Button icon="duplicate" disabled={!!working || conflicted || workspace.disconnected || !selected.structure?.duplicable} title="Duplicate static text without IDs or action bindings" onClick={() => propose({kind: 'duplicate'})}>Duplicate text</Button>}
                        <Button icon="arrow-up" disabled={!!working || conflicted || workspace.disconnected || !selected?.structure?.position?.up || selected?.structure?.position?.ambiguous} onClick={() => propose({kind: 'move', direction: 'up'})}>Move up</Button>{' '}
                        <Button icon="arrow-down" disabled={!!working || conflicted || workspace.disconnected || !selected?.structure?.position?.down || selected?.structure?.position?.ambiguous} onClick={() => propose({kind: 'move', direction: 'down'})}>Move down</Button>
                    {!!selected?.structure?.moveTargets?.length && <FormGroup label="Move to container" labelFor="visual-destination">
                        <HTMLSelect id="visual-destination" fill value="" disabled={!!working || conflicted || workspace.disconnected}
                            onChange={event => {if (event.target.value) propose({kind: 'move', destinationId: event.target.value});}}
                            options={[{value: '', label: 'Choose destination…'}, ...selected.structure.moveTargets.map(item => ({value: item.id, label: item.label + ' · ' + item.file + ':' + item.line}))]}/>
                    </FormGroup>}
                    {!!selected?.structure?.moveTargets?.length && <small>Move to container appends to the destination. Undo restores the previous container.</small>}
                    {selected?.structure?.moveReason && <small>{selected.structure.moveReason}</small>}
                    <small className={styles.shortcuts}><KeyComboTag combo="alt+arrowup"/> / <KeyComboTag combo="alt+arrowdown"/> Move selected element · outside text fields</small>
                </div>
                <div className={styles.previewViewport}>
                {display.status === 'loading' ? <NonIdealState icon={<Spinner/>} title="Reading supported render code…"/> : display.status !== 'ready' ? <NonIdealState icon="code" title={display.status === 'unsupported' ? 'This render path needs a preview adapter' : 'Preview unavailable'} description={<div><p>{display.message}</p>{display.location && <code>{display.location.path}:{display.location.line}:{display.location.column}</code>}<p>Source is unchanged. Continue in the IDE.</p></div>} action={<Button onClick={focus}>Show IDE</Button>}/>
                    : <iframe key={surface.token} ref={iframe} title="Plugin UI preview" sandbox="allow-scripts" srcDoc={surface.document} className={styles.frame} style={previewWidth == null ? undefined : {width: previewWidth}} onLoad={highlight}/>}
                </div>
            </section>
            <aside className={styles.inspector} aria-label="Element inspector">
                <h2>Inspector</h2>
                <div className={styles.deploymentRequirements}><DeploymentRequirements context={draft?.deploymentOnly?draft.deploymentPolicy.assessment:workspace.deployment} disclosureComponent={EditorSection}
                    disabled={!!working || sourceConflicted || workspace.disconnected || !!draft && !draft.deploymentOnly} onReview={propose}
                    onAsk={!draft && !recovery?()=>window.electron.liveUi.editWithAi(sessionId,workspace.revision,'__deployment__'):undefined}/></div>
                <ActionManager actions={display.actions || []} disabled={!!working || conflicted || workspace?.disconnected} onPropose={propose}/>
                {editError && <Callout intent="danger" role="alert">{editError}</Callout>}
                {draft && <section className={styles.draft} aria-label="Draft changes">
                    {draft.durability?.saved === false ? <Callout intent="warning" title="Draft is only in this window">{draft.durability.message}</Callout>
                        : draft.durability?.saved && <p className="bp6-text-muted">Draft and Undo/Redo history saved locally. Reopen this workspace to recover unapplied changes.</p>}
                    {sourceConflicted && <Callout intent="warning" title="Source changed">This draft is based on an older revision. Discard it and select the element again.</Callout>}
                    <strong>{draft.patches?.length === 0 ? 'No unapplied changes' : `${draft.changedFileCount ?? draft.patches?.length ?? 1} changed ${(draft.changedFileCount ?? draft.patches?.length ?? 1) === 1 ? 'file' : 'files'}`}</strong>
                    <p>{draft.deploymentOnly?'Only deployment metadata will change. Review the package diff; no installer, login or cloud operation runs here.':draft.supportOnly ? 'Only the support declaration will change. Apply or discard this draft before making visual edits.' : 'Only source differences count here. Continue arranging or editing elements, then apply once.'}</p>
                    {draft.deploymentOnly && <Callout intent="primary" title="Review deployment declaration"><ul>{draft.deploymentPolicy.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></Callout>}
                    {draft.supportOnly && <Callout intent={draft.supportPolicy.compatibility.status === 'incompatible' ? 'warning' : 'primary'} title="Review support policy">
                        <ul>{draft.supportPolicy.warnings.map(warning => <li key={String(warning)}>{String(warning)}</li>)}</ul>
                        <Checkbox checked={supportAcknowledged} disabled={!!working || draftConflicted}
                            onChange={event => setSupportAcknowledged(event.target.checked)}>I have reviewed these support claims and understand their compatibility impact.</Checkbox>
                    </Callout>}
                    {draft.historyTruncated && <p className="bp6-text-muted">Older Undo steps were dropped to keep this draft responsive. Discard still returns to the workspace version.</p>}
                    <Button icon="undo" disabled={!!working || draftConflicted || !draft.canUndo} onClick={() => propose({kind: 'undo'})}>Undo</Button>{' '}
                    <Button icon="redo" disabled={!!working || draftConflicted || !draft.canRedo} onClick={() => propose({kind: 'redo'})}>Redo</Button>
                    <Checkbox checked={keepCheckpoint} disabled={!!working || draftConflicted} onChange={event => setKeepCheckpoint(event.target.checked)}>Keep this change as a checkpoint</Checkbox>
                    <Button fill intent="primary" icon="tick" loading={working === 'apply'} disabled={draftConflicted || !!working || draft.supportOnly && !supportAcknowledged || !(draft.patches?.length ?? !!draft.patch)} onClick={apply}>Apply to workspace</Button>
                    <Button fill disabled={!!working} onClick={discard}>Discard draft</Button>
                    <EditorSection title="Source diff" icon="comparison" description="Review source and CSS changes">
                        {(draft.patches || (draft.patch ? [draft.patch] : [])).map(patch => <div key={patch.file}><p>{patch.description}</p><code>{patch.file}</code><pre className={styles.diff} aria-label="Source diff">{'− ' + patch.removed + '\n+ ' + patch.added}</pre></div>)}
                    </EditorSection>
                    <p className="bp6-text-muted">Apply validates all changed files and saves one working snapshot. Its restore point undoes the whole group; keep checkpoints for milestones. Draft Undo/Redo does not change workspace history.</p>
                </section>}
                {!selected ? <NonIdealState icon="select" title="Select an element" description="Select another element to continue this draft, or inspect its source."/> : <>
                    <p><strong>{selected.label}</strong></p><code>{selected.location.path}:{selected.location.line}</code>
                    <Button fill icon="code" disabled={!!working || sourceConflicted || workspace.disconnected || !!draft} title={draft ? 'Apply or discard the draft before showing workspace source' : undefined} onClick={reveal}>Show in code</Button>
                    <Button fill icon="predictive-analysis" disabled={!!working || sourceConflicted || workspace.disconnected || !!draft}
                        title={draft ? 'Apply or discard the draft before editing with AI' : 'Select this source in the coding assistant. Your prompt stays unchanged until you submit.'}
                        onClick={editWithAi}>Edit with AI</Button>
                    {selected.htmlLiteral && <Callout icon="code" title="Source-mapped HTML">Edit plain text here, or labels and hints under Element attributes. Style overrides are below. Supported siblings can be reordered above. Duplicate text copies passive text without identity or bindings; shared classes are retained. Other insertions, removals and binding changes remain in the IDE.</Callout>}
                    {selected.htmlLiteral && <HtmlInlineStyleEditor key={"inline-" + selectedId} element={selected} properties={cssProperties} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    {containingComponent && <Button fill icon="layout-hierarchy" onClick={() => {if(containingItem) rememberItem(containingComponent,containingItem.key);focusComponentContent.current = true; chooseElement(containingComponent.id);}}>Edit {containingComponent.sdkComponent.name} content</Button>}
                    {containingItem && <small className="bp6-text-muted">Return to {containingItem.label} in {containingComponent.sdkComponent.name}.</small>}
                    {selected.sdkComponent && <SdkComponentEditor rememberedItemKey={collectionContext.get(sdkComponentContextKey(selected,elements))} onItemSelect={key=>rememberItem(selected,key)} key={sdkComponentContextKey(selected,elements)} onPreviewItem={key=>setFramePreviewCommand({type:'fdo-ui-collection-item',token:surface?.token,id:selectedId,key})} onPreviewState={state=>setFramePreviewCommand({type:'fdo-ui-component-state',token:surface?.token,id:selectedId,state})} onInspect={chooseElement} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    <EditorSection defaultOpen title="Structure" icon="layout-hierarchy" description="Add and arrange components">
                        {!selected.htmlLiteral && <>
                            <Button fill icon="duplicate" disabled={!!working || conflicted || workspace.disconnected || !selected.structure?.duplicable || selected.structure?.position?.ambiguous} title={selected.structure?.duplicateReason || 'Copy a unique inline SDK composition without IDs or bindings'} onClick={() => propose({kind: 'duplicate'})}>Duplicate element</Button>
                            <p className="bp6-text-muted">{selected.structure?.duplicable ? `Copies ${selected.structure.duplicateElementCount || 1} SDK element(s), including supported nested content. The copy is selected for editing; stylesheet classes remain shared.` : selected.structure?.duplicateReason || 'Select an inline SDK element or container whose entire content has no IDs, bindings, active controls or shared declarations.'}</p>
                        </>}
                        {selected.structure?.container ? <>
                            <FormGroup label="Add component" labelFor="visual-component"><HTMLSelect id="visual-component" fill value={component} disabled={!!working} onChange={event => setComponent(event.target.value)} options={[{value: 'container', label: 'Container'}, {value: 'text', label: 'Text'}, {value: 'input', label: 'Textarea (multiline)'}, {value:'singleLineInput',label:'Input (single line)'}, {value: 'button', label: 'Button (unconnected)'}, {value: 'result', label: 'Result panel'}]}/></FormGroup>
                            <Button fill icon="add" disabled={!!working || conflicted || workspace.disconnected} onClick={() => propose({kind: 'insert'})}>Preview addition</Button>
                            <p className="bp6-text-muted">Adds inside this container. Assign an existing stylesheet class or create a new one below. Buttons stay disabled until connected to an existing click action below or wired in code.</p>
                        </> : <p className="bp6-text-muted">Select a static container to add components.</p>}
                        <Button fill intent="danger" variant="minimal" icon="trash" disabled={!!working || conflicted || workspace.disconnected || !selected.structure?.removable} onClick={() => propose({kind: 'remove'})}>Preview removal</Button>
                        {!selected.structure?.removable && <p className="bp6-text-muted">{selected.structure?.reason || 'This structure needs an adapter. Use Show in code.'}</p>}
                    </EditorSection>
                    {selected.tag === 'button' && <SdkOverlayOpenerEditor element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    {selected.tag === 'button' && <SdkToastActionEditor element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    {selected.tag === 'button' && <BackendActionEditor key={'backend-action-'+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    {selected.tag === 'button' && <LocalActionEditor key={'local-action-'+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    {selected.asyncAction && <SdkAsyncActionEditor key={'async-action-'+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>}
                    {selected.sdkBindings && !['connected','available'].includes(selected.actionConnection?.status)
                        && selected.overlayOpener?.status !== 'connected' && selected.toastAction?.status !== 'connected' && !selected.asyncAction &&
                        <ExistingBindingEditor key={'bindings-'+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected}
                            sourceDisabled={!!working || sourceConflicted || workspace.disconnected || !!draft} onPropose={propose} onReveal={revealBinding}/>}
                    {selected.tag === 'button' && ['connected','available'].includes(selected.actionConnection?.status) && selected.overlayOpener?.status !== 'connected' && selected.toastAction?.status !== 'connected' && <EditorSection defaultOpen title="Click action" icon="link" description="Reuse existing frontend behavior">
                        {selected.actionConnection?.status === 'connected' ? <>
                            <Callout intent="success" title={'Connected to ' + selected.actionConnection.handler}>Preview clicks select elements. Changes and disconnection can be undone before Apply.</Callout>
                            {selected.actionConnection.editable ? <>
                                <FormGroup label="Change click action" labelFor="visual-change-action"><HTMLSelect id="visual-change-action" fill value={selected.actionConnection.handler} disabled={!!working || conflicted || workspace.disconnected}
                                    onChange={event => propose({kind: 'connect-action', handler: event.target.value})}
                                    options={[...new Set([selected.actionConnection.handler, ...selected.actionConnection.handlers.map(handler => handler.name)])].map(name => ({value: name, label: name + ' · click'}))}/></FormGroup>
                                <Button fill icon="unlink" disabled={!!working || conflicted || workspace.disconnected} onClick={() => propose({kind: 'disconnect-action'})}>Disconnect action</Button>
                                <p className="bp6-text-muted">Disconnecting removes this button’s binding and disables it. Existing handlers and other controls stay unchanged.</p>
                            </> : <p className="bp6-text-muted">{selected.actionConnection.reason}</p>}
                        </> : selected.actionConnection?.status === 'available' ? <>
                            <FormGroup label="Connect existing click action" labelFor="visual-click-action"><HTMLSelect id="visual-click-action" fill value="" disabled={!!working || conflicted || workspace.disconnected}
                                onChange={event => {if (event.target.value) propose({kind: 'connect-action', handler: event.target.value});}}
                                options={[{value: '', label: 'Choose an action…'}, ...selected.actionConnection.handlers.map(handler => ({value: handler.name, label: handler.name + ' · click'}))]}/></FormGroup>
                            <p className="bp6-text-muted">Selecting an action connects and enables this button in the draft. Reuses the action’s existing inputs and result targets. Preview clicks only select elements.</p>
                        </> : null}
                    </EditorSection>}
                    <BackendResultEditor key={'result-mapping-'+surface?.token+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>
                    {selected.localActionSimulation && <ActionSimulationEditor key={surface?.token+selectedId} backend={selected.localActionSimulation.kind === 'backend-request' ? selected.localActionSimulation : null} disabled={!!working || conflicted || workspace.disconnected || !previewReady}
                        status={simulation?.token === surface?.token && (!simulation.id || simulation.id === selectedId) ? simulation.status : ''}
                        onSend={message=>iframe.current?.contentWindow?.postMessage({...message,token:surface?.token,id:selectedId},'*')}/>}
                    <ClassNamesEditor key={'classes-'+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>
                    <InputKindEditor key={'input-kind-'+selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>
                    <AttributeEditor key={selectedId} element={selected} disabled={!!working || conflicted || workspace.disconnected} onPropose={propose}/>
                    <EditorSection defaultOpen title="Stylesheet class" icon="style" description="Reuse or create styles">
                        {selected.styleAssignment && selected.availableStyles?.length ? <>
                            <FormGroup label="Assign existing class" labelFor="visual-style-class"><HTMLSelect id="visual-style-class" fill value={assignedStyle} disabled={!!working || conflicted} onChange={event => setAssignedStyle(event.target.value)}
                                options={[{value: '', label: 'Choose a class…'}, ...selected.availableStyles.map((style, index) => ({value: String(index), label: '.' + style.key + ' · ' + style.file}))]}/></FormGroup>
                            <Button fill icon="style" disabled={!!working || conflicted || workspace.disconnected || assignedStyle === ''} onClick={() => {const style = selected.availableStyles[Number(assignedStyle)]; propose({kind: 'style', styleFile: style.file, styleKey: style.key});}}>Preview style assignment</Button>
                            <p className="bp6-text-muted">Replaces this element’s class expression. Uses existing CSS on the same SDK DOM instance; stylesheet rules and other elements stay unchanged.</p>
                        </> : <p className="bp6-text-muted">Visual assignment needs static, unshared attributes, an imported stylesheet, and the DOM instance that emits this element’s HTML. Use Show in code for other patterns.</p>}
                        {selected.styleAssignment && selected.styleSheets?.length > 0 && <EditorSection title="Create a new class" icon="add" description="Name a style for this element">
                            <FormGroup label="Stylesheet for new class" labelFor="visual-new-style-file"><HTMLSelect id="visual-new-style-file" fill value={newStyleFile} disabled={!!working || conflicted} options={selected.styleSheets.map(sheet => ({value: sheet.file, label: sheet.file}))} onChange={event => setNewStyleFile(event.target.value)}/></FormGroup>
                            <FormGroup label="New class name" labelFor="visual-new-style-name" intent={classNameTouched && newClassError ? 'danger' : 'none'}
                                helperText={<span id="visual-new-style-help">Start with a letter; use letters, numbers, hyphens or underscores. Maximum 80 characters. No leading dot or spaces.</span>}>
                                <InputGroup id="visual-new-style-name" value={newClassName} disabled={!!working || conflicted} intent={classNameTouched && newClassError ? 'danger' : 'none'}
                                    aria-invalid={!!(classNameTouched && newClassError)} aria-describedby={'visual-new-style-help' + (classNameTouched && newClassError ? ' visual-new-style-error' : '')}
                                    onBlur={() => setClassNameTouched(true)} onValueChange={name => {setClassNameTouched(true); setNewClassName(name);}}/>
                                {classNameTouched && newClassError && <span id="visual-new-style-error" role="alert" className={styles.fieldError}>{newClassError}</span>}
                            </FormGroup>
                            <p className="bp6-text-muted">Creates an empty CSS rule and replaces this element’s class assignment. Existing names receive -2, -3, and so on; other elements stay unchanged.</p>
                            <Button fill icon="add" disabled={!!working || conflicted || workspace.disconnected || !newStyleFile || !!newClassError} onClick={() => propose({kind: 'create-style', styleFile: newStyleFile, className: newClassName})}>Create and edit class</Button>
                        </EditorSection>}
                    </EditorSection>
                    <FormGroup label="Edit" labelFor="visual-edit-kind"><HTMLSelect id="visual-edit-kind" fill value={mode} disabled={!!working} options={[{value: 'text', label: 'Plain text', disabled: !selected.text}, {value: 'css', label: 'CSS declaration', disabled: !selected.styles?.some(editableStyle)}]} onChange={event => {cssEditIntent.current = event.target.value === 'css'; setMode(event.target.value); setValue(event.target.value === 'text' ? selected.text?.value || '' : ''); setProperty('');}}/></FormGroup>
                    {mode === 'text' ? selected.text ? <FormGroup label="Text" labelFor="visual-text"><TextArea id="visual-text" fill value={value} maxLength={2000} disabled={!!working} onChange={event => setValue(event.target.value)}/>{selected.text.partial && <p className="bp6-text-muted">Edits only this element’s direct text. Nested icons, controls and markup stay unchanged.</p>}{textUses > 1 && <p className="bp6-text-muted">This text source is shared by {textUses} rendered elements.</p>}</FormGroup> : <p>This content is computed or contains markup. Use Show in code.</p> : <>
                        <FormGroup label="Style source" labelFor="visual-style"><HTMLSelect id="visual-style" fill value={String(styleIndex)} disabled={!!working} options={(selected.styles || []).map((style, index) => ({value: String(index), label: style.selector + ' · ' + style.file}))} onChange={event => {setStyleIndex(Number(event.target.value)); setCssScope('element'); setCssState('base'); setCssBreakpoint(null); setProperty(''); setValue('');}}/></FormGroup>
                        <FormGroup label="Responsive rule" labelFor="visual-css-breakpoint"><HTMLSelect id="visual-css-breakpoint" fill value={cssBreakpoint == null ? 'all' : breakpointOptionValue(cssBreakpoint)} disabled={!!working || conflicted} options={[{value: 'all', label: 'All widths'}, ...breakpointChoices.map(context => ({value: breakpointOptionValue(context.breakpoint), label: breakpointLabel(context.breakpoint) + (context.missing ? ' · Not in draft' : '')}))]} onChange={event => {const context = breakpointChoices.find(item => breakpointOptionValue(item.breakpoint) === event.target.value); const width = context?.breakpoint ?? null; setCssBreakpoint(width); if (width != null) setPreviewWidth(breakpointPreviewWidth(width)); setProperty(''); setValue('');}}/></FormGroup>
                        <EditorSection title="Custom breakpoint" icon="mobile-phone" description="Choose minimum, maximum or a width range">
                            <FormGroup label="Rule type" labelFor="visual-custom-rule-type"><HTMLSelect id="visual-custom-rule-type" fill value={customRuleType} disabled={!!working || conflicted} options={[{value: 'max', label: 'Maximum width · Narrower'}, {value: 'min', label: 'Minimum width · Wider'}, {value: 'range', label: 'Width range · Between'}]} onChange={event => {setCustomRuleType(event.target.value); setBreakpointTouched(false);}}/></FormGroup>
                            <FormGroup label={customRuleType === 'max' ? 'Maximum viewport width' : 'Minimum viewport width'} labelFor="visual-custom-width" intent={breakpointTouched && customWidthError ? 'danger' : 'none'}
                                helperText={<span id="visual-custom-width-help">Whole pixels, from 1 to 10000. {customRuleType === 'max' ? 'Applies at this width and narrower.' : customRuleType === 'min' ? 'Applies at this width and wider.' : 'Both ends of the range are included.'}</span>}>
                                <InputGroup id="visual-custom-width" value={customWidth} inputMode="numeric" disabled={!!working || conflicted} rightElement={<Tag minimal>px</Tag>}
                                    intent={breakpointTouched && customWidthError ? 'danger' : 'none'} aria-invalid={!!(breakpointTouched && customWidthError)}
                                    aria-describedby={'visual-custom-width-help' + (breakpointTouched && customWidthError ? ' visual-custom-width-error' : '')}
                                    onBlur={() => setBreakpointTouched(true)} onValueChange={width => {setCustomWidth(width); setBreakpointTouched(true);}}
                                    onKeyDown={event => {if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {event.preventDefault(); chooseCustomBreakpoint();}}}/>
                                {breakpointTouched && customWidthError && <span id="visual-custom-width-error" role="alert" className={styles.fieldError}>{customWidthError}</span>}
                            </FormGroup>
                            {customRuleType === 'range' && <FormGroup label="Maximum viewport width" labelFor="visual-custom-upper-width" intent={breakpointTouched && customWidthError ? 'danger' : 'none'}>
                                <InputGroup id="visual-custom-upper-width" value={customUpperWidth} inputMode="numeric" disabled={!!working || conflicted} rightElement={<Tag minimal>px</Tag>}
                                    intent={breakpointTouched && customWidthError ? 'danger' : 'none'} aria-invalid={!!(breakpointTouched && customWidthError)}
                                    aria-describedby={'visual-custom-width-help' + (breakpointTouched && customWidthError ? ' visual-custom-width-error' : '')}
                                    onBlur={() => setBreakpointTouched(true)} onValueChange={width => {setCustomUpperWidth(width); setBreakpointTouched(true);}}
                                    onKeyDown={event => {if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {event.preventDefault(); chooseCustomBreakpoint();}}}/>
                            </FormGroup>}
                            <p className="bp6-text-muted">Creates an empty responsive rule in the chosen scope. Existing breakpoints are selected without changing code.</p>
                            <Button fill icon={customWidthKnown ? 'arrow-right' : 'add'} disabled={!!working || conflicted || workspace.disconnected || !!customWidthError || (!customWidthKnown && !!isolationBlocked)} onClick={chooseCustomBreakpoint}>{customWidthKnown ? 'Use breakpoint' : 'Create breakpoint'}</Button>
                        </EditorSection>
                        {cssBreakpoint != null && <Callout title={breakpointLabel(cssBreakpoint)}>
                            Edits apply only within this condition. Other layouts keep their rules. Overlapping conditions still use the normal CSS cascade.
                            {previewWidth !== breakpointPreviewWidth(cssBreakpoint) && <Button fill size="small" onClick={() => setPreviewWidth(breakpointPreviewWidth(cssBreakpoint))}>Preview at {breakpointPreviewWidth(cssBreakpoint)}px</Button>}
                            {breakpointBoundaryPreviews(cssBreakpoint).map(item => <Button key={item.width} fill size="small" onClick={() => setPreviewWidth(item.width)}>{item.label}: {item.width}px</Button>)}
                        </Callout>}
                        <FormGroup label="CSS state" labelFor="visual-css-state"><HTMLSelect id="visual-css-state" fill value={cssState} disabled={!!working || conflicted} options={CSS_STATES} onChange={event => {setCssState(event.target.value); setProperty(''); setValue('');}}/></FormGroup>
                        {cssState !== 'base' && <Callout title={CSS_STATES.find(item => item.value === cssState)?.label + ' style preview'}>Only the selected element previews this state. No actions or focus events run. Editing adds or changes this state combination. Focus visible also previews Focus. Complex selectors remain read-only.</Callout>}
                        <FormGroup label="Apply CSS to" labelFor="visual-css-scope"><HTMLSelect id="visual-css-scope" fill value={cssScope} disabled={!!working} options={[{value: 'element', label: 'This element only · Separate class'}, {value: 'shared', label: 'Shared class · Every use'}]} onChange={event => setCssScope(event.target.value)}/></FormGroup>
                        {cssScope === 'shared' ? <Callout intent="warning" title="Editing a shared class">Changes to {selectedStyle?.selector} affect every use, including uses outside this preview. {styleUses} {styleUses === 1 ? 'element is' : 'elements are'} visible here.</Callout>
                            : isolationBlocked ? <Callout intent="warning" title="Cannot isolate this element">{isolationBlocked}</Callout>
                            : <p className="bp6-text-muted">{selectedStyle?.draftLocal ? 'Editing the separate class created in this draft.' : 'The first change copies this class, including states and responsive styles, and assigns the copy only to this element. The original class stays unchanged.'}</p>}
                        {cssBreakpoint != null && !selectedContext && <Callout intent="warning" title="Breakpoint is not in this draft">Use Redo to restore its rule, or create this breakpoint again.</Callout>}
                        {writableStyle(selectedRule) ? <>
                            <FormGroup label="CSS property" labelFor="visual-property"><CssPropertyPicker properties={cssProperties} style={selectedRule} value={property} disabled={!!working || conflicted || workspace.disconnected}
                                onSelect={(name, currentValue) => {setProperty(name); setValue(currentValue); cssValueInput.current?.focus();}}/></FormGroup>
                            <p className="bp6-text-muted">Search names or hints. Enter selects and focuses the value; Enter in the value previews the change.</p>
                            <FormGroup label="CSS value" labelFor="visual-css-value"><InputGroup id="visual-css-value" inputRef={cssValueInput} value={value} disabled={!!working} onValueChange={setValue} placeholder={property ? 'Value for ' + property : 'Select a property first'}
                                onKeyDown={event => {if (event.key === 'Enter' && !event.repeat && !event.nativeEvent.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {event.preventDefault(); if (cssChanged) propose();}}}/></FormGroup>
                            <CssColorPicker property={property} value={value} disabled={!!working || conflicted || workspace.disconnected || !!isolationBlocked} onChange={setValue}/>
                            <CssLengthEditor property={property} value={value} disabled={!!working || conflicted || workspace.disconnected || !!isolationBlocked} onChange={setValue} onPreview={() => {if (cssChanged) propose();}}/>
                            <CssSpacingEditor property={property} value={value} disabled={!!working || conflicted || workspace.disconnected || !!isolationBlocked} onChange={setValue} onPreview={() => {if (cssChanged) propose();}}/>
                            {cssValuePresets(property).length > 0 && <div className={styles.valuePresets} aria-label="Common CSS values">{cssValuePresets(property).filter(preset => typeof CSS === 'undefined' || !CSS.supports || CSS.supports(property, preset)).map(preset => <Button key={preset} size="small" variant="minimal" disabled={!!working || conflicted} active={value === preset} title={'Use ' + preset} onClick={() => {setValue(preset); cssValueInput.current?.focus();}}>{preset}</Button>)}</div>}
                            {selectedRule.canAddDeclarations && property && !selectedRule.presentProperties.includes(property) && <p className="bp6-text-muted">Adds {property} to {selectedRule.selector}.</p>}
                            {selectedRule.selectorList && <p className="bp6-text-muted">This rule shares a selector list. Editing separates this class/state into its own rule and keeps the other branches. The edited branch follows them at the same source location.</p>}
                            <Button fill variant="minimal" intent="danger" icon="delete" disabled={!!working || conflicted || workspace.disconnected || !!isolationBlocked || !selectedRule.declarations.some(item => item.property === property)} onClick={() => propose({kind: 'css', action: 'remove'})}>Remove declaration</Button>
                            {property && selectedRule.declarations.some(item => item.property === property) && <small className="bp6-text-muted">Removes the {cssState === 'base' ? 'base' : cssState} {property} declaration in the chosen scope. Inherited, state or responsive rules may still supply its value.</small>}
                            <p className="bp6-text-muted">Other state and media rules remain intact and may override this value.</p>
                        </> : <p>{selectedRule?.reason || 'No supported stylesheet declaration is mapped to this element.'}</p>}
                    </>}
                    <Button fill intent="primary" icon="eye-open" loading={working === 'preview'} disabled={!!working || conflicted || workspace.disconnected || (mode === 'text' ? !selected.text || value === selected.text.value : !cssChanged || !!isolationBlocked)} onClick={() => propose()}>Preview change</Button>
                </>}
            </aside>
        </div>
    </main>;
}
