/**
 * Falha o build se pubDate, updatedDate ou lastmod estiver no futuro
 * em relação ao relógio do build. Tolerância de 5 minutos.
 * Datas recentes, inclusive no minuto do build, são válidas.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtAt = Date.now();
const tolerance = 5 * 60 * 1000;

function isFuture(value) {
	const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
	return !Number.isNaN(time) && time > builtAt + tolerance;
}

function slugFromLoc(loc) {
	const pathname = new URL(loc).pathname.replace(/\/$/, '');
	return pathname.split('/').filter(Boolean).at(-1) || loc;
}

const failures = [];

const postsDir = path.join(root, 'src/content/posts');
for (const file of await readdir(postsDir)) {
	if (!file.endsWith('.md')) continue;
	const slug = file.slice(0, -3);
	const { data } = matter(await readFile(path.join(postsDir, file), 'utf8'));
	for (const field of ['pubDate', 'updatedDate']) {
		if (data[field] == null || data[field] === '') continue;
		if (!isFuture(data[field])) continue;
		const value = data[field] instanceof Date ? data[field].toISOString() : String(data[field]);
		failures.push({ slug, field, value });
	}
}

const dist = path.join(root, 'dist');
for (const file of await readdir(dist)) {
	if (!/^sitemap.*\.xml$/.test(file)) continue;
	const xml = await readFile(path.join(dist, file), 'utf8');
	for (const block of xml.matchAll(/<(url|sitemap)>([\s\S]*?)<\/\1>/g)) {
		const loc = block[2].match(/<loc>([^<]+)<\/loc>/)?.[1];
		const lastmod = block[2].match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
		if (!loc || !lastmod || !isFuture(lastmod)) continue;
		failures.push({ slug: slugFromLoc(loc), field: 'lastmod', value: lastmod });
	}
}

if (failures.length === 0) {
	console.log('Nenhuma data de post ou lastmod está no futuro.');
	process.exit(0);
}

console.error('Datas no futuro em relação ao horário do build:');
for (const item of failures) {
	console.error(`- ${item.slug} ${item.field} ${item.value}`);
}
process.exit(1);
