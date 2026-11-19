'use strict';
// Generates FDO's original file-tree icons (src/assets/icons/files). The shapes
// and palette are defined here and are not derived from any third-party icon set.
const fs = require('node:fs');
const path = require('node:path');

const out = path.join(__dirname, '..', 'src', 'assets', 'icons', 'files');
const svg = (title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><title>${title}</title>${body}</svg>\n`;

const FILES = {
    default: ['File', '#64748b', ''],
    js: ['JavaScript file', '#a16207', 'JS'],
    jsx: ['JSX file', '#0e7490', 'JSX'],
    ts: ['TypeScript file', '#1d4ed8', 'TS'],
    tsx: ['TSX file', '#0369a1', 'TSX'],
    json: ['JSON file', '#4d7c0f', '{ }'],
    md: ['Markdown file', '#475569', 'MD'],
    css: ['CSS file', '#6d28d9', 'CSS'],
    scss: ['SCSS file', '#be185d', 'SCSS'],
    html: ['HTML file', '#c2410c', 'HTML'],
    yaml: ['YAML file', '#b91c1c', 'YML'],
    xml: ['XML file', '#0f766e', 'XML'],
    svg: ['SVG image', '#7c3aed', 'SVG'],
    image: ['Image', '#0d9488', 'IMG'],
    text: ['Text file', '#52525b', 'TXT'],
    shell: ['Shell script', '#15803d', 'SH'],
    env: ['Environment file', '#a16207', 'ENV'],
    git: ['Git configuration', '#b45309', 'GIT'],
    config: ['Configuration file', '#475569', 'CFG'],
    lock: ['Lock file', '#9f1239', 'LOCK'],
    license: ['License', '#166534', 'LIC'],
    docker: ['Container file', '#0369a1', 'DKR'],
    sql: ['SQL file', '#9a3412', 'SQL'],
    python: ['Python file', '#1e40af', 'PY'],
    font: ['Font file', '#6b21a8', 'FNT'],
    archive: ['Archive', '#78350f', 'ZIP'],
    wasm: ['WebAssembly file', '#5b21b6', 'WASM'],
};

const page = (color, label) => {
    const size = label.length >= 4 ? 7 : label.length === 3 ? 8 : 9.5;
    const band = label
        ? `<rect x="3" y="16" width="26" height="11" rx="2" fill="${color}"/><text x="16" y="24.2" font-family="Arial,Helvetica,sans-serif" font-size="${size}" font-weight="700" text-anchor="middle" fill="#fff">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
        : `<path d="M10 17h12M10 21h12M10 25h8" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
    return `<path d="M7 2h13l7 7v21H7z" fill="#e2e8f0"/><path d="M20 2v7h7z" fill="#94a3b8"/>${band}`;
};

const FOLDERS = {
    default: ['Folder', '#64748b'],
    src: ['Source folder', '#2563eb'],
    dist: ['Build output folder', '#ea580c'],
    node: ['Dependencies folder', '#16a34a'],
    test: ['Tests folder', '#9333ea'],
    docs: ['Documentation folder', '#0891b2'],
    git: ['Git folder', '#dc2626'],
    assets: ['Assets folder', '#db2777'],
};

const closed = color => `<path d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="${color}"/><path d="M3 12h26v2H3z" fill="#fff" fill-opacity=".25"/>`;
const open = color => `<path d="M3 8a2 2 0 0 1 2-2h7l3 3h10a2 2 0 0 1 2 2v2H3z" fill="${color}" fill-opacity=".7"/><path d="M1.5 15a1.5 1.5 0 0 1 1.5-1.5h26a1.5 1.5 0 0 1 1.45 1.9l-2.4 9.2A2 2 0 0 1 26.1 26.1H5a2 2 0 0 1-1.95-1.55z" fill="${color}"/>`;

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});
for (const [id, [title, color, label]] of Object.entries(FILES)) fs.writeFileSync(path.join(out, `file_${id}.svg`), svg(title, page(color, label)));
fs.writeFileSync(path.join(out, 'file_package.svg'), svg('Package manifest',
    '<path d="m4 9 12-6 12 6v14l-12 6-12-6Z" fill="#64748b"/><path d="m4 9 12 6 12-6M16 15v14M10 6l12 6" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>'));
for (const [id, [title, color]] of Object.entries(FOLDERS)) {
    fs.writeFileSync(path.join(out, `folder_${id}.svg`), svg(title, closed(color)));
    fs.writeFileSync(path.join(out, `folder_${id}_opened.svg`), svg(`${title} (open)`, open(color)));
}
console.log(`Generated ${fs.readdirSync(out).length} icons in ${path.relative(process.cwd(), out)}`);
