import { useRef } from "react";

function getBabelWorkerUrl() {
    const currentUrl = window.location.href;

    if (currentUrl.startsWith("http://localhost")) {
        // Development mode (React dev server)
        return "/assets/js/babelWorker.js";
    }

    // Prefer static protocol for packaged/runtime builds.
    // This is stable across file://, app:// and custom protocols.
    return "static://host/assets/js/babelWorker.js";
}

export function useBabelWorker() {
    const workerRef = useRef(null);

    function transform(code, options = { presets: ["react"] }) {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                workerRef.current = new Worker(getBabelWorkerUrl());
            }

            const worker = workerRef.current;
            const timeoutMs = 6000;
            let settled = false;
            let timeoutId = null;

            const cleanup = () => {
                worker.removeEventListener("message", handleMessage);
                worker.removeEventListener("error", handleError);
                worker.removeEventListener("messageerror", handleMessageError);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            const handleMessage = (e) => {
                if (settled) return;
                settled = true;
                if (e.data.success) {
                    resolve(e.data.code);
                } else {
                    reject(new Error(e.data.error));
                }
                cleanup();
            };

            const handleError = (event) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error(event?.message || "Babel worker failed to load."));
            };

            const handleMessageError = () => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("Babel worker message deserialization failed."));
            };

            worker.addEventListener("message", handleMessage);
            worker.addEventListener("error", handleError);
            worker.addEventListener("messageerror", handleMessageError);
            timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new Error("Babel worker transform timed out."));
            }, timeoutMs);
            worker.postMessage({ code, options });
        });
    }

    return { transform };
}
