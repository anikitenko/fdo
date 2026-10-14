// A split retry describes responsibilities, not host-owned paths. Keeping the
// namespace with the host prevents another inventory echo from being mistaken
// for a decomposition. No source is inferred or recovered from a partial reply.
export function workspaceModuleSplitRepair({file, paths, maxHelpers, maxContractCharacters, maxManifestCharacters, helperTokens, prompt, forbiddenDependencies = [], requiredExports = [], dependencies = []}) {
    const extension = file.path.match(/\.(?:css|[cm]?[jt]sx?)$/i)?.[0];
    if (!extension) return null; // Data files do not have module composition semantics.
    const stylesheet = extension.toLowerCase() === '.css';
    const kind = stylesheet ? 'CSS' : 'module';
    const namePattern = '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$';
    const responseSchema = {type: 'object', additionalProperties: false, required: ['helpers'], properties: {
        helpers: {type: 'array', minItems: 1, maxItems: maxHelpers, items: {
            type: 'object', additionalProperties: false, required: ['name', 'contract'], properties: {
                name: {type: 'string', pattern: namePattern, maxLength: 48},
                contract: {type: 'string', minLength: 1, maxLength: maxContractCharacters},
            },
        }},
    }};
    const stem = file.path.slice(0, -extension.length);
    return {
        responseSchema,
        prompt: `${prompt}

FOCUSED ${stylesheet ? 'CSS' : 'MODULE'} DECOMPOSITION RETRY
The earlier task is reference requirements. This instruction replaces its file inventory and response format instructions for this request only.
The previous split did not supply an admissible dependency set. Subdivide ONLY ${file.path}: ${file.contract}
Return JSON of this shape: ${JSON.stringify({helpers: (stylesheet
    ? [{name: 'tokens', contract: 'Shared color, spacing and typography tokens.'}, {name: 'controls', contract: 'Shared buttons and input states.'}]
    : [{name: 'views', contract: 'Export renderCard(title: string): string for individual cards.'}, {name: 'data', contract: 'Export shared card data consumed by the composition.'}]).slice(0, maxHelpers)})}.
Choose names and responsibilities appropriate to this ${stylesheet ? 'stylesheet' : 'module'}; the example is not a mandatory design. Return 1–${maxHelpers} cohesive responsibilities, each fitting ${helperTokens} output tokens when later implemented. Do not reproduce the whole oversized module in a single responsibility.
Each name is a lowercase hyphenated label, at most 48 characters: no paths, extensions, slashes or source code. The host assigns unused sibling ${extension} paths and retains ${file.path} as the composition. Do not return a files array or the original module. No implementation is requested yet.
Forbidden dependencies (these already compose the module being split; helpers must not import them): ${JSON.stringify(forbiddenDependencies)}. Helpers must not import the retained composition ${file.path}, which imports them.
Existing ${stylesheet ? 'CSS ' : ''}paths are context only; do not duplicate their responsibilities: ${JSON.stringify(stylesheet ? paths.filter(path => /\.css$/i.test(path)) : paths)}.
${stylesheet ? '' : `Retained dependency contracts (unchanged; reuse their exports, do not return them as helpers): ${JSON.stringify(dependencies)}.
Public exports required from the retained composition: ${JSON.stringify(requiredExports)}. Preserve its public interface. Each new helper contract must name its exports and their types/signatures, so the retained module can import and compose them. List helper responsibilities in dependency order. Existing source modules remain unchanged. Keep TypeScript type-only imports where appropriate; do not introduce new packages or compiler configuration.`}
${stylesheet ? 'Preserve selectors, state rules, responsive rules and keyframes required by the task.' : 'Preserve behavior, action bindings, rendering roles, and all features assigned to the module. Extract coherent responsibilities, not trivial wrappers.'} Respect the user's file creation restrictions. Contracts are one short sentence, at most ${maxContractCharacters} characters. The whole response must fit ${maxManifestCharacters} characters. Return only the helpers JSON object.`,
        decode(text) {
            const invalid = reason => Object.assign(new Error(`Invalid ${kind} decomposition for ${file.path}: ${reason}. No changes were applied.`),
                {code: 'INVALID_WORKSPACE_MANIFEST_SCHEMA'});
            if (typeof text !== 'string' || text.length > maxManifestCharacters) throw invalid('response exceeds the inventory size limit');
            let value;
            try { value = JSON.parse(text.trim().replace(/^```json\s*\n([\s\S]*)\n```$/i, '$1')); }
            catch { throw invalid('expected valid helpers JSON'); }
            if (!value || Object.keys(value).length !== 1 || !Array.isArray(value.helpers)
                || !value.helpers.length || value.helpers.length > maxHelpers) throw invalid(`expected 1–${maxHelpers} helpers, not file paths`);
            const names = new Set();
            const occupied = new Set(paths.map(path => path.toLowerCase()));
            const files = value.helpers.map(helper => {
                if (!helper || typeof helper.name !== 'string' || helper.name.length > 48
                    || !new RegExp(namePattern).test(helper.name) || names.has(helper.name)
                    || Object.keys(helper).some(key => !['name', 'contract'].includes(key))) throw invalid('helper names must be unique lowercase labels without paths');
                names.add(helper.name);
                let path = `${stem}-${helper.name}${extension}`;
                let suffix = 2;
                while (occupied.has(path.toLowerCase())) path = `${stem}-${helper.name}-${suffix++}${extension}`;
                occupied.add(path.toLowerCase());
                return {path, contract: helper.contract, visualReference: file.visualReference !== false};
            });
            // Normal manifest admission still checks contracts, full paths,
            // total size and the transaction's file/request limits.
            return JSON.stringify({files});
        },
    };
}
