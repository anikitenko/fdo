import { useRef } from "react";

function getBabelWorkerUrl() {
    const currentUrl = window.location.href;

    if (currentUrl.startsWith("http://localhost")) {
        // Development mode (React dev server)
        return "/assets/js/babelWorker.js";
    }

    if (currentUrl.startsWith("plugin://")) {
        // Plugin page loaded via plugin:// protocol
        return "static://assets/js/babelWorker.js";
    }

    // Production mode (file:// protocol for main window)
    return currentUrl.replace(
        /renderer\/index\.html$/,
        "renderer/assets/js/babelWorker.js"
    );
}

export function useBabelWorker() {
    const workerRef = useRef(null);

    function transform(code, options = { presets: ["react"] }) {
        return new Promise((resolve, reject) => {
            if (!workerRef.current) {
                workerRef.current = new Worker(getBabelWorkerUrl());
            }

            const worker = workerRef.current;

            const handleMessage = (e) => {
                if (e.data.success) {
                    resolve(e.data.code);
                } else {
                    reject(new Error(e.data.error));
                }
                worker.removeEventListener("message", handleMessage);
            };

            worker.addEventListener("message", handleMessage);
            worker.postMessage({ code, options });
        });
    }

    return { transform };
}
