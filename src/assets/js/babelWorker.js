importScripts("static://assets/node_modules/@babel/standalone/babel.js");

self.onmessage = function (e) {
    const { code, options } = e.data;
    try {
        const transformed = Babel.transform(code, options).code;
        self.postMessage({ success: true, code: transformed });
    } catch (err) {
        self.postMessage({ success: false, error: err.message });
    }
};
