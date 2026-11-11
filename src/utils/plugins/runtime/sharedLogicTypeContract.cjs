// A deliberately small, data-only schema vocabulary. Never accept TypeScript
// source or references from providers as executable editor declarations.
function normalizeContract(value, methods) {
    if (value === undefined) return undefined;
    let nodes = 0;
    function schema(item, depth = 0) {
        if (++nodes > 1024 || depth > 8 || !item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid shared-service type schema.');
        const allowed = ['string','number','integer','boolean','null','unknown','object','array'];
        if (!allowed.includes(item.type) || Object.keys(item).some(key => !['type','properties','required','items'].includes(key))) throw new Error('Unsupported shared-service type schema.');
        if (item.type === 'array') return {type:'array',items:schema(item.items,depth+1)};
        if (item.type !== 'object') return {type:item.type};
        if (!item.properties || typeof item.properties !== 'object' || Array.isArray(item.properties) || Object.keys(item.properties).length > 64) throw new Error('Invalid shared-service object schema.');
        const required = item.required || [];
        if (!Array.isArray(required) || required.some(key => typeof key !== 'string' || !Object.hasOwn(item.properties,key))) throw new Error('Invalid required fields.');
        const properties = Object.create(null);
        for (const [key, child] of Object.entries(item.properties)) {
            if (key.length > 100 || ['constructor','prototype','__proto__'].includes(key)) throw new Error('Invalid shared-service field.');
            properties[key] = schema(child,depth+1);
        }
        return {type:'object',properties,required:[...new Set(required)]};
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 32) throw new Error('Invalid shared-service contract.');
    const result = Object.create(null);
    for (const [method, item] of Object.entries(value)) {
        if (!methods.includes(method) || !item || Object.keys(item).some(key => !['input','output'].includes(key))) throw new Error('Contract method does not match an export.');
        result[method] = {input:schema(item.input),output:schema(item.output)};
    }
    return result;
}
function schemaType(schema) {
    if (!schema) return 'unknown';
    if (schema.type === 'array') return `Array<${schemaType(schema.items)}>`;
    if (schema.type === 'object') return '{'+Object.entries(schema.properties).map(([key,value]) => `${JSON.stringify(key)}${schema.required.includes(key)?'':'?'}:${schemaType(value)}`).join(';')+'}';
    return schema.type === 'integer' ? 'number' : schema.type;
}
module.exports = {normalizeContract,schemaType};
