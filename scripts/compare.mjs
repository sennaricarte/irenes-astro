import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '_extract', 'compare');
const previewUrl = 'http://127.0.0.1:4321/';

const pages = [
	{ name: 'home', original: 'https://irenes.com.br/', local: previewUrl },
	{ name: 'categoria', original: 'https://irenes.com.br/?categoria=beleza', local: `${previewUrl}categoria/beleza/` },
	{
		name: 'o-guia-essencial-da-rotina-de-skincare',
		original: 'https://irenes.com.br/o-guia-essencial-da-rotina-de-skincare',
		local: `${previewUrl}o-guia-essencial-da-rotina-de-skincare/`,
	},
];

async function previewIsUp() {
	try {
		const response = await fetch(previewUrl);
		return response.ok;
	} catch {
		return false;
	}
}

async function waitForPreview() {
	for (let i = 0; i < 40; i += 1) {
		if (await previewIsUp()) return;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('preview não respondeu em http://127.0.0.1:4321/');
}

let child = null;
if (!(await previewIsUp())) {
	child = spawn('pnpm', ['exec', 'astro', 'preview', '--host', '127.0.0.1', '--port', '4321'], {
		cwd: root,
		shell: true,
		stdio: 'ignore',
	});
	await waitForPreview();
}

const browser = await chromium.launch({ headless: true });
await mkdir(outDir, { recursive: true });

try {
	for (const pageInfo of pages) {
		for (const width of [390, 1440]) {
			const context = await browser.newContext({ viewport: { width, height: 900 } });
			const page = await context.newPage();
			const shots = [];
			for (const url of [pageInfo.original, pageInfo.local]) {
				await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
				await page.waitForTimeout(1200);
				shots.push(await page.screenshot({ fullPage: true }));
			}
			await context.close();

			const images = await Promise.all(shots.map(async (buffer) => ({ buffer, meta: await sharp(buffer).metadata() })));
			const gap = 16;
			const labelHeight = 36;
			const height = Math.max(...images.map((image) => image.meta.height ?? 0));
			const widthSum = images.reduce((sum, image) => sum + (image.meta.width ?? 0), 0) + gap;
			const label = Buffer.from(
				`<svg width="${widthSum}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#262626"/><text x="16" y="24" fill="#ffffff" font-size="16" font-family="sans-serif">original</text><text x="${(images[0].meta.width ?? 0) + gap + 16}" y="24" fill="#ffffff" font-size="16" font-family="sans-serif">local</text></svg>`,
			);
			const file = path.join(outDir, `${pageInfo.name}-${width}.png`);
			await sharp({
				create: {
					width: widthSum,
					height: height + labelHeight,
					channels: 3,
					background: '#fafafa',
				},
			})
				.composite([
					{ input: label, left: 0, top: 0 },
					{ input: images[0].buffer, left: 0, top: labelHeight },
					{ input: images[1].buffer, left: (images[0].meta.width ?? 0) + gap, top: labelHeight },
				])
				.png()
				.toFile(file);
			console.log(file);
		}
	}
} finally {
	await browser.close();
	if (child) child.kill();
}
