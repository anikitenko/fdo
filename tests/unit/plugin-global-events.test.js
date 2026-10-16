import {installPluginGlobalEvents} from '../../src/components/plugin/utils/pluginGlobalEvents';

function fixture() {
    const target = new EventTarget();
    const owner = installPluginGlobalEvents(target);
    return {target, owner};
}

test('duplicate registration is ignored and removal preserves other callbacks', () => {
    const {target, owner} = fixture();
    const first = jest.fn(), second = jest.fn();
    const unsubscribe = target.addGlobalEventListener('update', first);
    expect(target.addGlobalEventListener('update', first)).toBe(unsubscribe);
    target.addGlobalEventListener('update', second);
    target.dispatchEvent(new Event('update'));
    expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(1);
    target.removeGlobalEventListener('update', first);
    target.dispatchEvent(new Event('update'));
    expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(2);
    owner.dispose();
    target.dispatchEvent(new Event('update'));
    expect(second).toHaveBeenCalledTimes(2);
});

test('replacement views keep exactly one callback per dispatch and stale helpers cannot register work', () => {
    const target = new EventTarget(), callback = jest.fn();
    let oldAdd;
    for (let i = 0; i < 12; i++) {
        const owner = installPluginGlobalEvents(target);
        target.addGlobalEventListener('refresh', callback);
        oldAdd = target.addGlobalEventListener;
        target.dispatchEvent(new Event('refresh'));
        expect(callback).toHaveBeenCalledTimes(i + 1);
        owner.dispose();owner.dispose();
        oldAdd('refresh', callback);
        target.dispatchEvent(new Event('refresh'));
        expect(callback).toHaveBeenCalledTimes(i + 1);
        expect(target.addGlobalEventListener).toBeUndefined();
        expect(target.removeGlobalEventListener).toBeUndefined();
    }
});

test('stale unsubscribe does not remove a newer registration of the same callback', () => {
    const {target, owner} = fixture(), callback = jest.fn();
    const stale = target.addGlobalEventListener('update', callback);
    stale();
    const current = target.addGlobalEventListener('update', callback);
    stale();
    target.dispatchEvent(new Event('update'));
    expect(callback).toHaveBeenCalledTimes(1);
    current();current();
    target.dispatchEvent(new Event('update'));
    expect(callback).toHaveBeenCalledTimes(1);
    owner.dispose();
});

test('preserves native callback this, event objects and handleEvent listeners', () => {
    const {target, owner} = fixture(), event = new Event('update');
    const callback = jest.fn(function(received) {expect(this).toBe(target);expect(received).toBe(event);});
    const object = {handleEvent: jest.fn(function(received) {expect(this).toBe(object);expect(received).toBe(event);})};
    target.addGlobalEventListener('update', callback);target.addGlobalEventListener('update', object);
    target.dispatchEvent(event);
    expect(callback).toHaveBeenCalledTimes(1);expect(object.handleEvent).toHaveBeenCalledTimes(1);
    owner.dispose();
});

test('restores previous helpers and does not overwrite later explicit replacements', () => {
    const target = new EventTarget(), previousAdd = jest.fn(), previousRemove = jest.fn();
    target.addGlobalEventListener = previousAdd;target.removeGlobalEventListener = previousRemove;
    const owner = installPluginGlobalEvents(target);owner.dispose();
    expect(target.addGlobalEventListener).toBe(previousAdd);expect(target.removeGlobalEventListener).toBe(previousRemove);
    const next = installPluginGlobalEvents(target), replacement = jest.fn();
    target.addGlobalEventListener = replacement;next.dispose();
    expect(target.addGlobalEventListener).toBe(replacement);
});

test('helper removal still supports native registrations and null callbacks are ignored', () => {
    const {target, owner} = fixture(), callback = jest.fn();
    target.addEventListener('update', callback);
    target.removeGlobalEventListener('update', callback);
    target.addGlobalEventListener('update', null);
    target.dispatchEvent(new Event('update'));
    expect(callback).not.toHaveBeenCalled();
    owner.dispose();
});
