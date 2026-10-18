/** @jest-environment node */
// Adapted from the SDK reference tests; exercises the bundled host adapter.
var import_node_events = require("node:events");
var import_node_stream = require("node:stream");
const { createX11Forwarding } = require("../../src/utils/hostServices/x11Forwarding.cjs");
class Wire extends import_node_stream.Duplex {
  writes = [];
  _read() {
  }
  _write(b, _enc, cb) {
    this.writes.push(Buffer.from(b));
    cb();
  }
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
function packet(cookie, little = true) {
  const p = Buffer.alloc(48);
  p[0] = little ? 108 : 66;
  const word = (v, at) => little ? p.writeUInt16LE(v, at) : p.writeUInt16BE(v, at);
  word(11, 2);
  word(18, 6);
  word(16, 8);
  Buffer.from("MIT-MAGIC-COOKIE-1").copy(p, 12);
  Buffer.from(cookie, "hex").copy(p, 32);
  return p;
}
function setup(extra = {}) {
  const client = new import_node_events.EventEmitter(), socket = new Wire(), cookie = Buffer.alloc(16, 33);
  const local = { cookie, screen: 0, securityAuthorization: "untrusted", connect: jest.fn().mockResolvedValue(socket), dispose: jest.fn() };
  const authorize = jest.fn();
  const gate = createX11Forwarding({ client, local, mode: "trusted", authorize, ...extra });
  const channel = new Wire(), reject = jest.fn();
  const open = () => client.emit("x11", { srcIP: "untrusted" }, () => channel, reject);
  return { gate, client, socket, channel, local, authorize, reject, open };
}
test.each([true, false])("fragmented X11 setup authenticates spoof cookie and substitutes host authorization (little=%s)", async (little) => {
  const f = setup();
  f.open();
  const p = packet(f.gate.request.cookie, little);
  expect(f.gate.request.cookie).not.toBe(f.local.cookie.toString("hex"));
  for (let i = 0; i < p.length; i++) f.channel.push(p.subarray(i, i + 1));
  await wait();
  expect(f.local.connect).toHaveBeenCalledTimes(1);
  const received = Buffer.concat(f.socket.writes);
  expect(received.subarray(32, 48)).toEqual(f.local.cookie);
  f.channel.push(Buffer.from("client-data"));
  f.socket.push(Buffer.from("server-data"));
  await wait();
  expect(Buffer.concat(f.socket.writes).subarray(48).toString()).toBe("client-data");
  expect(Buffer.concat(f.channel.writes).toString()).toBe("server-data");
  f.gate.close();
  expect(f.socket.destroyed).toBe(true);
  expect(f.channel.destroyed).toBe(true);
  expect(f.local.dispose).toHaveBeenCalledTimes(1);
  f.gate.dispose();
});
test.each(["cookie", "protocol", "byteorder", "length", "version"])("rejects invalid %s before opening any local socket", async (kind) => {
  const f = setup();
  f.open();
  const p = packet(f.gate.request.cookie);
  if (kind === "cookie") p[32] ^= 1;
  if (kind === "protocol") p[12] = 0;
  if (kind === "byteorder") p[0] = 0;
  if (kind === "length") p.writeUInt16LE(65535, 8);
  if (kind === "version") p[2] = 12;
  f.channel.push(p);
  await wait();
  expect(f.local.connect).not.toHaveBeenCalled();
  expect(f.channel.destroyed).toBe(true);
  f.gate.dispose();
});
test("authorization, channel cap, revocation and teardown reject channels", async () => {
  const f = setup({ maxChannels: 1 });
  f.open();
  f.client.emit("x11", {}, jest.fn(), f.reject);
  expect(f.reject).toHaveBeenCalledTimes(1);
  f.authorize.mockImplementation(() => {
    throw new Error("private");
  });
  f.channel.push(packet(f.gate.request.cookie));
  await wait();
  expect(f.local.connect).not.toHaveBeenCalled();
  expect(f.channel.destroyed).toBe(true);
  f.gate.close();
  f.open();
  expect(f.reject).toHaveBeenCalledTimes(2);
  f.gate.dispose();
  expect(f.client.listenerCount("x11")).toBe(0);
});
test("setup timeout closes a fragmented header; close disposes a late local connection", async () => {
  const f = setup({ setupTimeoutMs: 10 });
  f.open();
  f.channel.push(Buffer.from([108]));
  await new Promise((r) => setTimeout(r, 20));
  expect(f.channel.destroyed).toBe(true);
  f.gate.dispose();
  let resolve;
  const g = setup();
  g.local.connect.mockImplementation(() => new Promise((r) => {
    resolve = r;
  }));
  g.open();
  g.channel.push(packet(g.gate.request.cookie));
  await wait();
  g.gate.close();
  resolve(g.socket);
  await wait();
  expect(g.socket.destroyed).toBe(true);
  g.gate.dispose();
});
test("untrusted requires actual X SECURITY authorization and missing prerequisites fail closed", () => {
  const client = new import_node_events.EventEmitter(), authorize = jest.fn();
  expect(() => createX11Forwarding({ client, authorize, mode: "trusted" })).toThrow("X11_UNAVAILABLE");
  expect(() => createX11Forwarding({ client, authorize, mode: "trusted", local: { connect: jest.fn() } })).toThrow("X11_AUTH_UNAVAILABLE");
  expect(() => createX11Forwarding({ client, authorize, mode: "untrusted", local: { connect: jest.fn(), cookie: Buffer.alloc(16), screen: 0 } })).toThrow("X11_UNSUPPORTED");
  const f = setup({ mode: "untrusted" });
  f.gate.dispose();
});
test("local display connection failure is contained and closes the X11 channel", async () => {
  const f = setup();
  f.local.connect.mockRejectedValue({ message: "COOKIE" });
  f.open();
  f.channel.push(packet(f.gate.request.cookie));
  await wait();
  expect(f.channel.destroyed).toBe(true);
  f.gate.dispose();
});
