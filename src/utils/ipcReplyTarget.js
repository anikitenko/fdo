function replyFrame(event) {
    if (event.sender.isDestroyed()) return null;
    const frame = event.senderFrame;
    return frame && !frame.isDestroyed() && !frame.detached ? frame : null;
}

// Reply to the original frame, never a replacement page in the same window.
export function sendToIpcSender(event, channel, payload) {
    const frame = replyFrame(event);
    if (!frame) return false;
    try {
        frame.send(channel, payload);
        return true;
    } catch (error) {
        // A frame can disappear between the liveness check and the send.
        // Serialization/programming errors on a live frame must still surface.
        if (!replyFrame(event)) return false;
        throw error;
    }
}

export function observeIpcSender(event, onUnavailable) {
    const sender = event.sender;
    let unavailable = false;
    const stop = () => {
        if (unavailable) return;
        unavailable = true;
        onUnavailable();
    };
    const onNavigation = (details, _url, isInPlace, isMainFrame) => {
        if ((details.isMainFrame ?? isMainFrame) && !(details.isSameDocument ?? isInPlace)) stop();
    };
    sender.on("destroyed", stop);
    sender.on("render-process-gone", stop);
    sender.on("did-start-navigation", onNavigation);
    if (!replyFrame(event)) stop();
    return () => {
        sender.removeListener("destroyed", stop);
        sender.removeListener("render-process-gone", stop);
        sender.removeListener("did-start-navigation", onNavigation);
    };
}
