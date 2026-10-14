export function assistantInputCapabilities(assistant = {}, metadata = assistant.inputCapabilities || {}) {
    const identity = {provider: assistant.provider, model: assistant.model};
    if (['codex-cli', 'gemini-cli'].includes(assistant.provider)) return {...identity, imageSupport: 'unsupported', source: 'integration',
        reason: 'This CLI integration accepts text only in FDO, even if the underlying model supports images.'};
    // Discard the former Cursor transport restriction saved by earlier FDO
    // versions. The SDK now sends images; its catalog may still omit vision data.
    if (assistant.provider === 'cursor' && metadata.source === 'integration') metadata = {};
    if (metadata.imageSupport && metadata.provider === assistant.provider && metadata.model === assistant.model) return metadata;
    const modalities = [metadata.modalities, metadata.modalities?.input, metadata.inputModalities, metadata.input_modalities,
        metadata.architecture?.input_modalities].find(value => Array.isArray(value) && value.length);
    const capabilities = metadata.capabilities;
    let support;
    if (Array.isArray(modalities) && modalities.length) support = modalities.some(item => ['image', 'image_url'].includes(String(item).toLowerCase()));
    else if (Array.isArray(capabilities) && capabilities.includes('vision')) support = true;
    else if (Array.isArray(capabilities) && capabilities.length && assistant.provider === 'ollama') support = false;
    else if (typeof capabilities?.image_input?.supported === 'boolean') support = capabilities.image_input.supported;
    else if (typeof capabilities?.imageInput?.supported === 'boolean') support = capabilities.imageInput.supported;
    return {...identity, imageSupport: support === undefined ? 'unknown' : support ? 'supported' : 'unsupported', source: 'provider-metadata',
        reason: support === undefined ? assistant.provider === 'cursor'
            ? 'Attach screenshots or mockups to your request. If the selected model rejects an image, FDO will show the provider’s error.'
            : 'The provider metadata does not declare image input support.'
            : support ? 'Provider metadata advertises image input.' : 'Provider metadata does not advertise image input.'};
}

export function imageSupportLabel(capabilities) {
    return capabilities?.imageSupport === 'supported' ? 'Images supported'
        : capabilities?.imageSupport === 'unsupported' ? capabilities.source === 'integration' ? 'Text only in FDO' : 'Text only'
            : capabilities?.provider === 'cursor' ? 'Image attachments available' : 'Image support unknown';
}

// Keep transport-wide limits and missing catalog data out of every option.
// The selected assistant's details describe these once, below the selector.
export function imageSupportOptionSuffix(capabilities) {
    return capabilities?.imageSupport && capabilities.imageSupport !== 'unknown' && capabilities.source !== 'integration'
        ? ` · ${imageSupportLabel(capabilities)}` : '';
}
