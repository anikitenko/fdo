import {installedSdkCapabilities, readSkillFingerprint} from './installedSdkCapabilities';
import {pluginSkillCompatibility} from '../plugins/authoring/pluginSkillCompatibility';
import Module from 'node:module';
import path from 'node:path';
import {getHostPluginNodeModulesPath} from '../plugins/runtime/pluginRuntimeBundle';
import {validatePluginWorkspaceSdkContract} from './pluginWorkspaceSdkContract';
import {validateAiCompatibilityChanges, workspaceAuthoringContract} from './pluginAuthoringContract';
import {createHash} from 'node:crypto';

// Resolve from the same runtime dependency directory used by the plugin build.
// Never execute generated code to discover whether an SDK export exists.
export function createInstalledSdkValidator(workspaceFiles = []) {
    const requireSdk = Module.createRequire(path.join(getHostPluginNodeModulesPath(), 'fdo-plugin-sdk-contract.cjs'));
    const sdk = requireSdk('@anikitenko/fdo-sdk');
    const runtimeExports = [...Object.getOwnPropertyNames(Object(sdk)), 'default'];
    const methodSignatures = new Map();
    const capabilities = installedSdkCapabilities(requireSdk, sdk, {methodSignatures});
    const workspace = Object.fromEntries(workspaceFiles.map(file => [file.path, file.content]));
    capabilities.hostTarget = workspaceAuthoringContract(workspace);
    capabilities.fingerprint = createHash('sha256').update(capabilities.fingerprint)
        .update(JSON.stringify({host: capabilities.hostTarget.host, contract: capabilities.hostTarget.contract})).digest('hex');
    const check = file => validatePluginWorkspaceSdkContract([file], {
        runtimeExports, createActionSource: sdk.createRenderOnLoadActionsSource,
    }).map((error, index) => {
        const missing = /does not provide "([^"\n]+)"/.exec(error)?.[1];
        if (capabilities.typeExports.includes(missing)) return `${error} ${missing} is a declaration-only SDK export. For type annotations or implements clauses, use import type {${missing}} from "@anikitenko/fdo-sdk". It cannot be constructed, extended as a class, or called at runtime.`;
        return `${error}${index === 0 && missing ? ` Installed runtime exports: ${runtimeExports.slice().sort().join(', ')}.` : ''}`;
    });
    const source = requireSdk.resolve('@anikitenko/fdo-sdk');
    const compatibility = (content, exampleErrors = []) => {
        const result = pluginSkillCompatibility(content, sdk, source, exampleErrors);
        for (const finding of result.findings) {
            if (finding.status !== 'unverified' || !finding.message.includes('accessor')) continue;
            const parts = finding.reference.replace(/^sdk\./, '').split('.');
            const declared = parts.length === 2 && capabilities.api.find(entry => entry.name === parts[0] && entry.methods.length);
            if (!declared || !content.includes(finding.reference + '(')) continue;
            const exists = declared.methods.includes(parts[1]);
            Object.assign(finding, {status: exists ? 'verified' : 'conflict',
                message: exists ? 'Method exists in installed SDK declarations; argument types are checked during candidate typechecking.'
                    : `Installed SDK declarations do not expose method ${finding.reference}.`,
                correction: exists ? undefined : `Choose a declared ${parts[0]} method and preserve its actual signature. Available declarations (not automatic substitutes): ${(methodSignatures.get(parts[0]) || []).slice(0, 12).join(" ")}`});
        }
        result.hasConflicts = result.findings.some(item => item.status === 'conflict');
        return result;
    };
    const report = content => ({...compatibility(content, check({path: '/SKILL.md', content})), sdkVersion: capabilities.sdkVersion, fingerprint: capabilities.fingerprint, migrationRequired: readSkillFingerprint(content) !== capabilities.fingerprint});
    const validate = file => file.path === '/SKILL.md'
        ? report(file.content).findings.filter(item => item.status === 'conflict')
            .map(item => `/SKILL.md:${item.line || 1}: ${item.message} ${item.correction} Contract source: ${source}`)
        : [...check(file), ...(file.path === '/package.json' ? validateAiCompatibilityChanges(workspace['/package.json'], file.content) : [])];
    validate.report = report;
    validate.capabilities = capabilities;
    validate.plan = files => files.flatMap(file => compatibility(file.contract).findings.filter(item => item.status === 'conflict').map(item => `${file.path}: ${item.message}`));
    return validate;
}
