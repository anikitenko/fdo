import React from 'react';
import {Icon} from '@blueprintjs/core';
import * as styles from './WorkspacePreview.module.css';

// Native disclosure keeps Enter/Space, focus and expanded-state semantics.
export function EditorSection({title, icon = 'folder-open', description, defaultOpen = false, className = '', children}) {
    return <details open={defaultOpen || undefined} className={`${styles.section} ${className}`}>
        <summary className={styles.sectionHeader}>
            <Icon icon={icon} className={styles.sectionIcon}/>
            <span className={styles.sectionHeading}><span>{title}</span>{description && <small>{description}</small>}</span>
            <Icon icon="chevron-right" className={styles.sectionChevron}/>
        </summary>
        <div className={styles.sectionBody}>{children}</div>
    </details>;
}
