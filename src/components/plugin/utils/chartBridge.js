import {normalizeChartConfig} from './chartConfig';

// Load Recharts only when a plugin actually requests a chart.
export function installChartRenderer(target = window, loadRenderer = () => import('./chartRenderer.jsx')) {
    const instances = new Map();
    const pending = new Set();
    let closed = false;
    let rendererPromise;
    const observer = new target.MutationObserver(() => {
        for (const [element, controller] of instances) if (!element.isConnected) controller.dispose();
    });
    observer.observe(target.document, {childList: true, subtree: true});
    const api = Object.freeze({version: 1, async create(element, config) {
        if (closed || !(element instanceof target.HTMLElement) || !element.isConnected) throw new Error('Chart needs a connected HTML element.');
        if (instances.has(element) || pending.has(element)) throw new Error('Chart already mounted in this element.');
        const normalized = normalizeChartConfig(config);
        pending.add(element);
        let renderer;
        try {
            rendererPromise ??= loadRenderer().catch(error => {rendererPromise = undefined; throw error;});
            renderer = await rendererPromise;
        } finally {pending.delete(element);}
        if (closed || !element.isConnected) throw new Error('Chart view was removed before loading completed.');
        const chart = renderer.mountChart(element, normalized);
        let disposed = false;
        const controller = Object.freeze({
            update(next) {
                if (disposed) throw new Error('Chart has been disposed.');
                chart.update(normalizeChartConfig(next));
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                instances.delete(element);
                chart.dispose();
            },
        });
        instances.set(element, controller);
        return controller;
    }});
    target.FDOCharts = api;
    const dispose = () => {
        closed = true;
        observer.disconnect();
        for (const controller of instances.values()) controller.dispose();
        if (target.FDOCharts === api) delete target.FDOCharts;
        target.removeEventListener('pagehide', dispose);
    };
    target.addEventListener('pagehide', dispose, {once: true});
    return {dispose};
}
