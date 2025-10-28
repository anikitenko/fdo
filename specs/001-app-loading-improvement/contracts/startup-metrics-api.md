# Startup Metrics API Contract

**Version**: 1.0.0  
**Type**: Internal API (no external exposure)  
**Location**: `src/utils/startupMetrics.js` (NEW)

---

## Overview

Internal API for tracking and logging FDO application startup performance metrics. Used by main process (`src/main.js`) and renderer process (`src/renderer.js`) to instrument startup phases.

---

## API Surface

### 1. `initMetrics(): void`

Initialize metrics tracking system. Must be called at process start.

**Parameters**: None

**Returns**: `void`

**Side Effects**:
- Records process start timestamp
- Creates log directory if not exists
- Generates session UUID

**Usage**:
```javascript
// src/main.js (very first line after imports)
import { initMetrics } from './utils/startupMetrics.js';

initMetrics();
```

---

### 2. `logMetric(event: StartupEvent, metadata?: object): Promise<void>`

Log a startup event with optional metadata.

**Parameters**:
- `event: StartupEvent` - Event name (see types below)
- `metadata?: object` - Optional additional context

**Returns**: `Promise<void>`

**Side Effects**:
- Writes to console (synchronous)
- Appends to log file (asynchronous)
- Calculates elapsed time from process start
- Checks slow startup threshold (4.5s)

**Usage**:
```javascript
// src/main.js
import { logMetric } from './utils/startupMetrics.js';

app.on('ready', async () => {
  await logMetric('app-ready');
  createWindow();
});

async function createWindow() {
  const win = new BrowserWindow({...});
  await logMetric('window-created', { windowId: win.id });
}
```

**Error Handling**: If file write fails, logs error to console but does not throw.

---

### 3. `getElapsedTime(): number`

Get milliseconds elapsed since process start.

**Parameters**: None

**Returns**: `number` - Milliseconds elapsed

**Usage**:
```javascript
import { getElapsedTime } from './utils/startupMetrics.js';

console.log(`Current startup time: ${getElapsedTime()}ms`);
```

---

### 4. `isSlowStartup(): boolean`

Check if current startup has exceeded slow threshold (4.5s).

**Parameters**: None

**Returns**: `boolean` - True if elapsed time > 4500ms

**Usage**:
```javascript
import { isSlowStartup } from './utils/startupMetrics.js';

if (isSlowStartup()) {
  console.warn('Startup is slower than expected');
}
```

---

## Types

### StartupEvent

```typescript
type StartupEvent =
  | 'process-start'           // Process initialization (logged by initMetrics)
  | 'app-ready'               // Electron app.ready event
  | 'window-created'          // BrowserWindow instance created
  | 'window-visible'          // Window.show() called
  | 'renderer-process-start'  // Renderer process begins
  | 'renderer-loaded'         // webContents.did-finish-load
  | 'react-mount-start'       // React.render() called
  | 'react-mount-complete'    // React mount finished
  | 'app-interactive'         // UI fully interactive (FINAL)
  ;
```

---

## Log Format

### Console Output

```text
[STARTUP] process-start: 0ms
[STARTUP] app-ready: 450ms
[STARTUP] window-created: 780ms
[STARTUP] app-interactive: 2850ms
```

### File Output (NDJSON)

File: `~/.fdo/logs/startup.log` (or OS equivalent from `app.getPath('userData')`)

```json
{"event":"process-start","timestamp":"1234567890000000","elapsed":"0ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"app-ready","timestamp":"1234568340000000","elapsed":"450ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"window-created","timestamp":"1234568670000000","elapsed":"780ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
{"event":"app-interactive","timestamp":"1234570740000000","elapsed":"2850ms","platform":"darwin","arch":"arm64","startupType":"cold","session":"a1b2c3d4","version":"1.0.0","electronVersion":"37.2.6"}
```

---

## Implementation Requirements

### Performance

- `logMetric()` MUST NOT block startup
- File writes MUST be asynchronous
- Timing overhead MUST be <1ms per call
- Use `process.hrtime.bigint()` for microsecond precision

### Reliability

- If log file write fails, log to console but continue
- Create log directory with `fs.mkdir(recursive: true)`
- Handle race conditions for multiple writes
- Ensure NDJSON format (one JSON object per line)

### Configuration

- Log file path: `${app.getPath('userData')}/logs/startup.log`
- No automatic rotation (user manages manually)
- Console output enabled in both dev and production

---

## Integration Points

### Main Process (src/main.js)

```javascript
import { initMetrics, logMetric } from './utils/startupMetrics.js';

// Very first line after imports
initMetrics();

app.on('ready', async () => {
  await logMetric('app-ready');
  createWindow();
});

function createWindow() {
  const win = new BrowserWindow({...});
  logMetric('window-created');
  
  win.webContents.on('did-finish-load', () => {
    logMetric('renderer-loaded');
  });
  
  win.once('ready-to-show', () => {
    win.show();
    logMetric('window-visible');
  });
}
```

### Renderer Process (src/renderer.js)

```javascript
import { logMetric } from './utils/startupMetrics.js';

// At script start
logMetric('renderer-process-start');

// After React renders
import { createRoot } from 'react-dom/client';

logMetric('react-mount-start');

const root = createRoot(document.getElementById('root'));
root.render(<App />);

// After first render completes
requestAnimationFrame(() => {
  logMetric('react-mount-complete');
  
  // Check if fully interactive
  if (document.readyState === 'complete') {
    logMetric('app-interactive');
  }
});
```

---

## Testing

### Unit Tests

```javascript
// tests/unit/startupMetrics.test.js
import { initMetrics, logMetric, getElapsedTime, isSlowStartup } from '../../src/utils/startupMetrics';

describe('Startup Metrics', () => {
  beforeEach(() => {
    initMetrics();
  });

  test('elapsed time increases', async () => {
    const t1 = getElapsedTime();
    await new Promise(resolve => setTimeout(resolve, 100));
    const t2 = getElapsedTime();
    expect(t2).toBeGreaterThan(t1);
  });

  test('detects slow startup', async () => {
    // Mock elapsed time
    expect(isSlowStartup()).toBe(false);
  });

  test('logs to console', async () => {
    const spy = jest.spyOn(console, 'log');
    await logMetric('test-event');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[STARTUP]'));
  });
});
```

### Integration Tests

```javascript
// tests/integration/startup.test.js
import { Application } from 'spectron';

describe('Startup Performance', () => {
  let app;

  beforeEach(async () => {
    app = new Application({
      path: electronPath,
      args: [path.join(__dirname, '..')]
    });
    await app.start();
  });

  afterEach(async () => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  test('logs all startup events', async () => {
    // Wait for app to be interactive
    await app.client.waitUntilWindowLoaded();
    
    // Check log file exists
    const logPath = path.join(app.getPath('userData'), 'logs', 'startup.log');
    expect(fs.existsSync(logPath)).toBe(true);
    
    // Parse log entries
    const logs = fs.readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    
    // Verify all events logged
    const events = logs.map(l => l.event);
    expect(events).toContain('process-start');
    expect(events).toContain('app-ready');
    expect(events).toContain('window-created');
    expect(events).toContain('app-interactive');
  });
});
```

---

## Versioning

**Current Version**: 1.0.0

**Change Policy**: This is an internal API. Breaking changes are acceptable if documented.

**Changelog**:
- 1.0.0 (2025-10-27): Initial implementation

---

## Related Documents

- [data-model.md](../data-model.md) - Data structure definitions
- [research.md](../research.md) - Logging strategy decisions
- [quickstart.md](../quickstart.md) - Usage examples

