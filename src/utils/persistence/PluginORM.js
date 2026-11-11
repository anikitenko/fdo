import JSONORM from "./JSONORM";
import {normalizeCapabilityList} from "../plugins/security/pluginCapabilities";
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {target as validateSharedTarget, capability as sharedCapability, targetFromCapability} from '../plugins/runtime/sharedLogicContracts.cjs';

export default class PluginORM extends JSONORM {
    constructor(filePath) {
        super(filePath); // Call the base class
        if (!this.data.plugins) this.data.plugins = []; // Ensure array exists
    }

    // Add a plugin
    normalizePluginRecord(plugin) {
        if (!plugin || typeof plugin !== "object") {
            return plugin;
        }
        return {
            ...plugin,
            capabilities: normalizeCapabilityList(plugin.capabilities),
            customProcessScopes: Array.isArray(plugin.customProcessScopes) ? plugin.customProcessScopes : [],
            customFilesystemScopes: Array.isArray(plugin.customFilesystemScopes) ? plugin.customFilesystemScopes : [],
        };
    }

    addPlugin(pluginName, metadata, home, entry, overwrite = false, capabilities = []) {
        const existingPlugin = this.getPlugin(pluginName);
        if (overwrite) {
            this.removePlugin(pluginName);
        }
        if (!this.isInstalled(pluginName)) {
            this.data.plugins.push(this.normalizePluginRecord({
                ...existingPlugin,
                id: pluginName,
                metadata: metadata,
                home,
                entry,
                capabilities,
                customProcessScopes: existingPlugin?.customProcessScopes || [],
                customFilesystemScopes: existingPlugin?.customFilesystemScopes || [],
            }));
            this._save();
        }
    }

    // Get all plugins
    getAllPlugins() {
        return this.data.plugins.map((plugin) => this.normalizePluginRecord(plugin));
    }

    getPlugin(id) {
        const plugin = this.data.plugins.find(plugin => plugin.id === id);
        return this.normalizePluginRecord(plugin);
    }

    setPluginCapabilities(pluginName, capabilities = []) {
        const index = this.data.plugins.findIndex((plugin) => plugin.id === pluginName);
        if (index < 0) {
            return {success: false, error: `Plugin "${pluginName}" not found.`};
        }
        const normalized = normalizeCapabilityList(capabilities);
        this.data.plugins[index] = this.normalizePluginRecord({
            ...this.data.plugins[index],
            capabilities: normalized,
        });
        this._save();
        return {success: true, capabilities: normalized};
    }

    requestSharedLogicAccess(pluginId, target) {
        validateSharedTarget(target);
        const plugin = this.data.plugins.find(item => item.id === pluginId);
        if (!plugin) throw new Error(`Consumer plugin "${pluginId}" is not installed. Save or deploy it before requesting shared-service access.`);
        const capability = sharedCapability(target);
        const resolvedCapability = sharedCapability(this.resolveSharedLogicTarget(pluginId, target));
        if (plugin.capabilities?.includes('plugins.shared.use') && plugin.capabilities.includes(capability) && plugin.capabilities.includes(resolvedCapability)) return {state:'approved', capability};
        const requests = plugin.sharedLogicRequests || [];
        const existing = requests.find(item => item.capability === capability);
        if (existing) return {state:'pending', request:existing};
        if (requests.length >= 32) throw new Error('Review existing shared-service requests before creating more.');
        const request = {id:randomUUID(), ...target, capability, createdAt:new Date().toISOString()};
        plugin.sharedLogicRequests = [...requests, request];
        this.saveSharedLogicState();
        return {state:'pending', request, created:true};
    }

    rememberSharedLogicExport(service) {
        if (!service) return;
        const plugin = this.data.plugins.find(item => item.id === service.providerId);
        if (!plugin) return;
        const exports = (plugin.sharedLogicExports || []).filter(item => item.name !== service.name || item.version !== service.version);
        if (exports.length >= 16) exports.shift();
        plugin.sharedLogicExports = [...exports, service];
        this.saveSharedLogicState();
    }

    setSharedLogicBinding(pluginId, target, installedProviderId) {
        validateSharedTarget(target);
        validateSharedTarget({...target, providerId: installedProviderId});
        const plugin = this.data.plugins.find(item => item.id === pluginId);
        if (!plugin) throw new Error(`Consumer plugin "${pluginId}" is not installed.`);
        if (installedProviderId !== target.providerId && !this.isInstalled(installedProviderId)) throw new Error(`Provider "${installedProviderId}" is not installed.`);
        const key = sharedCapability(target);
        plugin.sharedLogicBindings = (plugin.sharedLogicBindings || []).filter(binding => sharedCapability(binding) !== key);
        if (installedProviderId !== target.providerId) plugin.sharedLogicBindings.push({...target, installedProviderId});
        this.saveSharedLogicState();
    }

