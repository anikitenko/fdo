// --- Signature Map for known method argument orders ---
const methodSignatureMap = {
    DOM: {
        createElement: ["tag", "props", "children"],
    },
    DOMMisc: {
        divider: ["options", "id"]
    },
};

const specialStyleInjectors = new Set(["createClassFromStyle", "createStyleKeyframe"]);

// --- Formatters ---
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

// --- Utility to format arguments properly ---
const formatterArguments = {
    asIs: (value) => {
        return value;
    },
    template: (value) => {
        return `\`${value}\``;
    },
    object: (value) => {
        return JSON.stringify(value);
    },
    undefinedString: (value, paramName) => {
        if (paramName === "props" || paramName === "options") return "{}";
        return "undefined";
    },
}
function formatArg(value, paramName) {
    if (typeof value === "string") value = value.replace(/\r?\n/g, "");

    if (typeof value === "string" && value.startsWith("new DOM")) {
        return formatterArguments.asIs(value)
    }

    if (paramName === "keyframe") {
        return formatterArguments.template(value)
    }

    if (value === undefined) {
        return formatterArguments.undefinedString(value, paramName);
    }

    if (typeof value === "string" && value.trim().includes("=>")) return formatterArguments.asIs(value);

    return formatterArguments.object(value);
}

function extractStyleClassCalls(children) {
    const calls = [];
    for (const child of children) {
        if (specialStyleInjectors.has(child.node?.data?.methodName)) {
            const styleCall = generateCodeFromNode(child.node)
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

// --- Main Code Generator ---
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

    const dynamicConcatTargetKey = methodParamOrder.find(key => {
        return (
            typeof method[key] === "string" &&
            children.some(c => c.node?.type === "concat") &&
            formatterType === "concat" &&
            formattedFormatterChildren.length > 0
        );
    });

    methodParamOrder.forEach((key) => {
        if (key === "children") {
            methodArgs.push(allChildrenExpression);
        } else if (key === dynamicConcatTargetKey) {
            const labelConcat = formatterStrategies.concat(method[key], formattedFormatterChildren);
            methodArgs.push(shouldWrapInQuotes(labelConcat) ? `"${labelConcat}"` : labelConcat);
        } else {
            if (method[key]?.classes && Array.isArray(method[key].classes)) {
                const base = method[key].classes.map(cls =>
                    typeof cls === "string" && cls.startsWith("new DOM") ? cls : JSON.stringify(cls)
                );
                const parts = [...base, ...styleClassCalls];
                const { classes: _, ...rest } = method[key];
                const expression = `{ classes: [${parts.join(", ")}], ...${JSON.stringify(rest)} }`;
                methodArgs.push(expression);
                return;
            } else if (method[key]?.className && styleClassCalls.length > 0) {
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
