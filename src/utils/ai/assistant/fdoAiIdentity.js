// Shared vector for host React and SDK-rendered HTML: a folded orbit and core.
export const FDO_AI_MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 29 9.5v6l-5-3V12L16 7.4 8 12v8l8 4.6 8-4.6v-1.5l5 3v1L16 30 3 22.5v-13Z"/><path d="m16 10 6 6-6 6-6-6Z"/></svg>';
const mask = `url("data:image/svg+xml,${encodeURIComponent(FDO_AI_MARK_SVG)}")`;
export const FDO_AI_MARK_STYLES = `
.fdo-ai-mark {
  display: inline-block; position: relative; flex: 0 0 auto;
  width: var(--fdo-ai-size, 24px); height: var(--fdo-ai-size, 24px);
  vertical-align: middle; color: var(--fdo-ai-color, #8abbff);
}
.fdo-ai-mark::before {
  content: ""; position: absolute; inset: 0; background: currentColor;
  -webkit-mask: ${mask} center / contain no-repeat;
  mask: ${mask} center / contain no-repeat;
}
.fdo-ai-mark[data-active="true"] { filter: drop-shadow(0 0 5px rgba(138,187,255,.55)); }
.fdo-ai-mark[data-active="true"]::before {
  background: linear-gradient(90deg, #46d2eb, #b3a1ff 40%, #def9ff 55%, #46d2eb);
  background-size: 200% 100%; animation: fdo-ai-flow 3s linear infinite;
}
@keyframes fdo-ai-flow { from { background-position: 0% 0; } to { background-position: 200% 0; } }
.fdo-ai-mark[data-active="true"][data-phase="waiting"]::before {
  animation: fdo-ai-breathe 2.4s ease-in-out infinite;
}
@keyframes fdo-ai-breathe {
  0%, 100% { opacity: .55; transform: scale(.94); }
  50% { opacity: 1; transform: scale(1); }
}
.fdo-ai-mark[data-active="false"][data-ambient="true"]::before {
  animation: fdo-ai-idle 5s ease-in-out infinite;
}
@keyframes fdo-ai-idle {
  0%, 100% { opacity: .78; transform: scale(.96); }
  50% { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .fdo-ai-mark::before { animation: none !important; }
}
@media (forced-colors: active) {
  .fdo-ai-mark { color: CanvasText; filter: none !important; }
  .fdo-ai-mark::before { forced-color-adjust: none; background: CanvasText !important; animation: none !important; }
}
`;
