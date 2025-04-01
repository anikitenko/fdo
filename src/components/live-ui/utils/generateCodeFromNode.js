// Signature map defines known method argument structures for special formatting
const methodSignatureMap = {
    DOM: {
        createElement: ["tag", "props", "children"]
    },
    DOMMisc: {
        divider: ["options", "id"]
    }
};

// Set of special methods that produce CSS classes or animations and shouldn't appear as visual children
const specialStyleInjectors = new Set(["createClassFromStyle", "createStyleKeyframe"]);

// Map to hold extracted named keyframes for substitution
const keyframesRegistry = {};

function defaultFormatStrategy(baseArg, children) {
    return [...children].filter(Boolean);
}

const formatterStrategies = {
    concat: (baseArg, children) => {
        const base = typeof baseArg === "string" && baseArg.trim() === "" ? '""' : formatArg(baseArg);
        const parts = [base, ...children].filter(Boolean);
        return parts.length > 1 ? parts.join(" + ") : parts[0] || "";
    },
    toArray: defaultFormatStrategy,
    default: defaultFormatStrategy
};

const formatterArguments = {
    asIs: value => value,
    template: value => `\`${value}\``,
    object: value => JSON.stringify(value),
    undefinedString: (value, paramName) => (paramName === "props" || paramName === "options") ? "{}" : "undefined",
    string: value => typeof value === "string" ? value.replace(/\r?\n/g, "") : value
};

function formatArg(value, paramName) {
    if (typeof value === "string" && value.startsWith("new DOM")) return formatterArguments.asIs(value);
    if (paramName === "keyframe") return formatterArguments.template(value);
    if (value === undefined) return formatterArguments.undefinedString(value, paramName);
    if (typeof value === "string" && value.trim().includes("=>")) return formatterArguments.asIs(value);
    value = formatterArguments.string(value);
    return formatterArguments.object(value);
}

function extractStyleClassCalls(children) {
    const calls = [];
    for (const child of children) {
        const methodName = child.node?.data?.methodName;
        if (specialStyleInjectors.has(methodName)) {
            const styleCall = generateCodeFromNode(child.node);
            if (methodName === "createStyleKeyframe" && child.node.data?.label) {
                keyframesRegistry[child.node.data.label] = styleCall;
            }
            calls.push(styleCall);
        }
    }
    return calls;
}

function filterChildren(children) {
    return children.filter(c => !specialStyleInjectors.has(c.node?.data?.methodName));
}

function shouldWrapInQuotes(value) {
    return typeof value === "string" && !value.startsWith("\"") && !value.endsWith("\"") && !value.includes(" + ");
}

function safeJSKey(key) {
    return /^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(key) ? key : JSON.stringify(key);
}

function resolveKeyframeRefs(obj) {
    if (typeof obj !== "object" || !obj) return obj;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string" && value.startsWith("$keyframes.")) {
            const match = value.match(/\$keyframes\.(\w+)(.*)?/);
            if (match) {
                const [, kfName, suffix] = match;
                const resolved = keyframesRegistry[kfName];
                result[key] = resolved && suffix ? `${resolved} + " " + ${JSON.stringify(suffix.trim())}` : resolved || value;
            } else {
                result[key] = value;
            }
        } else {
            result[key] = value;
        }
    }
    return result;
}

