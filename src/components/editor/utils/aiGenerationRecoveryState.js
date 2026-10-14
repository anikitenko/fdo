import {normalizeCodingFailure} from '../../../utils/ai/assistant/aiCodingFailure';

export const initialGenerationRecovery = {status: 'idle', requestId: null, failure: null, originalPrompt: ''};

// This machine owns retry preparation and generation, not applying files or saving snapshots.
export function generationRecoveryReducer(state, event) {
    if (event.type === 'prepare-checkpoint' && state.status !== 'retrying') return {...initialGenerationRecovery, status: 'prepared', originalPrompt: event.originalPrompt || ''};
    if (event.type === 'reset') return initialGenerationRecovery;
    if (event.type === 'start') {
        if (!event.requestId) return state;
        const retry = state.status === 'prepared' || state.status === 'retrying';
        return {...state, status: retry ? 'retrying' : 'idle', requestId: event.requestId,
            failure: retry ? state.failure : null, originalPrompt: retry ? state.originalPrompt : ''};
    }
    if (event.type === 'prepare') {
        return state.status === 'failed' && state.failure
            ? {...state, status: 'prepared'} : state;
    }
    if (!event.requestId || event.requestId !== state.requestId || state.status === 'cancelled') return state;
    if (event.type === 'failed' && ['idle', 'retrying', 'failed'].includes(state.status)) {
        return {...state, status: 'failed', failure: normalizeCodingFailure(event.failure),
            originalPrompt: event.originalPrompt || state.originalPrompt};
    }
    if (event.type === 'ready' && ['idle', 'retrying'].includes(state.status)) return {...state, status: 'ready', failure: null};
    if (event.type === 'cancel') return {...state, status: 'cancelled', failure: null};
    return state;
}
