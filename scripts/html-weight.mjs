import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

async function htmlFiles(dir) {
	const found = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
		else if (entry.name.endsWith('.html')) found.push(full);
	}
	return found;
}

function bytes(pattern, html) {
	let total = 0;
	for (const match of html.matchAll(pattern)) total += Buffer.byteLength(match[1] ?? match[0]);
	return total;
}

const files = await htmlFiles(dist);
const sized = await Promise.all(
	files.map(async (file) => ({ file, size: (await stat(file)).size })),
);
sized.sort((a, b) => b.size - a.size);

for (const item of sized.slice(0, 5)) {
	const html = await readFile(item.file, 'utf8');
	const css = bytes(/<style[^>]*>([\s\S]*?)<\/style>/gi, html);
	const svg = bytes(/<svg[\s\S]*?<\/svg>/gi, html);
	const jsonld = bytes(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi, html);
	const brotli = brotliCompressSync(Buffer.from(html)).length;
	const rel = path.relative(root, item.file);
	console.log(`${rel}`);
	console.log(`  total ${item.size}`);
	console.log(`  css ${css}`);
	console.log(`  svg ${svg}`);
	console.log(`  jsonld ${jsonld}`);
	console.log(`  brotli ${brotli}`);
}
