import { fileTypeFromFile } from "file-type";
import mime from "mime-types";

export async function detectAttachmentType(filePath) {
    // Detect by reading magic bytes
    const detected = await fileTypeFromFile(filePath);
    let mimeType = detected?.mime || mime.lookup(filePath) || "application/octet-stream";

    // Map MIME types → LLM attachment type
    const mimeMap = {
        "image/gif": "fromGIF",
        "image/jpeg": "fromJPEG",
        "image/jpg": "fromJPEG",       // alias
        "image/pjpeg": "fromJPEG",     // progressive JPEG
        "application/pdf": "fromPDF",
        "image/png": "fromPNG",
        "image/x-png": "fromPNG",      // alias
        "image/svg+xml": "fromSVG",
        "image/tiff": "fromTIFF",
        "image/x-tiff": "fromTIFF",    // alias
        "image/webp": "fromWEBP",
    };

    // Determine category
    const category = mimeMap[mimeType] || "unknown";

    // High-level classification (useful for UI or LLM.js)
    const type =
        category.startsWith("from") && category !== "fromPDF" ? "image" :
            category === "fromPDF" ? "document" :
                "unknown";

    return { path: filePath, mimeType, category, type };
}

export async function getRemoteFileCategory(url) {
    try {
        // 1️⃣ Try HEAD request to get content-type
        const res = await fetch(url, { method: "HEAD" });
        let contentType = res.headers.get("content-type");

        if (!contentType || contentType === "application/octet-stream") {
            const pathname = new URL(url).pathname;
            contentType = mime.lookup(pathname) || "";
        }

        contentType = contentType.split(";")[0].trim();

        if (contentType.startsWith("image/")) {
            return { category: "image", mimeType: contentType };
        }

        if (
            contentType.startsWith("application/pdf") ||
            contentType.startsWith("text/") ||
            contentType.includes("document")
        ) {
            // For text-based docs, optionally fetch the text
            let textContent;
            if (contentType.startsWith("text/")) {
                try {
                    const textRes = await fetch(url);
                    textContent = await textRes.text();
                } catch (fetchErr) {
                    throw new Error(`[getRemoteFileCategory] Failed to read text from ${url}: ${fetchErr.message}`);
                }
            }

            return { category: "document", mimeType: contentType, textContent };
        }

        // 4️⃣ Default fallback
        return { category: "unknown", mimeType: contentType || "unknown" };
    } catch (err) {
        throw new Error(`Failed to detect remote file type: ${err.message}`);
    }
}
