/**
 * Somente leitura: abre cada slug interno ausente no inventário e classifica pelo DOM.
 * O SPA responde 200 mesmo quando a página não existe.
 * Grava _extract/orphan-links.md.
 */
import { chromium } from 'playwright';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://irenes.com.br';
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');
const PAGES_DIR = path.join(ROOT, 'src', 'content', 'paginas');
const INVENTORY_PATH = path.join(ROOT, '_extract', 'inventory.json');
const REPORT_PATH = path.join(ROOT, '_extract', 'orphan-links.md');
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function listMarkdown(dir) {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		const files = [];
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) files.push(...(await listMarkdown(full)));
			else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
		}
		return files;
	} catch {
		return [];
	}
}

function splitFrontmatter(markdown) {
	const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
	return match ? match[1] : markdown;
}

function linkTarget(href) {
	if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;
	if (/^https?:\/\//i.test(href) && !/^https?:\/\/(?:www\.)?irenes\.com\.br\b/i.test(href)) return null;
	let url;
	try {
		url = new URL(href, ORIGIN);
	} catch {
		return null;
	}
	if (url.hostname.replace(/^www\./, '') !== 'irenes.com.br') return null;
	if (/\.(?:png|jpe?g|webp|gif|svg|avif|css|js|pdf)$/i.test(url.pathname)) return null;
	if (url.searchParams.has('categoria')) return url.searchParams.get('categoria');
	const pathname = url.pathname.replace(/\/+$/, '');
	if (!pathname) return 'home';
	return pathname.replace(/^\//, '');
}

function visitUrl(href) {
	const url = new URL(href, ORIGIN);
	url.hash = '';
	return url.href;
}

function cell(value) {
	return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function classifyPage(page, href) {
	try {
		await page.goto(href, { waitUntil: 'networkidle', timeout: 45000 });
	} catch {
		await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
	}
	await page.waitForSelector('h1, main', { timeout: 8000 }).catch(() => {});
	const dom = await page.evaluate(() => {
		const h1 = document.querySelector('h1')?.innerText?.replace(/\s+/g, ' ').trim() || '';
		const prose = document.querySelector('main article .prose');
		const proseText = prose?.innerText?.replace(/\s+/g, ' ').trim() || '';
		const mainText = document.querySelector('main')?.innerText?.replace(/\s+/g, ' ').trim() || '';
		return { h1, proseText, mainText };
	});
	const blob = `${dom.h1} ${dom.mainText}`;
	const notFound =
		/^404$/i.test(dom.h1) ||
		/artigo não encontrado|página não encontrada|pagina não encontrada|não existe ou foi removido|nao existe ou foi removido/i.test(blob);
	const hasArticle = Boolean(dom.h1) && dom.proseText.length > 40 && !notFound;
	let status = '404';
	if (hasArticle) status = 'existe';
	else if (!notFound && dom.mainText.length >= 40) status = 'sem-artigo';
	return { status, h1: dom.h1 };
}

async function main() {
	const inventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
	const known = new Set(inventory.map((item) => item.slug));
	const groups = new Map();

	for (const file of [...(await listMarkdown(POSTS_DIR)), ...(await listMarkdown(PAGES_DIR))]) {
		const body = splitFrontmatter(await readFile(file, 'utf8'));
		const relative = path.relative(ROOT, file);
		for (const match of body.matchAll(/(?<!!)\[([^\[\]]*)\]\(([^)\s]+)\)/g)) {
			const slug = linkTarget(match[2]);
			if (!slug || known.has(slug)) continue;
			const href = visitUrl(match[2]);
			const key = `${slug}\n${href}`;
			if (!groups.has(key)) groups.set(key, { slug, href, links: [] });
			groups.get(key).links.push({ file: relative, text: match[1].replace(/\s+/g, ' ').trim() });
		}
	}

	const items = [...groups.values()].sort((a, b) => a.slug.localeCompare(b.slug, 'pt') || a.href.localeCompare(b.href));
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ userAgent: USER_AGENT, locale: 'pt-BR' });
	try {
		for (const item of items) {
			const result = await classifyPage(page, item.href);
			item.status = result.status;
			item.h1 = result.h1;
			console.log(`${result.status} ${item.slug} ${item.href}`);
		}
	} finally {
		await browser.close();
	}

	const lines = [
		'# Links órfãos',
		'',
		'Classificação pelo DOM. O status HTTP não entra na decisão: o SPA responde 200 também para páginas inexistentes.',
		'',
		'- `existe`: há H1 e corpo em `main article .prose`.',
		'- `404`: tela de não encontrado, ou a área principal fica sem conteúdo.',
		'- `sem-artigo`: a página renderiza conteúdo, mas não é um artigo com `.prose`. Nada foi alterado.',
		'',
		'| Slug | Status | H1 | Origem | Âncora |',
		'| --- | --- | --- | --- | --- |',
	];
	if (!items.length) lines.push('| — | — | — | — | — |');
	for (const item of items) {
		for (const link of item.links) {
			lines.push(`| \`${cell(item.slug)}\` | ${item.status} | ${cell(item.h1)} | \`${cell(link.file)}\` | ${cell(link.text)} |`);
		}
	}
	lines.push('', `Artigos para extrair: ${items.filter((item) => item.status === 'existe').map((item) => item.slug).join(', ') || 'nenhum'}.`, '');

	await mkdir(path.dirname(REPORT_PATH), { recursive: true });
	await writeFile(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
	console.log(`relatório gravado em ${path.relative(ROOT, REPORT_PATH)}`);
	const existe = items.filter((item) => item.status === 'existe');
	console.log(`EXISTE ${existe.map((item) => item.href).join(',')}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
