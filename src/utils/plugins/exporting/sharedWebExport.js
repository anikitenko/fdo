import {createHash} from 'node:crypto';
import {targetFromCapability, capability, provider as validProvider} from '../runtime/sharedLogicContracts.cjs';
import {attachWebExportRecovery} from './webExportRecovery';

// Resolve only reviewed, host-owned installations. Never infer an approval from
// a matching service name or let renderer export options supply provider code.
export async function prepareSharedWebExport(options, prepareSingle) {
    const nodes = new Map(), ordered = [], visiting = new Set(), blockers = [];
    const visit = async (snapshot, plugin) => {
        if (visiting.has(plugin.id)) {blockers.push(`Shared-service dependency cycle includes ${plugin.id}. Remove the cycle before exporting.`);return;}
        if (nodes.has(plugin.id)) return;
        if (!validProvider(plugin.id) || nodes.size >= 32) {blockers.push('Shared-service export requires valid plugin IDs and at most 32 plugins.');return;}
        visiting.add(plugin.id);
        const prepared = await prepareSingle({...options, snapshot, plugin});
        const node = {plugin, prepared, bindings: [], extraGrants: new Set()};
        if (plugin.id !== options.plugin.id && !prepared.report.capabilities.includes('plugins.shared.provide')) blockers.push(`Shared provider ${plugin.id} must declare plugins.shared.provide before exporting.`);
        nodes.set(plugin.id, node);
        for (const problem of prepared.report.blockers) if (plugin.id !== options.plugin.id) blockers.push(`Shared provider ${plugin.name || plugin.id}: ${problem}`);
        const granted = new Set(plugin.capabilities || []);
        for (const id of prepared.report.capabilities) {
            if (!id.startsWith('plugins.shared.call.')) continue;
            const target = targetFromCapability(id);
            if (!target) {blockers.push(`Invalid shared-service capability: ${id}.`);continue;}
            const binding = (plugin.sharedLogicBindings || []).find(item => item.providerId === target.providerId && item.name === target.name && item.version === target.version);
            const resolved = {...target, providerId: binding?.installedProviderId || target.providerId};
            if (!validProvider(resolved.providerId) || !prepared.report.capabilities.includes('plugins.shared.use') || !granted.has('plugins.shared.use') || !granted.has(id) || !granted.has(capability(resolved))) {
                blockers.push(`Plugin ${plugin.name || plugin.id} needs approved plugins.shared.use and exact access to ${id} and its installed provider. Review shared-service access in Manage Plugins.`);continue;
            }
            node.bindings.push({...target, installedProviderId: resolved.providerId});
            node.extraGrants.add(capability(resolved));
            if (resolved.providerId === plugin.id) {
                if (!granted.has('plugins.shared.provide')) blockers.push(`Shared provider ${plugin.id} lacks approved plugins.shared.provide.`);
                continue;
            }
            let dependency;
            try {dependency = await options.resolveSharedProvider?.(resolved.providerId);}
            catch (error) {blockers.push(`Shared provider ${resolved.providerId}: ${error.message}`);continue;}
            if (!dependency?.snapshot || dependency.plugin?.id !== resolved.providerId) {
                blockers.push(`Shared provider ${resolved.providerId} must be installed and included in this export. Desktop providers are unavailable inside Docker.`);continue;
            }
            if (!dependency.plugin.capabilities?.includes('plugins.shared.provide')) {
                blockers.push(`Shared provider ${resolved.providerId} lacks approved plugins.shared.provide.`);continue;
            }
            await visit(dependency.snapshot, dependency.plugin);
        }
        visiting.delete(plugin.id);ordered.push(node);
    };
    await visit(options.snapshot, options.plugin);
    const result = nodes.get(options.plugin.id)?.prepared;
    if (!result) throw new Error('Choose an installed plugin with a valid ID.');
    const dependencies = ordered.filter(node => node.plugin.id !== options.plugin.id);
    const providers = dependencies.map(node => ({id:node.plugin.id, name:node.plugin.name || node.plugin.id,
        directory:'shared-providers/'+createHash('sha256').update(node.plugin.id).digest('hex').slice(0,24),
        sourceFingerprint:node.prepared.report.sourceFingerprint, capabilities:node.prepared.report.capabilities,
        configuration:node.prepared.report.configuration || []}));
    result.report.sharedLogic = {providers, bindings:nodes.get(options.plugin.id).bindings};
    if (dependencies.length) {
        const original='Desktop data, credentials, grants outside this plugin, certificates and SSH profiles are never included.';
        const warning='Desktop data, credentials, certificates and SSH profiles are never included. Only the reviewed application and listed shared-provider grants are carried into the deployment.';
        result.report.warnings=result.report.warnings.map(value=>value===original?warning:value);
        if(result.files)result.files['README.md']=result.files['README.md'].replace(original,warning);
        for(const node of dependencies) for(const adapter of node.prepared.report.configuration || [])result.report.warnings.push(`Shared provider ${node.plugin.name || node.plugin.id}: ${adapter.description}`);
    }
    result.report.blockers = [...new Set([...result.report.blockers, ...blockers])];
    if (!result.report.blockers.length && result.files) {
        const mainPlan = JSON.parse(result.files['deployment/toolchain.json']);
        for (const node of dependencies) {
            const plan = node.prepared.report.toolchain;
            if (!plan) continue;
            if (plan.baseImage !== mainPlan.baseImage) {result.report.blockers.push(`Shared provider ${node.plugin.id} requires a different Docker base image.`);continue;}
            for (const tool of plan.tools) {
                const existing = mainPlan.tools.find(item => item.id === tool.id || item.commands.some(command => tool.commands.includes(command)));
                const identity = value => JSON.stringify([value.id,value.commands,value.version,value.executable,value.installer,value.versionArgs]);
                if (existing && identity(existing) !== identity(tool)) result.report.blockers.push(`Shared provider ${node.plugin.id} has conflicting deployment tool requirements for ${tool.id}.`);
                else if (!existing) mainPlan.tools.push(tool);
                else existing.aliases = [...new Set([...(existing.aliases || []),...(tool.aliases || [])])];
            }
            mainPlan.basePackages = [...new Set([...mainPlan.basePackages,...plan.basePackages])];
            mainPlan.unresolved.push(...plan.unresolved);mainPlan.warnings.push(...plan.warnings);
        }
        for (const node of ordered) {
            if (!node.prepared.files) continue;
            const manifest = JSON.parse(node.prepared.files['deployment/application.json']);
            manifest.capabilities = [...new Set([...manifest.capabilities,...node.extraGrants])];
            manifest.sharedLogic = {bindings:node.bindings, ...(node.plugin.id === options.plugin.id ? {providers} : {provider:true})};
            node.prepared.files['deployment/application.json'] = JSON.stringify(manifest,null,2)+'\n';
        }
        for (let index=0;index<dependencies.length;index++) {
            const providerFiles=dependencies[index].prepared.files;
            if (providerFiles) {
                const settings=JSON.parse(providerFiles['deployment/services.json']);
                const dataRoot='/data/'+providers[index].directory;
                settings.pathMappings=Object.fromEntries(Object.entries(settings.pathMappings || {}).map(([original,destination])=>[original,destination.replace(/^\/data(?=\/|$)/,dataRoot)]));
                providerFiles['deployment/services.json']=JSON.stringify(settings,null,2)+'\n';
            }
            for (const [file,content] of Object.entries(dependencies[index].prepared.files || {})) {
                // Provider processes expose no HTTP endpoint and share the image's
                // pinned dependencies; they retain independent service settings.
                if (/^(?:backend\/|runtime\/|deployment\/|build\.cjs$|worker\.cjs$|THIRD_PARTY_NOTICES)/.test(file)) result.files[providers[index].directory+'/'+file] = content;
            }
        }
        if (dependencies.length) {
            result.files['build-application.cjs'] = result.files['build.cjs'];
            result.files['build.cjs'] = `const path=require('node:path'),{execFileSync}=require('node:child_process');\nfor(const directory of ${JSON.stringify(providers.map(item=>item.directory))})execFileSync(process.execPath,[path.join(__dirname,directory,'build.cjs')],{stdio:'inherit'});\nexecFileSync(process.execPath,[path.join(__dirname,'build-application.cjs')],{stdio:'inherit'});\n`;
            result.report.toolchain = mainPlan;
            result.files['deployment/toolchain.json'] = JSON.stringify(mainPlan,null,2)+'\n';
            result.files['README.md'] += '\n## Shared plugin services\n\nApproved provider source is included under shared-providers/. Each provider runs in a separate backend process with its own capability policy, service settings and data directory under /data/shared-providers/. No desktop provider needs to be running.\n\nIncluded providers:\n'+providers.map(item=>`- ${item.name} (${item.id}): ${item.directory}/deployment/services.json`).join('\n')+'\n\nConfigure provider credentials and volume path mappings separately, as for the main application. Providers expose no HTTP endpoints. Pending requests cannot approve new capabilities inside the container; change grants in FDO and export again. Restart the application to recover an exited provider.\n';
        }
    }
    attachWebExportRecovery(result.report);
    if (result.report.blockers.length) delete result.files;
    else result.files['conversion-report.json'] = JSON.stringify(result.report,null,2)+'\n';
    return result;
}
