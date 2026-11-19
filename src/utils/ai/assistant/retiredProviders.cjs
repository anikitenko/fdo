// Providers FDO no longer ships. Assistants saved by earlier versions are
// removed at startup, together with their encrypted credentials, so they
// cannot remain selectable or be sent to an integration that no longer exists.
const RETIRED_PROVIDERS = Object.freeze(['cursor']);

function removeRetiredProviderData(settings) {
    let removed = 0;
    for (const purpose of ['chat', 'coding']) {
        const records = settings.getAiAssistantRecords ? settings.getAiAssistantRecords(purpose) : settings.get(`ai.${purpose}`, []) || [];
        if (!Array.isArray(records)) continue;
        const kept = records.filter(record => !RETIRED_PROVIDERS.includes(record?.provider));
        if (kept.length === records.length) continue;
        removed += records.length - kept.length;
        if (kept.length && !kept.some(record => record.default === true || record.default === 'true')) kept[0] = {...kept[0], default: true};
        settings.set(`ai.${purpose}`, kept);
    }
    const instructions = settings.get('ai.providerInstructions', {});
    if (instructions && typeof instructions === 'object' && RETIRED_PROVIDERS.some(provider => provider in instructions)) {
        settings.set('ai.providerInstructions', Object.fromEntries(Object.entries(instructions).filter(([provider]) => !RETIRED_PROVIDERS.includes(provider))));
    }
    return removed;
}

module.exports = {RETIRED_PROVIDERS, removeRetiredProviderData};
