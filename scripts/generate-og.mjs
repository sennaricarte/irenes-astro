import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { decompress } = require('wawoff2');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const woff2Path = path.join(
	root,
	'node_modules/@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2',
);
const ttfPath = path.join(tmpdir(), 'irenes-playfair-display-700.ttf');
const outPath = path.join(root, 'public/og-default.jpg');

const woff2 = await readFile(woff2Path);
const ttf = Buffer.from(await decompress(woff2));
await writeFile(ttfPath, ttf);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#fafafa"/>
  <rect width="1200" height="12" fill="#a24e7d"/>
  <text x="80" y="280" fill="#262626" font-family="Playfair Display" font-size="92" font-weight="700">Irenes</text>
  <text x="80" y="360" fill="#a24e7d" font-family="Playfair Display" font-size="28" font-weight="700">Cultive a Paz. Realce a Beleza. Transforme o Seu Lar.</text>
</svg>`;

const resvg = new Resvg(svg, {
	fitTo: { mode: 'width', value: 1200 },
	font: {
		fontFiles: [ttfPath],
		loadSystemFonts: false,
		defaultFontFamily: 'Playfair Display',
	},
});
const png = resvg.render().asPng();
await mkdir(path.dirname(outPath), { recursive: true });
await sharp(png).jpeg({ quality: 82 }).toFile(outPath);
console.log(`og ${outPath}`);
