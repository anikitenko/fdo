import {validRange,satisfies} from 'semver';
import catalog from '../../../../contracts/web-export-tools.json';

const basename=value=>String(value).split(/[\\/]/).at(-1).replace(/\.exe$/i,'');
const token=value=>typeof value==='string' && /^[a-z0-9][a-z0-9._+-]{0,79}$/.test(value);
const packageName=value=>typeof value==='string' && /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?(?:=[a-zA-Z0-9:+.~_-]+)?$/.test(value);
const commandTool=command=>Object.entries(catalog.tools).find(([,tool])=>tool.commands.includes(command))?.[0];

export function validateToolRequirement(value) {
    if(!value || typeof value!=='object' || !token(value.id))throw new Error('Each deployment tool needs a stable id.');
    const known=catalog.tools[value.id];
    const unknown=Object.keys(value).find(key=>!['id','version','command','executable','versionArgs','installer'].includes(key));
    if(unknown)throw new Error(`Tool ${value.id}: unsupported field ${unknown}; credentials and authentication values do not belong in tool requirements.`);
    if(value.version!==undefined && (typeof value.version!=='string' || value.version.length>100 || !validRange(value.version)))throw new Error(`Tool ${value.id}: version must be a supported semver range.`);
    if(known && value.installer===undefined) {
        if(known.installer.type==='azure-cli' && !satisfies(known.version,value.version || '*'))throw new Error(`Tool ${value.id}: the trusted installer provides ${known.version}; supply an explicit package or checksum-verified artifact for another version.`);
        return {...known,id:value.id,version:value.version || known.version,source:'declared'};
    }
    if(!token(value.command))throw new Error(`Tool ${value.id}: custom tools need a command basename.`);
    if(!value.installer || !['apt','artifact','provided'].includes(value.installer.type))throw new Error(`Tool ${value.id}: choose an apt package, a checksum-verified artifact or a provided executable; shell installers are not accepted.`);
    const versionArgs=value.versionArgs || ['--version'];
    if(!Array.isArray(versionArgs) || versionArgs.length>16 || versionArgs.some(arg=>typeof arg!=='string' || arg.length>256 || /[\0\r\n]/.test(arg)))throw new Error(`Tool ${value.id}: invalid version probe arguments.`);
    let installer,executable;
    if(value.installer.type==='provided') {
        if(typeof value.executable!=='string' || !/^\/(?:[a-zA-Z0-9._+-]+\/)*[a-zA-Z0-9._+-]+$/.test(value.executable) || value.executable.split('/').some(part=>['.','..'].includes(part)))throw new Error(`Tool ${value.id}: specify an absolute provided executable path.`);
        installer={type:'provided'};executable=value.executable;
    } else if(value.installer.type==='apt') {
        const packages=value.installer.packages;
        if(!Array.isArray(packages) || !packages.length || packages.length>32 || packages.some(name=>!packageName(name)))throw new Error(`Tool ${value.id}: invalid Debian package specification.`);
        if(typeof value.executable!=='string' || !/^\/(?:usr\/bin|usr\/local\/bin|bin)\/[a-zA-Z0-9._+-]+$/.test(value.executable))throw new Error(`Tool ${value.id}: specify the installed executable under /usr/bin, /usr/local/bin or /bin.`);
        installer={type:'apt',packages};executable=value.executable;
    } else {
        const platforms=value.installer.platforms;
        if(!platforms || typeof platforms!=='object' || Array.isArray(platforms) || !Object.keys(platforms).length || Object.keys(platforms).some(key=>!['linux/amd64','linux/arm64'].includes(key)))throw new Error(`Tool ${value.id}: declare artifact platforms linux/amd64 and/or linux/arm64.`);
        const artifacts={};
        for(const [platform,artifact] of Object.entries(platforms)) {
            const url=new URL(artifact.url);
            if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/i.test(artifact.sha256 || '') || !['file','tar.gz','zip'].includes(artifact.format))throw new Error(`Tool ${value.id}: artifacts need a public HTTPS URL, SHA-256 digest and file, tar.gz or zip format.`);
            if(artifact.format!=='file' && (typeof artifact.member!=='string' || !/^[a-zA-Z0-9._+-]+(?:\/[a-zA-Z0-9._+-]+)*$/.test(artifact.member) || artifact.member.split('/').some(part=>['.','..'].includes(part))))throw new Error(`Tool ${value.id}: specify one safe executable archive member.`);
            artifacts[platform]={url:url.href,sha256:artifact.sha256.toLowerCase(),format:artifact.format,...(artifact.format==='file'?{}:{member:artifact.member})};
        }
        installer={type:'artifact',platforms:artifacts};executable='/opt/fdo-tools/bin/'+value.command;
    }
    return {...(known?.authentication?{authentication:known.authentication}:{}),id:value.id,commands:[value.command],executable,version:value.version || '*',versionArgs,installer,source:'declared-custom'};
}