export function generateCodeFromNode(node) {
    const { type, children = [], data = {} } = node;
    const { className, constructor = {}, methodName, method = {} } = data;
    if (type !== "customNode" || !className || !methodName) return;

    const styleClassCalls = extractStyleClassCalls(children);
    const filteredChildren = filterChildren(children);

    const constructorArgs = Object.values(constructor).map(val => formatArg(val));
    const constructorCall = `new ${className}(${constructorArgs.join(", ")})`;

    const methodParamOrder = methodSignatureMap[className]?.[methodName] || Object.keys(method);
    const methodArgs = [];

    const formatterNode = filteredChildren.find(c => c.node?.type === "concat" || c.node?.type === "toArray");
    const formatterType = formatterNode?.node?.type || "default";

    const formatterChildren = formatterNode?.node?.children || [];
    const extraChildren = filteredChildren.filter(c => c !== formatterNode);

    const formattedFormatterChildren = formatterChildren.map(child => generateCodeFromNode(child.node)).filter(Boolean);
    const formattedExtraChildren = extraChildren.map(child => generateCodeFromNode(child.node)).filter(Boolean);

    const staticChildren = (method.children || []).map(c => formatArg(c));
    const mergedChildren = formatterStrategies[formatterType](undefined, formattedFormatterChildren);
    const allChildren = Array.isArray(mergedChildren)
        ? [...staticChildren, ...mergedChildren, ...formattedExtraChildren]
        : [...staticChildren, mergedChildren, ...formattedExtraChildren].filter(Boolean);
    const allChildrenExpression = `[${allChildren.join(", ")}]`;

    const dynamicConcatTargetKey = methodParamOrder.find(
        key => typeof method[key] === "string" &&
            children.some(c => c.node?.type === "concat") &&
            formatterType === "concat" &&
            formattedFormatterChildren.length > 0
    );

    methodParamOrder.forEach(key => {
        if (key === "children") {
            methodArgs.push(allChildrenExpression);
        } else if (key === dynamicConcatTargetKey) {
            const labelConcat = formatterStrategies.concat(method[key], formattedFormatterChildren);
            methodArgs.push(shouldWrapInQuotes(labelConcat) ? `"${labelConcat}"` : labelConcat);
        } else {
            if (method[key]?.className && styleClassCalls.length > 0) {
                const base = method[key].className;
                const parts = [
                    ...(typeof base === "string" ? [JSON.stringify(base)] : [base]),
                    ...styleClassCalls
                ];
                const { className: _, ...rest } = method[key];
                const expression = `{ className: ${parts.join(" + ")}, ...${JSON.stringify(rest)} }`;
                methodArgs.push(expression);
                return;
            }

            if (typeof method[key] === "object" && method[key] !== null) {
                const raw = { ...method[key] };

                const styleKeys = ["style", "styleObj"];
                for (const sKey of styleKeys) {
                    if (sKey in raw) {
                        raw[sKey] = resolveKeyframeRefs(raw[sKey]);
                    }
                }

                if ("classes" in raw && Array.isArray(raw.classes)) {
                    const base = raw.classes.map(cls =>
                        typeof cls === "string" && cls.startsWith("new DOM") ? cls : JSON.stringify(cls)
                    );
                    raw.classes = [...base, ...styleClassCalls
                        .filter(c => c.includes("createClassFromStyle"))
                        .map(str => str)];
                }

                const composed = Object.entries(raw).map(([k, v]) => {
                    if (Array.isArray(v)) {
                        return `${safeJSKey(k)}: [${v.join(", ")}]`;
                    } else if (typeof v === "string" && v.startsWith("new DOM")) {
                        return `${safeJSKey(k)}: ${v}`;
                    } else if (typeof v === "object" && v !== null) {
                        const inner = Object.entries(v).map(([innerKey, innerVal]) => {
                            return `${JSON.stringify(innerKey)}: ${typeof innerVal === "string" && innerVal.startsWith("new DOM") ? innerVal : JSON.stringify(innerVal)}`;
                        }).join(", ");
                        return `${safeJSKey(k)}: { ${inner} }`;
                    } else {
                        return `${safeJSKey(k)}: ${JSON.stringify(v)}`;
                    }
                }).join(", ");

                methodArgs.push(`{ ${composed} }`);
                return;
            }

            if (method[key]?.classes && Array.isArray(method[key].classes)) {
                const base = method[key].classes.map(cls =>
                    typeof cls === "string" && cls.startsWith("new DOM") ? cls : JSON.stringify(cls)
                );
                const parts = [...base, ...styleClassCalls];
                const { classes: _, ...rest } = method[key];
                const expression = `{ classes: [${parts.join(", ")}], ...${JSON.stringify(rest)} }`;
                methodArgs.push(expression);
                return;
            }

            methodArgs.push(formatArg(method[key], key));
        }
    });

    try {
        return `${constructorCall}.${methodName}(${methodArgs.join(", ")})`;
    } catch (e) {
        console.warn("Code generation failed for node:", node, e);
        return "";
    }
}
