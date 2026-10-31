const recipes={
    process:{title:'Scoped command execution needs a web backend adapter',
        steps:['Implement execution in the standalone backend or an authenticated remote execution service; the current exporter has no scoped process adapter.',
            'Map each declared process scope to installed container tools, allowed arguments, working directories and environment-key names. Desktop executable paths and CLI login sessions are not portable.',
            'Preserve request/response envelopes, dry-run behavior, timeouts, output limits and confirmation checks. Keep credentials and execution out of browser code.',
            'For Azure CLI workflows, provision az and a workload identity or service principal on the execution target. Bind it to the intended tenant/subscriptions and Azure RBAC permissions. Do not reuse a desktop az login cache.'],
        verify:['An allowed read command completes through the converted action API.','An unapproved executable, argument, working directory or environment key is denied.','A mutation still requires the plugin’s existing explicit confirmation. A timeout reports an unknown outcome rather than retrying a mutation.']},
    filesystem:{title:'Filesystem targets need an explicit deployment mapping',steps:['Map each scope to a persistent container volume or remote file service.','Implement the same path, operation, symlink and confirmation restrictions in the web backend. Do not map a desktop path to the container host automatically.'],verify:['Allowed operations work on the configured target.','Out-of-scope paths, traversal and symlink escapes are denied.']},
    authentication:{title:'Desktop authentication needs a standalone identity service',steps:['Configure web client registration, redirect origins and server-side sessions.','Replace desktop auth/session broker calls with an authenticated backend adapter; keep token refresh and credentials out of browser storage.'],verify:['Login, refresh and logout work without FDO.','Sessions and authorization remain isolated between users; expired/revoked sessions are denied.']},
    ai:{title:'AI routing needs standalone provider configuration',steps:['Implement provider and assistant routing in the web backend.','Inject provider credentials through deployment secret references; preserve request limits and cancellation. Desktop assistant settings are not exported.'],verify:['An authorized assistant request succeeds.','Unauthorized providers, missing credentials and cancellation produce explicit errors.']},
    ssh:{title:'SSH needs a standalone connection service',steps:['Enroll the intended remote profiles and pinned host fingerprints on a backend SSH service.','Provide credentials using deployment secrets; preserve command restrictions and cancellation. Never disable host verification to unblock export.'],verify:['An allowed command succeeds without FDO.','A changed host fingerprint or unapproved command is rejected.']},
    'ssh-streaming':{title:'SSH events need a web stream adapter',steps:['Provide authenticated status/event streaming with cancellation, connection ownership and backpressure.'],verify:['Disconnecting the browser releases stream resources and revokes access.']},
    'ssh-terminal':{title:'Terminals need an authenticated web gateway',steps:['Implement terminal ownership, browser rendering, resize, cancellation, timeouts and output limits in a standalone gateway.'],verify:['An authorized terminal session works; another user cannot attach or write to it.']},
    x11:{title:'X11 needs a separate display gateway',steps:['Provision a browser display gateway and explicit display authorization. A web container has no desktop display by default.'],verify:['An authorized display session works and closes when its owner disconnects.']},
    'raw-network':{title:'Raw protocols need a deployment-specific adapter',steps:['Implement the required TCP, UDP or DNS operation in the backend and carry over destination restrictions.','Configure the platform network path; an HTTP ingress endpoint is not a raw socket service.'],verify:['The approved protocol and destination work; other destinations remain denied.']},
    tray:{title:'Tray actions need a web interaction design',steps:['Replace tray actions with web controls or an explicit background job service.','Keep the original desktop behavior in the desktop project; do not remove its capability to conceal the missing web implementation.'],verify:['Each original action has a visible, tested web equivalent.']},
    elevation:{title:'Interactive elevation needs a deployment-owned operation',steps:['Replace sudo prompts with a narrowly authorized backend/remote operation.','Configure only the required service identity; do not enable privileged containers as a workaround.'],verify:['The approved operation succeeds while unrelated privileged operations are denied.']},
};

