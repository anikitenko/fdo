export function Render(): string {
    return `
<style>
[data-json-inspector] {
    --ink: #172b3a;
    --muted: #526777;
    box-sizing: border-box;
    max-width: 880px;
    margin: 0 auto;
    padding: clamp(18px, 4vw, 36px);
    color: var(--ink);
    background: #f5f8fa;
    font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    border-radius: 16px;
}
[data-json-inspector] * { box-sizing: border-box; }
[data-json-inspector] [hidden] { display: none !important; }
[data-json-inspector] .ji-eyebrow {
    color: #28616a; font-size: 11px; font-weight: 750;
    letter-spacing: .14em; text-transform: uppercase; margin: 0 0 6px;
}
[data-json-inspector] h1 { margin: 0; font-size: clamp(26px, 5vw, 34px); letter-spacing: -.04em; }
[data-json-inspector] .ji-intro { margin: 7px 0 24px; color: var(--muted); }
[data-json-inspector] .ji-label-row {
    display: flex; flex-wrap: wrap; align-items: baseline;
    justify-content: space-between; gap: 8px; margin-bottom: 8px;
}
[data-json-inspector] .pure-form label { margin: 0; font-weight: 700; }
[data-json-inspector] .ji-hint { color: var(--muted); font-size: 12px; }
[data-json-inspector] .pure-form textarea {
    display: block; width: 100%; min-height: 300px; resize: vertical;
    margin: 0; padding: 16px; border: 1px solid #aebfcc;
    border-radius: 10px; box-shadow: none; background: #fff; color: var(--ink);
    font: 13px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace;
    tab-size: 2;
}
[data-json-inspector] textarea::placeholder { color: #667b8a; opacity: 1; }
[data-json-inspector] textarea[aria-invalid="true"] { border-color: #b74343; }
[data-json-inspector] .ji-actions {
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
    margin: 16px 0 24px;
}
[data-json-inspector] .pure-button-primary {
    padding: 12px 24px; border-radius: 8px; background: #17646c;
    color: #fff; font-weight: 700; border: 1px solid #17646c;
    transition: background-color .15s ease;
}
[data-json-inspector] .pure-button-primary:hover { background: #104d54; }
[data-json-inspector] .pure-button-primary:disabled { opacity: .7; cursor: wait; }
[data-json-inspector] :is(button, textarea):focus-visible {
    outline: 3px solid #2a8290; outline-offset: 3px;
}
[data-json-inspector] .ji-result {
    border: 1px solid #c4d1da; border-left: 4px solid #8097a6;
    border-radius: 10px; background: #fff; padding: 18px;
    overflow-wrap: anywhere;
}
[data-json-inspector] .ji-result[data-state="success"] {
    border-color: #9bcbb7; border-left-color: #19734c; background: #f1fbf5;
}
[data-json-inspector] .ji-result[data-state="error"] {
    border-color: #e3b3b3; border-left-color: #b13535; background: #fff5f5;
}
[data-json-inspector] .ji-result[data-state="pending"] {
    border-left-color: #17646c; background: #edf7f8;
}
[data-json-inspector] h2 { margin: 0 0 6px; font-size: 17px; }
[data-json-inspector] [data-result-message] {
    margin: 0; color: var(--muted); white-space: pre-wrap;
}
[data-json-inspector] .ji-result[data-state="error"] h2 { color: #912727; }
[data-json-inspector] .ji-result[data-state="success"] h2 { color: #155c3d; }
[data-json-inspector] dl {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px; margin: 16px 0 0;
}
[data-json-inspector] dt { color: var(--muted); font-size: 12px; }
[data-json-inspector] dd { margin: 3px 0 0; font-weight: 700; }
[data-json-inspector] .ji-keys { grid-column: 1 / -1; }
[data-json-inspector] .ji-keys dd {
    font: 13px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace;
    white-space: pre-wrap;
}
@media (max-width: 480px) {
    [data-json-inspector] { border-radius: 0; }
    [data-json-inspector] .pure-button-primary { width: 100%; }
    [data-json-inspector] textarea { min-height: 260px; }
}
@media (prefers-reduced-motion: reduce) {
    [data-json-inspector] .pure-button-primary { transition: none; }
}
</style>
<main data-json-inspector>
    <header>
        <p class="ji-eyebrow">DevOps toolkit / Local utility</p>
        <h1>JSON Inspector</h1>
        <p class="ji-intro">A quick sanity check for configs and API responses.</p>
    </header>
    <form class="pure-form pure-form-stacked">
        <div class="ji-label-row">
            <label for="json-source">JSON input</label>
            <span id="json-editor-hint" class="ji-hint">Objects, arrays and scalar values supported</span>
        </div>
        <textarea id="json-source" aria-describedby="json-editor-hint"
            spellcheck="false" autocapitalize="off" autocomplete="off"
            placeholder='Paste JSON here, for example:
{
  "service": "api",
  "replicas": 3,
  "healthy": true
}'></textarea>
        <div class="ji-actions">
            <button data-inspect class="pure-button pure-button-primary" type="submit">Inspect JSON</button>
            <span class="ji-hint">Local only. Your input is never sent anywhere.</span>
        </div>
    </form>
    <section class="ji-result" data-result data-state="empty"
        role="status" aria-live="polite" aria-atomic="true" aria-busy="false">
        <h2 data-result-title>Ready for your JSON</h2>
        <p data-result-message>Paste a config or API response above, then select Inspect JSON.</p>
        <dl data-summary hidden>
            <div><dt>Value type</dt><dd data-value-type></dd></div>
            <div><dt>Top-level items</dt><dd data-count></dd></div>
            <div class="ji-keys" data-keys-row hidden>
                <dt>Top-level keys</dt><dd data-keys></dd>
            </div>
        </dl>
    </section>
</main>`;
}