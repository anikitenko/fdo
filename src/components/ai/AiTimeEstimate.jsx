import React from 'react';
import * as styles from './AiTimeEstimate.module.css';

export default function AiTimeEstimate({text, progress, details}) {
    if (!text) return null;
    return <div className={styles.estimate}>
        <p><strong>{text}</strong></p>
        {progress && <p>{progress}</p>}
        {details && <details>
            <summary>Estimate details</summary>
            <p>{details}</p>
        </details>}
        {details && <p><small>File generation estimate; validation and repairs may add time.</small></p>}
    </div>;
}
