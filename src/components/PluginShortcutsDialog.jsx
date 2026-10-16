import React from 'react';
import {Button, Dialog, DialogBody, DialogFooter, NonIdealState, Switch} from '@blueprintjs/core';
import {movePluginUiItem, normalizePluginUiPreferences, orderPluginUiItems} from '../utils/plugins/runtime/pluginUiPreferences';
import * as styles from './css/PluginShortcutsDialog.module.css';

export function PluginShortcutsDialog({isOpen, onClose, actions, sidebarItems, preferences, onChange, storageError}) {
    const toggle = (field, id) => onChange({...preferences, [field]: preferences[field].includes(id)
        ? preferences[field].filter(value => value !== id) : [...preferences[field], id]});
    const pinned = orderPluginUiItems(actions.filter(action => preferences.pinnedActionIds.includes(action.id)), preferences.pinnedActionIds);
    const sidebar = orderPluginUiItems(sidebarItems.filter(item => !item.id.startsWith('system-')), preferences.sidebarOrder);
    const moveButtons = (items, field, item, index) => <div className={styles.order}>
        <Button size="small" variant="minimal" icon="chevron-up" aria-label={`Move ${item.name} up`} disabled={index === 0}
                onClick={() => onChange({...preferences, [field]: movePluginUiItem(items, preferences[field], item.id, -1)})}/>
        <Button size="small" variant="minimal" icon="chevron-down" aria-label={`Move ${item.name} down`} disabled={index === items.length - 1}
                onClick={() => onChange({...preferences, [field]: movePluginUiItem(items, preferences[field], item.id, 1)})}/>
    </div>;
    return <Dialog isOpen={isOpen} onClose={onClose} title="Plugin shortcuts" icon="layout" className="bp6-dark">
        <DialogBody>
            <p>Customize shortcuts from running plugins. Changes apply immediately and are remembered on this device.</p>
            {storageError && <p role="alert">Preferences could not be saved. Changes will last for this window only.</p>}
            <h3>Quickbar</h3>
            <p>Pin frequent actions to the top of command search. Open it with Ctrl+K or ⌘K.</p>
            {!actions.length && <NonIdealState icon="search" title="No plugin quick actions" description="Activate a plugin that registers quick actions."/>}
            {actions.map(action => <div className={styles.row} key={action.id}>
                <Switch checked={preferences.pinnedActionIds.includes(action.id)} onChange={() => toggle('pinnedActionIds', action.id)}
                        label={`Pin ${action.name}`}/>
                <span className={styles.owner}>Provided by {action.pluginName || action.section || action.pluginId}</span>
            </div>)}
            {pinned.length > 1 && <><h4>Pinned action order</h4>{pinned.map((action, index) => <div className={styles.row} key={action.id}>
                <span className={styles.name}>{action.name} · {action.pluginName || action.section || action.pluginId}</span>{moveButtons(pinned, 'pinnedActionIds', action, index)}
            </div>)}</>}
            <h3>Sidebar</h3>
            <p>Choose which plugin menus appear in the right sidebar and arrange their order. Use the sidebar toggle in the header to show it.</p>
            {!sidebar.length && <NonIdealState icon="panel-stats" title="No plugin sidebar menus" description="Activate a plugin that registers a side panel."/>}
            {sidebar.map((item, index) => <div className={styles.row} key={item.id}>
                <Switch checked={!preferences.hiddenSidebarIds.includes(item.id)} onChange={() => toggle('hiddenSidebarIds', item.id)} label={`Show ${item.name}`}/>
                <span className={styles.owner}>Provided by {item.pluginName || item.id}</span>
                {moveButtons(sidebar, 'sidebarOrder', item, index)}
            </div>)}
        </DialogBody>
        <DialogFooter actions={<><Button onClick={() => onChange(normalizePluginUiPreferences())}>Reset shortcuts</Button><Button intent="primary" onClick={onClose}>Done</Button></>}/>
    </Dialog>;
}