    resolveSharedLogicTarget(pluginId, target) {
        const key = sharedCapability(target);
        let binding = this.getPlugin(pluginId)?.sharedLogicBindings?.find(item => sharedCapability(item) === key);
        if (!binding && !this.isInstalled(target.providerId)) {
            this.repairApprovedSharedLogicBindings(pluginId);
            binding = this.getPlugin(pluginId)?.sharedLogicBindings?.find(item => sharedCapability(item) === key);
        }
        return binding ? {...target, providerId: binding.installedProviderId} : target;
    }

    getApprovedSharedLogicProviders(pluginId, target) {
        validateSharedTarget(target);
        const grants = this.getPlugin(pluginId)?.capabilities || [];
        if (!grants.includes('plugins.shared.use') || !grants.includes(sharedCapability(target))) return [];
        return this.getAllPlugins().filter(plugin => plugin.id !== target.providerId
            && plugin.capabilities.includes('plugins.shared.provide')
            && grants.includes(sharedCapability({...target, providerId: plugin.id}))
            && Array.isArray(plugin.sharedLogicExports)
            && plugin.sharedLogicExports.some(service => service.name === target.name && service.version === target.version));
    }

    // Older approvals saved both exact grants without the routing binding.
    // Recover only from already-approved, uniquely matching installed exports.
    // Existing bindings and real installed target IDs are never redirected.
    repairApprovedSharedLogicBindings(pluginId) {
        const repaired = [];
        for (const plugin of this.data.plugins) {
            if (pluginId && plugin.id !== pluginId) continue;
            const grants = Array.isArray(plugin.capabilities) ? plugin.capabilities : [];
            if (!grants.includes('plugins.shared.use')) continue;
            for (const value of grants) {
                const target = targetFromCapability(value);
                if (!target || this.isInstalled(target.providerId)) continue;
                if (plugin.sharedLogicBindings?.some(binding => sharedCapability(binding) === value)) continue;
                const providers = this.getApprovedSharedLogicProviders(plugin.id, target);
                if (providers.length !== 1) continue;
                const binding = {...target, installedProviderId: providers[0].id};
                plugin.sharedLogicBindings = [...(plugin.sharedLogicBindings || []), binding];
                repaired.push({consumerId: plugin.id, ...binding});
            }
        }
        if (repaired.length) this.saveSharedLogicState();
        return repaired;
    }

    dismissGrantedSharedLogicRequests(pluginId, capabilities) {
        const plugin = this.data.plugins.find(item => item.id === pluginId);
        if (!plugin) return;
        plugin.sharedLogicRequests = (plugin.sharedLogicRequests || []).filter(request => !capabilities.includes(request.capability));
        this.saveSharedLogicState();
    }

    dismissSharedLogicRequest(pluginId, requestId) {
        const plugin = this.data.plugins.find(item => item.id === pluginId);
        if (!plugin?.sharedLogicRequests?.some(item => item.id === requestId)) throw new Error('This request is no longer pending.');
        plugin.sharedLogicRequests = plugin.sharedLogicRequests.filter(item => item.id !== requestId);
        this.saveSharedLogicState();
    }

    saveSharedLogicState() {
        const temporary = `${this.filePath}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporary, JSON.stringify(this.data,null,4), {mode:0o600});
            fs.renameSync(temporary,this.filePath);
        } finally {fs.rmSync(temporary,{force:true});}
        this.emit('update',this.data);
    }

    getPluginCustomProcessScopes(pluginName) {
        const plugin = this.getPlugin(pluginName);
        return Array.isArray(plugin?.customProcessScopes) ? plugin.customProcessScopes : [];
    }

    setPluginCustomProcessScopes(pluginName, scopes = []) {
        const index = this.data.plugins.findIndex((plugin) => plugin.id === pluginName);
        if (index < 0) {
            return {success: false, error: `Plugin "${pluginName}" not found.`};
        }
        this.data.plugins[index] = this.normalizePluginRecord({
            ...this.data.plugins[index],
            customProcessScopes: Array.isArray(scopes) ? scopes : [],
        });
        this._save();
        return {success: true, scopes: this.getPluginCustomProcessScopes(pluginName)};
    }

    getPluginCustomFilesystemScopes(pluginName) {
        const plugin = this.getPlugin(pluginName);
        return Array.isArray(plugin?.customFilesystemScopes) ? plugin.customFilesystemScopes : [];
    }

    setPluginCustomFilesystemScopes(pluginName, scopes = []) {
        const index = this.data.plugins.findIndex((plugin) => plugin.id === pluginName);
        if (index < 0) {
            return {success: false, error: `Plugin "${pluginName}" not found.`};
        }
        this.data.plugins[index] = this.normalizePluginRecord({
            ...this.data.plugins[index],
            customFilesystemScopes: Array.isArray(scopes) ? scopes : [],
        });
        this._save();
        return {success: true, scopes: this.getPluginCustomFilesystemScopes(pluginName)};
    }

    // Remove a plugin
    removePlugin(pluginName) {
        this.data.plugins = this.data.plugins.filter(p => p.id !== pluginName);
        this._save();
    }

    // Check if a plugin is installed
    isInstalled(pluginName) {
        if (this.data.plugins.length === 0) return false;
        return this.data.plugins.some(p => p.id === pluginName);
    }
}
