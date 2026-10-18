// Host-owned binary Git SSH adapter. argv contains only an expiring operation
// handle and Git destination, never credentials. stdin/stdout carry raw bytes.
const {connect} = require('node:net');
const [port, token] = process.argv.slice(2, 4);
const socket = connect({host: '127.0.0.1', port: Number(port), allowHalfOpen: true});
let pending = Buffer.alloc(0), completed = false;
function fail() {completed = false; process.exitCode = 1; socket.destroy(); process.stdin.destroy();}
socket.on('connect', () => {
    socket.write(JSON.stringify({token, args: process.argv.slice(4)}) + '\n');
    process.stdin.pipe(socket);
});
function drain() {
    while (pending.length >= 5) {
        const length = pending.readUInt32BE(1);
        if (length > 1048576) return fail();
        if (pending.length < length + 5) break;
        const type = pending[0], body = pending.subarray(5, 5 + length); pending = pending.subarray(5 + length);
        if (type === 3) {
            if (body.length !== 1) return fail();
            completed = true; process.exitCode = body[0]; process.stdin.unpipe(socket); process.stdin.destroy();
            continue;
        }
        if (type !== 1 && type !== 2) return fail();
        const stream = type === 1 ? process.stdout : process.stderr;
        if (!stream.write(body)) {stream.once('drain', drain); return;}
    }
    socket.resume();
}
socket.on('data', data => {socket.pause(); pending = Buffer.concat([pending, data]); drain();});
socket.on('error', fail);
socket.on('end', () => {if (!completed || pending.length) fail(); else socket.destroy();});
