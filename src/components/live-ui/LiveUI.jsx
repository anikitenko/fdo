import React from 'react';
import {NonIdealState} from '@blueprintjs/core';
import {useLocation} from 'react-router-dom';
import {WorkspacePreview} from './WorkspacePreview';

export const LiveUI = () => {
    const session = new URLSearchParams(useLocation().search).get('session');
    if (session) return <WorkspacePreview sessionId={session}/>;
    return <NonIdealState icon="application" title="Open Live UI from the IDE" description="Open a plugin workspace and choose Live UI editor to connect its source."/>;
}
