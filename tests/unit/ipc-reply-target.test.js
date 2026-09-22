import {EventEmitter} from "node:events";
import {observeIpcSender, sendToIpcSender} from "../../src/utils/ipcReplyTarget";

function fixture() {
    const sender = new EventEmitter();
    sender.isDestroyed = jest.fn(() => false);
    sender.send = jest.fn();
    const frame = {isDestroyed: jest.fn(() => false), detached: false, send: jest.fn()};
    return {event: {sender, senderFrame: frame}, sender, frame};
}

test("sends to the requesting frame rather than the current window's main frame", () => {
    const {event, sender, frame} = fixture();
    const payload = {requestId: "test", content: "chunk"};
    expect(sendToIpcSender(event, "stream", payload)).toBe(true);
    expect(frame.send).toHaveBeenCalledWith("stream", payload);
    expect(sender.send).not.toHaveBeenCalled();
});
test.each(["window", "frame", "detached", "missing"])("does not send to an unavailable %s", state => {
    const {event, sender, frame} = fixture();
    if (state === "window") sender.isDestroyed.mockReturnValue(true);
    if (state === "frame") frame.isDestroyed.mockReturnValue(true);
    if (state === "detached") frame.detached = true;
    if (state === "missing") event.senderFrame = null;
    expect(sendToIpcSender(event, "stream", {})).toBe(false);
    expect(frame.send).not.toHaveBeenCalled();
});
test("handles frame destruction during send, but surfaces unrelated errors", () => {
    const {event, frame} = fixture();
    frame.send.mockImplementationOnce(() => {
        frame.isDestroyed.mockReturnValue(true);
        throw new Error("Object has been destroyed");
    });
    expect(sendToIpcSender(event, "stream", {})).toBe(false);
    frame.isDestroyed.mockReturnValue(false);
    frame.send.mockImplementationOnce(() => { throw new Error("Cannot serialize"); });
    expect(() => sendToIpcSender(event, "stream", {})).toThrow("Cannot serialize");
});
test.each(["destroyed", "render-process-gone"])("cancels once on %s and detaches listeners after completion", name => {
    const {event, sender} = fixture();
    const cancel = jest.fn();
    const dispose = observeIpcSender(event, cancel);
    sender.emit(name);
    sender.emit("destroyed");
    expect(cancel).toHaveBeenCalledTimes(1);
    dispose();
    expect(sender.eventNames()).toEqual([]);
});
test("ignores same-document and child-frame navigation; cancels document replacement", () => {
    const {event, sender} = fixture();
    const cancel = jest.fn();
    const dispose = observeIpcSender(event, cancel);
    sender.emit("did-start-navigation", {isSameDocument: true, isMainFrame: true});
    sender.emit("did-start-navigation", {isSameDocument: false, isMainFrame: false});
    expect(cancel).not.toHaveBeenCalled();
    sender.emit("did-start-navigation", {isSameDocument: false, isMainFrame: true});
    expect(cancel).toHaveBeenCalledTimes(1);
    dispose();
});
test("a completed request is not cancelled by a later window close", () => {
    const {event, sender} = fixture();
    const cancel = jest.fn();
    observeIpcSender(event, cancel)();
    sender.emit("destroyed");
    expect(cancel).not.toHaveBeenCalled();
});
