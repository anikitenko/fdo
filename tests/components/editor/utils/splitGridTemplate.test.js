import * as Babel from '@babel/standalone';
import {SPLIT_GRID_LAYOUT} from '../../../../src/components/editor/utils/templates/splitGridLayout';

function initializer() {
    const compiled = Babel.transform(SPLIT_GRID_LAYOUT, {filename: 'split.ts', presets: ['typescript'], plugins: ['transform-modules-commonjs']}).code;
    const exports = {};
    new Function('exports', compiled)(exports);
    // The SDK serializes setup functions; no imported closure may be required.
    return new Function(`return (${exports.initializeSplitLayout.toString()})`)();
}
function mountLayout() {
    document.body.innerHTML = '<div data-role="split-layout"><section id="split-controls"></section><div data-role="split-gutter"></div><section id="split-metrics"></section></div><p data-role="split-hint"></p>';
}
const width = window.innerWidth;
afterEach(() => {
    window.__starterSplitLayout?.dispose();
    delete window.__starterSplitLayout;
    delete window.Split;
    window.innerWidth = width;
    document.body.innerHTML = '';
});
test('rerenders clean up old instances and keyboard listeners while preserving the split ratio', () => {
    window.innerWidth = 1000;
    const destroy = jest.fn();
    window.Split = jest.fn(() => ({destroy}));
    const init = initializer();
    mountLayout();
    init();
    const gutter = document.querySelector('[data-role="split-gutter"]');
    gutter.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(gutter.getAttribute('aria-valuenow')).toBe('55');
    init();
    expect(destroy).toHaveBeenCalledTimes(1);
    gutter.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(gutter.getAttribute('aria-valuenow')).toBe('60');
    gutter.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(gutter.getAttribute('aria-valuenow')).toBe('80');
    window.innerWidth = 480;
    window.dispatchEvent(new Event('resize'));
    expect(gutter.hidden).toBe(true);
    expect(document.querySelector('[data-role="split-layout"]').style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    window.innerWidth = 1000;
    window.dispatchEvent(new Event('resize'));
    expect(gutter.hidden).toBe(false);
    expect(gutter.getAttribute('aria-valuenow')).toBe('80');
});
test('unmount cleans up the split instance; absent library retains keyboard resizing', async () => {
    window.innerWidth = 1000;
    const destroy = jest.fn();
    window.Split = () => ({destroy});
    mountLayout();
    initializer()();
    document.querySelector('[data-role="split-layout"]').remove();
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledWith(true);
    delete window.Split;
    mountLayout();
    initializer()();
    expect(document.querySelector('[data-role="split-hint"]').textContent).toContain('unavailable');
    const gutter = document.querySelector('[data-role="split-gutter"]');
    gutter.dispatchEvent(new KeyboardEvent('keydown', {key: 'Home', bubbles: true}));
    expect(gutter.getAttribute('aria-valuenow')).toBe('20');
});