export function attachWebExportRecovery(report) {
    const remaining=new Set(report.blockers),tasks=[];
    const add=task=>tasks.push({id:'recovery-'+tasks.length,...task});
    for(const adapter of report.adapters || [])if(adapter.status==='blocked') {
        remaining.delete(adapter.description);
        const recipe=recipes[adapter.id] || {title:'Standalone service adapter required',steps:[adapter.description],verify:['Verify behavior without FDO before enabling deployable export.']};
        const requirements=(report.requirements || []).filter(item=>item.adapter===adapter.id);
        add({kind:'exporter',owner:'FDO exporter / web backend engineer',adapter:adapter.id,...recipe,
            capabilities:requirements.map(item=>item.capability),locations:(report.locations || []).filter(item=>item.adapter===adapter.id),
            message:adapter.description,reviewWhen:'After a real adapter is implemented and enabled in the conversion contract, or the plugin source uses an already supported standalone service.'});
    }
    const permissionMessages=[...remaining].filter(message=>message.includes('is declared but is not approved'));
    if(permissionMessages.length) {
        permissionMessages.forEach(message=>remaining.delete(message));
        add({kind:'permission',owner:'Plugin engineer',title:'Review requested capability grants',message:permissionMessages.join(' '),
            capabilities:(report.requirements || []).filter(item=>permissionMessages.some(message=>message.includes('Capability '+item.capability+' is '))).map(item=>item.capability),locations:[],
            steps:['Open Capabilities in Manage Plugins and review each missing grant. Approve only operations you intend this plugin to perform, then save.', 'Granting a capability does not implement its missing web adapter. Those requirements remain separate.'],verify:['The reviewed declaration and approved grants agree.'],reviewWhen:'After saving a deliberate permission change.'});
    }
    for(const message of remaining) {
        const match=message.match(/^(\/[^:]+)(?::(\d+))?:\s*/);
        const exporter=/helper|SDK export|converter|web conversion contract|standalone dependency conversion|build-time module|browser library/.test(message);
        add({kind:exporter?'exporter':'source',owner:exporter?'FDO exporter engineer':'Plugin engineer',title:exporter?'Converter support is required':'Source change or build repair required',message,
            locations:match?[{file:match[1],line:Number(match[2] || 1)}]:message.startsWith('Runtime capability declaration:')?(report.locations || []).filter(item=>item.adapter==='declaration'):[],capabilities:[],
            steps:exporter?['Implement and test the missing converter behavior in FDO. Repeated review of unchanged plugin source cannot add exporter support.']:
                ['Open the indicated runtime source and address this specific diagnostic. Preserve its behavior and capability checks.','Save and redeploy the source before reviewing the installed plugin again. For GitOps-managed plugins, edit the repository and synchronize the reviewed commit.'],
            verify:['The diagnostic is absent from a new review and the affected behavior passes its interaction tests.'],reviewWhen:exporter?'After upgrading to an exporter that implements this conversion.':'After the corrected source has been installed or synchronized.'});
    }
    report.recovery={status:tasks.length?'migration-required':'ready',tasks,
        summary:tasks.some(task=>task.kind==='exporter')?'This exporter cannot yet convert every required operation. Reviewing unchanged source will not resolve missing adapters.':'Apply the source or permission changes below before reviewing the installed plugin again.',
        nextStep:tasks.length?'Export a migration work package to work on a separate source copy with this report and verification plan.':'Configure deployment values in the exported application README.',
        unchanged:'Export review is read-only. Your installed plugin, grants and desktop data were not changed.',
        reviewWhen:tasks.map(task=>task.reviewWhen).filter((item,index,array)=>array.indexOf(item)===index)};
    return report;
}

export function migrationBrief(report,name='Plugin') {
    const recovery=report.recovery || attachWebExportRecovery(report).recovery;
    return `# ${name}: web migration plan\n\nSource fingerprint: ${report.sourceFingerprint || 'not recorded'}\nConverter contract: ${report.contractVersion}\n\n${recovery.unchanged}\n\n${recovery.summary}\n\nThis is an engineering work package, not a deployable web application. Do not mark the export ready by disabling capabilities, deleting behavior, or substituting no-op services. Keep credentials and actual secret values out of source and migration notes.\n\n## Runtime scope\n\nEntry: ${report.analysis?.entry || 'see package.json source'}\n${report.analysis?.included?.length || 0} runtime source files; ${report.analysis?.excluded?.length || 0} unimported files excluded from conversion checks. Imported scripts are still checked.\n\n## Required work\n\n`+
        recovery.tasks.map((task,index)=>`### ${index+1}. ${task.title}\n\nOwner: ${task.owner}\n${task.message}\n\n${task.locations?.length?'Evidence:\n'+task.locations.map(item=>'- '+(item.file || item.path)+':'+item.line+(item.symbol?' — '+item.symbol:'')).join('\n')+'\n\n':''}${task.capabilities?.length?'Capabilities: '+task.capabilities.join(', ')+'\n\n':''}${task.steps.map((step,i)=>(i+1)+'. '+step).join('\n')}\n\nVerify:\n${task.verify.map(item=>'- '+item).join('\n')}\n\n${task.adapter==='process'?'Azure CLI authentication reference: https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli\n\n':''}Review again: ${task.reviewWhen}\n`).join('\n')+
        '\n## Finish and recovery\n\n1. Extract this work package to a separate directory. Keep original-plugin as the baseline and edit a copy. Initialize version control or make a snapshot before changes.\n2. Implement the listed source changes or standalone adapters and run the listed verification. An adapter gap is FDO/backend engineering work; it cannot be cleared by approving more permissions.\n3. If plugin source changes, save/deploy it to the installed plugin. If GitOps-managed, commit to its repository and synchronize. Then use Review installed version.\n4. If only FDO exporter support changes, rebuild or upgrade FDO and review the same installed plugin.\n5. For deployment-only settings, use the generated web README after conversion succeeds; changing cloud settings does not remove an exporter implementation gap.\n6. To abandon migration, discard the working copy. This work package never modified the installed plugin. To undo a later deliberate source deployment, restore its IDE snapshot or synchronize the previous reviewed Git commit.\n';
}

