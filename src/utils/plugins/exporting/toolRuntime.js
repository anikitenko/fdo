// Serialized into each project. Installs run only during an explicit image build;
// export/review never downloads or executes plugin-provided tools on the desktop.
export function toolRuntime() {
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
    const {spawnSync}=require('node:child_process');
    const {coerce,satisfies}=require(path.join(__dirname,'tool-semver.cjs'));
    const root=path.resolve(__dirname,'..'),manifest=()=>JSON.parse(fs.readFileSync(path.join(root,'deployment/toolchain.json'),'utf8'));
    const platform=()=>process.platform+'/'+({x64:'amd64',arm64:'arm64'}[process.arch] || process.arch);
    const run=(command,args,options={})=>{
        const result=spawnSync(command,args,{encoding:'utf8',timeout:options.timeout || 20000,maxBuffer:options.maxBuffer || 1048576,...options});
        if(result.error || result.status!==0)throw new Error('Tool command failed: '+path.basename(command)+' (exit '+(result.status ?? result.error?.code)+').');
        return result;
    };
    const settings=()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'deployment/services.json'),'utf8'));}catch{return {};}};
    const check=({strict=false,writeReceipt=false}={})=>{
        const plan=manifest(),issues=[],tools=[],overrides=settings().executables || {};
        if(plan.schemaVersion!==1)throw new Error('Unsupported toolchain schema.');
        for(const item of plan.unresolved || [])issues.push('Scope '+item.scope+': '+item.reason);
        const probeHome=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-tool-check-'));
        try{for(const tool of plan.tools) {
            const executable=tool.aliases?.map(alias=>overrides[alias]).find(Boolean) || tool.executable;
            try {
                const result=run(executable,tool.versionArgs || ['--version'],{env:{PATH:process.env.PATH,HOME:probeHome,TMPDIR:os.tmpdir(),LANG:'C.UTF-8',AZURE_CONFIG_DIR:path.join(probeHome,'azure'),CLOUDSDK_CONFIG:path.join(probeHome,'gcloud')}}),version=coerce(result.stdout+'\n'+result.stderr)?.version || null;
                if(tool.version!=='*' && (!version || !satisfies(version,tool.version))){issues.push(tool.id+': Expected '+tool.version+'; found '+(version || 'an unrecognized version')+'.');tools.push({id:tool.id,executable,requiredVersion:tool.version,status:'unavailable'});continue;}
                tools.push({id:tool.id,executable,version,requiredVersion:tool.version,status:'ready'});
            }catch(error){issues.push(tool.id+': '+error.message);tools.push({id:tool.id,executable,requiredVersion:tool.version,status:'unavailable'});}
        }}finally{fs.rmSync(probeHome,{recursive:true,force:true});}
        const result={schemaVersion:1,platform:platform(),ok:issues.length===0,tools,issues};
        if(strict && !result.ok)throw new Error('Toolchain is not ready:\n'+issues.map(value=>'- '+value).join('\n')+'\nUpdate package.json fdo.deployment.tools and export again, or complete deployment/toolchain.json.');
        if(writeReceipt)fs.writeFileSync(path.join(root,'deployment/toolchain.lock.json'),JSON.stringify(result,null,2)+'\n');
        return result;
    };
    const aptPackage=value=>typeof value==='string' && /^[a-z0-9][a-z0-9+.-]*(?::[a-z0-9]+)?(?:=[a-zA-Z0-9:+.~_-]+)?$/.test(value);
    const download=async(url,maximum=268435456)=>{
        for(let count=0;count<6;count++) {
            const target=new URL(url);if(target.protocol!=='https:' || target.username || target.password)throw new Error('Tool downloads require HTTPS without embedded credentials.');
            const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(120000)});
            if([301,302,303,307,308].includes(response.status)){url=new URL(response.headers.get('location'),target).href;await response.body?.cancel();continue;}
            if(!response.ok)throw new Error('Tool download failed (HTTP '+response.status+').');
            const chunks=[];let size=0;
            for await(const chunk of response.body){size+=chunk.length;if(size>maximum){await response.body.cancel?.().catch(()=>{});throw new Error('Tool artifact exceeds the download size limit.');}chunks.push(Buffer.from(chunk));}
            return Buffer.concat(chunks);
        }
        throw new Error('Too many tool download redirects.');
    };
    const install=async()=>{
        const plan=manifest();
        if(plan.schemaVersion!==1 || !Array.isArray(plan.tools) || !Array.isArray(plan.basePackages) || process.platform!=='linux')throw new Error('Tool installation targets Linux containers.');
        if(plan.unresolved?.length)throw new Error('Tool choices are unresolved: '+plan.unresolved.map(item=>item.scope+': '+item.reason).join('\n'));
        for(const tool of plan.tools){if(tool.installer && !['provided','apt','artifact','azure-cli'].includes(tool.installer.type))throw new Error('Unknown installer for tool '+tool.id+'.');if(!tool.installer)throw new Error('Tool '+tool.id+' needs an apt or checksum-verified artifact definition in deployment/toolchain.json.');}
        const packages=new Set(plan.basePackages || []);
        for(const tool of plan.tools){
            if(tool.installer.type==='apt')for(const item of tool.installer.packages || [])packages.add(item);
            if(tool.installer.type==='azure-cli')for(const item of ['ca-certificates','gnupg'])packages.add(item);
            if(tool.installer.type==='artifact'){const artifact=tool.installer.platforms?.[platform()];if(!artifact)throw new Error('Tool '+tool.id+' has no artifact for '+platform()+'. Add that platform or build for a declared platform.');if(artifact.format==='zip')packages.add('unzip');if(artifact.format==='tar.gz')packages.add('tar');}
        }
        if([...packages].some(item=>!aptPackage(item)))throw new Error('Invalid Debian package specification in toolchain.');
        if(packages.size){run('apt-get',['update'],{timeout:300000,maxBuffer:8388608,stdio:'inherit'});run('apt-get',['install','-y','--no-install-recommends',...[...packages].sort()],{timeout:600000,stdio:'inherit'});}
        const azure=plan.tools.find(tool=>tool.installer.type==='azure-cli');
        if(azure){
            if(!/^[a-zA-Z0-9:+.~_-]+$/.test(azure.installer.packageVersion))throw new Error('Invalid Azure CLI package version.');
            const arch={x64:'amd64',arm64:'arm64'}[process.arch];if(!arch)throw new Error('Azure CLI installer has no package for '+platform()+'.');
            fs.mkdirSync('/etc/apt/keyrings',{recursive:true});
            run('gpg',['--batch','--yes','--dearmor','-o','/etc/apt/keyrings/microsoft.gpg'],{input:await download('https://packages.microsoft.com/keys/microsoft.asc',1048576)});
            fs.writeFileSync('/etc/apt/sources.list.d/azure-cli.list',`deb [arch=${arch} signed-by=/etc/apt/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/azure-cli/ bookworm main\n`);
            run('apt-get',['update'],{timeout:300000,stdio:'inherit'});run('apt-get',['install','-y','--no-install-recommends','azure-cli='+azure.installer.packageVersion],{timeout:600000,stdio:'inherit'});
        }
        for(const tool of plan.tools.filter(tool=>tool.installer.type==='artifact')) {
            const artifact=tool.installer.platforms[platform()],data=await download(artifact.url);
            if(!/^[a-f0-9]{64}$/i.test(artifact.sha256 || '') || crypto.createHash('sha256').update(data).digest('hex')!==artifact.sha256.toLowerCase())throw new Error('SHA-256 verification failed for tool '+tool.id+'.');
            if(!/^[a-z0-9][a-z0-9._+-]{0,79}$/.test(tool.commands?.[0]) || tool.executable!=='/opt/fdo-tools/bin/'+tool.commands[0])throw new Error('Invalid tool artifact installation path.');
            let executable=data;
            const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-tool-'));
            try {
                if(artifact.format!=='file') {
                    if(!/^[a-zA-Z0-9._+-]+(?:\/[a-zA-Z0-9._+-]+)*$/.test(artifact.member || '') || artifact.member.split('/').some(part=>['.','..'].includes(part)))throw new Error('Invalid archive member.');
                    const archive=path.join(temporary,'artifact');fs.writeFileSync(archive,data);
                    const zip=artifact.format==='zip';if(!zip && artifact.format!=='tar.gz')throw new Error('Unknown archive format.');
                    const names=run(zip?'unzip':'tar',zip?['-Z1',archive]:['-tzf',archive],{maxBuffer:8388608}).stdout.trim().split('\n');
                    if(names.filter(name=>name===artifact.member).length!==1)throw new Error('The executable must appear exactly once in the verified archive.');
                    // Read one member to stdout. Never extract archive paths or links into the image filesystem.
                    executable=run(zip?'unzip':'tar',zip?['-p',archive,artifact.member]:['-xOzf',archive,'--',artifact.member],{encoding:'buffer',maxBuffer:134217728}).stdout;
                }
                if(!executable.length)throw new Error('Empty tool executable.');
                fs.mkdirSync(path.dirname(tool.executable),{recursive:true});fs.writeFileSync(tool.executable,executable,{mode:0o755});fs.chmodSync(tool.executable,0o755);
            }finally{fs.rmSync(temporary,{recursive:true,force:true});}
        }
        const result=check({strict:true,writeReceipt:true});
        fs.rmSync('/var/lib/apt/lists',{recursive:true,force:true});return result;
    };
    return {check,install};
}
