/** @jest-environment node */
const {removeRetiredProviderData} = require('../../src/utils/ai/assistant/retiredProviders.cjs');

function memorySettings(initial) {
    const data = JSON.parse(JSON.stringify(initial));
    return {data, get: (key, fallback) => data[key] ?? fallback, set: (key, value) => {data[key] = value;}};
}

test('assistants saved for a retired provider are removed and a default is preserved', () => {
    const settings = memorySettings({
        'ai.coding': [{id: '1', provider: 'cursor', default: true, apiKey: 'sealed'}, {id: '2', provider: 'openrouter', default: false}],
        'ai.chat': [{id: '3', provider: 'openai', default: true}],
        'ai.providerInstructions': {cursor: 'x', openai: 'y'},
    });
    expect(removeRetiredProviderData(settings)).toBe(1);
    expect(settings.data['ai.coding']).toEqual([{id: '2', provider: 'openrouter', default: true}]);
    expect(settings.data['ai.chat']).toHaveLength(1);
    expect(settings.data['ai.providerInstructions']).toEqual({openai: 'y'});
});

test('settings without retired providers are not rewritten', () => {
    const settings = memorySettings({'ai.coding': [{id: '2', provider: 'ollama', default: true}]});
    settings.set = jest.fn();
    expect(removeRetiredProviderData(settings)).toBe(0);
    expect(settings.set).not.toHaveBeenCalled();
});
