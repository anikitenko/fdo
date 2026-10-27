// Decode uploaded bytes and export only pixels. Never use an uploaded file's
// object URL directly as a preview, even when its declared MIME type is allowed.
export async function rasterImagePreview(file) {
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Image preview canvas is unavailable');
        context.drawImage(bitmap, 0, 0);
        const preview = canvas.toDataURL('image/png');
        if (!preview.startsWith('data:image/png;base64,')) throw new Error('Image preview encoding failed');
        return preview;
    } finally {
        bitmap.close();
    }
}
