/** @jest-environment node */
import {afterEach, expect, test} from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Jimp} from 'jimp';
import {compressImage} from '../../src/ipc/ai/utils/compressImage';

const directories = [];
afterEach(() => {directories.splice(0).forEach(directory => fs.rmSync(directory, {recursive: true, force: true}));});

test.each([
    {name: 'opaque resized image', width: 1100, height: 20, color: 0x336699ff, expectedType: 'image/png', expectedWidth: 1024},
    {name: 'transparent image', width: 20, height: 20, color: 0x33669980, expectedType: 'image/png', expectedWidth: 20},
    {name: 'large opaque image', width: 1024, height: 2000, color: 0x336699ff, expectedType: 'image/jpeg', expectedWidth: 1024},
])('encodes $name using the installed Jimp API', async ({width, height, color, expectedType, expectedWidth}) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-chat-image-'));
    directories.push(directory);
    const filename = path.join(directory, 'input.png');
    const pixel = Buffer.from([color >>> 24, (color >>> 16) & 255, (color >>> 8) & 255, color & 255]);
    const image = new Jimp({width, height, data: Buffer.alloc(width * height * 4, pixel)});
    fs.writeFileSync(filename, await image.getBuffer('image/png'));
    const result = await compressImage(filename, {maxWidth: 1024, jpegQuality: 80});
    expect(result.contentType).toBe(expectedType);
    const decoded = await Jimp.read(Buffer.from(result.base64, 'base64'));
    expect(decoded.bitmap.width).toBe(expectedWidth);
    expect(decoded.bitmap.height).toBe(Math.round(height * expectedWidth / width));
    expect(decoded.hasAlpha()).toBe(color === 0x33669980);
}, 30000);

test('reports image decode failures instead of leaving an unresolved attachment', async () => {
    await expect(compressImage(Buffer.from('Invalid image'))).rejects.toThrow('[compressImage] Failed to compress:');
});
