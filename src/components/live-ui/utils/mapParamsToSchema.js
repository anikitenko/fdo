import {parseComplexType} from "./parseComplexType";

export const mapParamsToSchema = (jsdocParams) => {
    const schema = {
        type: "object",
        properties: {},
        required: [],
    };

    jsdocParams.forEach((param) => {
        const { name, type, optional, description } = param;

        const propSchema = parseComplexType(type);
        if (description) propSchema.description = description;

        schema.properties[name] = propSchema;

        if (!optional) {
            schema.required.push(name);
        }
    });

    if (schema.required.length === 0) {
        delete schema.required;
    }

    return schema;
}
