# Native AI provider adapters

These adapters translate FDO requests into each provider's official SDK API.
The shared application boundary is [AiProviderClient](aiProviderClient.js).

## Where versions belong

**SDK versions are configured in [package.json](../../../../package.json), under
`dependencies`.** [package-lock.json](../../../../package-lock.json) records the
resolved dependency tree. Change versions there when upgrading; adapter comments
and this README are compatibility documentation, not runtime configuration.

| Provider | Dependency | Adapter API |
| --- | --- | --- |
| OpenAI | `openai` | Responses; Chat Completions for the explicit/legacy route |
| Anthropic | `@anthropic-ai/sdk` | Messages |
| Gemini | `@google/genai` | Interactions |
| Cloudflare | `cloudflare` | Workers AI |
| Ollama | `ollama` | Native HTTP chat |
| Cursor | `@cursor/sdk` | API-key agent SDK in process; tools disabled |

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
[cloudflareRunPath](cloudflareProvider.cjs). That helper validates the account
and model path before joining them. Authentication, cancellation, HTTP error
handling and retry configuration remain with the native SDK. There is no runtime
version check or requirement to stay on that particular SDK release.

When upgrading the SDK, check its generated path handling before replacing this
call with `ai.run`. The native request tests assert the actual URL, including
unescaped model-path separators.

## Verification

Cursor is configured as a coding assistant with a user or service-account API
key from Cursor Dashboard → API Keys. No separate Cursor CLI is invoked. Model
discovery validates account access without inference. FDO runs each request in
an empty temporary workspace with `tools: []`, no MCP/subagents, no ambient
settings, and SDK transport retries disabled. Returned text passes the same
staged plan, guide approval, file validation and checkpoint recovery as other
API providers. The SDK returns complete message segments, so the adapter
declares buffered generation and maps reasoning events to FDO's bounded wait.
Stop cancels the SDK run; temporary state is removed on completion or failure.

Cursor image attachments are sent as native SDK base64/MIME parts or remote
HTTP(S) URLs. Local file URLs and non-image attachments are rejected. The model
catalog currently may omit vision declarations; this is shown as unknown,
which permits uploading an image, rather than claiming the model is text only.
Old saved Cursor integration restrictions are ignored. Explicit model input
modalities still determine whether the model accepts images.
Model parameters use catalog
defaults; Router explicitly selects balanced optimization when offered.
SDK usage is recorded when supplied; cache reads and writes are added to the
inclusive input total used by FDO. Cursor custom rates can be saved in Usage &
cost, and estimate input, cached input, cache writes and output separately.
Reasoning is a subset of output and is not billed twice. Cost remains unknown
unless a rate is configured; these estimates are not Cursor's account charges.
FDO applies its response-size budgets; the SDK has no per-request
output-token cap in this adapter. Native SDK chunks and platform packages are
copied beside the packaged main process. The supported runtime requires Node
22.13 or later. See [Cursor's official SDK docs](https://cursor.com/docs/sdk/typescript).

`npm run test:ai:safety` includes native provider contract and structured-output
tests. They use installed SDKs with simulated HTTP responses, without paid API
calls. See [AI coding reliability](../../../docs/AI_CODING_RELIABILITY.md) for
completion rules, usage accounting and live-test configuration.
