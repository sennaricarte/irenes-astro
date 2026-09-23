/**
 * Rastreamento somente leitura de irenes.com.br.
 * Grava _extract/crawl-diff.md e _extract/crawl-meta.json (breadcrumbs e tempo de leitura).
 */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://irenes.com.br';

function canonical(input) {
	let url;
	try {
		url = new URL(input, ORIGIN);
	} catch {
		return null;
	}
	const host = url.hostname.replace(/^www\./, '');
	if (host !== 'irenes.com.br') return null;
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	const categoria = url.searchParams.get('categoria');
	let pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
	if (!pathname) pathname = '/';
	if (pathname === '/' && categoria) return `${ORIGIN}/?categoria=${categoria}`;
	if (pathname === '/') return `${ORIGIN}/`;
	return `${ORIGIN}${pathname}`;
}

function sameKey(url) {
	return canonical(url);
}

const inventory = JSON.parse(await readFile(path.join(ROOT, '_extract/inventory.json'), 'utf8'));
const known = new Set(inventory.map((item) => sameKey(item.url)).filter(Boolean));

const seeds = [canonical(`${ORIGIN}/`), ...inventory.map((item) => sameKey(item.url))].filter(Boolean);
const queue = [...new Set(seeds)];
const visited = new Set();
const foundOn = new Map();
const records = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function openAndSettle(url) {
	try {
		await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
	} catch {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
	}
	let previous = 0;
	for (let i = 0; i < 12; i += 1) {
		const height = await page.evaluate(() => {
			window.scrollTo(0, document.body.scrollHeight);
			return document.body.scrollHeight;
		});
		if (height === previous) break;
		previous = height;
		await page.waitForTimeout(350);
	}
	await page.evaluate(() => window.scrollTo(0, 0));
}

while (queue.length) {
	const url = queue.shift();
	if (!url || visited.has(url)) continue;
	visited.add(url);
	process.stdout.write(`(${visited.size}) ${url}\n`);
	try {
		await openAndSettle(url);
	} catch (error) {
		console.error(`falha ${url}: ${error instanceof Error ? error.message : error}`);
		continue;
	}

	const data = await page.evaluate(() => {
		const main = document.querySelector('main');
		const text = (main?.innerText || '').replace(/\s+/g, ' ').trim();
		const h1 = (main?.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim();
		const prose = Boolean(main?.querySelector('article .prose'));
		const notFound = /artigo não encontrado|não existe ou foi removido|página não encontrada/i.test(text) || h1 === '404';
		const eyebrow = [...(main?.querySelectorAll('p, span') || [])]
			.map((el) => el.textContent.replace(/\s+/g, ' ').trim())
			.find((value) => /^(categoria|tag|ambientes|rituais)$/i.test(value)) || '';
		const listing = /\d+\s+artigos?\s+(publicados|encontrados)/i.test(text);
		const nav = main?.querySelector('nav[aria-label="Breadcrumb"]');
		const crumbs = nav
			? [...nav.querySelectorAll('a, span')]
					.map((el) => ({
						text: el.textContent.replace(/\s+/g, ' ').trim(),
						href: el.getAttribute('href'),
					}))
					.filter((item) => item.text && item.text !== '›' && item.text !== '>')
			: [];
		const reading = text.match(/(\d+)\s+min de leitura/);
		const hrefs = [...document.querySelectorAll('a[href]')].map((anchor) => anchor.href);
		return { text: text.slice(0, 180), h1, prose, notFound, eyebrow, listing, crumbs, reading: reading?.[1] || '', hrefs };
	});

	let tipo = 'pagina';
	if (data.notFound) tipo = '404';
	else if (data.h1 && data.prose) tipo = 'post';
	else if (data.eyebrow || data.listing) tipo = 'taxonomia';

	records.push({
		url,
		tipo,
		known: known.has(url),
		from: foundOn.get(url) || '(semente)',
		crumbs: data.crumbs,
		reading: data.reading,
		h1: data.text.slice(0, 120),
	});

	for (const href of data.hrefs) {
		const next = canonical(href);
		if (!next || visited.has(next) || queue.includes(next)) continue;
		if (!foundOn.has(next)) foundOn.set(next, url);
		queue.push(next);
	}
}

await browser.close();

const novel = records.filter((item) => !item.known);
const counts = novel.reduce((map, item) => {
	map[item.tipo] = (map[item.tipo] || 0) + 1;
	return map;
}, {});

const lines = [
	'# URLs novas em relação ao inventário',
	'',
	`Rastreadas: ${records.length}. Novas: ${novel.length}.`,
	'',
	...Object.entries(counts).map(([tipo, count]) => `- ${tipo}: ${count}`),
	'',
	'| URL | Tipo | Encontrada em |',
	'| --- | --- | --- |',
	...novel.map((item) => `| ${item.url} | ${item.tipo} | ${item.from} |`),
	'',
];

await mkdir(path.join(ROOT, '_extract'), { recursive: true });
await writeFile(path.join(ROOT, '_extract/crawl-diff.md'), lines.join('\n'), 'utf8');
await writeFile(
	path.join(ROOT, '_extract/crawl-meta.json'),
	JSON.stringify(
		records.map((item) => ({ url: item.url, tipo: item.tipo, crumbs: item.crumbs, reading: item.reading })),
		null,
		2,
	),
	'utf8',
);
console.log(`novas ${novel.length}`, counts);
