import React from 'react';
import {Callout, ProgressBar} from '@blueprintjs/core';

const titles = {save: 'Verifying and saving repository', verify: 'Verifying repository', sync: 'Synchronizing plugins',
    syncPlugin: 'Checking plugin for updates', reviewUpdate: 'Applying update review', remove: 'Removing repository subscription'};
const phases = {starting: 'Preparing the operation…', verifying: 'Checking repository access and the collection manifest…',
    preparing: 'Preparing plugin checks…', finishing: 'Finishing repository synchronization…',
    reviewing: 'Applying the plugin update decision…', removing: 'Detaching installed plugins from this subscription…'};

export default function GitOpsProgress({operation}) {
    if (!operation) return null;
    const counted = operation.phase === 'synchronizing' && operation.total > 0;
    const completed = Math.max(0, Math.min(operation.completed || 0, operation.total || 0));
    const count = `${completed} of ${operation.total} ${operation.total === 1 ? 'plugin' : 'plugins'} checked`;
    return <Callout intent="primary" icon="git-pull" title={operation.automatic ? 'Automatic synchronization in progress' : titles[operation.kind] || 'GitOps operation in progress'}
        style={{margin: '12px 0'}} role="status" aria-live="polite">
        <p style={{margin: '0 0 8px', overflowWrap: 'anywhere'}}>
            <strong>{operation.repositoryName || 'Repository'}</strong>{' · '}
            {counted ? `Checking ${operation.pluginName} · ${count}` : phases[operation.phase] || phases.starting}
        </p>
        <ProgressBar intent="primary" animate stripes value={counted ? completed / operation.total : undefined}
            aria-label="GitOps progress"
            aria-valuetext={counted ? `${count}; checking ${operation.pluginName}` : phases[operation.phase] || phases.starting}/>
    </Callout>;
}
