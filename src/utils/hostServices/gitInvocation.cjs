const path=require('node:path');
const fs=require('node:fs/promises');
const {failure}=require('./contracts.cjs');
const {target,folder}=require('./gitPolicy.cjs');
const invalid=reason=>Object.assign(failure('INVALID_REQUEST'),{gitFailure:reason});
function configuration(buffer) {
    const result=new Map();
    for(const entry of buffer.toString('utf8').split('\0').filter(Boolean)){const at=entry.indexOf('\n');if(at<0)throw invalid('UNSAFE_REPOSITORY_CONFIG');const name=entry.slice(0,at),value=entry.slice(at+1);if(!result.has(name))result.set(name,[]);result.get(name).push(value);}
    return result;
}
function checkConfiguration(config) {
    for(const [key,values] of config) {
        const name=key.toLowerCase();
        if(/^(include\.|includeif\.|url\..*\.(insteadof|pushinsteadof)$|lfs\.(customtransfer\.|extension\.|standalonetransferagent$|storage$))/.test(name)
            || /^(?:http|https)\./.test(name)
            || /^remote\..*\.(?:proxy|vcs|uploadpack|receivepack|lfsurl|lfspushurl)$/.test(name)
            || name==='core.alternaterefscommand'
            || /^merge\..*\.driver$/.test(name)
            || /^filter\.(?!lfs\.).*\.(clean|smudge|process)$/.test(name)
            || /^submodule\..*\.update$/.test(name)&&values.some(value=>value.startsWith('!')))throw invalid('UNSAFE_REPOSITORY_CONFIG');
    }
}
function remote(config,name,push=false) {
    const urls=config.get(`remote.${name}.${push?'pushurl':'url'}`)||config.get(`remote.${name}.url`);
    if(!urls||urls.length!==1)throw invalid('REMOTE_NOT_FOUND');
    target(urls[0]);return urls[0];
}
function canonical(value) {
    const endpoint=target(value);
    return endpoint.repository.startsWith('/')?`ssh://${endpoint.username}@${endpoint.host.includes(':')?'['+endpoint.host+']':endpoint.host}:${endpoint.port}${endpoint.repository}`:`${endpoint.username}@${endpoint.host}:${endpoint.repository}`;
}
function helperTarget(args) {
    if(!Array.isArray(args)||args.length>128||args.some(arg=>typeof arg!=='string'||arg.length>4096||arg.includes('\0')))throw invalid('HELPER_ARGUMENTS_REJECTED');
    const rest=[...args];let port=22,user;
    while(rest[0]?.startsWith('-')) {
        const arg=rest.shift();if(arg==='--')break;if(arg==='-T')continue;
        if(arg==='-p'){port=Number(rest.shift());continue;}if(/^-p\d+$/.test(arg)){port=Number(arg.slice(2));continue;}
        if(arg==='-l'){user=rest.shift();continue;}
        if(arg==='-o'){if(!['BatchMode=yes','SendEnv=GIT_PROTOCOL','IdentitiesOnly=yes'].includes(rest.shift()))throw invalid('HELPER_ARGUMENTS_REJECTED');continue;}
        throw invalid('HELPER_ARGUMENTS_REJECTED');
    }
    const endpoint=rest.shift(), raw=rest.join(' ');
    const hostMatch=/^(?:([^@\s]+)@)?(\[[a-fA-F0-9:]+]|[a-zA-Z0-9.-]+)$/.exec(endpoint||'');
    if(!hostMatch||!Number.isInteger(port)||port<1||port>65535)throw invalid('HELPER_ARGUMENTS_REJECTED');
    const command=/^(git-(?:upload|receive)-pack|git-lfs-(?:authenticate|transfer))\s+(?:'([^']+)'|"([^"]+)"|([^\s]+))(?:\s+(download|upload))?$/.exec(raw);
    if(!command)throw invalid('HELPER_ARGUMENTS_REJECTED');
    const username=hostMatch[1]||user, host=hostMatch[2].replace(/^\[|]$/g,''), repo=command[2]||command[3]||command[4];
    if(!username)throw invalid('HELPER_ARGUMENTS_REJECTED');
    const isLfs=command[1].startsWith('git-lfs-');if(isLfs!==!!command[5])throw invalid('HELPER_ARGUMENTS_REJECTED');
    const url=repo.startsWith('/')?`ssh://${username}@${host.includes(':')?'['+host+']':host}:${port}${repo}`:`${username}@${host}:${repo}`;
    const parsed=target(url);if(parsed.port!==port)throw invalid('HELPER_ARGUMENTS_REJECTED');
    return {url,service:command[1],direction:command[5],repository:repo,command:command[1]+" '"+repo+"'"+(command[5]?' '+command[5]:''),...parsed};
}
async function childDirectory(root,relative) {
    if(!folder(relative))throw invalid('UNSAFE_REPOSITORY_CONFIG');
    const base=await fs.realpath(root),child=await fs.realpath(path.join(root,relative));
    if(!child.startsWith(base+path.sep))throw invalid('UNSAFE_REPOSITORY_CONFIG');
    return child;
}
function submodules(config,parent) {
    const modules=[];
    for(const [name,values] of config) {
        if(!/^submodule\..*\.path$/.test(name))continue;
        const relative=values[0],urls=config.get(name.slice(0,-4)+'url');
        if(values.length!==1||!folder(relative)||!urls||urls.length!==1)throw invalid('UNSAFE_REPOSITORY_CONFIG');
        let url=urls[0];
        if(/^\.\.?\//.test(url)) {
            const endpoint=target(parent),repo=path.posix.normalize(endpoint.repository+'/'+url);
            url=endpoint.repository.startsWith('/')?`ssh://${endpoint.username}@${endpoint.host.includes(':')?'['+endpoint.host+']':endpoint.host}:${endpoint.port}${repo}`:`${endpoint.username}@${endpoint.host}:${repo}`;
        }
        target(url);modules.push({path:relative,url});
    }
    if(modules.length>64)throw invalid('UNSAFE_REPOSITORY_CONFIG');return modules;
}
module.exports={configuration,checkConfiguration,remote,canonical,helperTarget,childDirectory,submodules,invalid};
