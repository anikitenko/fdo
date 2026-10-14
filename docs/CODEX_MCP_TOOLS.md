# MCP tools for Codex coding assistants

In Settings → AI Extensions → Codex → MCP Tools, add an HTTP or command server. Select its allowed tools, assign one or more saved Codex coding assistants, enable the server, and save permissions. Changes take effect on the next request. Codex remains available only as a coding assistant.

## HTTP servers

Remote endpoints use HTTPS. Local development endpoints may use HTTP with `localhost`, `127.0.0.1`, or `[::1]`. Embedded URL credentials, query strings, and fragments are rejected. Supported authentication:

- None, with optional custom headers.
- Bearer token.
- OAuth browser sign-in for public desktop clients, with metadata discovery, PKCE, dynamic client registration where supported, and refresh tokens.

Add custom headers as name/value rows, for example name `X-Team` and value `devops`. Values are stored in FDO settings and hidden from the inventory. Reserved transport headers and conflicting Authorization settings are rejected. Custom headers are sent only to the configured MCP endpoint, including when OAuth discovery uses a different endpoint.

For OAuth, select **Add server and sign in**, complete consent in your browser, then **Check connection** to discover tools. A public client ID can be provided when dynamic registration is unavailable. For a pre-registered client, register `http://127.0.0.1:PORT/callback` and enter that callback port. Otherwise FDO chooses an available loopback port and retains the redirect URI for subsequent sign-ins. Scopes are optional. Sign-in can be cancelled and has a three-minute limit. Sign out removes locally saved credentials; it does not sign you out of the provider’s browser session or revoke its consent grant.

FDO keeps OAuth credentials separate from server configuration. Tokens, headers, and environment values are not included in assistant prompts or public extension inventory. Existing remote bearer connections remain supported.

## Command servers / stdio

Choose **Command · stdio** and specify an installed executable and add one literal argument per row. Use the arrow buttons to reorder arguments and the cross to remove a row. FDO launches it without a general shell using the MCP SDK’s cross-platform process transport. `node`, `npx`, and `uvx` are examples; install the required runtime and server separately. Executable paths and arguments containing spaces are supported. Windows command shims are handled by the process transport.

For an installed Node server:

- Command: `node`
- Argument 1: `/absolute/path/to/server.js` (Windows example: `C:\tools\server.js`). Enter paths directly without JSON escaping or extra quotes.
- Working directory: optional absolute path; defaults to your home directory.
- Environment: name/value rows, such as name `SERVICE_TOKEN` and its value. Values are masked while editing; use Show values to inspect them.

Only basic OS variables and explicitly configured environment values are forwarded. Use environment variables for secrets rather than command arguments. Server stdout must contain MCP protocol messages. Stderr is drained without recording potentially sensitive output. Connection testing starts the process and discovers tools without calling them. The process is closed after testing or after the coding request ends.

Command servers run with your user permissions as separate trusted tools. Their filesystem and network access depend on that server’s configuration. Codex’s shell remains disabled. To change connection configuration, remove and add the server again; tool and assistant permissions can be changed directly.

## Runtime boundaries

FDO connects to configured servers through the official MCP SDK and exposes an authenticated temporary loopback bridge to bundled Codex. Provider credentials remain in FDO. The bridge filters the tool catalog and rejects calls to unselected tools. Trusted connections may also expose MCP resources. Saving permissions authorizes the selected tools to run during requests without asking each time.

The bundled code-mode helper can call MCP tools without enabling shell tools or host filesystem imports. On macOS the agent sandbox allows only its temporary bridge ports while retaining host filesystem restrictions and denying other loopback ports. The bridge closes with the request. Staged recovery detects changes to server configuration, assignments, tool permissions, or explicit OAuth sign-out; routine token refresh does not invalidate a checkpoint.

AI Progress shows configured server/tool counts and actual native MCP start/completion/failure events without arguments or tool results. A configured-server message alone does not prove a call occurred. Active calls suspend answer-stream idle checks, subject to a 75-second host bound and the existing first-answer and total-request deadlines. FDO does not automatically replay failed requests once MCP execution began; a manual retry may repeat external actions.

## Verification

- `node scripts/check-mcp-transports.cjs`: offline stdio, local HTTP, custom headers, authenticated bridge, tool filtering, macOS port boundary, and OAuth discovery/registration/PKCE/state/token exchange.
- `node scripts/check-codex-mcp.cjs`: bundled native direct and code-mode tool calls against mocked inference and MCP endpoints.
- `npm run test:ai:isolation`: native filesystem isolation.
- `npx playwright test tests/e2e/ai-extensions-settings.spec.js --workers=1`: Settings IPC and persistence.

To test manually, enable the OpenAI Docs example and ask the assigned Codex assistant: “Use the configured OpenAI Docs MCP server to find documentation for Responses API remote MCP tools. Explain tool allowlists and approvals and include retrieved links.” Real OAuth providers, installed command servers, and Windows/Linux execution still require validation in their respective environments.

References: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp), [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).
