import React from 'react';
import PropTypes from 'prop-types';
import {Callout} from '@blueprintjs/core';

export default function PluginCompatibilityNotice({report}) {
    if (!report) return null;
    return <Callout intent={report.status === 'incompatible' ? 'danger' : report.status === 'unverified' ? 'warning' : 'success'}
        title={`Supported FDO: ${report.supportedFdo}`} style={{marginTop: 12, marginBottom: 12}}>
        <p>{report.summary}</p>
        {report.currentFdo && <p>Your installation: FDO {report.currentFdo} · SDK {report.currentSdk}</p>}
        {report.builtWith && <p>Built with FDO {report.builtWith.fdo} · SDK {report.builtWith.sdk}</p>}
        {report.issues?.length > 0 && <ul>{report.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
        {report.remediation && <p>{report.remediation}</p>}
    </Callout>;
}

PluginCompatibilityNotice.propTypes = {report: PropTypes.object};
