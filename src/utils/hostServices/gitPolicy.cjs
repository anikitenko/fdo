const {failure, repository} = require('./contracts.cjs');
function target(value) {
    if (typeof value !== 'string' || /[\0\r\n]/.test(value)) throw failure('INVALID_REQUEST');
    let host, port, username, pathname;
    if (value.startsWith('ssh://')) {
        let parsed; try {parsed = new URL(value);} catch {throw failure('INVALID_REQUEST');}
        if (parsed.password || parsed.search || parsed.hash || !parsed.username) throw failure('INVALID_REQUEST');
        host = parsed.hostname.replace(/^\[|]$/g, ''); port = Number(parsed.port || 22); username = parsed.username; pathname = parsed.pathname;
    } else {
        const match = /^([a-zA-Z0-9_.-]+)@([a-zA-Z0-9.-]+):(.+)$/.exec(value);
        if (!match) throw failure('INVALID_REQUEST');
        [, username, host, pathname] = match; port = 22;
    }
    repository(pathname);
    return {host: host.toLowerCase(), port, username, repository: pathname};
}
function select(profiles, value, operation) {
    const destination = target(value);
    const matches = profiles.filter(profile => profile.policy.consumers.includes('git') &&
        profile.host.toLowerCase() === destination.host && profile.port === destination.port && profile.username === destination.username &&
        (profile.policy.repositories || []).some(rule => rule.path === destination.repository && rule.operations.includes(operation)));
    if (matches.length !== 1) throw Object.assign(failure('ACCESS_DENIED'), {gitFailure: matches.length ? 'PROFILE_AMBIGUOUS' : 'PROFILE_NOT_FOUND'});
    return {profile: matches[0], ...destination};
}
// Caller flags are an explicit grammar, never Git configuration, executable,
// proxy, hook or arbitrary transport overrides.
const reference = value => typeof value === 'string' && !/[\r\n]/.test(value) && /^(?:HEAD|[a-zA-Z0-9_][a-zA-Z0-9._/-]*)$/.test(value)
    && !value.includes('..') && !value.includes('//') && !value.endsWith('/') && !value.endsWith('.lock');
