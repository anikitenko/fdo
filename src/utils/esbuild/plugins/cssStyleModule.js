import {extractCssStyles} from '../../../components/editor/utils/extractCssStyles';
import {resolveCssImports, mergeCssStyleMaps} from '../../../components/editor/utils/resolveCssImports';

// Both deployed plugins and node:test bundles consume SDK style maps, not
// esbuild's browser CSS output. Keep imports, states and media rules identical.
export async function compileCssStyleModule(latestContent, virtualPath) {
    const classMap = extractCssStyles(latestContent[virtualPath]);
    const imported = await resolveCssImports(classMap, virtualPath, latestContent, extractCssStyles);
    return `export default ${JSON.stringify(mergeCssStyleMaps(imported, classMap))};`;
}