export function createMigrationWorkPackage(snapshot,report,name,plugin={}) {
    const requested=new Set(report.capabilities || []);
    const fields=(value,names)=>Object.fromEntries(names.filter(key=>Array.isArray(value[key]) || ['string','number','boolean'].includes(typeof value[key])).map(key=>[key,Array.isArray(value[key])
        ?value[key].filter(item=>typeof item==='string' && (key!=='allowedEnvKeys' || /^[a-z_][a-z0-9_]*$/i.test(item))):value[key]]));
    const processScopes=(plugin.customProcessScopes || []).filter(scope=>requested.has('system.process.scope.'+scope.scope)).map(scope=>({
        ...fields(scope,['scope','allowedExecutables','allowedCwdRoots','allowedEnvKeys','timeoutCeilingMs','requireConfirmation','policyVersion']),
        ...(scope.argumentPolicy?{argumentPolicy:fields(scope.argumentPolicy,['version','mode','allowedFirstArgs','deniedFirstArgs','allowedLeadingOptions','pathRestrictedLeadingOptions'])}:{}),
    }));
    const filesystemScopes=(plugin.customFilesystemScopes || []).filter(scope=>requested.has('system.fs.scope.'+scope.scope)).map(scope=>fields(scope,['scope','allowedRoots','allowedOperationTypes','requireConfirmation','policyVersion']));
    const policy={purpose:'Desktop policy reference only. These are not enabled container grants. Verify the full active policy, remap targets and implement enforcement before deployment.',
        declaredCapabilities:report.capabilities || [],approvedCapabilities:plugin.capabilities || [],processScopes,filesystemScopes,
        note:'Only available plugin-owned policy fields are included. Shared/builtin policies and additional constraints must be reviewed in Manage Plugins; absent fields never mean unrestricted access. Environment variable values and credentials are excluded.'};
    const files={'MIGRATION_PLAN.md':migrationBrief(report,name),'conversion-report.json':JSON.stringify(report,null,2)+'\n',
        'DESKTOP_POLICY_REFERENCE.json':JSON.stringify(policy,null,2)+'\n',
        'README.md':'# Web migration work package\n\nStart with MIGRATION_PLAN.md. This archive is not deployable. original-plugin is a source baseline; edit a copy. No installed plugin or permissions were changed. Desktop credentials, environment files, dependencies and build outputs are excluded. Authored source literals still require normal review before sharing.\n',
        '.gitignore':'node_modules/\n.env\n.env.*\n*.enc\ndata/\n'};
    files['MIGRATION_PLAN.md']+='\n## Desktop policy reference\n\nDESKTOP_POLICY_REFERENCE.json records available plugin-owned scope restrictions for comparison. It is not an enabled container policy. Verify the full active policy in Manage Plugins, remap paths/tools and implement enforcement. Environment key names may be listed; their values and credentials are excluded. Missing constraints never mean unrestricted access.\n';
    for(const [file,content] of Object.entries(snapshot.virtual)) {
        if(!/\.(?:[cm]?[jt]sx?|css|json|md)$/.test(file) || /(?:^|\/)(?:\.git|node_modules|dist|logs|data)(?:\/|$)/i.test(file) || /(?:^|\/)(?:credentials|secrets)[^/]*\.json$/i.test(file))continue;
        if(!file.startsWith('/') || file.includes('\\') || file.split('/').includes('..'))continue;
        files['original-plugin'+file]=content;
    }
    return files;
}
