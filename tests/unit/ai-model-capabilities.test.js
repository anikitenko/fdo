/** @jest-environment node */
import fs from 'fs/promises';
import {getModelCapabilities} from '../../src/ipc/ai/model_capabilities';
import {inspectGeminiModel} from '../../src/utils/geminiProvider.cjs';

jest.mock('fs/promises', () => ({readFile: jest.fn(), writeFile: jest.fn().mockResolvedValue(undefined)}));
jest.mock('electron', () => ({app: {getPath: () => '/tmp/fdo-capabilities-test'}}));
jest.mock('../../src/utils/geminiProvider.cjs', () => ({inspectGeminiModel: jest.fn()}));
jest.mock('../../src/ipc/ai/model_capabilities/fetchers/openai_fetcher', () => ({fetchOpenAICapabilities: jest.fn()}));
jest.mock('../../src/ipc/ai/model_capabilities/fetchers/anthropic_fetcher', () => ({fetchAnthropicCapabilities: jest.fn()}));

test('a fresh cache for another provider does not hide an uncached Gemini model', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {other: {provider: 'openai'}}}));
    inspectGeminiModel.mockResolvedValue({inputTokenLimit: 1000000, outputTokenLimit: 64000});
    const assistant = {provider: 'gemini', model: 'gemini-test', apiKey: 'test-only'};
    expect(await getModelCapabilities(assistant.model, assistant)).toMatchObject({provider: 'gemini', api: 'interactions', streaming: true, tools: true,
        maxTokens: 1000000, maxOutputTokens: 64000});
    expect(inspectGeminiModel).toHaveBeenCalledWith(assistant);
    expect(fs.writeFile.mock.calls[0][1]).not.toContain('test-only');
});

test('model lookup selects the most specific name within the requested provider', async () => {
    fs.readFile.mockResolvedValue(JSON.stringify({updatedAt: Date.now(), data: {
        'model': {provider: 'openai', maxTokens: 100},
        'model-pro': {provider: 'openai', maxTokens: 200},
        'model-pro-other': {provider: 'anthropic', maxTokens: 300},
    }}));
    expect(await getModelCapabilities('model-pro-20260920', {provider: 'openai'})).toMatchObject({maxTokens: 200});
    expect(await getModelCapabilities('unrelated-model-pro', {provider: 'openai'})).toMatchObject({provider: 'unknown'});
});
