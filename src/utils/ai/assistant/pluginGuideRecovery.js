// Transport-safe recovery contract; approval remains a separate human decision.
export function pluginGuideRecoveryMetadata(value) {
    for (let current = value; current; current = current.cause) {
        const recovery = current.guideRecovery;
        if (recovery?.schemaVersion === '1.0.0' && recovery.code === 'PLUGIN_GUIDE_SDK_REVIEW_REQUIRED'
            && recovery.path === '/SKILL.md' && recovery.workspaceChanged === false) return recovery;
    }
    return null;
}

export function createPluginGuideRecoveryError() {
    return Object.assign(new Error('Plugin guide SDK fingerprint is missing or stale. Update and approve /SKILL.md for the installed SDK, then resume repair; no files were applied.'), {
        guideRecovery: {schemaVersion: '1.0.0', code: 'PLUGIN_GUIDE_SDK_REVIEW_REQUIRED', path: '/SKILL.md', workspaceChanged: false},
    });
}
