# FDO AI identity

The **folded orbit** is an open hexagonal ribbon surrounding a diamond core. Its silhouette stays fixed while active work moves cyan and violet across it, echoing the Coding Agent's continuous top-edge glow. Idle marks use one color; activity uses gentle motion, not spinning or flashing.

The canonical SVG and CSS live in `src/utils/ai/assistant/fdoAiIdentity.js`. A standalone vector is available in `docs/assets/fdo-ai-mark.svg`.

## Host components

```jsx
import FdoAiMark from '../ai/FdoAiMark';

<FdoAiMark size={24} active={isWorking} />
```

Use `phase="waiting"` for a gentle pulse before answer content arrives, and
`phase="responding"` for flowing color while the response is being produced.
The default is `responding`; both phases animate only when `active` is true.
These presentation states are shared across providers and models. HTML consumers
can use the equivalent `data-phase` attribute.

The sidebar uses `ambient` (HTML: `data-ambient="true"`) for a subtle five-second
idle pulse. This decorative motion does not indicate an active request. Active
request animation takes precedence; reduced-motion preferences disable both.

The mark is decorative by default. Supply `label="FDO AI"` when it stands alone. Keep readable status text beside active marks; animation alone must not communicate request status.

## Plugin UI

FDO injects the same styles into rendered plugin iframes. No React, network asset, package import, or style-map registration is required for this host-provided class:

```html
<span class="fdo-ai-mark" data-active="false" aria-hidden="true"></span>
<span role="status">Ready to assist</span>
```

Set `data-active="true"` while an AI request is pending, then restore `false` on success, failure, or cancellation. Use your existing SDK AI request/access flow; this visual marker does not grant permissions or start requests.

```js
mark.dataset.active = 'true';
try {
    // Await your authorized AI operation here.
} finally {
    mark.dataset.active = 'false';
}
```

Size is controlled by `--fdo-ai-size` (default `24px`). `--fdo-ai-color` overrides the idle color, for example a darker blue on light surfaces. Use an accessible adjacent label, or `role="img" aria-label="FDO AI"` on a standalone mark instead of `aria-hidden`.

Reduced-motion preferences disable animation. Forced-color mode uses the system text color. Keep the silhouette intact and preserve space around it at small sizes.

## Native coding activity

While coding work is active, the same mark appears in the macOS menu bar,
Windows notification area, or a supported Linux tray. Its menu opens active
editors, selects the AI Coding Agent tab, and opens its progress popover;
the icon disappears when the final operation ends, including cancellation,
window closure, or renderer failure. Existing Dock/taskbar indicators remain.
The tray uses a monochrome macOS template for automatic light/dark adaptation
and a blue mark elsewhere, with 1x, 2x, and 3x PNG representations bundled in JS.

Regenerate `src/utils/ai/assistant/fdoAiTrayIcons.json` after changing the shared SVG:
`node scripts/generate-ai-tray-icons.cjs` (requires Playwright Chromium;
`CHROME_PATH` can point to an installed Chrome executable).

Windows may put the icon in its tray overflow; Linux visibility depends on the
desktop's tray support. No notification permission is required for the tray icon.
