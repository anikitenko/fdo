import React from 'react';
import PropTypes from 'prop-types';
import {Callout} from '@blueprintjs/core';

function PlainDisclosure({title, children}) {
    return <details><summary>{title}</summary>{children}</details>;
}

export default function PluginAuthoringContract({context, disclosureComponent: Disclosure = PlainDisclosure, children}) {
    if (!context) return null;
    const {host, contract, compatibility} = context;
    return <section aria-label="Plugin target compatibility" style={{margin: '8px 0'}}>
        {compatibility.status === 'incompatible' && <Callout intent="danger" title="Plugin target needs attention">
            <p>{compatibility.summary}</p>
            <ul>{compatibility.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
            <p>Visual changes cannot be applied. {children ? 'Review the support settings below.' : 'Review the target declaration in the IDE.'} AI must preserve your support policy.</p>
        </Callout>}
        <Disclosure title={`${compatibility.declared ? 'Supported' : 'Build target'} FDO: ${compatibility.supportedFdo}`}
            icon="info-sign" description="Supported versions and host contract details">
            <p>{compatibility.summary}</p>
            <p>Installed FDO {host.fdo} · SDK {host.sdk} · Host API {host.api}</p>
            <p>Handshake {contract.contractVersion} · Capability schema {contract.capabilitySchemaVersion}</p>
            <p>Declare tested ranges in the plugin’s package.json under <code>fdo.compatibility</code>. A local build or static preview does not verify older hosts. SDK updates do not automatically change the host API contract.</p>
            {children}
        </Disclosure>
    </section>;
}

PluginAuthoringContract.propTypes = {context: PropTypes.object, disclosureComponent: PropTypes.elementType, children: PropTypes.node};
