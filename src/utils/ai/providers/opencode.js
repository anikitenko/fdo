import {openaiRequest} from './openai';
import {OPENCODE_ZEN_BASE_URL} from './opencodeProvider.cjs';

// Zen serves the MiMo/DeepSeek/GLM/Kimi/MiniMax families on Chat Completions
// (`/zen/v1/chat/completions`). The OpenAI Responses API and the Anthropic
// Messages API are different endpoints in that gateway, so this adapter always
// forces the chat-completions route with the official OpenAI client.
export function opencodeRequest(config, conversation, options, signal) {
    return openaiRequest(
        {...config, baseURL: OPENCODE_ZEN_BASE_URL},
        conversation,
        {...options, api: 'chat.completions'},
        signal,
    );
}
