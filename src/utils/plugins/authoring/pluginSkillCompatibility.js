// Documentation is data: inspect installed descriptors without evaluating any
// guide code, calling SDK methods, constructing classes or invoking getters.
function descriptor(value, name) {
    for (let current = value; current && current !== Object.prototype && current !== Function.prototype;
        current = Object.getPrototypeOf(current)) {
        const found = Object.getOwnPropertyDescriptor(current, name);
        if (found) return found;
    }
    return null;
}

export function pluginSkillCompatibility(content, sdk, source, exampleErrors = []) {
    const exports = Object.getOwnPropertyNames(sdk);
    const findings = exampleErrors.map(diagnostic => {
        const location = /^\/SKILL\.md:(\d+):\s*/.exec(diagnostic);
        return {status: 'conflict', reference: 'Code example', line: location ? Number(location[1]) : 1,
            message: location ? diagnostic.slice(location[0].length) : diagnostic,
            evidence: source, correction: 'Correct the example using the installed SDK contract described in the diagnostic.'};
    });
    const checked = new Set();
    for (const [index, line] of String(content).split('\n').entries()) {
        // Only explicit SDK-qualified references are claims we can identify.
        // Arbitrary project services and unqualified prose remain unverified.
        for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*(?:\(|`|\b)/g)) {
            const reference = match[1];
            const parts = reference.split('.');
            const namespace = parts[0] === 'sdk';
            if (!namespace && !exports.includes(parts[0])) continue;
            if (checked.has(reference)) continue;
            checked.add(reference);
            if (/\b(?:do not|never|avoid|unsupported|nonexistent|does not exist)\b/i.test(line)) {
                findings.push({status: 'unverified', reference, line: index + 1, evidence: source,
                    message: 'This line appears to warn against this API; no positive capability claim was inferred.'});
                continue;
            }
            let value = sdk;
            let status = 'verified';
            let missing;
            const path = namespace ? parts.slice(1) : parts;
            for (let i = 0; i < path.length; i++) {
                let property = descriptor(value, path[i]);
                // Class.method notation in documentation may describe an
                // instance method. Inspect its prototype without instantiation.
                if (!property && i > 0 && typeof value === 'function') {
                    const prototype = Object.getOwnPropertyDescriptor(value, 'prototype')?.value;
                    if (prototype) property = descriptor(prototype, path[i]);
                }
                if (!property) { status = 'conflict'; missing = path.slice(0, i + 1).join('.'); break; }
                if (!Object.hasOwn(property, 'value')) { status = 'unverified'; break; }
                value = property.value;
                if (value === null || value === undefined) {
                    status = i < path.length - 1 ? 'unverified' : 'verified';
                    break;
                }
            }
            findings.push({status, reference, line: index + 1, evidence: source,
                message: status === 'conflict' ? `Installed SDK does not expose ${missing}.`
                    : status === 'verified' ? 'API member exists. Arguments, return types and intended behavior are not verified by this check.'
                    : 'This reference requires runtime state or an accessor; it was not evaluated.',
                ...(status === 'conflict' ? {correction: 'Replace this reference with an API supported by the installed SDK, or remove the unsupported requirement. Do not invent a substitute signature.'} : {})});
        }
    }
    return {source, findings, hasConflicts: findings.some(item => item.status === 'conflict'),
        unchecked: 'Architecture, conventions, unqualified API references, links and general prose are project guidance, not automatically verified contracts.'};
}
