import {generationBudgetRecovery, smallerScopeGenerationPrompt} from '../../src/components/editor/utils/aiGenerationBudgetRecovery';
import {createCodingGenerationFailure, codingFailureMetadata, normalizeCodingFailure} from '../../src/utils/ai/assistant/aiCodingFailure';
import {initialGenerationRecovery as initial, generationRecoveryReducer as reduce} from '../../src/components/editor/utils/aiGenerationRecoveryState';

const failure = createCodingGenerationFailure('Any wording, or translated text', {path: '/plugin/lifecycle-styles.ts', completedFileCount: 3, pendingFileCount: 2, splitDepth: 2, maximumSplitDepth: 2, requestedOutputTokens: 4096}).failure;

test('metadata recognizes failure independently of message and serializes a whitelist', () => {
    expect(generationBudgetRecovery(failure)).toEqual(failure);
    expect(generationBudgetRecovery('Workspace module /x.ts exceeded its response budget. No changes were applied.')).toBeNull();
    expect(normalizeCodingFailure({...failure, providerResponse: 'secret', completedFileCount: -1})).toEqual(expect.not.objectContaining({providerResponse: expect.anything(), completedFileCount: expect.anything()}));
    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
    expect(codingFailureMetadata(new Error('wrapper', {cause: createCodingGenerationFailure('other wording', {path: '/index.ts'})}))).toMatchObject({path: '/index.ts'});
});

test.each([{schemaVersion: '2.0.0'}, {path: '/Users/private/file.ts'}, {path: '../x.ts'}, {workspaceChanged: true}, {resumable: true}, {code: 'UNKNOWN'}, {recoveryActions: []}])('rejects unsupported or unsafe metadata %j', patch => {
    expect(normalizeCodingFailure({...failure, ...patch})).toBeNull();
});

test('retry preserves original requirements and identifies a fresh unapplied attempt', () => {
    const prompt = smallerScopeGenerationPrompt('Build a JSON inspector with nested values.', failure.path);
    expect(prompt).toContain('Build a JSON inspector with nested values.');
    expect(prompt).toContain(failure.path);
    expect(prompt).toContain('Do not treat the previous partial response as existing files');
    expect(prompt).toContain('explain what is deferred');
});

test('recovery transitions from failure to prepared to retrying to ready', () => {
    let state = reduce(initial, {type: 'start', requestId: 'first'});
    state = reduce(state, {type: 'failed', requestId: 'first', failure, originalPrompt: 'Build inspector'});
    expect(state.status).toBe('failed');
    state = reduce(state, {type: 'prepare'});
    expect(state.status).toBe('prepared');
    state = reduce(state, {type: 'start', requestId: 'retry'});
    expect(state).toMatchObject({status: 'retrying', requestId: 'retry', originalPrompt: 'Build inspector'});
    expect(reduce(state, {type: 'failed', requestId: 'first', failure})).toBe(state);
    expect(reduce(state, {type: 'ready', requestId: 'first'})).toBe(state);
    state = reduce(state, {type: 'ready', requestId: 'retry'});
    expect(state).toMatchObject({status: 'ready', failure: null});
});

test('cancel rejects late completion and reset discards draft; repeated failure can prepare again', () => {
    let state = reduce(initial, {type: 'start', requestId: 'first'});
    expect(reduce(state, {type: 'prepare'})).toBe(state);
    state = reduce(state, {type: 'failed', requestId: 'first', failure});
    state = reduce(state, {type: 'prepare'});
    state = reduce(state, {type: 'start', requestId: 'second'});
    state = reduce(state, {type: 'failed', requestId: 'second', failure});
    expect(state.status).toBe('failed');
    state = reduce(state, {type: 'prepare'});
    state = reduce(state, {type: 'start', requestId: 'third'});
    state = reduce(state, {type: 'cancel', requestId: 'third'});
    expect(state.status).toBe('cancelled');
    expect(reduce(state, {type: 'failed', requestId: 'third', failure})).toBe(state);
    expect(reduce(state, {type: 'ready', requestId: 'third'})).toBe(state);
    expect(reduce(state, {type: 'reset'})).toEqual(initial);
});
