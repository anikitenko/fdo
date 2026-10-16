import {waitForPluginAssets} from '../../src/components/plugin/utils/pluginAssetReadiness';

function fixture(readyState = 'loading', sheets = [null, null]) {
    const target = new EventTarget();
    target.setTimeout = setTimeout;
    target.clearTimeout = clearTimeout;
    const links = sheets.map(sheet => Object.assign(new EventTarget(), {sheet}));
    const doc = {readyState, querySelectorAll: () => links};
    const removals = links.map(link => jest.spyOn(link, 'removeEventListener'));
    return {target, links, doc, removals};
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('ready documents and existing cross-origin sheets allocate no timers or rule reads', async () => {
    const sheet = {get cssRules() {throw new Error('cross-origin rules');}};
    const {doc, target, links} = fixture('complete', [sheet]);
    const add = jest.spyOn(links[0], 'addEventListener');
    const assets = waitForPluginAssets(doc, target);
    await assets.ready;
    expect(jest.getTimerCount()).toBe(0);
    expect(add).not.toHaveBeenCalled();
    assets.dispose();
});

test('load and stylesheet success clear their timers immediately', async () => {
    const {doc, target, links, removals} = fixture();
    const assets = waitForPluginAssets(doc, target), ready = jest.fn();
    assets.ready.then(ready);
    expect(jest.getTimerCount()).toBe(2);
    target.dispatchEvent(new Event('load'));
    expect(jest.getTimerCount()).toBe(1);
    links[0].dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    links[1].dispatchEvent(new Event('load'));
    await assets.ready;
    expect(jest.getTimerCount()).toBe(0);
    removals.forEach(remove => expect(remove).toHaveBeenCalledTimes(2));
});

test('failed stylesheets settle alongside successful ones without waiting for timeout', async () => {
    const {doc, target, links} = fixture('complete');
    const assets = waitForPluginAssets(doc, target);
    links[0].dispatchEvent(new Event('error'));
    links[1].dispatchEvent(new Event('load'));
    await assets.ready;
    expect(jest.getTimerCount()).toBe(0);
});

test('fallback deadlines bound readiness and remove every listener', async () => {
    const {doc, target, removals} = fixture();
    const remove = jest.spyOn(target, 'removeEventListener');
    const assets = waitForPluginAssets(doc, target), ready = jest.fn();
    assets.ready.then(ready);
    await jest.advanceTimersByTimeAsync(1400);
    expect(ready).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(400);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    removals.forEach(fn => expect(fn).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenCalledTimes(1);
});

test('replacing twelve views leaves no pending timers or asset listeners', async () => {
    const {doc, target, links, removals} = fixture();
    const remove = jest.spyOn(target, 'removeEventListener');
    for (let i = 0; i < 12; i++) {
        const assets = waitForPluginAssets(doc, target);
        expect(jest.getTimerCount()).toBe(2);
        assets.dispose();assets.dispose();
        await assets.ready;
        expect(jest.getTimerCount()).toBe(0);
    }
    removals.forEach(fn => expect(fn).toHaveBeenCalledTimes(24));
    expect(remove).toHaveBeenCalledTimes(12);
    links.forEach(link => link.dispatchEvent(new Event('load')));
    target.dispatchEvent(new Event('load'));
    expect(jest.getTimerCount()).toBe(0);
});
