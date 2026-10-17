// Runs before settings validation; the original data stays in the encrypted
// settings file until the ready-time SQLite/OS-keychain migration is verified.
function stageObservabilityMigration(store) {
    const ai = store.get('ai', {}) || {};
    const {secretKey, ...langfuse} = ai.observability?.langfuse || {};
    const staged = store.get('observabilityMigration') || {};
    if (ai.metrics !== undefined) staged.metrics = ai.metrics;
    if (ai.usageLedger !== undefined) staged.usageLedger = ai.usageLedger;
    if (secretKey) staged.secretKey = secretKey;
    if (Object.keys(staged).length) store.set('observabilityMigration', staged);
    store.delete('ai.metrics');
    store.delete('ai.usageLedger');
    if (ai.observability?.langfuse) store.set('ai.observability.langfuse', langfuse);
}
module.exports = {stageObservabilityMigration};
