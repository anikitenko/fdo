# GitHub Release Monitor authoring guide

## Modules and contracts
- index.ts: metadata, declared HTTPS capabilities, backend handler, and self-contained SDK UI bindings.
- logic.ts: validate owner/repository and request GitHub's latest public release with a timeout.
- render.tsx: accessible controls rendered through one SDK DOM instance.
- styles.css: standard CSS compiled to SDK style-map entries.
- text.ts: escape plain text in generated markup.
- starter.test.ts: deterministic tests; network responses are stubs, not evidence of live connectivity.

## Runtime rules
Keep HTTP requests in the backend. Never add a token to source. The URL always uses https://api.github.com. Declare capabilities without treating declarations as grants. The built-in public-web-secure host scope is broader than this example's fixed GitHub URL. Display response fields with textContent and keep previous results explicitly labelled after failure. Use defineRenderOnLoadActions for UI actions and do not close over backend variables.

Return expected API/check failures as a `kind: failed` result with a user-facing message. Do not throw them across the host handler boundary, where they appear as a plugin failure and trigger diagnostics notifications. Unexpected transport/host failures are still checked by the frontend.

## Validation
Run Tests, Compile, and deploy in FDO. A live check must be performed separately after reviewing and granting network access, HTTPS requests, and Secure Public Web Scope.
