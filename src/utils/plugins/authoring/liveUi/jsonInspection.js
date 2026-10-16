// These source templates run in the virtual plugin workspace; workspace typecheck tests validate them.
// Trusted, self-contained fixture helper. The same function is emitted into the
// generated backend with a contextual TypeScript input/result contract.
export function inspectJsonFixture(text) {
    try {
        const value=JSON.parse(text);
        const valueType=value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
        const topLevelKeys=valueType === 'object' ? Object.keys(value) : [];
        const itemCount=Array.isArray(value) ? value.length : topLevelKeys.length;
        const summary='Valid JSON · '+valueType+(['object','array'].includes(valueType) ? ' · '+itemCount+' top-level '+(itemCount === 1 ? 'item' : 'items') : '');
        return {success:true,summary,valueType,itemCount,topLevelKeys};
    } catch(error) {
        return {success:false,error:'Invalid JSON: '+(error instanceof Error ? error.message : String(error))};
    }
}
export function jsonBackendDeclarations(inputType,resultType,implementation) {
    return /* language=TEXT */ `\n\n// Live UI JSON inspector. Validate input at the SDK transport boundary.\nexport interface ${inputType} {text: string;}\nexport type ${resultType} = {success: true; summary: string; valueType: string; itemCount: number; topLevelKeys: string[]} | {success: false; error: string};\nexport function ${implementation}(input: unknown): ${resultType} {\n    if (!input || typeof input !== 'object' || Array.isArray(input)) return {success: false, error: 'Expected a text request.'};\n    const data = input as Partial<${inputType}>;\n    if (typeof data.text !== 'string' || data.text.length > 2000) return {success: false, error: 'Text must contain at most 2,000 characters.'};\n    const inspect: (text: string) => ${resultType} = ${inspectJsonFixture.toString()};\n    return inspect(data.text);\n}\n`;
}
