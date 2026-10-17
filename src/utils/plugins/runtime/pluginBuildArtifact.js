// esbuild emits CommonJS. A package's source/module entry must never become
// the destination for that bundle in the editor or exported workspace.
function virtualPath(value) {
    if (typeof value !== 'string' || !value || /[\0?#:]/.test(value)) return null;
    const normalized=value.replace(/\\/g,'/').replace(/^\/+/, '');
    const segments=normalized.split('/').filter(part=>part && part!=='.');
    if (!segments.length || segments.includes('..')) return null;
    return segments.join('/');
}
// Source workspaces can declare package.source, point main at TypeScript, or
// use the editor's conventional index.ts without a source field.
export function pluginBuildSource(latestContent) {
    const manifest = JSON.parse(latestContent['/package.json']);
    if (manifest.source !== undefined) {
        const source = virtualPath(manifest.source);
        if (!source) throw new Error('package.json source must be a file path inside the plugin.');
        return source;
    }
    const main = virtualPath(manifest.main);
    if (main && /\.(?:[cm]?ts|tsx)$/i.test(main)) return main;
    for (const candidate of ['index.ts', 'index.tsx']) {
        if (Object.hasOwn(latestContent, '/' + candidate)) return candidate;
    }
    return null;
}
export function pluginBuildEntrypoint(latestContent) {
    const manifest=JSON.parse(latestContent['/package.json']);
    const source=pluginBuildSource(latestContent) || 'index.ts';
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
