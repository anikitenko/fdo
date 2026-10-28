import React, {useEffect, useState} from 'react';
import PropTypes from 'prop-types';
import {Button, Callout, Checkbox, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup} from '@blueprintjs/core';
import {normalizePluginRequirements} from '../../utils/sdk/pluginCompatibility';

const labels = {fdo: 'Supported FDO range', sdk: 'Supported SDK range', api: 'Supported host API range'};
const supportMessage = message => String(message || 'Could not preview these support settings. Try again.')
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
/** @returns {{fdo: string, sdk: string, api: string, features: string[]}} */
const initial = context => ({
    fdo: String(context.declaredRequirements?.fdo ?? context.defaultRequirements.fdo),
    sdk: String(context.declaredRequirements?.sdk ?? context.defaultRequirements.sdk),
    api: String(context.declaredRequirements?.api ?? context.defaultRequirements.api),
    features: Array.isArray(context.declaredRequirements?.features)
        ? context.declaredRequirements.features.filter(flag => typeof flag === 'string') : [...context.defaultRequirements.features],
});

export function PluginSupportEditor({context, disabled: externallyDisabled, onReview}) {
    const [values, setValues] = useState(() => initial(context));
    const [notice, setNotice] = useState(null);
    const [reviewing, setReviewing] = useState(false);
    const disabled = externallyDisabled || reviewing;
    const [open, setOpen] = useState(false);
    const identity = JSON.stringify([context.host, context.contract, context.declaredRequirements]);
    useEffect(() => {setValues(initial(context)); setNotice(null);}, [identity]);
    useEffect(() => {setNotice(null);}, [values]);
    const missing = ['fdo', 'sdk', 'api', 'features'].filter(key => context.declaredRequirements?.[key] === undefined);
    const features = Object.keys(context.contract.featureFlags).filter(key => context.contract.featureFlags[key] === true);
    for (const feature of Array.isArray(context.declaredRequirements?.features) ? context.declaredRequirements.features : []) {
        if (typeof feature === 'string' && !features.includes(feature)) features.push(feature);
    }
    features.sort();
    let invalid = '', changed = true;
    try {
        normalizePluginRequirements(values);
    } catch (error) {invalid = error.message;}
    if (!invalid && !missing.length) {
        try {changed = JSON.stringify(normalizePluginRequirements(values)) !== JSON.stringify(normalizePluginRequirements(context.declaredRequirements));}
        catch {changed = true;}
    }
    const review = async request => {
        setNotice(null); setReviewing(true);
        try {
            const result = await onReview(request);
            if (result?.status === 'ready') setOpen(false);
            else setNotice({intent: result?.status === 'unchanged' ? 'primary' : 'danger',
                message: supportMessage(result?.message)});
        } catch (error) {
            setNotice({intent: 'danger', message: supportMessage(error.message)});
        } finally {setReviewing(false);}
    };
    const toggleFeature = feature => setValues(current => ({
        fdo: current.fdo, sdk: current.sdk, api: current.api,
        features: current.features.includes(feature) ? current.features.filter(flag => flag !== feature) : [...current.features, feature],
    }));
    /** @type {React.ReactElement[]} */
    const featureControls = [];
    for (const feature of features) featureControls.push(<Checkbox key={feature} checked={values.features.includes(feature)}
        label={feature + (context.contract.featureFlags[feature] === true ? '' : ' (unavailable on this host)')}
        onChange={() => toggleFeature(feature)}/>);
    if (!context.supportEditing?.available) return <Callout intent="warning">{context.supportEditing?.reason || 'Reconnect to the IDE to edit the support declaration.'}</Callout>;
    return <div>
        {missing.length > 0 && <p>Missing support fields: {missing.join(', ')}.</p>}
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
            <Button icon="edit" disabled={disabled} onClick={() => {setNotice(null); setOpen(true);}}>Adjust supported versions</Button>
            {missing.length > 0 && <Button icon="add" disabled={disabled} onClick={() => review({kind: 'compatibility', mode: 'missing'})}>Add missing support fields</Button>}
        </div>
        {!open && notice && <Callout intent={notice.intent} role={notice.intent === 'danger' ? 'alert' : 'status'}>{notice.message}</Callout>}
        <Dialog isOpen={open} title="Adjust plugin support" className="bp6-dark" style={{width: 620, maxWidth: 'calc(100vw - 32px)'}}
            onClose={() => {if (!disabled) setOpen(false);}} canOutsideClickClose={!disabled} canEscapeKeyClose={!disabled}>
        <DialogBody style={{maxHeight: '65vh', overflow: 'auto'}}>
        <fieldset disabled={disabled} style={{border: 0, padding: 0, minWidth: 0}} aria-label="Plugin support requirements">
        <p>These are plugin requirements. Editing them does not upgrade FDO or the SDK, change host contracts, or verify other versions. Changes stay in a reviewable workspace draft until Apply.</p>
        {missing.length > 0 && <Callout intent="primary" title="Support fields are missing">
            <p>Missing: {missing.join(', ')}. Defaults below come from this host. Existing declarations are preserved when adding missing fields.</p>
        </Callout>}
        {Object.entries(labels).map(([key, label]) => <FormGroup key={key} label={label} labelFor={`support-${key}`}
            helperText={`This host: ${context.host[key]}`}>
            <InputGroup id={`support-${key}`} value={values[key]} maxLength={200}
                onValueChange={value => setValues(current => ({...current, [key]: value}))}/>
        </FormGroup>)}
        <FormGroup label="Required features" helperText="Available features come from the host contract. This list grants no permissions.">
            {featureControls}
        </FormGroup>
        {invalid && <Callout intent="danger" role="alert">{invalid}</Callout>}
        {notice && <Callout intent={notice.intent} role={notice.intent === 'danger' ? 'alert' : 'status'}>{notice.message}</Callout>}
        </fieldset>
        </DialogBody>
        <DialogFooter actions={<>
            <Button disabled={disabled} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={disabled} onClick={() => setValues(current => ({
                fdo: context.defaultRequirements.fdo, sdk: context.defaultRequirements.sdk,
                api: context.defaultRequirements.api, features: current.features,
            }))}>Use current host defaults</Button>
            <Button intent="primary" icon="comparison" disabled={disabled || !!invalid || !changed}
                onClick={() => review({kind: 'compatibility', requirements: values})}>Preview support changes</Button>
        </>}/>
        </Dialog>
    </div>;
}

PluginSupportEditor.propTypes = {context: PropTypes.object.isRequired, disabled: PropTypes.bool, onReview: PropTypes.func.isRequired};
