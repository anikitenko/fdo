import React, {useEffect, useState} from 'react';
import PropTypes from 'prop-types';
import {Icon, Tooltip} from '@blueprintjs/core';
import * as styles from './PluginLocation.module.css';

export default function PluginLocation({path}) {
    const [copying, setCopying] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState('');
    useEffect(() => {setCopied(false); setError('');}, [path]);
    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 2500);
        return () => clearTimeout(timer);
    }, [copied]);
    const copy = async () => {
        setCopying(true); setError('');
        try {await navigator.clipboard.writeText(path); setCopied(true);}
        catch {setError('Could not copy the path. Select it and copy it manually.');}
        finally {setCopying(false);}
    };
    return <div>
        <div className={styles.location}>
            <span>Loaded from:</span>
            <Tooltip className={styles.target} content={<div style={{maxWidth: 440, overflowWrap: 'anywhere'}}>
                <div>{path || 'Path unavailable'}</div><small>{copied ? 'Path copied' : 'Click to copy path'}</small>
            </div>}>
                <button type="button" className={styles.path} aria-label="Copy plugin path" disabled={!path || copying} onClick={copy}>
                    <code>{path || 'Path unavailable'}</code>{copied && <Icon icon="tick" size={12} intent="success" aria-hidden="true"/>}
                </button>
            </Tooltip>
        </div>
        <span role="status" className={styles.status}>{copied ? 'Path copied to clipboard.' : ''}</span>
        {error && <p role="alert" className="bp6-text-small">{error}</p>}
    </div>;
}

PluginLocation.propTypes = {path: PropTypes.string};
