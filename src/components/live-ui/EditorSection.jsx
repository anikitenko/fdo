import React from 'react';
import {Icon} from '@blueprintjs/core';
import * as styles from './WorkspacePreview.module.css';

// Native disclosure keeps Enter/Space, focus and expanded-state semantics.
export function EditorSection({title, icon = 'folder-open', description, defaultOpen = false, open, onToggle, compact = false, className = '', children}) {
    return <details open={open ?? (defaultOpen || undefined)} onToggle={onToggle ? event=>onToggle(event.currentTarget.open):undefined}
        className={`${styles.section} ${compact?styles.compactSection:''} ${className}`}>
        <summary className={styles.sectionHeader}>
            <Icon icon={icon} className={styles.sectionIcon}/>
            <span className={styles.sectionHeading}><span>{title}</span>{description && <small>{description}</small>}</span>
            <Icon icon="chevron-right" className={styles.sectionChevron}/>
        </summary>
        <div className={styles.sectionBody}>{children}</div>
    </details>;
}
