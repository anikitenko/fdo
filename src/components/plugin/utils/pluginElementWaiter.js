// Self-contained: serialized into the trusted iframe module, owned by one view.
export function createPluginElementWaiter(doc = document, target = window) {
    const pending = new Map();
    let observer = null, queued = false, disposed = false;
    const report = error => {
        if (typeof target.reportError === 'function') target.reportError(error);
        else target.console.error(error);
    };
    const stopWhenIdle = () => {
        if (!pending.size) {observer?.disconnect(); observer = null;}
    };
    const deliver = (selector, group, element) => {
        if (pending.get(selector) !== group) return;
        pending.delete(selector);
        stopWhenIdle();
        const ready = [...group].filter(waiter => !waiter.done);
        ready.forEach(waiter => waiter.cancel());
        for (const waiter of ready) {
            if (disposed) break;
            try {waiter.callback(element);} catch (error) {report(error);}
        }
    };
    const check = () => {
        queued = false;
        if (disposed) return;
        for (const [selector, group] of [...pending]) {
            let element;
            try {element = doc.querySelector(selector);}
            catch (error) {
                for (const waiter of [...group]) waiter.cancel();
                report(error);continue;
            }
            if (element?.parentNode) deliver(selector, group, element);
        }
    };
    const scheduleCheck = () => {
        if (disposed || queued || !pending.size) return;
        queued = true;
        target.queueMicrotask(check);
    };
    return {
        wait(selector, callback, timeout = 5000) {
            if (disposed) return () => {};
            if (typeof callback !== 'function') throw new TypeError('waitForElement requires a callback.');
            const group = pending.get(selector) || new Set();
            const waiter = {callback, done: false, timer: null, cancel: null};
            waiter.cancel = () => {
                if (waiter.done) return;
                waiter.done = true;
                target.clearTimeout(waiter.timer);
                group.delete(waiter);
                if (!group.size && pending.get(selector) === group) pending.delete(selector);
                stopWhenIdle();
            };
            group.add(waiter);pending.set(selector, group);
            waiter.timer = target.setTimeout(() => {
                let element;
                try {element = doc.querySelector(selector);}
                catch (error) {waiter.cancel();report(error);return;}
                if (element?.parentNode) deliver(selector, group, element);
                else {waiter.cancel();target.console.error('Timeout: Element not found:', selector);}
            }, Math.max(0, Number(timeout) || 0));
            if (!observer) {
                observer = new target.MutationObserver(scheduleCheck);
                observer.observe(doc, {childList: true, subtree: true, attributes: true});
            }
            scheduleCheck();
            return waiter.cancel;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const group of [...pending.values()]) for (const waiter of [...group]) waiter.cancel();
            pending.clear();stopWhenIdle();
        },
    };
}
