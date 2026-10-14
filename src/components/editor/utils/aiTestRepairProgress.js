// Extra inference is justified only by comparable execution evidence, never by
// shorter error prose or deleted/renamed/skipped tests.
export function hasStrictTestRepairProgress(previous, current) {
    const index = results => {
        if (!Array.isArray(results) || !results.length) return null;
        const entries = new Map();
        for (const result of results) {
            if (!result.file || !result.name || typeof result.passed !== 'boolean' || result.skipped || result.todo) return null;
            const key = JSON.stringify([result.file, result.name]);
            if (entries.has(key)) return null;
            entries.set(key, result.passed);
        }
        return entries;
    };
    const before = index(previous), after = index(current);
    if (!before || !after || [...before.keys()].some(key => !after.has(key))) return false;
    const failures = [...after].filter(([, passed]) => !passed).map(([key]) => key);
    const oldFailures = [...before].filter(([, passed]) => !passed).map(([key]) => key);
    return failures.length > 0 && failures.length < oldFailures.length && failures.every(key => before.get(key) === false);
}
