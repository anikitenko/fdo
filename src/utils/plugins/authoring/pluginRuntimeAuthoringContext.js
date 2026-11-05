import {buildRuntimeSecurityPolicy} from '../security/pluginCapabilities';

export const PLUGIN_RUNTIME_CONTRACT_VERSION = '2026-11-05';
export const PLUGIN_RUNTIME_GUIDANCE = `DESKTOP PLUGIN RUNTIME AND PERMISSION DIAGNOSIS
- Desktop workers receive a filtered environment, not the application's process.env. Host/cloud/AI keys, SSH agents, proxies and loader flags are not inherited. HOME and temporary/configuration directories are plugin-private. Do not dump process.env, read the user's ~/.aws or ~/.ssh, or restore host environment inheritance to repair a plugin.
- For a user-entered API key use the installed SDK backend secret service (this.secrets with the required secrets.use and operation grants). Use SDK plugin-scoped storage for nonsecret preferences and PLUGIN_HOME for writable plugin files; PLUGIN_CODE_HOME is read-only source/assets. Never return credentials to the iframe or include them in logs, prompts, tests or suggested diagnostics. Exported containers have a separate, explicitly configured environment; do not assume those variables exist in the desktop worker.
- Declaring capabilities does not grant them. Compare source declarations, configured grants and the running worker's grants using supplied runtimeContract/capabilityIntent evidence. Configured policy is not proof that a running worker has restarted with it. Only the user/host can approve grants; generated plugin code must not enable or broaden permissions itself.
- HTTPS fetch()/https.request()/https.get() require system.network, system.network.https and a matching system.network.scope.<id>. Node's internal TLS/DNS for an allowed HTTPS request does not require direct system.network.tcp or system.network.dns grants. Direct raw sockets/TLS/DNS APIs remain separate permissions. Use the narrowest appropriate existing scope and the installed SDK contract for host-managed CLI tools and explicitly permitted tool environment keys.
- Diagnose [host-policy]/FDO_PLUGIN_PERMISSION_DENIED from the actual call site and runtime evidence. A missing grant, a denied destination, unavailable credential configuration and a host/runtime defect are different causes. A bare fetch failed message is insufficient: inspect a redacted error code/cause and current plugin trace. If code uses only permitted HTTPS but tls.connect is denied, report a possible host guard regression and the need for the FDO host fix/restart; do not rewrite the plugin to raw sockets, add TCP/DNS/sudo grants or edit host source from this plugin workspace.
- Keep repairs plugin-local when evidence establishes a plugin defect. If the fix belongs to FDO, explain that boundary and the concrete host diagnostic. Test permission failures and recovery with synthetic keys and mocked provider data; distinguish mocked tests, actual worker networking and live provider verification. Do not trigger VM creation or other external mutations merely to diagnose connectivity.`;

// Explicit public fields only. Never accept an environment/settings object or
// serialize the plugin record: those may contain credentials and private paths.
export function buildPluginRuntimeAuthoringContext({grantedCapabilities=[],grantSource='configured'}={}) {
    const policy=buildRuntimeSecurityPolicy(grantedCapabilities);
    return {
        contractVersion:PLUGIN_RUNTIME_CONTRACT_VERSION,
        boundary:'desktop-plugin-worker',
        grantSource:grantSource==='running-worker'?'running-worker':'configured',
        grantedCapabilities:policy.grantedCapabilities,
        environment:{inheritsHostEnvironment:false,home:'plugin-private',credentials:'SDK backend secret service',
            publicPathVariables:['PLUGIN_HOME','PLUGIN_CODE_HOME','FDO_SDK_STORAGE_ROOT','FDO_SDK_LOG_ROOT']},
        filesystem:{read:'own plugin data, source and runtime dependencies',write:'PLUGIN_HOME only'},
        network:{...policy.networkAccess,scopes:policy.networkScopes.map(scope=>({scope:scope.scope,
            allowedTransports:[...scope.allowedTransports],allowedSchemes:[...scope.allowedSchemes],
            allowedHostPatterns:[...scope.allowedHostPatterns],allowedPorts:[...scope.allowedPorts]}))},
    };
}
