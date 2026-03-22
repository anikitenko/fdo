# Langfuse Observability

FDO now has an optional Langfuse export path for AI chat tracing.

It is disabled by default.

## Configuration

Enable it either with environment variables or by editing the persisted Electron settings store.

Environment variables:
- `LANGFUSE_ENABLED=true`
- `LANGFUSE_HOST=https://cloud.langfuse.com`
- `LANGFUSE_PUBLIC_KEY=...`
- `LANGFUSE_SECRET_KEY=...`
- optional: `LANGFUSE_ENV=production`
- optional: `LANGFUSE_RELEASE=...`

Stored settings path:
- `ai.observability.langfuse`

Supported fields:
- `enabled`
- `host`
- `publicKey`
- `secretKey`
- `environment`
- `release`

## Current trace coverage

One trace per AI chat turn:
- routing / tool-policy decision span
- per-tool spans
- tool follow-up span
- final trace metadata with route, scope, task shape, tools, and prompt version

## Manual verification

1. Configure valid Langfuse credentials.
2. Start the app.
3. Ask:
   - `how do FDO plugins work?`
   - `what is weather in Lutsk?`
4. Check the main-process log.
5. Expected:
   - `[Langfuse] Trace exported`
6. Check Langfuse UI.
7. Expected:
   - one trace per turn
   - routing span
   - tool spans for tool-backed turns
8. Break credentials intentionally.
9. Expected:
   - `[Langfuse] Trace export failed ...`
   - chat still works normally

## Notes

- The export path is fail-open and does not block chat execution.
- This slice does not yet include feedback/eval hooks.
