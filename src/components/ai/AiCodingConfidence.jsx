import React from 'react';
import * as styles from './AiTimeEstimate.module.css';
export default function AiCodingConfidence({confidence}) {
    if (!confidence) return null;
    return <div className={styles.estimate} data-testid="ai-coding-confidence">
        <p role="status" aria-live="polite">Verification confidence: <strong>{confidence.label}</strong></p>
        <details>
            <summary>What supports this?</summary>
            <p>{confidence.detail}</p>
            {confidence.checks.length > 0 && <ul>{confidence.checks.map(check => <li key={check.id}>{check.label}: {check.status}</li>)}</ul>}
        </details>
    </div>;
}
