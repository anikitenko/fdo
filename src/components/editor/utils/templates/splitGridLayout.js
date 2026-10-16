// These source templates run in the virtual plugin workspace; workspace typecheck tests validate them.
// Serialized by defineRenderOnLoadActions: keep this function self-contained.
// language=TEXT
export const SPLIT_GRID_LAYOUT = `export function initializeSplitLayout(): void {
    type SplitInstance = {destroy(immediate?: boolean): void};
    type LayoutState = {ratio: number; dispose(): void};
    const scope = window as Window & {
        Split?: (options: {columnGutters: {track: number; element: HTMLElement}[]; columnMinSize: number; onDragEnd(): void}) => SplitInstance;
        __starterSplitLayout?: LayoutState;
    };
    const previous = scope.__starterSplitLayout;
    previous?.dispose();
    const layout = document.querySelector<HTMLElement>('[data-role="split-layout"]');
    const gutter = document.querySelector<HTMLElement>('[data-role="split-gutter"]');
    const controls = document.getElementById('split-controls');
    const hint = document.querySelector<HTMLElement>('[data-role="split-hint"]');
    if (!layout || !gutter || !controls) return;
    const state: LayoutState = {ratio: previous?.ratio ?? 50, dispose: () => {}};
    scope.__starterSplitLayout = state;
    let split: SplitInstance | undefined;
    let disposed = false;
    const updateRatio = () => {
        const percent = Math.round(state.ratio);
        gutter.setAttribute('aria-valuenow', String(percent));
        gutter.setAttribute('aria-valuetext', percent + '% controls pane');
    };
    const setTracks = () => { layout.style.gridTemplateColumns = state.ratio + 'fr 12px ' + (100 - state.ratio) + 'fr'; updateRatio(); };
    const refreshLayout = () => {
        split?.destroy(true);
        split = undefined;
        const narrow = window.innerWidth <= 640;
        gutter.hidden = narrow;
        gutter.tabIndex = narrow ? -1 : 0;
        layout.style.gap = narrow ? '16px' : '0';
        if (narrow) {
            layout.style.gridTemplateColumns = 'minmax(0, 1fr)';
            if (hint) hint.textContent = 'Panels are stacked on narrow screens.';
            return;
        }
        setTracks();
        if (typeof scope.Split === 'function') {
            split = scope.Split({columnGutters: [{track: 1, element: gutter}], columnMinSize: Math.max(100, (layout.clientWidth - 12) * 0.2),
                onDragEnd: () => {
                    const available = layout.clientWidth - 12;
                    if (available > 0) state.ratio = Math.min(80, Math.max(20, controls.getBoundingClientRect().width / available * 100));
                    updateRatio();
                }});
            if (hint) hint.textContent = 'Drag the divider, or focus it and use Left/Right. Home/End sets the limits.';
        } else if (hint) hint.textContent = 'Split Grid is unavailable. Focus the divider and use Left/Right to resize.';
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (gutter.hidden) return;
        const step = event.shiftKey ? 10 : 5;
        if (event.key === 'ArrowLeft') state.ratio -= step;
        else if (event.key === 'ArrowRight') state.ratio += step;
        else if (event.key === 'Home') state.ratio = 20;
        else if (event.key === 'End') state.ratio = 80;
        else return;
        event.preventDefault();
        state.ratio = Math.min(80, Math.max(20, state.ratio));
        setTracks();
    };
    const observer = new MutationObserver(() => { if (!layout.isConnected) state.dispose(); });
    state.dispose = () => {
        if (disposed) return;
        disposed = true;
        split?.destroy(true);
        observer.disconnect();
        gutter.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('resize', refreshLayout);
        window.removeEventListener('pagehide', state.dispose);
    };
    gutter.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', refreshLayout);
    window.addEventListener('pagehide', state.dispose);
    observer.observe(document.body, {childList: true, subtree: true});
    refreshLayout();
}
`;

export const SPLIT_GRID_STYLES = `
.split { display: grid; grid-template-columns: 50fr 12px 50fr; margin-top: 20px; min-width: 0; align-items: stretch; }
.gutter { background: #607789; cursor: col-resize; touch-action: none; border-radius: 6px; outline-offset: -2px; }
.gutter:focus-visible { outline: 2px solid #82b8fa; }
`;