// Permissions define allowed choices. They do not require every executable in a
// fallback scope. A single command family can be inferred for legacy plugins;
// scopes with alternatives need an explicit dependency declaration.
export function createToolchainPlan(packageSource,processScopes,capabilities=[]) {
    const pkg=JSON.parse(packageSource || '{}'),declaration=pkg.fdo?.deployment;
    if(declaration!=null && (typeof declaration!=='object' || Array.isArray(declaration)))throw new Error('fdo.deployment must be an object with schemaVersion and tools.');
    if(declaration && Object.keys(declaration).some(key=>!['schemaVersion','tools','baseImage'].includes(key)))throw new Error('fdo.deployment supports only schemaVersion, tools and baseImage; keep credentials and login configuration in deployment runtime settings.');
    if(declaration && (declaration.schemaVersion!==catalog.schemaVersion || !Array.isArray(declaration.tools) || declaration.tools.length>64))throw new Error(`fdo.deployment requires schemaVersion: ${catalog.schemaVersion} and tools: [].`);
    const baseImage=declaration?.baseImage || catalog.baseImage;
    if(declaration?.baseImage && (typeof baseImage!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(baseImage)))throw new Error('fdo.deployment.baseImage must be an immutable image reference ending in @sha256:<digest>, with Node 24 and Debian bookworm.');
    const selected=new Map(),unresolved=[],warnings=[];
    for(const requirement of declaration?.tools || []) {
        const tool=validateToolRequirement(requirement);
        if(selected.has(tool.id) || [...selected.values()].some(item=>item.commands.some(command=>tool.commands.includes(command))))throw new Error(`Duplicate deployment tool or command: ${tool.id}.`);
        selected.set(tool.id,tool);
    }
    for(const scope of processScopes) {
        const commands=[...new Set(scope.allowedExecutables.map(basename))];
        const missing=commands.filter(command=>![...selected.values()].some(tool=>tool.commands.includes(command)));
        if(declaration)continue; // An explicit list is the plugin's complete dependency intent.
        const choices=[...new Set(commands.map(command=>commandTool(command) || command))];
        if(choices.length===1) {
            const id=choices[0];
            if(!selected.has(id))selected.set(id,catalog.tools[id]?{...catalog.tools[id],id,source:'inferred-single-tool-scope'}:{id,commands,executable:'/opt/fdo-tools/bin/'+commands[0],version:'*',versionArgs:['--version'],installer:null,source:'inferred-single-tool-scope'});
        } else if(missing.every(command=>catalog.tools[commandTool(command)]?.installer.type==='provided')) {
            for(const command of missing){const id=commandTool(command);selected.set(id,{...catalog.tools[id],id,source:'provided'});}
        } else if(missing.length)unresolved.push({scope:scope.scope,commands,reason:'This scope permits alternative tools. Declare the tools the plugin actually needs in package.json fdo.deployment.tools.'});
    }
    for(const capability of capabilities.filter(id=>id.startsWith('system.process.scope.'))) {
        const scope=capability.slice('system.process.scope.'.length);
        if(!processScopes.some(policy=>policy.scope===scope))unresolved.push({scope,commands:[],reason:'No approved process policy was resolved for this scope. Add its policy in Manage Plugins and export again.'});
    }
    const executables={};
    const tools=[...selected.values()].map(tool=>{
        const aliases=processScopes.flatMap(scope=>scope.allowedExecutables).filter(command=>tool.commands.includes(basename(command)));
        for(const alias of aliases){const command=basename(alias);executables[alias]=command===tool.commands[0]?tool.executable:tool.executable.slice(0,tool.executable.lastIndexOf('/')+1)+command;}
        return {...tool,aliases:[...new Set(aliases)],status:tool.installer?'planned':'needs-definition'};
    });
    if(unresolved.length || tools.some(tool=>!tool.installer))warnings.push('Tool requirements need configuration before the image can build. Update fdo.deployment.tools and export again, or complete deployment/toolchain.json in the exported project.');
    return {schemaVersion:catalog.schemaVersion,baseImage,platform:'linux',basePackages:catalog.basePackages,tools,unresolved,warnings,executables};
}
