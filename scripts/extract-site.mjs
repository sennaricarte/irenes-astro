/**
 * Extrai irenes.com.br para o content layer do Astro.
 *
 * Padrão: dry-run — grava só _extract/inventory.json, screenshots e design-tokens.json.
 * --apply: também grava posts, páginas, categorias e tags.
 * --force: permite substituir arquivos que já existem (use junto com --apply).
 * --only=slug-a,slug-b: processa só esses slugs ou URLs e mescla o inventário.
 */
import { chromium } from 'playwright';
import TurndownService from 'turndown';
import { mkdir, writeFile, readFile, access, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTRACT_DIR = path.join(ROOT, '_extract');
const SCREENSHOT_DIR = path.join(EXTRACT_DIR, 'screenshots');
const ERROR_LOG = path.join(EXTRACT_DIR, 'errors.log');
const WARNINGS_LOG = path.join(EXTRACT_DIR, 'warnings.log');
const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const args = new Set(argv);
const apply = args.has('--apply');
const force = args.has('--force');
const only = (argv.find((arg) => arg.startsWith('--only=')) || '')
	.slice('--only='.length)
	.split(',')
	.map((item) => item.trim())
	.filter(Boolean);
const originFlag = (argv.find((arg) => arg.startsWith('--origin=')) || '').slice('--origin='.length);
const ORIGIN = (originFlag || 'https://irenes.com.br').replace(/\/+$/, '');
const PUBLIC_ORIGIN = 'https://irenes.com.br';
const SOURCE_HOST = new URL(ORIGIN).hostname.replace(/^www\./, '');
const PUBLIC_HOST = new URL(PUBLIC_ORIGIN).hostname.replace(/^www\./, '');
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;

function acceptedHost(hostname) {
	const host = hostname.replace(/^www\./, '');
	return host === PUBLIC_HOST || host === SOURCE_HOST;
}

function rewriteHost(input, targetOrigin) {
	const url = new URL(input, ORIGIN);
	if (!acceptedHost(url.hostname)) return String(input);
	const target = new URL(targetOrigin);
	url.protocol = target.protocol;
	url.host = target.host;
	return url.href;
}

function toPublicUrl(input) {
	return rewriteHost(input, PUBLIC_ORIGIN);
}

const MONTHS = {
	janeiro: 1,
	fevereiro: 2,
	marco: 3,
	abril: 4,
	maio: 5,
	junho: 6,
	julho: 7,
	agosto: 8,
	setembro: 9,
	outubro: 10,
	novembro: 11,
	dezembro: 12,
};

const IMAGE_EXT = {
	'image/jpeg': '.jpg',
	'image/jpg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
	'image/gif': '.gif',
	'image/svg+xml': '.svg',
	'image/avif': '.avif',
};

function decodeXml(value) {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'");
}

function canonicalKey(input) {
	let url;
	try {
		url = new URL(input, ORIGIN);
	} catch {
		return null;
	}
	if (!acceptedHost(url.hostname)) return null;
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	let pathname = url.pathname.replace(/\/+$/, '');
	if (!pathname) pathname = '/';
	if (pathname.startsWith('/admin') || pathname.startsWith('/auth') || pathname.startsWith('/api')) return null;
	if (/\.(?:png|jpe?g|webp|gif|svg|css|js|mjs|pdf|xml|ico|woff2?|txt|map)$/i.test(pathname)) return null;
	if (url.searchParams.has('search')) return null;
	const params = [...url.searchParams.entries()]
		.filter(([key]) => key !== 'search')
		.sort(([a], [b]) => a.localeCompare(b));
	const search = params.length ? `?${new URLSearchParams(params).toString()}` : '';
	return `${pathname}${search}`;
}

function classify(url, isPost) {
	const parsed = new URL(url);
	const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
	if (parsed.searchParams.has('categoria') || pathname.startsWith('/tag/')) return 'categoria';
	if (pathname === '/') return 'home';
	if (pathname === '/categorias') return 'pagina';
	if (isPost) return 'post';
	return 'pagina';
}

function slugFor(url, tipo) {
	const parsed = new URL(url);
	if (tipo === 'home') return 'home';
	if (tipo === 'categoria' && parsed.searchParams.has('categoria')) {
		return parsed.searchParams.get('categoria') || 'categoria';
	}
	const parts = parsed.pathname.split('/').filter(Boolean);
	return parts.join('/') || tipo;
}

function fileSlug(slug) {
	return slug.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function stripAccents(value) {
	return value.normalize('NFD').replace(/\p{M}/gu, '');
}

function slugify(value) {
	return stripAccents(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

function taxonomySlug(value) {
	return stripAccents(decodeURIComponent(String(value || '')))
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function isWordChar(char) {
	return /[\p{L}\p{N}]/u.test(char || '');
}

function escapeInlineMarkdown(text) {
	const flags = new Array(text.length).fill(false);
	for (const match of text.matchAll(/\[(?:[^\]\\]|\\.)*](?=\()/g)) {
		flags[match.index] = true;
	}

	const runs = [];
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char !== '*' && char !== '_') continue;
		let end = index;
		while (end < text.length && text[end] === char) end += 1;
		runs.push({ start: index, end, char, len: end - index });
		index = end - 1;
	}

	const used = new Set();
	const canOpen = (run) => {
		const before = text[run.start - 1];
		const after = text[run.end];
		if (!after || /\s/u.test(after)) return false;
		if (run.char === '_' && isWordChar(before) && isWordChar(after)) return false;
		return true;
	};
	const canClose = (run) => {
		const before = text[run.start - 1];
		const after = text[run.end];
		if (!before || /\s/u.test(before)) return false;
		if (run.char === '_' && isWordChar(before) && isWordChar(after)) return false;
		return true;
	};

	for (let open = 0; open < runs.length; open += 1) {
		if (used.has(open) || !canOpen(runs[open])) continue;
		for (let close = open + 1; close < runs.length; close += 1) {
			if (used.has(close) || runs[close].char !== runs[open].char || !canClose(runs[close])) continue;
			if (runs[open].end >= runs[close].start) continue;
			if (!text.slice(runs[open].end, runs[close].start).trim()) continue;
			const size = Math.min(runs[open].len, runs[close].len);
			for (let offset = 0; offset < size; offset += 1) {
				flags[runs[open].end - 1 - offset] = true;
				flags[runs[close].start + offset] = true;
			}
			used.add(open);
			used.add(close);
			break;
		}
	}

	let out = '';
	for (let index = 0; index < text.length; index += 1) {
		out += flags[index] ? `\\${text[index]}` : text[index];
	}
	return out;
}

function escapeAmbiguousLine(line) {
	const indent = line.match(/^\s*/)?.[0] ?? '';
	let rest = line.slice(indent.length);
	let prefix = indent;
	const heading = rest.match(/^(#{1,6})(\s)/);
	const bullet = rest.match(/^([-+])(\s)/);
	const ordered = rest.match(/^(\d+)(\.)(\s)/);
	if (heading) {
		prefix += heading[1].replaceAll('#', '\\#') + heading[2];
		rest = rest.slice(heading[0].length);
	} else if (bullet) {
		prefix += `\\${bullet[1]}${bullet[2]}`;
		rest = rest.slice(bullet[0].length);
	} else if (ordered) {
		prefix += `${ordered[1]}\\.${ordered[3]}`;
		rest = rest.slice(ordered[0].length);
	}
	return prefix + escapeInlineMarkdown(rest);
}

function escapeAmbiguousMarkdown(value) {
	return String(value ?? '')
		.split('\n')
		.map((line) => escapeAmbiguousLine(line))
		.join('\n');
}

function urlMatchesOnly(url, item) {
	if (/^https?:\/\//i.test(item)) return canonicalKey(url) === canonicalKey(item);
	const bare = item.replace(/^\/+|\/+$/g, '');
	const parsed = new URL(url);
	const pathSlug = parsed.pathname.split('/').filter(Boolean).join('/');
	const category = parsed.searchParams.get('categoria') || '';
	return bare === pathSlug || bare === category || (category && bare === taxonomySlug(category));
}

function selectUrls(urls, selection) {
	if (!selection.length) return urls;
	const selected = [];
	const seen = new Set();
	const add = (input) => {
		const absolute = /^https?:\/\//i.test(input) ? input : new URL(String(input).replace(/^\//, ''), `${ORIGIN}/`).href;
		const key = canonicalKey(absolute);
		if (!key || seen.has(key)) return;
		seen.add(key);
		selected.push(absolute);
	};
	for (const url of urls) {
		if (selection.some((item) => urlMatchesOnly(url, item))) add(url);
	}
	for (const item of selection) add(item);
	return selected;
}

function toIsoDate(value) {
	if (!value) return null;
	if (typeof value === 'string') {
		const pt = value.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
		if (pt) {
			const month = MONTHS[stripAccents(pt[2].toLowerCase())];
			if (month) {
				return `${pt[3]}-${String(month).padStart(2, '0')}-${pt[1].padStart(2, '0')}`;
			}
		}
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString().slice(0, 10);
}

function yamlString(value) {
	return JSON.stringify(value ?? '');
}

function clip(value, max = 300) {
	const clean = String(value || '').replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

function unwrapProxy(src) {
	try {
		const url = new URL(src);
		if (url.hostname === 'wsrv.nl' && url.searchParams.get('url')) {
			return url.searchParams.get('url');
		}
		return url.href;
	} catch {
		return src;
	}
}

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

async function logError(url, error) {
	const message = error instanceof Error ? error.stack || error.message : String(error);
	const line = `[${new Date().toISOString()}] ${url} — ${message.replace(/\s+/g, ' ')}\n`;
	console.error(`erro ${url}: ${error instanceof Error ? error.message : error}`);
	await mkdir(EXTRACT_DIR, { recursive: true });
	await appendFile(ERROR_LOG, line, 'utf8');
}

async function logWarning(url, message) {
	const line = `[${new Date().toISOString()}] ${url} — ${message}\n`;
	console.warn(`aviso ${url}: ${message}`);
	await mkdir(EXTRACT_DIR, { recursive: true });
	await appendFile(WARNINGS_LOG, line, 'utf8');
}

function resolvePubDate(data) {
	return toIsoDate(data.domPubDate) || toIsoDate(data.jsonLdPubDate) || toIsoDate(data.metaPubDate);
}

function escapeAttr(value) {
	return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function applyImageAlts(html, title) {
	const missing = [];
	const next = String(html || '').replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
		const src = attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
		const altMatch = attrs.match(/\balt\s*=\s*["']([^"']*)["']/i);
		if (altMatch && altMatch[1].trim()) return tag;
		missing.push(src);
		const safe = escapeAttr(title);
		if (altMatch) return tag.replace(/\balt\s*=\s*["'][^"']*["']/i, `alt="${safe}"`);
		return `<img alt="${safe}"${attrs}>`;
	});
	return { html: next, missing };
}

function normalizeHeadings(markdown) {
	let fence = false;
	let previous = null;
	const lines = [];
	for (const line of markdown.split('\n')) {
		if (/^```/.test(line.trim())) {
			fence = !fence;
			lines.push(line);
			continue;
		}
		if (fence) {
			lines.push(line);
			continue;
		}
		const match = /^(#{1,6})(\s+)(.*)$/.exec(line);
		if (!match) {
			lines.push(line);
			continue;
		}
		if (match[1].length === 1) continue;
		let level = match[1].length;
		if (previous != null && level > previous + 1) level = previous + 1;
		previous = level;
		lines.push(`${'#'.repeat(level)}${match[2]}${match[3]}`);
	}
	return lines.join('\n');
}

function stripNoiseMarkdown(markdown) {
	const related = /^(?:\*{1,2}|_{1,2})?(?:leia também|leia tambem|leia mais|continue lendo|artigos relacionados|posts relacionados|você também pode gostar|veja também|veja tambem)\b/i;
	const blocks = markdown.split(/\n{2,}/);
	const kept = [];
	for (const block of blocks) {
		const text = block.replace(/\s+/g, ' ').trim();
		const plain = text.replace(/^(?:[*_>\s]+)+/, '');
		if (!text) continue;
		if (related.test(plain) && text.length < 700) continue;
		if (/^(compartilhar|share)\b/i.test(plain) && text.length < 180) continue;
		if (/lovable\.dev|\blovable\b/i.test(text) && text.length < 240) continue;
		const cleaned = block.replace(/\s*\*{0,2}(?:leia também|leia tambem|leia mais|continue lendo):?\*{0,2}\s*\[[^\]]*\]\([^)]*\)\s*/gi, '').trim();
		if (cleaned) kept.push(cleaned);
	}
	return kept.join('\n\n');
}

function convertSiteHref(raw) {
	const href = String(raw || '').trim();
	if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return raw;
	let url;
	try {
		url = new URL(href, ORIGIN);
	} catch {
		return raw;
	}
	if (!acceptedHost(url.hostname)) return raw;
	const absoluteSite = acceptedHost(new URL(href, ORIGIN).hostname) && /^https?:\/\//i.test(href);
	const rootRelative = href.startsWith('/') && !href.startsWith('//');
	if (!absoluteSite && !rootRelative) return raw;
	if (/\.(?:png|jpe?g|webp|gif|svg|avif|css|js|pdf|xml)$/i.test(url.pathname)) return raw;
	let pathname = url.pathname || '/';
	if (!pathname.endsWith('/')) pathname += '/';
	return `${pathname}${url.search}${url.hash}`;
}

function rewriteInternalLinks(markdown) {
	return markdown.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (full, prefix, href, suffix) => {
		if (prefix.startsWith('!')) return full;
		return `${prefix}${convertSiteHref(href)}${suffix}`;
	}).replace(/<(https?:\/\/(?:www\.)?irenes\.com\.br[^>\s]*)>/gi, (_full, href) => `<${convertSiteHref(href)}>`);
}

function finalizeMarkdown(markdown) {
	return rewriteInternalLinks(normalizeHeadings(stripNoiseMarkdown(markdown)))
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

async function fetchText(url) {
	const response = await fetch(url, {
		headers: { 'user-agent': USER_AGENT, accept: 'application/xml,text/xml,text/html' },
		redirect: 'follow',
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} ao buscar ${url}`);
	}
	return response.text();
}

async function discoverFromSitemap() {
	const xml = await fetchText(SITEMAP_URL);
	if (!xml.includes('<loc>')) throw new Error('sitemap sem URLs');
	const urls = [];
	const seen = new Set();
	const queue = [xml];
	const nested = [];
	while (queue.length) {
		const chunk = queue.shift();
		if (/<sitemapindex[\s>]/i.test(chunk)) {
			for (const match of chunk.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
				nested.push(decodeXml(match[1].trim()));
			}
			continue;
		}
		for (const match of chunk.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
			const raw = decodeXml(match[1].trim());
			const key = canonicalKey(raw);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			urls.push(raw);
		}
	}
	for (const child of nested) {
		try {
			queue.push(await fetchText(child));
		} catch (error) {
			await logError(child, error);
		}
	}
	while (queue.length) {
		const chunk = queue.shift();
		for (const match of chunk.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
			const raw = decodeXml(match[1].trim());
			const key = canonicalKey(raw);
			if (!key || seen.has(key)) continue;
			seen.add(key);
			urls.push(raw);
		}
	}
	if (!urls.length) throw new Error('sitemap vazio');
	return urls;
}

async function discoverByCrawl(page) {
	const home = `${ORIGIN}/`;
	const queue = [home];
	const seen = new Set();
	const urls = [];
	while (queue.length) {
		const current = queue.shift();
		const key = canonicalKey(current);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		urls.push(current);
		const target = rewriteHost(current, ORIGIN);
		try {
			await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
		} catch (error) {
			await logError(current, error);
			try {
				await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
			} catch (fallbackError) {
				await logError(current, fallbackError);
				continue;
			}
		}
		const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((anchor) => anchor.href));
		for (const href of hrefs) {
			const nextKey = canonicalKey(href);
			if (!nextKey || seen.has(nextKey)) continue;
			queue.push(href);
		}
	}
	return urls;
}

function createTurndown() {
	const turndown = new TurndownService({
		headingStyle: 'atx',
		bulletListMarker: '-',
		codeBlockStyle: 'fenced',
		emDelimiter: '*',
		strongDelimiter: '**',
	});
	turndown.escape = escapeAmbiguousMarkdown;
	turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg']);
	turndown.addRule('tables', {
		filter: 'table',
		replacement(_content, node) {
			const rows = Array.from(node.querySelectorAll('tr')).filter((row) => {
				let parent = row.parentNode;
				while (parent && parent.nodeName !== 'TABLE') parent = parent.parentNode;
				return parent === node;
			});
			if (!rows.length) return '';
			const cellsOf = (row) =>
				Array.from(row.childNodes)
					.filter((cell) => cell.nodeName === 'TH' || cell.nodeName === 'TD')
					.map((cell) => escapeAmbiguousMarkdown(cell.textContent.replace(/\s+/g, ' ').trim()).replace(/\|/g, '\\|'));
			const header = cellsOf(rows[0]);
			if (!header.length) return '';
			const line = (cells) => `| ${cells.join(' | ')} |`;
			const separator = `| ${header.map(() => '---').join(' | ')} |`;
			const body = rows.slice(1).map((row) => line(cellsOf(row)));
			return `\n\n${line(header)}\n${separator}\n${body.join('\n')}\n\n`;
		},
	});
	return turndown;
}

async function readPage(page) {
	return page.evaluate(() => {
		const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
		const prose = document.querySelector('main article .prose');
		const article = document.querySelector('main article');
		const hero = article?.querySelector(':scope > figure img') || article?.querySelector('figure img');

		let jsonLdPubDate = '';
		let updatedDate = '';
		let categorySlug = '';
		let categoryName = '';
		let isArticle = false;

		for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
			let data;
			try {
				data = JSON.parse(script.textContent || '');
			} catch {
				continue;
			}
			const nodes = Array.isArray(data) ? data : [data];
			for (const node of nodes) {
				const type = node['@type'];
				if (type === 'Article' || type === 'BlogPosting') {
					isArticle = true;
					jsonLdPubDate = node.datePublished || jsonLdPubDate;
					updatedDate = node.dateModified || updatedDate;
				}
				if (type === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
					const categories = node.itemListElement.filter(
						(item) => typeof item.item === 'string' && item.item.includes('categoria='),
					);
					const last = categories.at(-1);
					if (last?.item) {
						try {
							categorySlug = new URL(last.item, location.origin).searchParams.get('categoria') || categorySlug;
							categoryName = last.name || categoryName;
						} catch {
							/* ignora breadcrumb inválido */
						}
					}
				}
			}
		}

		if (!categorySlug && article) {
			const links = [...article.querySelectorAll('a[href*="categoria="]')];
			const last = links.at(-1);
			if (last) {
				try {
					categorySlug = new URL(last.href).searchParams.get('categoria') || '';
					categoryName = last.textContent.trim();
				} catch {
					/* ignora */
				}
			}
		}

		const timeEl = article?.querySelector('time');
		const headerText = article?.querySelector('header')?.innerText || '';
		const headerMatch = headerText.match(/\d{1,2}\s+de\s+[A-Za-zÀ-ú]+\s+de\s+\d{4}/);
		const domPubDate = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || headerMatch?.[0] || '';
		const metaPubDate =
			document.querySelector('meta[property="article:published_time"]')?.content ||
			document.querySelector('meta[name="article:published_time"]')?.content ||
			'';

		const cleanRoot = (root) => {
			if (!root) return '';
			const clone = root.cloneNode(true);
			clone.querySelectorAll('h1').forEach((el) => el.remove());
			for (const el of [...clone.querySelectorAll('p, li, aside, section, div, a, button')]) {
				if (!el.isConnected || el.querySelector('h2, h3, h4, h5, h6')) continue;
				const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
				const hrefs = [el.getAttribute('href') || '', ...[...el.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') || '')]
					.join(' ')
					.toLowerCase();
				const sample = `${text} ${hrefs} ${el.className || ''}`.toLowerCase();
				const lovable = /lovable\.dev|\blovable\b/.test(sample);
				const share = text.length > 0 && text.length < 180 && /^(compartilhar|share)\b/i.test(text);
				const related =
					text.length > 0 &&
					text.length < 600 &&
					/^(leia também|leia tambem|leia mais|continue lendo|artigos relacionados|posts relacionados|você também pode gostar|veja também|veja tambem)\b/i.test(text);
				if (lovable || share || related) el.remove();
			}
			clone.querySelectorAll('p').forEach((paragraph) => {
				const text = paragraph.textContent.replace(/\u00a0/g, '').replace(/\s+/g, '').trim();
				if (!text && !paragraph.querySelector('img')) paragraph.remove();
			});
			return clone.innerHTML;
		};

		const tags = [];
		const seenTags = new Set();
		for (const anchor of article?.querySelectorAll('a[href*="/tag/"]') || []) {
			try {
				const pathname = new URL(anchor.getAttribute('href'), location.origin).pathname;
				const parts = pathname.split('/').filter(Boolean);
				if (parts[0] !== 'tag' || !parts[1]) continue;
				const tagSlug = decodeURIComponent(parts[1]);
				if (seenTags.has(tagSlug)) continue;
				seenTags.add(tagSlug);
				tags.push(tagSlug);
			} catch {
				/* ignora tag inválida */
			}
		}
		const noindex = /noindex/i.test(meta('meta[name="robots"]'));

		const firstParagraph =
			[...(prose?.querySelectorAll('p') || [])]
				.map((paragraph) => paragraph.innerText.replace(/\s+/g, ' ').trim())
				.find((text) => text && !/^(leia também|leia tambem|continue lendo|artigos relacionados)\b/i.test(text)) || '';

		const tokens = { ':root': {}, '.dark': {} };
		for (const sheet of document.styleSheets) {
			let rules;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			for (const rule of rules) {
				if (!rule.selectorText || !rule.style) continue;
				const selectors = rule.selectorText.split(',').map((selector) => selector.trim());
				const targets = [];
				if (selectors.includes(':root')) targets.push(':root');
				if (selectors.some((selector) => selector === '.dark' || selector === ':root.dark' || selector === '.dark:root')) {
					targets.push('.dark');
				}
				for (const target of targets) {
					for (const prop of rule.style) {
						if (prop.startsWith('--')) tokens[target][prop] = rule.style.getPropertyValue(prop).trim();
					}
				}
			}
		}

		const fontOf = (selector) => {
			const element = document.querySelector(selector);
			return element ? getComputedStyle(element).fontFamily : '';
		};

		return {
			title: document.title || '',
			description: meta('meta[name="description"]'),
			canonical: document.querySelector('link[rel="canonical"]')?.href || '',
			ogImage: meta('meta[property="og:image"]'),
			h1: document.querySelector('h1')?.innerText?.replace(/\s+/g, ' ').trim() || '',
			isPost: Boolean(prose) || isArticle,
			domPubDate,
			jsonLdPubDate,
			metaPubDate,
			updatedDate,
			categorySlug,
			categoryName,
			tags,
			noindex,
			heroSrc: hero?.currentSrc || hero?.src || '',
			heroAlt: hero?.alt || '',
			firstParagraph,
			proseHtml: cleanRoot(prose),
			mainHtml: cleanRoot(document.querySelector('main')),
			tokens,
			fontFamily: {
				body: fontOf('body'),
				h1: fontOf('h1'),
				h2: fontOf('h2'),
			},
		};
	});
}

async function openUrl(page, url) {
	const target = rewriteHost(url, ORIGIN);
	try {
		return await page.goto(target, { waitUntil: 'networkidle', timeout: 45000 });
	} catch {
		return page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
	}
}

async function shoot(page, name) {
	await mkdir(SCREENSHOT_DIR, { recursive: true });
	const shots = [
		{ width: 1440, height: 900, suffix: 'desktop' },
		{ width: 390, height: 844, suffix: 'mobile' },
	];
	for (const shot of shots) {
		await page.setViewportSize({ width: shot.width, height: shot.height });
		await page.waitForTimeout(400);
		await page.screenshot({
			path: path.join(SCREENSHOT_DIR, `${name}-${shot.suffix}.png`),
			fullPage: true,
		});
	}
	await page.setViewportSize({ width: 1440, height: 900 });
}

function imageBaseName(alt, imageUrl) {
	let stem = '';
	try {
		stem = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
	} catch {
		stem = '';
	}
	const hashed = /^[a-f0-9-]{16,}$/i.test(stem) || /^\d{10,}$/.test(stem);
	if (stem && !hashed && slugify(stem)) return slugify(stem);
	const fromAlt = slugify(alt || '');
	return fromAlt || 'imagem';
}

function extensionFor(contentType, imageUrl) {
	const type = (contentType || '').split(';')[0].trim().toLowerCase();
	if (IMAGE_EXT[type]) return IMAGE_EXT[type];
	try {
		const match = new URL(imageUrl).pathname.match(/\.(jpe?g|png|webp|gif|svg|avif)$/i);
		if (match) return `.${match[1].toLowerCase().replace('jpeg', 'jpg')}`;
	} catch {
		/* ignora */
	}
	return '.jpg';
}

function collectImages(html) {
	const sources = [];
	for (const match of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
		const tag = match[0];
		const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
		if (!src) continue;
		sources.push({ src, alt: tag.match(/\balt=["']([^"']*)["']/i)?.[1] || '' });
	}
	return sources;
}

async function downloadImages(sources, pageUrl, slug) {
	const destDir = path.join(ROOT, 'src', 'assets', 'posts', fileSlug(slug));
	await mkdir(destDir, { recursive: true });
	const used = new Set();
	const map = new Map();
	let heroPath = '';

	for (const source of sources) {
		let absolute;
		try {
			absolute = new URL(source.src, pageUrl).href;
		} catch {
			continue;
		}
		if (absolute.startsWith('data:')) continue;
		const resolved = unwrapProxy(absolute);
		if (map.has(resolved)) {
			if (source.hero) heroPath = map.get(resolved);
			continue;
		}
		try {
			const response = await fetch(resolved, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
			if (!response.ok) throw new Error(`HTTP ${response.status} em ${resolved}`);
			const ext = extensionFor(response.headers.get('content-type'), resolved);
			const base = imageBaseName(source.alt, resolved);
			let index = 1;
			let filename = '';
			let dest = '';
			while (index < 100) {
				filename = index === 1 ? `${base}${ext}` : `${base}-${index}${ext}`;
				dest = path.join(destDir, filename);
				if (!used.has(filename) && (force || !(await exists(dest)))) break;
				index += 1;
			}
			if (!force && (await exists(dest))) {
				console.log(`mantida imagem existente ${path.relative(ROOT, dest)}`);
			} else {
				await writeFile(dest, Buffer.from(await response.arrayBuffer()));
			}
			used.add(filename);
			const relative = `../../assets/posts/${fileSlug(slug)}/${filename}`;
			map.set(absolute, relative);
			map.set(resolved, relative);
			map.set(source.src, relative);
			if (source.hero) heroPath = relative;
		} catch (error) {
			await logError(resolved || source.src, error);
		}
	}
	return { map, heroPath };
}

function rewriteMarkdownImages(markdown, map) {
	return markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (full, prefix, src, suffix) => {
		const resolved = unwrapProxy(src);
		const next = map.get(src) || map.get(resolved);
		return next ? `${prefix}${next}${suffix}` : full;
	});
}

function buildPostFrontmatter(entry, heroPath) {
	const lines = ['---', `title: ${yamlString(entry.titulo)}`];
	if (entry.seoTitle && entry.seoTitle !== entry.titulo) lines.push(`seoTitle: ${yamlString(entry.seoTitle)}`);
	lines.push(`description: ${yamlString(entry.description)}`);
	if (entry.pubDate) lines.push(`pubDate: ${entry.pubDate}`);
	if (entry.updatedDate && entry.updatedDate !== entry.pubDate) lines.push(`updatedDate: ${entry.updatedDate}`);
	lines.push(`category: ${yamlString(entry.category)}`);
	if (entry.tags?.length) {
		lines.push('tags:');
		for (const tag of entry.tags) lines.push(`  - ${yamlString(tag)}`);
	} else {
		lines.push('tags: []');
	}
	if (heroPath) lines.push(`heroImage: ${heroPath}`);
	lines.push(`heroAlt: ${yamlString(entry.heroAlt)}`, `originalUrl: ${yamlString(entry.url)}`, '---', '');
	return lines.join('\n');
}

async function writeIfAllowed(file, contents) {
	if ((await exists(file)) && !force) {
		console.log(`mantido ${path.relative(ROOT, file)} (use --force para substituir)`);
		return false;
	}
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, contents, 'utf8');
	console.log(`gravou ${path.relative(ROOT, file)}`);
	return true;
}

function taxonomyRecord(item) {
	const record = {
		slug: item.slug,
		name: item.name,
	};
	if (item.description) record.description = item.description;
	record.noindex = Boolean(item.noindex);
	record.originalUrl = item.originalUrl;
	return record;
}

async function writeTaxonomyFile(filename, items) {
	const file = path.join(ROOT, 'src', 'content', filename);
	const fresh = items
		.map(taxonomyRecord)
		.sort((a, b) => a.slug.localeCompare(b.slug, 'pt'));
	if (!fresh.length) return;
	await mkdir(path.dirname(file), { recursive: true });
	if (only.length || !force) {
		let current = [];
		if (await exists(file)) {
			const parsed = JSON.parse(await readFile(file, 'utf8'));
			current = Array.isArray(parsed) ? parsed.filter((item) => item?.slug) : [];
		}
		const bySlug = new Map(current.map((item) => [item.slug, item]));
		let changed = false;
		for (const item of fresh) {
			if (bySlug.has(item.slug) && !force) {
				console.log(`mantido ${filename} ${item.slug} (use --force para substituir)`);
				continue;
			}
			bySlug.set(item.slug, item);
			changed = true;
		}
		if (!changed) return;
		const next = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug, 'pt'));
		await writeFile(file, `${JSON.stringify(next, null, '\t')}\n`, 'utf8');
		console.log(`gravou src/content/${filename} (${next.length})`);
		return;
	}
	await writeFile(file, `${JSON.stringify(fresh, null, '\t')}\n`, 'utf8');
	console.log(`gravou src/content/${filename} (${fresh.length})`);
}

function escapeRedirectValue(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function writeCategoryRedirects(items) {
	const paths = new Set();
	const mismatches = [];
	for (const item of items) {
		let url;
		try {
			url = new URL(item.originalUrl);
		} catch {
			continue;
		}
		if (!url.searchParams.has('categoria')) continue;
		const pathname = url.pathname.replace(/\/+$/, '') || '/';
		paths.add(pathname);
		const value = url.searchParams.get('categoria') || '';
		const slug = taxonomySlug(value);
		if (value !== slug) mismatches.push({ pathname, value, slug });
	}
	if (!paths.size) return;
	const redirects = [];
	const seen = new Set();
	for (const mismatch of mismatches) {
		const key = `${mismatch.pathname}|${mismatch.value}`;
		if (seen.has(key)) continue;
		seen.add(key);
		redirects.push({
			source: mismatch.pathname,
			has: [{ type: 'query', key: 'categoria', value: `^${escapeRedirectValue(mismatch.value)}$` }],
			destination: `/categoria/${mismatch.slug}/`,
			permanent: true,
		});
	}
	for (const source of [...paths].sort()) {
		redirects.push({
			source,
			has: [{ type: 'query', key: 'categoria', value: '(?<valor>.+)' }],
			destination: '/categoria/:valor/',
			permanent: true,
		});
	}
	const vercelPath = path.join(ROOT, 'vercel.json');
	let current = { trailingSlash: true };
	if (await exists(vercelPath)) {
		current = JSON.parse(await readFile(vercelPath, 'utf8'));
	}
	current.trailingSlash = true;
	current.redirects = redirects;
	await writeFile(vercelPath, `${JSON.stringify(current, null, '\t')}\n`, 'utf8');
	console.log(`gravou vercel.json (${redirects.length} redirect${redirects.length === 1 ? '' : 's'}, paths: ${[...paths].join(', ')})`);
}

async function main() {
	await mkdir(EXTRACT_DIR, { recursive: true });
	await rm(ERROR_LOG, { force: true });
	await rm(WARNINGS_LOG, { force: true });

	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		userAgent: USER_AGENT,
		locale: 'pt-BR',
	});
	const page = await context.newPage();
	const turndown = createTurndown();
	let inventory = [];
	if (only.length) {
		try {
			const parsed = JSON.parse(await readFile(path.join(EXTRACT_DIR, 'inventory.json'), 'utf8'));
			if (Array.isArray(parsed)) inventory = parsed;
		} catch {
			inventory = [];
		}
	}
	const categorias = [];
	const tags = [];
	const shots = { home: false, post: false, categoria: false };
	let tokensWritten = false;
	let siteDescription = '';

	let urls = [];
	try {
		urls = await discoverFromSitemap();
		console.log(`sitemap: ${urls.length} URLs`);
	} catch (error) {
		await logError(SITEMAP_URL, error);
		console.log('sitemap indisponível, rastreando a home');
		urls = await discoverByCrawl(page);
		console.log(`rastreio: ${urls.length} URLs`);
	}

	const categorySlugs = new Set();
	for (const url of urls) {
		const value = new URL(url).searchParams.get('categoria');
		if (value) categorySlugs.add(taxonomySlug(value));
	}
	if (only.length) {
		urls = selectUrls(urls, only);
		console.log(`--only: ${urls.length} URLs`);
	}

	const remember = (entry) => {
		const index = inventory.findIndex((item) => item.url === entry.url);
		if (index >= 0) inventory[index] = entry;
		else inventory.push(entry);
	};

	for (const url of urls) {
		try {
			const response = await openUrl(page, url);
			const status = response?.status() ?? 0;
			const data = await readPage(page);
			const publicUrl = toPublicUrl(url);
			const sourceUrl = rewriteHost(url, ORIGIN);
			const tipo = classify(url, data.isPost);
			const slug = slugFor(url, tipo);
			const titulo = data.h1 || data.title || slug;
			if (tipo === 'home' && data.description) siteDescription = data.description;
			const repeatsSiteDescription = tipo !== 'home' && siteDescription && data.description.trim() === siteDescription.trim();
			const description = clip(
				!repeatsSiteDescription && data.description ? data.description : data.firstParagraph || data.description || titulo,
			);

			remember({
				url: publicUrl,
				slug,
				tipo,
				titulo,
				status,
			});
			await writeFile(path.join(EXTRACT_DIR, 'inventory.json'), `${JSON.stringify(inventory, null, '\t')}\n`, 'utf8');
			console.log(`${status} ${tipo} ${publicUrl}`);

			if (!only.length && !tokensWritten && tipo === 'home') {
				await writeFile(
					path.join(EXTRACT_DIR, 'design-tokens.json'),
					`${JSON.stringify({ ':root': data.tokens[':root'], '.dark': data.tokens['.dark'], fontFamily: data.fontFamily }, null, '\t')}\n`,
					'utf8',
				);
				tokensWritten = true;
			}

			if (!only.length && tipo === 'home' && !shots.home) {
				await shoot(page, 'home');
				shots.home = true;
			} else if (!only.length && tipo === 'post' && !shots.post) {
				await shoot(page, `post-${fileSlug(slug)}`);
				shots.post = true;
			} else if (!only.length && tipo === 'categoria' && !shots.categoria) {
				await shoot(page, `categoria-${fileSlug(slug)}`);
				shots.categoria = true;
			}

			if (!apply) continue;

			if (tipo === 'categoria') {
				const parsed = new URL(url);
				const isTag = parsed.pathname.replace(/\/+$/, '').startsWith('/tag/');
				const raw = isTag
					? decodeURIComponent(parsed.pathname.split('/').filter(Boolean)[1] || '')
					: parsed.searchParams.get('categoria') || slug;
				let description = (data.description || '').trim();
				if (siteDescription && description === siteDescription.trim()) description = '';
				const record = {
					slug: isTag ? raw : taxonomySlug(raw),
					name: data.h1 || data.categoryName || raw,
					description,
					noindex: Boolean(data.noindex),
					originalUrl: publicUrl,
				};
				if (isTag) tags.push(record);
				else categorias.push(record);
				continue;
			}

			if (tipo !== 'post' && tipo !== 'pagina') continue;

			const sourceHtml = tipo === 'post' ? data.proseHtml : data.mainHtml;
			const withAlts = applyImageAlts(sourceHtml, titulo);
			if (tipo === 'post') {
				for (const src of withAlts.missing) {
					let original = src;
					try {
						original = unwrapProxy(new URL(src, url).href);
					} catch {
						/* mantém o src bruto */
					}
					await logWarning(url, `imagem sem alt; usando o título do post como fallback # ${original}`);
				}
			}
			let markdown = finalizeMarkdown(turndown.turndown(withAlts.html || ''));

			if (tipo === 'post') {
				const file = path.join(ROOT, 'src', 'content', 'posts', `${fileSlug(slug)}.md`);
				if ((await exists(file)) && !force) {
					console.log(`mantido ${path.relative(ROOT, file)} (use --force para substituir)`);
					continue;
				}
				const pubDate = resolvePubDate(data);
				if (!pubDate) {
					await logWarning(url, 'pubDate não encontrada no DOM, no JSON-LD (datePublished) nem em meta article:published_time');
				}
				const category = taxonomySlug(data.categorySlug || '');
				if (!category || (categorySlugs.size && !categorySlugs.has(category))) {
					await logWarning(url, `categoria "${category}" não corresponde a um slug de categorias.json`);
				}
				const heroSrc = data.heroSrc || data.ogImage;
				let heroAlt = (data.heroAlt || '').trim();
				if (heroSrc && !heroAlt) {
					heroAlt = titulo;
					await logWarning(url, `imagem destacada sem alt; usando o título do post como fallback # ${unwrapProxy(heroSrc)}`);
				}
				const sources = [
					...(heroSrc ? [{ src: heroSrc, alt: heroAlt || titulo, hero: true }] : []),
					...collectImages(withAlts.html),
				];
				const { map, heroPath } = await downloadImages(sources, sourceUrl, slug);
				markdown = rewriteInternalLinks(rewriteMarkdownImages(markdown, map));
				const body = buildPostFrontmatter(
					{
						url: publicUrl,
						titulo,
						seoTitle: data.title,
						description: description || titulo,
						pubDate,
						updatedDate: toIsoDate(data.updatedDate),
						category,
						tags: Array.isArray(data.tags) ? data.tags : [],
						heroAlt: heroAlt || titulo,
					},
					heroPath,
				);
				await writeIfAllowed(file, `${body}${markdown}\n`);
			} else {
				const file = path.join(ROOT, 'src', 'content', 'paginas', `${fileSlug(slug)}.md`);
				const frontmatter = `---\ntitle: ${yamlString(titulo)}\ndescription: ${yamlString(description || titulo)}\n---\n\n`;
				await writeIfAllowed(file, `${frontmatter}${markdown}\n`);
			}
		} catch (error) {
			await logError(url, error);
		}
	}

	if (apply) {
		try {
			await writeTaxonomyFile('categorias.json', categorias);
			await writeTaxonomyFile('tags.json', tags);
			if (!only.length) await writeCategoryRedirects(categorias);
		} catch (error) {
			await logError('src/content/categorias.json', error);
		}
	}

	await browser.close();
	const byType = inventory.reduce((counts, item) => {
		counts[item.tipo] = (counts[item.tipo] || 0) + 1;
		return counts;
	}, {});
	console.log(`inventário: ${inventory.length} URLs`, byType);
	console.log(apply ? 'modo apply' : 'modo dry-run');
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
	main().catch(async (error) => {
		console.error(error);
		try {
			await logError('extract-site', error);
		} catch {
			/* sem log */
		}
		process.exitCode = 1;
	});
}
