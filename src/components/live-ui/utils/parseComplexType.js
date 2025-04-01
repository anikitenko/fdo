const splitUnionTypes = (typeStr = "") => {
    const result = [];
    let current = '';
    let depth = 0;

    for (const element of typeStr) {
        const char = element;

        if (char === '<' || char === '{' || char === '(') depth++;
        else if (char === '>' || char === '}' || char === ')') depth--;

        if (char === '|' && depth === 0) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    if (current.trim()) {
        result.push(current.trim());
    }

    return result;
}

const extractObjectFields = (objStr) => {
    const body = objStr.slice(1, -1).trim();
    const fields = [];
    let depth = 0, current = "";

    for (const char of body) {
        if (char === "{" || char === "<") depth++;
        if (char === "}" || char === ">") depth--;
        if (char === ";" && depth === 0) {
            fields.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    if (current.trim()) fields.push(current.trim());
    return fields;
}

export const parseComplexType = (typeStr) => {
    const unionTypes = splitUnionTypes(typeStr).filter(
        (t) => t !== "undefined" && t !== "null"
    );

    // If this was a union
    if (unionTypes.length > 1) {
        return {
            oneOf: unionTypes.map(parseComplexType),
        };
    }

    // Now clean single type
    let cleanType = unionTypes[0];
    let isPartial = false;

    // Step 1: Detect and strip Partial<>
    if (cleanType.startsWith("Partial<")) {
        isPartial = true;
        cleanType = cleanType.slice(8, -1).trim();
    }

    // Top-level Record<string, any|string>
    if (/^Record<string,\s*(string|any)>$/.test(cleanType)) {
        const match = cleanType.match(/^Record<string,\s*(string|any)>$/);
        const valueType = match[1] === "any" ? true : {type: match[1]};
        return {
            type: "object",
            additionalProperties: valueType,
        };
    }

    // Inline object
    if (cleanType.startsWith("{") && cleanType.endsWith("}")) {
        const objSchema = {type: "object", properties: {}, required: []};

        const entries = extractObjectFields(cleanType)

        for (const entry of entries) {
            const [key, rawType] = entry.split(":").map((s) => s.trim());
            let propSchema = {};

            if (rawType.includes("string[]")) {
                propSchema = {type: "array", items: {type: "string"}};
            } else if (rawType.includes("number[]")) {
                propSchema = {type: "array", items: {type: "number"}};
            } else if (rawType === "string") {
                propSchema = {type: "string"};
            } else if (rawType === "number") {
                propSchema = {type: "number"};
            } else if (rawType === "boolean") {
                propSchema = {type: "boolean"};
            } else if (rawType === "Record<string, string>") {
                propSchema = {
                    type: "object",
                    additionalProperties: {type: "string"},
                };
            } else {
                propSchema = {type: "string"}; // fallback
            }

            objSchema.properties[key] = propSchema;
            if (!isPartial) objSchema.required.push(key);
        }

        if (objSchema.required.length === 0) {
            delete objSchema.required;
        }

        return objSchema;
    }

    // Step 4: Primitive types
    if (cleanType === "string") return {type: "string"};
    if (cleanType === "Function") return {type: "string"};
    if (cleanType === "number") return {type: "number"};
    if (cleanType === "boolean") return {type: "boolean"};
    if (cleanType === "string[]") return {type: "array", items: {type: "string"}};
    if (cleanType === "number[]") return {type: "array", items: {type: "number"}};
    if (cleanType === "boolean[]") return {type: "array", items: {type: "boolean"}};
    if (cleanType === "any[]") {
        return {
            anyOf: [
                {
                    type: "array", items: {
                        anyOf: [
                            {type: "string"},
                        ],
                    },
                },
                {type: "string"}
            ],
        };
    }

    return {type: "object"}; // ultimate fallback
}
