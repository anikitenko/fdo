import {assistantInputCapabilities, imageSupportLabel, imageSupportOptionSuffix} from '../../src/utils/ai/assistant/aiAssistantInputCapabilities';

test.each([
    [{modalities: ['text', 'image']}, 'supported'],
    [{modalities: ['text']}, 'unsupported'],
    [{inputModalities: ['text', 'image_url']}, 'supported'],
    [{capabilities: ['completion', 'vision']}, 'supported'],
    [{capabilities: ['completion']}, 'unknown'],
    [{modalities: {input: ['text', 'image']}}, 'supported'],
    [{capabilities: {image_input: {supported: true}}}, 'supported'],
    [{architecture: {output_modalities: ['image']}}, 'unknown'],
    [{}, 'unknown'],
])('derives image input support from metadata without guessing: %j', (metadata, expected) => {
    expect(assistantInputCapabilities({provider: 'openrouter', model: 'test'}, metadata).imageSupport).toBe(expected);
});

test.each(['codex-cli', 'gemini-cli'])('integration limits override model vision support for %s', provider => {
    const result = assistantInputCapabilities({provider, model: 'vision-model'}, {modalities: ['image']});
    expect(result.imageSupport).toBe('unsupported');
    expect(imageSupportLabel(result)).toBe('Text only in FDO');
});

test('retains checked capabilities only for the matching provider and model', () => {
    const saved = {provider: 'openrouter', model: 'a', imageSupport: 'supported', source: 'provider-metadata'};
    expect(assistantInputCapabilities({provider: 'openrouter', model: 'a', inputCapabilities: saved})).toBe(saved);
    expect(assistantInputCapabilities({provider: 'openrouter', model: 'b', inputCapabilities: saved}).imageSupport).toBe('unknown');
});

test('Ollama capability lists explicitly describe whether the local model supports vision', () => {
    expect(assistantInputCapabilities({provider: 'ollama', model: 'example'}, {capabilities: ['completion']}).imageSupport).toBe('unsupported');
});

test('Unknown image support is labelled without implying vision support, and text-only models are marked', () => {
    const unknown = assistantInputCapabilities({provider: 'openrouter', model: 'example'});
    expect(unknown.imageSupport).toBe('unknown');
    expect(imageSupportLabel(unknown)).toBe('Image support unknown');
    expect(imageSupportOptionSuffix(unknown)).toBe('');
    const textOnly = assistantInputCapabilities({provider: 'openrouter', model: 'example'}, {modalities: ['text']});
    expect(imageSupportOptionSuffix(textOnly)).toBe(' · Text only');
    expect(imageSupportOptionSuffix(assistantInputCapabilities({provider: 'codex-cli'}))).toBe('');
});
