const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.beforeEach(async ({page}) => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/components/editor/utils/rasterImagePreview.js'), 'utf8');
    await page.addScriptTag({type: 'module', content: `${source}\nwindow.rasterImagePreview = rasterImagePreview;`});
    await page.waitForFunction(() => typeof window.rasterImagePreview === 'function');
});

test('image previews preserve pixels and discard uploaded markup and metadata', async ({page}) => {
    const result = await page.evaluate(async () => {
        window.previewInjected = false;
        const source = document.createElement('canvas');
        source.width = 2;
        source.height = 3;
        source.getContext('2d').fillStyle = '#336699';
        source.getContext('2d').fillRect(0, 0, 1, 1);
        const original = source.toDataURL('image/png');
        const bytes = await (await fetch(original)).arrayBuffer();
        // File type and name are supplied by the uploader. Neither may become
        // preview markup, and even trailing content must not survive encoding.
        const file = new File([bytes, '<script>window.previewInjected = true</script>'], '<script>alert(1)</script>.png', {type: 'image/png'});
        const preview = await window.rasterImagePreview(file);
        const decoded = await createImageBitmap(await (await fetch(preview)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = decoded.width;
        canvas.height = decoded.height;
        canvas.getContext('2d').drawImage(decoded, 0, 0);
        const pixels = [...canvas.getContext('2d').getImageData(0, 0, 2, 3).data];
        decoded.close();
        return {preview, original, width: canvas.width, height: canvas.height, pixels, injected: !!window.previewInjected};
    });
    expect(result.preview).toBe(result.original);
    expect(result).toMatchObject({width: 2, height: 3, injected: false});
    expect(result.pixels.slice(0, 4)).toEqual([51, 102, 153, 255]);
    expect(result.pixels.slice(-4)).toEqual([0, 0, 0, 0]);
});

test('HTML disguised as a raster upload fails decoding', async ({page}) => {
    const result = await page.evaluate(async () => {
        try {
            await window.rasterImagePreview(new File(['<script>alert(1)</script>'], 'screenshot.png', {type: 'image/png'}));
            return 'accepted';
        } catch {
            return 'rejected';
        }
    });
    expect(result).toBe('rejected');
});
