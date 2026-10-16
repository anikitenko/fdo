import {Jimp} from "jimp";

/**
 * Compress an image (local file, URL, or Buffer) using Jimp v1+.
 *  - Resizes to maxWidth (preserving aspect ratio)
 *  - Encodes to JPEG (or PNG if transparency)
 *  - Returns { base64, contentType }
 */
export async function compressImage(source, {
    maxWidth = 800,
    jpegQuality = 60,
    pngCompressionLevel = 9,
    forceJpeg = false,
} = {}) {
    try {
        const img = await Jimp.read(source);        // works with file path or URL
        const { width } = img.bitmap;
        // Resize while keeping aspect ratio
        if (width > maxWidth) {
            await img.resize({ w: maxWidth });
        }

        // Detect transparency (alpha channel)
        const hasAlpha = typeof img.hasAlpha === "function" ? img.hasAlpha() : false;

        const isLineArt = img.bitmap.width * img.bitmap.height < 2_000_000 && hasAlpha === false;
        if (isLineArt) {
            const buffer = await img.getBuffer("image/png", {deflateLevel: 5});
            return { base64: buffer.toString("base64"), contentType: "image/png" };
        }

        if (!forceJpeg && hasAlpha) {
            const buffer = await img.getBuffer("image/png", {deflateLevel: pngCompressionLevel});
            return { base64: buffer.toString("base64"), contentType: "image/png" };
        }

        const buffer = await img.getBuffer("image/jpeg", {quality: jpegQuality});
        return { base64: buffer.toString("base64"), contentType: "image/jpeg" };

    } catch (err) {
        throw new Error(`[compressImage] Failed to compress: ${err.message}`);
    }
}

