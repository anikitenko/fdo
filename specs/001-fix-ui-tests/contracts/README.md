# Contracts: UI Test Infrastructure

This feature does not introduce new external HTTP/GraphQL APIs. It validates and relies on existing internal IPC contracts:

- Test Server → Renderer: `webContents.executeJavaScript(script)`
- Notifications: `virtualFS.notifications.addToQueue(eventType, data)`
- System IPC: `window.electron.system.confirmEditorCloseApproved()` (cleanup path)

Machine-readable CI output:
- JUnit XML test reports (per FR-023)
