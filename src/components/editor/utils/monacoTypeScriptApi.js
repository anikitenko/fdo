// Monaco 0.53 exposes this under languages; newer releases expose it at the top level.
export function resolveMonacoTypeScriptApi(monaco) {
    return monaco?.typescript
        || monaco?.languages?.typescript
        || monaco?.default?.typescript
        || monaco?.default?.languages?.typescript;
}
