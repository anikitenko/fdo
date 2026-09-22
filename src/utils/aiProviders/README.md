# Native AI provider adapters

These adapters translate FDO requests into each provider's official SDK API.
The shared application boundary is [AiProviderClient](../aiProviderClient.js).

## Where versions belong

**SDK versions are configured in [package.json](../../../package.json), under
`dependencies`.** [package-lock.json](../../../package-lock.json) records the
resolved dependency tree. Change versions there when upgrading; adapter comments
and this README are compatibility documentation, not runtime configuration.

| Provider | Dependency | Adapter API |
| --- | --- | --- |
| OpenAI | `openai` | Responses; Chat Completions for the explicit/legacy route |
| Anthropic | `@anthropic-ai/sdk` | Messages |
| Gemini | `@google/genai` | Interactions |
| Cloudflare | `cloudflare` | Workers AI |
| Ollama | `ollama` | Native HTTP chat |

API versions are separate from SDK releases. For example, Cloudflare's `/client/v4`
URL and Gemini's `apiVersion: 'v1beta'` select remote API contracts. They belong
with the corresponding client configuration and should change only when that
integration is migrated. Model IDs are selected separately in assistant Settings.

## Cloudflare model-path compatibility

With the installed Cloudflare SDK **7.1.0**, the generated `ai.run` method passes
the model ID through a path-template helper that encodes `/` as `%2F`. Workers AI
model IDs contain path segments, such as `@cf/qwen/qwen3.8-27b`; encoding those
separators caused the reported “No route for that URI” failure.

[cloudflare.js](cloudflare.js) therefore uses the same SDK's public `client.post`
method with the path produced by
[cloudflareRunPath](../cloudflareProvider.cjs). That helper validates the account
and model path before joining them. Authentication, cancellation, HTTP error
handling and retry configuration remain with the native SDK. There is no runtime
version check or requirement to stay on that particular SDK release.

When upgrading the SDK, check its generated path handling before replacing this
call with `ai.run`. The native request tests assert the actual URL, including
unescaped model-path separators.

## Verification

`npm run test:ai:safety` includes native provider contract and structured-output
tests. They use installed SDKs with simulated HTTP responses, without paid API
calls. See [AI coding reliability](../../../docs/AI_CODING_RELIABILITY.md) for
completion rules, usage accounting and live-test configuration.
