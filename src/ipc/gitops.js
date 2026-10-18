import {randomUUID} from 'node:crypto';
import {SettingsChannels} from './channels';
import {validateRepository} from '../utils/gitops/manifest';
import {verifyRepository} from '../utils/gitops/verifyRepository';

function requireDeclaredPlugin(declarations, pluginName) {
    if (pluginName && !declarations.some(plugin => plugin.name === pluginName)) {
        throw new Error('This plugin is no longer in the collection. Refresh the collection to see its current plugins.');
    }
}

export function publicRepository(repository) {
    const {id, url, authType, manifestPath, revisionType, targetRevision, manifest, commit, verifiedAt,
        lastSyncedAt, syncError, installedPlugins, pluginStatuses = [], lastCheckedAt, checkIntervalMinutes = 5, autoSync = true} = repository;
    return {id, url, authType, manifestPath, revisionType, targetRevision, manifest, commit, verifiedAt,
        lastSyncedAt, syncError, installedPlugins, autoSync,
        pluginStatuses, lastCheckedAt, checkIntervalMinutes,
        hasCredentials: !!repository.encryptedCredentials};
}

export function registerGitOpsHandlers({ipcMain, settings, safeStorage, getMainWindow, verify = verifyRepository, sync, detach, review, notify = () => {}, report = () => {}}) {
    const channels = SettingsChannels.gitops;
    const repositories = () => settings.get('gitops.repositories', []);
    let busy = false;
    const assertEncryption = () => {
        if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
            throw new Error('Secure credential storage is unavailable. Unlock your OS keychain or use a public repository without credentials.');
        }
    };
    const credentials = repository => {
        assertEncryption();
        try { return JSON.parse(safeStorage.decryptString(Buffer.from(repository.encryptedCredentials, 'base64'))); }
        catch { throw new Error('Cannot unlock these repository credentials. Edit the repository and enter them again.'); }
    };
    const replace = repository => settings.set('gitops.repositories', repositories().map(repo => repo.id === repository.id ? repository : repo));
    const incident = (repository, pluginName, error) => {
        const groupKey = `gitops:${repository.id}:${pluginName || 'collection'}`;
        const collection = repository.manifest?.metadata?.displayName || repository.manifest?.metadata?.name || 'Repository';
        const name = pluginName ? `${pluginName} in ${collection}` : collection;
        // Reporting is independent of synchronization: a storage failure must not undo a successful update.
        void Promise.resolve().then(() => report({source: 'gitops', groupKey,
            title: error ? `Couldn’t synchronize ${name}` : `${name} synchronization recovered`,
            message: error ? 'Open the repository details to review the failed check and retry. If you do not maintain this collection, share the diagnostic details with its maintainer.' : 'The repository check succeeded after an earlier failure. Review the collection for current plugin versions.',
            details: error || '', type: error ? 'danger' : 'success',
            ...(error ? {} : {status: 'resolved'}),
            actions: [{kind: 'view-gitops', repositoryId: repository.id},
                {kind: 'retry-gitops', repositoryId: repository.id, ...(pluginName ? {pluginName} : {})}],
        })).catch(error => console.error('Could not save GitOps notification:', error));
    };
    for (const repository of repositories()) {
        if (!repository.pluginStatuses?.some(status => status.state === 'checking')) continue;
        replace({...repository, pluginStatuses: repository.pluginStatuses.map(status => status.state === 'checking'
            ? {...status, state: 'error', error: 'The previous check was interrupted. Retry this plugin when you are ready.'} : status)});
    }
    const synchronize = async (repository, refresh = true, pluginName) => {
        if (!sync) throw new Error('Plugin synchronization is unavailable.');
        let current = repository;
        try {
            const secret = repository.authType === 'basic' ? credentials(repository) : {};
            if (refresh) current = {...current, ...await verify({...current, ...secret})};
            const declarations = current.manifest.spec.plugins;
            requireDeclaredPlugin(declarations, pluginName);
            const statuses = new Map((current.pluginStatuses || []).filter(status => declarations.some(plugin => plugin.name === status.name)).map(status => [status.name, status]));
            for (const plugin of declarations.filter(plugin => !pluginName || plugin.name === pluginName)) {
                statuses.set(plugin.name, {...statuses.get(plugin.name),name:plugin.name,state:'checking'});
                current = {...current, pluginStatuses: [...statuses.values()]};
                replace(current); notify();
                try {
                    const result = await sync({source: current, secret, pluginName: plugin.name});
                    const {pendingUpdates=[],reviewStatuses=[],...snapshot}=result;
                    current = {...current, ...snapshot};
                    const pending=pendingUpdates.find(item=>item.name===plugin.name);
                    const declined=reviewStatuses.find(item=>item.name===plugin.name&&item.state==='declined');
                    const installed = current.installedPlugins?.find(item => item.name === plugin.name);
                    statuses.set(plugin.name, {name: plugin.name, state:pending?'awaiting_approval':declined?'declined':'synced', checkedAt:new Date().toISOString(), ...(installed?{commit:installed.commit}:{}), ...(pending?{pendingUpdate:pending}:{}), ...(declined?{commit:declined.commit}:{})});
                    if(pending?.newReview)void Promise.resolve().then(()=>report({source:'gitops',type:'warning',groupKey:`gitops-review:${current.id}:${pending.pluginId}`,
                        title:`${plugin.name} update needs permission approval`,
                        message:pending.inspectionError?'The permission declaration needs attention. The approved version is still installed.':`Version ${pending.version} requests ${pending.addedCapabilities.length} additional ${pending.addedCapabilities.length===1?'capability':'capabilities'}. The approved version is still installed.`,
                        details:`Current: ${pending.currentVersion} (${pending.currentCommit})\nCandidate: ${pending.version} (${pending.commit})\nAdditional capabilities:\n${pending.addedCapabilities.join('\n')}${pending.inspectionError?'\n'+pending.inspectionError:''}`,
                        actions:[{kind:'view-gitops',repositoryId:current.id}]})).catch(()=>{});
                    incident(current, plugin.name);
                } catch (error) {
                    statuses.set(plugin.name, {name: plugin.name, state: 'error', checkedAt: new Date().toISOString(), error: error.message});
                    incident(current, plugin.name, error.message);
                }
                current = {...current, pluginStatuses: [...statuses.values()]};
                replace(current); notify();
            }
            if (!pluginName && current.installedPlugins?.some(installed => !declarations.some(plugin => plugin.name === installed.name))) {
                const {pendingUpdates,reviewStatuses,...result}=await sync({source:current,secret,pruneOnly:true});
                current={...current,...result};
            }
            const failures = [...statuses.values()].filter(status => status.state === 'error').length;
            current = {...current, pluginStatuses: [...statuses.values()], lastCheckedAt: new Date().toISOString(),
                syncError: failures ? `${failures} ${failures === 1 ? 'plugin needs' : 'plugins need'} attention. Open the plugin list for details.` : ''};
            replace(current);
            incident(current);
            notify();
            return current;
        } catch (error) {
            incident(current, undefined, error.message);
            replace({...current, lastCheckedAt: new Date().toISOString(), syncError: error.message});
            notify();
            throw error;
        }
    };
    const handle = (channel, action) => ipcMain.handle(channel, async (event, input) => {
        const window = getMainWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) {
            return {success: false, error: 'GitOps settings are available only in the main application window.'};
        }
        try { return {success: true, ...await action(input)}; }
        catch (error) { return {success: false, error: error.message}; }
    });
    handle(channels.LIST, () => ({repositories: repositories().map(publicRepository)}));
    handle(channels.SAVE, async input => {
        if (busy) throw new Error('Repository verification is already running.');
        busy = true;
        try {
            const previous = input?.id ? repositories().find(repo => repo.id === input.id) : undefined;
            if (input?.id && !previous) throw new Error('Repository no longer exists. Refresh GitOps settings.');
            if (!previous && repositories().length >= 30) throw new Error('Add at most 30 repositories.');
            let candidate = {...input};
            if (previous?.encryptedCredentials && input.authType === 'basic' && !input.password && !input.username) {
                if (input.url !== previous.url) throw new Error('Enter credentials again when changing the repository URL.');
                candidate = {...candidate, ...credentials(previous)};
            }
            const config = validateRepository(candidate);
            if (repositories().some(repo => repo.id !== previous?.id && repo.url === config.url &&
                repo.targetRevision === config.targetRevision && repo.revisionType === config.revisionType && repo.manifestPath === config.manifestPath)) {
                throw new Error('This repository, revision, and manifest are already configured.');
            }
            let encryptedCredentials;
            if (config.authType === 'basic') {
                assertEncryption();
                try { encryptedCredentials = safeStorage.encryptString(JSON.stringify({username: candidate.username, password: candidate.password})).toString('base64'); }
                catch { throw new Error('Could not encrypt repository credentials. Unlock your OS keychain and try again.'); }
            }
            const verified = await verify({...candidate, ...config});
            const {encryptedCredentials: _oldSecret, ...previousState} = previous || {};
            let repository = {...previousState, id: previous?.id || randomUUID(), ...config, ...verified,
                autoSync: previous?.autoSync ?? true,
                ...(encryptedCredentials ? {encryptedCredentials} : {})};
            settings.set('gitops.repositories', [...repositories().filter(repo => repo.id !== repository.id), repository]);
            if (sync) {
                try { repository = await synchronize(repository, false); }
                catch { repository = repositories().find(repo => repo.id === repository.id); }
            }
            notify();
            return {repository: publicRepository(repository), repositories: repositories().map(publicRepository)};
        } finally { busy = false; }
    });
    handle(channels.VERIFY, async id => {
        if (busy) throw new Error('Repository verification is already running.');
        const repository = repositories().find(repo => repo.id === id);
        if (!repository) throw new Error('Repository no longer exists.');
        busy = true;
        try {
            const secret = repository.authType === 'basic' ? credentials(repository) : {};
            const verified = await verify({...repository, ...secret});
            const updated = {...repository, ...verified};
            settings.set('gitops.repositories', repositories().map(repo => repo.id === id ? updated : repo));
            return {repositories: repositories().map(publicRepository)};
        } finally { busy = false; }
    });
    handle(channels.SYNC, async id => {
        if (busy) throw new Error('Repository verification or synchronization is already running.');
        const repository = repositories().find(repo => repo.id === id);
        if (!repository) throw new Error('Repository no longer exists.');
        busy = true;
        try {
            await synchronize(repository);
            return {repositories: repositories().map(publicRepository)};
        } finally { busy = false; }
    });
    handle(channels.SYNC_PLUGIN, async ({id, pluginName}) => {
        if (busy) throw new Error('Another repository check is running. Please wait for it to finish.');
        const repository = repositories().find(repo => repo.id === id);
        if (!repository) throw new Error('Repository no longer exists.');
        busy = true;
        try {
            await synchronize(repository, false, pluginName);
            return {repositories: repositories().map(publicRepository)};
        } finally { busy = false; }
    });
    handle(channels.REVIEW_UPDATE, async input => {
        if(busy)throw new Error('Wait for the current repository operation to finish.');
        if(!review)throw new Error('Update review is unavailable.');
        const repository=repositories().find(item=>item.id===input?.id);
        if(!repository)throw new Error('Repository no longer exists.');
        requireDeclaredPlugin(repository.manifest.spec.plugins,input.pluginName);
        if(!input.pluginName)throw new Error('Choose a plugin update to review.');
        busy=true;
        try {
            const result=await review({source:repository,pluginName:input.pluginName,reviewId:input.reviewId,decision:input.decision,capabilities:input.capabilities});
            if(result.state==='checking')await synchronize(repository,false,input.pluginName);
            else {
                const statuses=(repository.pluginStatuses||[]).filter(status=>status.name!==input.pluginName);
                statuses.push({name:input.pluginName,state:result.state,commit:result.commit,checkedAt:new Date().toISOString()});
                const installedPlugins=(repository.installedPlugins||[]).map(plugin=>plugin.name===input.pluginName&&result.state==='synced'?{...plugin,commit:result.commit}:plugin);
                replace({...repository,pluginStatuses:statuses,installedPlugins});notify();
            }
            return {repositories:repositories().map(publicRepository)};
        } finally {busy=false;}
    });
    handle(channels.SET_INTERVAL, ({id, minutes}) => {
        if (busy) throw new Error('Wait for the current repository check to finish.');
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1439) throw new Error('Choose an interval between 00:01 and 23:59 (hours:minutes).');
        const repository = repositories().find(repo => repo.id === id);
        if (!repository) throw new Error('Repository no longer exists.');
        replace({...repository, checkIntervalMinutes: minutes}); notify();
        return {repositories: repositories().map(publicRepository)};
    });
    handle(channels.SET_AUTO_SYNC, ({id, enabled}) => {
        if (busy) throw new Error('Wait for repository synchronization to finish.');
        if (typeof enabled !== 'boolean') throw new Error('Auto-sync must be enabled or disabled.');
        const repository = repositories().find(repo => repo.id === id);
        if (!repository) throw new Error('Repository no longer exists.');
        replace({...repository, autoSync: enabled});
        notify();
        return {repositories: repositories().map(publicRepository)};
    });
    handle(channels.REMOVE, async id => {
        if (busy) throw new Error('Wait for repository verification to finish.');
        busy = true;
        try {
            await detach?.(id);
            settings.set('gitops.repositories', repositories().filter(repo => repo.id !== id));
            notify();
            return {repositories: repositories().map(publicRepository)};
        } finally { busy = false; }
    });
    let stopped = false;
    let timer;
    const syncAll = async (startup = false) => {
        if (busy || stopped || !sync) return;
        busy = true;
        try {
            for (const repository of repositories()) {
                if (stopped) break;
                if (repository.autoSync === false) continue;
                const elapsed = Date.now() - Date.parse(repository.lastCheckedAt || '');
                if (!startup && Number.isFinite(elapsed) && elapsed < (repository.checkIntervalMinutes || 5) * 60 * 1000) continue;
                try { await synchronize(repository); } catch { /* Saved on the repository for Settings. */ }
            }
        } finally { busy = false; }
    };
    return {
        start: () => {
            if (timer || stopped) return;
            void syncAll(true);
            timer = setInterval(() => { void syncAll(); }, 1000);
            timer.unref?.();
        },
        stop: () => {stopped = true; clearInterval(timer);},
    };
}
