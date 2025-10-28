// Polyfills for Node.js compatibility in Electron renderer process

// Ensure globalThis is available first
if (typeof globalThis === 'undefined') {
    if (typeof window !== 'undefined') {
        window.globalThis = window;
    } else if (typeof self !== 'undefined') {
        self.globalThis = self;
    }
}

// Global object polyfill
if (typeof global === 'undefined') {
    globalThis.global = globalThis;
    if (typeof window !== 'undefined') {
        window.global = globalThis;
    }
}
