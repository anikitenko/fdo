import React, {useEffect, useState, useRef, useImperativeHandle, forwardRef} from 'react';
import {Button, Callout, Card, Classes, FormGroup, HTMLSelect, InputGroup} from '@blueprintjs/core';
import {targetFromCapability, capability as sharedCapability} from '../../utils/plugins/runtime/sharedLogicContracts.cjs';

const serviceKey = service => `${service.providerId}/${service.name}/v${service.version}`;
const SharedLogicAccessReview = forwardRef(function SharedLogicAccessReview({pluginId, disabled, onApproved, declaredCapabilities = []}, ref) {
    const reviewRef = useRef(null);
    const [plugins, setPlugins] = useState([]), [services, setServices] = useState([]);
    const [providerId, setProvider] = useState(''), [name, setName] = useState(''), [version, setVersion] = useState('1');
    const [consumerProviderId, setConsumerProvider] = useState(''), [manual, setManual] = useState(false);
    const [requestProviders, setRequestProviders] = useState({});
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const consumer = plugins.find(plugin => plugin.id === pluginId);
    const requests = consumer?.sharedLogicRequests || [];
    const target = {providerId: providerId.trim(), name: name.trim(), version: Number(version)};
    const selected = services.find(service => serviceKey(service) === serviceKey(target));
    const compatible = value => services.filter(service => service.name === value.name && service.version === Number(value.version));
    const load = async () => {
        const [result, catalog] = await Promise.all([window.electron.plugin.getAll(), window.electron.plugin.listSharedLogic?.()]);
        setPlugins(result?.plugins || []);
        if (catalog?.success) setServices(catalog.services || []);
    };
    useEffect(() => {
        let disposed = false, pending = false;
        const poll = async () => {
            if (pending) return;pending = true;
            try {
                const [result, catalog] = await Promise.all([window.electron.plugin.getAll(), window.electron.plugin.listSharedLogic?.()]);
                if (!disposed) {setPlugins(result?.plugins || []);if (catalog?.success) setServices(catalog.services || []);}
            } catch {} finally {pending = false;}
        };
        setProvider('');setName('');setConsumerProvider('');setManual(false);setRequestProviders({});setNotice('');setError('');
        void poll();const timer = setInterval(poll, 3000);
        return () => {disposed = true;clearInterval(timer);};
    }, [pluginId]);
    const choose = service => {
        setProvider(service.providerId);setName(service.name);setVersion(String(service.version));setManual(false);setError('');setNotice('');
        const calls = [...[...(consumer?.capabilities || []), ...declaredCapabilities].map(targetFromCapability).filter(Boolean), ...requests]
            .filter(item => item.name === service.name && item.version === service.version && item.providerId !== service.providerId
                && !plugins.some(plugin => plugin.id === item.providerId));
        const aliases = [...new Set(calls.map(item => item.providerId))];
        setConsumerProvider(aliases.length === 1 ? aliases[0] : service.providerId);
    };
    useEffect(() => {
        if (providerId || manual) return;
        const granted = services.filter(service => consumer?.capabilities?.includes(sharedCapability(service)));
        if (granted.length === 1) choose(granted[0]);
    }, [providerId, manual, services, consumer?.capabilities]);
    useImperativeHandle(ref, () => ({createForCapability(capability) {
        const requested = targetFromCapability(capability);
        if (!requested) return;
        const exact = services.find(service => serviceKey(service) === serviceKey(requested));
        const options = compatible(requested);
        if (exact || options.length === 1) {choose(exact || options[0]);setConsumerProvider(requested.providerId);}
        else {setProvider(requested.providerId);setName(requested.name);setVersion(String(requested.version));setConsumerProvider(requested.providerId);setManual(true);}
        reviewRef.current?.scrollIntoView?.({block: 'start', behavior: 'smooth'});reviewRef.current?.focus({preventScroll: true});
    }}));
    const run = async action => {
        if (busy) return;setBusy(true);setError('');setNotice('');
        try {await action();await load();} catch (error) {setError(error.message);} finally {setBusy(false);}
    };
    const applied = async result => {
        if (!result?.success) throw new Error(result?.error || 'Could not save shared-service access.');
        await onApproved?.(result);
        if (result.runtimeRestartError) setNotice(`Access saved. Restart the consumer to apply it: ${result.runtimeRestartError}`);
        else setNotice('Access added. The consumer can use this service when the provider is running and has registered it.');
    };
    const callTarget = {...target, providerId: consumerProviderId.trim() || target.providerId};
    let alreadyGranted = false;
    try {
        const grants = consumer?.capabilities || [];
        alreadyGranted = grants.includes('plugins.shared.use') && grants.includes(sharedCapability(target)) && grants.includes(sharedCapability(callTarget))
            && (callTarget.providerId === target.providerId || consumer?.sharedLogicBindings?.some(binding => sharedCapability(binding) === sharedCapability(callTarget) && binding.installedProviderId === target.providerId));
    } catch {}
    const requestProvider = request => requestProviders[request.id] || (plugins.some(plugin => plugin.id === request.providerId) ? request.providerId
        : compatible(request).length === 1 ? compatible(request)[0].providerId : request.providerId);
    return <section ref={reviewRef} tabIndex={-1} data-testid="shared-logic-access-review" aria-label="Shared-service access">
        <Callout title="Add shared-service access" icon="exchange">
            <p>Choose a service and add access directly. Requests made by plugin code appear separately below for your approval.</p>
            <FormGroup label="Installed shared service" labelFor={`shared-service-${pluginId}`}>
                <HTMLSelect id={`shared-service-${pluginId}`} aria-label="Installed shared service" fill value={selected ? serviceKey(selected) : ''}
                    onChange={event => {const service = services.find(item => serviceKey(item) === event.target.value);if (service) choose(service);}}>
                    <option value="" disabled>Choose a service…</option>
                    {services.map(service => <option key={serviceKey(service)} value={serviceKey(service)}>{service.providerName || service.providerId} — {service.name} v{service.version} ({service.available ? 'available' : 'unavailable'})</option>)}
                </HTMLSelect>
            </FormGroup>
            {selected && <p className={Classes.TEXT_SMALL}>Installed provider: <strong>{plugins.find(plugin => plugin.id === providerId)?.metadata?.name || providerId}</strong> <code>{providerId}</code>.
                {!selected.available && ' The service is not registered by a running provider. Review the provider’s status and Provide shared logic permission.'}</p>}
            <Button variant="minimal" size="small" icon="edit" onClick={() => setManual(!manual)}>{manual ? 'Hide manual target' : 'Enter a service manually'}</Button>
            {manual && <div style={{display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12}}>
                <FormGroup label="Installed provider ID"><InputGroup aria-label="Shared provider plugin ID" value={providerId} onChange={event => {setProvider(event.target.value);setConsumerProvider(event.target.value);}}/></FormGroup>
                <FormGroup label="Service name"><InputGroup aria-label="Shared service name" value={name} onChange={event => setName(event.target.value)}/></FormGroup>
                <FormGroup label="Version"><InputGroup aria-label="Shared service version" value={version} onChange={event => setVersion(event.target.value)} style={{width: 80}}/></FormGroup>
            </div>}
            {providerId && name && <>
                <FormGroup label="Provider ID used by the consumer" helperText="Usually the installed ID. If the consumer uses an example or logical ID, keep it here to bind those calls to the selected provider.">
                    <InputGroup aria-label="Consumer provider ID" value={consumerProviderId} onChange={event => setConsumerProvider(event.target.value)}/>
                </FormGroup>
                {callTarget.providerId !== target.providerId && <Callout intent="primary" icon="link">Calls to <code>{callTarget.providerId}</code> / {name} v{version} will use installed provider <code>{target.providerId}</code>. This binding applies only to this consumer and this service version.</Callout>}
                {!plugins.some(plugin => plugin.id === providerId) && <p role="status">Provider “{providerId}” is not installed under this ID. Adding access grants permission only; install or select a provider to make calls available.</p>}
                <p className={Classes.TEXT_SMALL}>Adds Use shared logic and this service’s exact permissions. Other grants are preserved. A running consumer restarts to apply changes.</p>
                <Button intent="primary" icon="add" loading={busy} disabled={disabled || alreadyGranted} onClick={() => run(async () => {
                    await applied(await window.electron.plugin.grantSharedLogicAccess(pluginId, callTarget, target.providerId));
                })}>{alreadyGranted ? 'Access already added' : 'Add shared-service access'}</Button>
            </>}
            {disabled && <p>Save or discard other capability changes before adding access.</p>}
        </Callout>
        {notice && <Callout intent="success" role="status" style={{marginTop: 12}}>{notice}</Callout>}
        {error && <Callout intent="danger" role="alert" style={{marginTop: 12}}>{error}</Callout>}
        <h4 className={Classes.HEADING}>Requests from this plugin {requests.length > 0 && `(${requests.length})`}</h4>
        {!requests.length && <p className={Classes.TEXT_MUTED}>No requests awaiting approval.</p>}
        {requests.map(request => <Card key={request.id} data-shared-request-capability={request.capability} style={{marginBottom: 12}}>
            <strong>{request.name} v{request.version}</strong><p>Requested provider ID: <code>{request.providerId}</code></p>
            <FormGroup label="Installed provider for this request">
                <HTMLSelect aria-label={`Provider for ${request.name} request`} value={requestProvider(request)} fill onChange={event => setRequestProviders({...requestProviders, [request.id]: event.target.value})}>
                    <option value={request.providerId}>{request.providerId}{!plugins.some(plugin => plugin.id === request.providerId) && ' (not installed)'}</option>
                    {compatible(request).filter(service => service.providerId !== request.providerId).map(service => <option key={serviceKey(service)} value={service.providerId}>{service.providerName || service.providerId} ({service.providerId})</option>)}
                </HTMLSelect>
            </FormGroup>
            {requestProvider(request) !== request.providerId && <p>Approval binds <code>{request.providerId}</code> to <code>{requestProvider(request)}</code> for this consumer and grants both exact service permissions.</p>}
            <Button intent="primary" disabled={busy || disabled} onClick={() => run(async () => {
                const installed = requestProvider(request);
                await applied(await window.electron.plugin.reviewSharedLogicAccess(pluginId, request.id, 'approve', installed));
            })}>Approve shared-service access</Button>{' '}
            <Button disabled={busy} onClick={() => run(async () => {
                const result = await window.electron.plugin.reviewSharedLogicAccess(pluginId, request.id, 'dismiss');
                if (!result?.success) throw new Error(result?.error || 'Could not dismiss this request.');
                setNotice('Request dismissed. No access was added.');
            })}>Dismiss shared-service request</Button>
        </Card>)}
    </section>;
});
export default SharedLogicAccessReview;
