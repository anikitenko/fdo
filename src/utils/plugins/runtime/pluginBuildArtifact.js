// esbuild emits CommonJS. A package's source/module entry must never become
// the destination for that bundle in the editor or exported workspace.
function virtualPath(value) {
    if (typeof value !== 'string' || !value || /[\0?#:]/.test(value)) return null;
    const normalized=value.replace(/\\/g,'/').replace(/^\/+/, '');
    const segments=normalized.split('/').filter(part=>part && part!=='.');
    if (!segments.length || segments.includes('..')) return null;
    return segments.join('/');
}
export function pluginBuildEntrypoint(latestContent) {
    const manifest=JSON.parse(latestContent['/package.json']);
    const source=virtualPath(manifest.source || 'index.ts');
    const candidates=[manifest.main,manifest.module,'dist/index.cjs'];
    for(const candidate of candidates){
        const entry=virtualPath(candidate);
        if(!entry || entry===source || !/\.(?:cjs|js)$/i.test(entry) || manifest.type==='module' && !/\.cjs$/i.test(entry))continue;
        // Existing JavaScript outside dist is authored source, too.
        if(Object.hasOwn(latestContent,'/'+entry) && !entry.startsWith('dist/'))continue;
        return entry;
    }
    // Even an unusual source inside dist must remain separate from runtime.
    for(let suffix=1;;suffix++){
        const entry=`dist/plugin-runtime-${suffix}.cjs`;
        if(entry!==source && !Object.hasOwn(latestContent,'/'+entry))return entry;
    }
}
