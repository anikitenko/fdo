# Browser libraries in standalone exports

Standalone web / Docker exports include these frontend globals locally:

- `window.Notyf`, including notification styles and accessibility announcements.
- `window.Split` (Split Grid).
- `window.hljs` (the same highlight.js build as FDO), including highlighting styles.
- `window.goober`, configured for React.
- `window.React` and `window.ReactDOM` with the installed React DOM and client APIs.
- `window.lodash` and `window._`.
- `window.Terminal` (xterm.js); `window.FDOTerminal` remains the managed terminal API.
- `window.ace` (Ace Editor), including its locally bundled editor modules, modes,
  themes, snippets and extensions. Worker execution is disabled to preserve the
  sandbox's restrictive content security policy.
- `window.FDOCharts`, the existing supported chart API.

Use these inside frontend initialization or UI actions, rather than backend code.
The exported iframe loads their code and styles before plugin initialization.
No desktop `static://` URLs, CDN requests, added network grants, or relaxed script
policy are needed. Original third-party license texts are included in the export.

For example, frontend code can use `new Notyf().success('Saved')` or
`new window.Notyf().success('Saved')` unchanged. The converter recognizes
supported libraries through their browser globals, `window`, and `globalThis`.
Normal library cleanup still applies when unmounting views or replacing controls.

Chart.js (`window.Chart`), Moment and Day.js are not standalone bundles.
The converter keeps an explicit diagnostic for them; Recharts does not implement
the Chart.js API. Use `window.FDOCharts` for supported charts. Other libraries need
an explicit frontend bundle with their required assets. APIs which dynamically
compile scripts or fetch executable assets remain subject to the iframe CSP.

Restart the rebuilt FDO and run a fresh export review to regenerate an existing
Docker project with these libraries.
