import React, {useMemo} from 'react';
import {MenuItem} from '@blueprintjs/core';
import {Suggest} from '@blueprintjs/select';
import {cssPropertyInfo, filterCssProperties} from '../../utils/plugins/authoring/liveUi/cssProperties';
import * as styles from './WorkspacePreview.module.css';

export function CssPropertyPicker({properties, style, value, disabled, onSelect}) {
    const items = useMemo(() => {
        const existing = new Map((style?.declarations || []).map(item => [item.property, item]));
        const names = new Set(existing.keys());
        if (style?.canAddDeclarations) for (const name of properties) if (!style.presentProperties?.includes(name)) names.add(name);
        return [...names].map(name => ({name, existing: existing.has(name), value: existing.get(name)?.value || '', ...cssPropertyInfo(name)}));
    }, [properties, style]);
    return <><Suggest fill items={items} itemsEqual="name" selectedItem={items.find(item => item.name === value) || null}
        menuProps={{'aria-label': 'CSS properties'}} inputValueRenderer={item => item.name} itemListPredicate={filterCssProperties}
        resetOnQuery resetOnSelect closeOnSelect disabled={disabled}
        inputProps={{id: 'visual-property', 'aria-label': 'CSS property', placeholder: 'Search: spacing, round, bg col…', leftIcon: 'search', autoComplete: 'off', maxLength: 160}}
        popoverProps={{matchTargetWidth: true, minimal: true, shouldReturnFocusOnClose: false, popoverClassName: styles.propertyPopover}}
        itemRenderer={(item, {handleClick, handleFocus, modifiers}) => <MenuItem key={item.name} roleStructure="listoption" text={<span className={styles.propertyName}><code>{item.name}</code><small>{item.group}</small></span>}
            label={item.existing ? 'Existing' : 'Add'} title={item.group} active={modifiers.active} onClick={handleClick} onFocus={handleFocus}/>}
        noResults={<MenuItem disabled text="No matching properties"/>}
        onItemSelect={item => onSelect(item.name, item.value)}/><small className="bp6-text-muted">{items.length} available properties · Existing or Add</small></>;
}
