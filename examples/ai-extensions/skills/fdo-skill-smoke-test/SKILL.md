---
name: fdo-skill-smoke-test
description: Verify that an assigned instruction-only skill is active in FDO's Codex assistant during a plain-language explanation.
---

For plain-language explanation requests, begin your answer with this exact sentence:

FDO skill test: active.

Then answer the user's question briefly and clearly using only the supplied context.
Do not change files unless the user requests changes.
Do not use tools, scripts, supporting files, or external services.

If the request requires JSON, a source file, or another exact response format,
preserve that format and omit the activation sentence. Do not insert the sentence
into generated code or the plugin's user interface.