const remoteName = value => typeof value === 'string' && !/[\r\n]/.test(value) && /^[a-zA-Z0-9_][a-zA-Z0-9._/-]*$/.test(value) && !value.includes('..');
const folder = value => typeof value === 'string' && !/[\r\n]/.test(value) && /^[a-zA-Z0-9_][a-zA-Z0-9._/-]*$/.test(value) && !value.split('/').some(part => !part || part==='.' || part==='..' || part==='.git');
function isURL(value) {return typeof value === 'string' && (value.startsWith('ssh://') || value.includes('@'));}
function parse(plan) {
    if (Object.keys(plan.env || {}).length || plan.input || !Array.isArray(plan.args) || plan.args.length>128 || plan.args.some(arg => typeof arg!=='string'||arg.includes('\0')||arg.length>4096)) throw failure('INVALID_REQUEST');
    const args=[...plan.args], operation=args.shift();
    if (!['ls-remote','clone','fetch','push','pull','submodule','lfs'].includes(operation)) throw failure('INVALID_REQUEST');
    const subcommand=['submodule','lfs'].includes(operation)?args.shift():undefined;
    if(operation==='submodule'&&!['status','init','sync','add','update'].includes(subcommand)) throw failure('INVALID_REQUEST');
    if(operation==='lfs'&&!['fetch','pull','push','checkout','status','ls-files','version'].includes(subcommand)) throw failure('INVALID_REQUEST');
    const flags={
        'ls-remote':['--heads','--tags','--refs','--symref','--exit-code','--quiet','-q'],
        clone:['--single-branch','--no-tags','--bare','--no-checkout','--recurse-submodules','--recursive','--quiet','-q','--progress'],
        fetch:['--prune','--prune-tags','--tags','--no-tags','--recurse-submodules','--quiet','-q','--verbose','-v','--progress','--dry-run'],
        pull:['--ff-only','--rebase','--no-rebase','--recurse-submodules','--quiet','-q','--verbose','-v','--no-edit'],
        push:['--set-upstream','-u','--porcelain','--dry-run','--quiet','-q','--verbose','-v','--progress'],
        submodule:['--init','--recursive','--remote','--checkout','--quiet','-q','--cached'],
        lfs:['--all','--recent','--dry-run','--json','--long','-l','--name-only'],
    };
    const options=[], positional=[];
    let end=false;
    while(args.length) {
        const arg=args.shift();
        if(arg==='--'&&!end){end=true;continue;}
        if(!end&&arg.startsWith('-')) {
            const pair=/^(--(?:branch|depth|filter|jobs|include|exclude))=(.*)$/.exec(arg);
            const name=pair?pair[1]:arg;
            if(flags[operation].includes(arg)){options.push(arg);continue;}
            const allowed=operation==='clone'?['--branch','-b','--depth','--filter']:operation==='fetch'?['--depth','--filter']:operation==='submodule'?['--depth','--jobs','-j']:operation==='lfs'?['--include','--exclude']:[];
            if(!allowed.includes(name)) throw failure('INVALID_REQUEST');
            const value=pair?pair[2]:args.shift();
            if(typeof value!=='string'||!value) throw failure('INVALID_REQUEST');
            if(['--depth','--jobs','-j'].includes(name)&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>1000000)) throw failure('INVALID_REQUEST');
            if(['--branch','-b'].includes(name)&&!reference(value)) throw failure('INVALID_REQUEST');
            if(name==='--filter'&&!/^(blob:none|blob:limit=\d+[kmg]?)$/i.test(value)) throw failure('INVALID_REQUEST');
            if(['--include','--exclude'].includes(name)&&/[\r\n\0]/.test(value)) throw failure('INVALID_REQUEST');
            options.push(name,value);
        } else positional.push(arg);
    }
    let remote;
    if(['ls-remote','clone','fetch','push','pull'].includes(operation)||operation==='submodule'&&subcommand==='add'||operation==='lfs'&&['fetch','pull','push'].includes(subcommand)) remote=positional.shift()||(['fetch','pull','push','lfs'].includes(operation)?'origin':undefined);
    if(remote!==undefined){if(isURL(remote))target(remote);else if(!remoteName(remote))throw failure('INVALID_REQUEST');}
    if(['ls-remote','clone'].includes(operation)&&!remote)throw failure('INVALID_REQUEST');
    if(operation==='clone'&&(positional.length!==1||!folder(positional[0])||positional[0].includes('/')))throw failure('INVALID_REQUEST');
    if(operation==='push'&&(!positional.length||positional.length>16||positional.some(value=>!value.split(':').every(reference)||value.split(':').length>2)))throw failure('INVALID_REQUEST');
    if(['fetch','pull'].includes(operation)&&positional.some(value=>!value.split(':').every(reference)||value.split(':').length>2))throw failure('INVALID_REQUEST');
    if(operation==='ls-remote'&&positional.some(value=>!/^[a-zA-Z0-9_.*?/-]+$/.test(value)||value.includes('..')))throw failure('INVALID_REQUEST');
    if(operation==='submodule'&&positional.some(value=>!folder(value)))throw failure('INVALID_REQUEST');
    if(operation==='lfs'&&positional.some(value=>!reference(value)))throw failure('INVALID_REQUEST');
    if(operation==='pull'&&!options.some(value=>['--ff-only','--rebase','--no-rebase'].includes(value)))options.push('--ff-only');
    return {operation,subcommand,remote,rest:positional,options,policyOperation:operation==='pull'?'fetch':operation==='lfs'?(subcommand==='push'?'push':'fetch'):operation==='submodule'?(subcommand==='add'?'clone':'fetch'):operation};
}
module.exports = {target,select,parse,reference,folder,isURL};
