// Regenerate the bundled PNG representations from the shared UI vector.
// Run: node scripts/generate-ai-tray-icons.cjs
const {chromium} = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
    const root = path.resolve(__dirname, '..');
    const source = await fs.readFile(path.join(root, 'src/utils/ai/assistant/fdoAiIdentity.js'), 'utf8');
    const svg = source.match(/export const FDO_AI_MARK_SVG = '([^']+)'/)[1];
    const browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {});
    try {
        const page = await browser.newPage();
        const icons = await page.evaluate(async svg => {
            const result = {};
            for (const [name, color] of [['template', '#000000'], ['color', '#388bff']]) {
                result[name] = [];
                for (const scaleFactor of [1, 2, 3]) {
                    const size = 16 * scaleFactor;
                    const img = new Image();
                    img.src = 'data:image/svg+xml,' + encodeURIComponent(svg.replace('<svg ', `<svg width="${size}" height="${size}" fill="${color}" `));
                    await img.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = size;
                    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
                    result[name].push({scaleFactor, dataURL: canvas.toDataURL('image/png')});
                }
            }
            return result;
        }, svg);
        await fs.writeFile(path.join(root, 'src/utils/ai/assistant/fdoAiTrayIcons.json'), JSON.stringify(icons, null, 2) + '\n');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
