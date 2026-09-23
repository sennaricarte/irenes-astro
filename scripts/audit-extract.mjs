/**
 * Auditoria somente leitura do conteúdo extraído.
 * Lê src/content e _extract/inventory.json e grava _extract/audit.md.
 */
import { readdir, readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');
const PAGES_DIR = path.join(ROOT, 'src', 'content', 'paginas');
const INVENTORY_PATH = path.join(ROOT, '_extract', 'inventory.json');
const AUDIT_PATH = path.join(ROOT, '_extract', 'audit.md');

function fileSlug(slug) {
	return String(slug || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

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
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { frontmatter: '', body: markdown };
	return { frontmatter: match[1], body: match[2] };
}

function field(frontmatter, key) {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
	if (!match) return null;
	const raw = match[1].trim();
	if (!raw) return '';
	try {
		return JSON.parse(raw);
	} catch {
		return raw.replace(/^['"]|['"]$/g, '');
	}
}

function listField(frontmatter, key) {
	const inline = frontmatter.match(new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, 'm'));
	if (inline) {
		if (!inline[1].trim()) return [];
		return inline[1]
			.split(',')
			.map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
			.filter(Boolean);
	}
	const lines = frontmatter.split(/\r?\n/);
	const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
	if (start < 0) return [];
	const items = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const match = lines[index].match(/^\s+-\s+(.*)$/);
		if (!match) break;
		const value = match[1].trim().replace(/^['"]|['"]$/g, '');
		if (value) items.push(value);
	}
	return items;
}

function wordCount(body) {
	const text = body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_\\[\]]/g, ' ');
	return text.split(/\s+/).filter(Boolean).length;
}

function h2Count(body) {
	return [...body.matchAll(/^##\s+\S/gm)].length;
}

function markdownImages(body) {
	return [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((match) => ({
		alt: match[1],
		src: match[2],
	}));
}

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

function linkTarget(href) {
	if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return null;
	if (/^https?:\/\//i.test(href) && !/^https?:\/\/(?:www\.)?irenes\.com\.br\b/i.test(href)) return null;
	let url;
	try {
		url = new URL(href, 'https://irenes.com.br');
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

function categoryGroup(url) {
	if (url.includes('/tag/')) return '/tag/';
	if (/[?&]categoria=/.test(url)) return '?categoria=';
	try {
		const pathname = new URL(url).pathname;
		if (pathname === '/categoria' || pathname.startsWith('/categoria/')) return '/categoria/';
	} catch {
		/* ignora */
	}
	return 'outras';
}

function excerpt(value) {
	return value.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function classifyEscape(body, index, token) {
	if (token === '\\_') {
		const before = body[index - 1] || '';
		const after = body[index + 2] || '';
		const insideWord = /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after);
		return insideWord ? 'unnecessary' : 'ambiguous';
	}
	if (token === '\\[') {
		const rest = body.slice(index);
		return /^\\\[[\s\S]{0,240}?\\\]\(/.test(rest) ? 'ambiguous' : 'unnecessary';
	}
	const prev = body.slice(Math.max(0, index - 2), index);
	const next = body.slice(index + 2, index + 4);
	return prev.endsWith('\\*') || next.startsWith('\\*') ? 'ambiguous' : 'unnecessary';
}

async function readJsonArray(file) {
	try {
		const parsed = JSON.parse(await readFile(file, 'utf8'));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function countRows(defined, counts) {
	const slugs = [...defined.map((item) => item.slug), ...counts.keys()];
	const unique = [...new Set(slugs)];
	return unique.map((slug) => `| \`${slug}\` | ${counts.get(slug) || 0} |`);
}

async function main() {
	const inventory = JSON.parse(await readFile(INVENTORY_PATH, 'utf8'));
	const posts = inventory.filter((item) => item.tipo === 'post');
	const pages = inventory.filter((item) => item.tipo === 'pagina');
	const categories = inventory.filter((item) => item.tipo === 'categoria');
	const known = new Set(inventory.map((item) => item.slug));

	const postFiles = await listMarkdown(POSTS_DIR);
	const pageFiles = await listMarkdown(PAGES_DIR);
	const postNames = new Set(postFiles.map((file) => path.basename(file)));
	const pageNames = new Set(pageFiles.map((file) => path.basename(file)));

	const missingPosts = posts.filter((item) => !postNames.has(`${fileSlug(item.slug)}.md`));
	const missingPages = pages.filter((item) => !pageNames.has(`${fileSlug(item.slug)}.md`));
	const expectedPosts = new Set(posts.map((item) => `${fileSlug(item.slug)}.md`));
	const expectedPages = new Set(pages.map((item) => `${fileSlug(item.slug)}.md`));
	const extraPosts = [...postNames].filter((name) => !expectedPosts.has(name));
	const extraPages = [...pageNames].filter((name) => !expectedPages.has(name));

	const postReports = [];
	const missingImages = [];
	const brokenLinks = [];
	const withoutDate = [];
	const withoutDescription = [];
	const longDescription = [];
	const rawHtml = [];
	const unnecessaryEscapes = [];
	const ambiguousEscapes = [];
	const byCategory = new Map();
	const byTag = new Map();
	const categoryMismatches = [];
	const categoriasJson = await readJsonArray(path.join(ROOT, 'src', 'content', 'categorias.json'));
	const tagsJson = await readJsonArray(path.join(ROOT, 'src', 'content', 'tags.json'));
	const categorySlugs = new Set(categoriasJson.map((item) => item.slug));

	for (const file of [...postFiles, ...pageFiles]) {
		const markdown = await readFile(file, 'utf8');
		const { frontmatter, body } = splitFrontmatter(markdown);
		const relative = path.relative(ROOT, file);
		const isPost = file.startsWith(POSTS_DIR);
		const images = markdownImages(body);
		const hero = field(frontmatter, 'heroImage');
		const refs = [...images.map((image) => image.src), ...(hero ? [String(hero)] : [])];

		for (const src of refs) {
			if (/^https?:\/\//i.test(src)) {
				missingImages.push({ file: relative, src });
				continue;
			}
			const absolute = path.resolve(path.dirname(file), src.split('#')[0].split('?')[0]);
			if (!(await exists(absolute))) missingImages.push({ file: relative, src });
		}

		for (const match of body.matchAll(/(?<!!)\[([^\[\]]*)\]\(([^)\s]+)\)/g)) {
			const target = linkTarget(match[2]);
			if (target && !known.has(target)) {
				brokenLinks.push({ file: relative, href: match[2], slug: target, text: match[1] });
			}
		}

		for (const match of body.matchAll(/<\/?[a-z][^>\n]{0,80}>/gi)) {
			rawHtml.push({ file: relative, sample: excerpt(match[0]) });
		}
		for (const match of body.matchAll(/\\[*_\[]/g)) {
			const at = match.index ?? 0;
			const sample = { file: relative, sample: excerpt(body.slice(Math.max(0, at - 30), at + 30)) };
			if (classifyEscape(body, at, match[0]) === 'unnecessary') unnecessaryEscapes.push(sample);
			else ambiguousEscapes.push(sample);
		}

		if (!isPost) continue;
		const description = field(frontmatter, 'description');
		const pubDate = field(frontmatter, 'pubDate');
		if (!pubDate) withoutDate.push(relative);
		if (description == null || String(description).trim() === '') withoutDescription.push(relative);
		else if (String(description).length > 160) {
			longDescription.push({ file: relative, length: String(description).length, description: String(description) });
		}
		const category = String(field(frontmatter, 'category') || '');
		if (category) byCategory.set(category, (byCategory.get(category) || 0) + 1);
		if (category && categorySlugs.size && !categorySlugs.has(category)) categoryMismatches.push({ file: relative, category });
		for (const tag of listField(frontmatter, 'tags')) {
			byTag.set(tag, (byTag.get(tag) || 0) + 1);
		}
		postReports.push({
			file: relative,
			words: wordCount(body),
			h2: h2Count(body),
			images: images.length + (hero ? 1 : 0),
		});
	}

	const groups = { '/tag/': [], '?categoria=': [], '/categoria/': [], outras: [] };
	for (const item of categories) groups[categoryGroup(item.url)].push(item);

	const lines = [
		'# Auditoria da extração',
		'',
		'## Arquivos e inventário',
		'',
		`- Posts no inventário: ${posts.length}`,
		`- Markdown em \`src/content/posts\`: ${postFiles.length}`,
		`- Páginas no inventário: ${pages.length}`,
		`- Markdown em \`src/content/paginas\`: ${pageFiles.length}`,
		'',
		'### Posts faltantes',
		'',
		...(missingPosts.length ? missingPosts.map((item) => `- \`${item.slug}\` — ${item.url}`) : ['- Nenhum.']),
		'',
		'### Páginas faltantes',
		'',
		...(missingPages.length ? missingPages.map((item) => `- \`${item.slug}\` — ${item.url}`) : ['- Nenhum.']),
		'',
		'### Markdown sem entrada no inventário',
		'',
		...([...extraPosts, ...extraPages].length
			? [...extraPosts, ...extraPages].map((name) => `- \`${name}\``)
			: ['- Nenhum.']),
		'',
		'## Posts',
		'',
		'| Arquivo | Palavras | H2 | Imagens |',
		'| --- | ---: | ---: | ---: |',
		...postReports.map((item) => `| \`${item.file}\` | ${item.words} | ${item.h2} | ${item.images} |`),
		'',
		'## Imagens referenciadas que não existem no disco',
		'',
		...(missingImages.length
			? missingImages.map((item) => `- \`${item.file}\` → \`${item.src}\``)
			: ['- Nenhuma.']),
		'',
		'## Links internos para slugs ausentes no inventário',
		'',
		...(brokenLinks.length
			? brokenLinks.map((item) => `- \`${item.file}\`: [${item.text}](${item.href}) → \`${item.slug}\``)
			: ['- Nenhum.']),
		'',
		'## Datas e descriptions',
		'',
		'### Sem pubDate',
		'',
		...(withoutDate.length ? withoutDate.map((file) => `- \`${file}\``) : ['- Nenhum.']),
		'',
		'### Sem description',
		'',
		...(withoutDescription.length ? withoutDescription.map((file) => `- \`${file}\``) : ['- Nenhum.']),
		'',
		'### Description com mais de 160 caracteres',
		'',
		...(longDescription.length
			? longDescription.map((item) => `- \`${item.file}\` (${item.length}): ${item.description}`)
			: ['- Nenhuma.']),
		'',
		'## HTML cru ou escapes do Turndown',
		'',
		`Ocorrências de HTML: ${rawHtml.length}. Escapes desnecessários (\`_\` dentro de palavra, \`*\` ou \`[\` isolados): ${unnecessaryEscapes.length}. Escapes ambíguos preservados (ênfase ou \`[\` de link): ${ambiguousEscapes.length}.`,
		'',
		...(rawHtml.length ? rawHtml.slice(0, 40).map((item) => `- \`${item.file}\`: \`${item.sample}\``) : ['- Sem HTML cru.']),
		...(unnecessaryEscapes.length
			? unnecessaryEscapes.slice(0, 40).map((item) => `- desnecessário \`${item.file}\`: \`${item.sample}\``)
			: ['- Sem escapes desnecessários.']),
		'',
		'## Categorias no inventário',
		'',
		`Total: ${categories.length}.`,
		'',
	];

	for (const group of ['/tag/', '?categoria=', '/categoria/', 'outras']) {
		lines.push(`### ${group} (${groups[group].length})`, '');
		lines.push(...(groups[group].length ? groups[group].map((item) => `- ${item.url} — \`${item.slug}\``) : ['- Nenhuma.']), '');
	}

	lines.push(
		'## Posts por categoria',
		'',
		'| Categoria | Posts |',
		'| --- | ---: |',
		...(countRows(categoriasJson, byCategory).length ? countRows(categoriasJson, byCategory) : ['| — | 0 |']),
		'',
		...(categoryMismatches.length
			? ['Categorias de post sem slug em `categorias.json`:', '', ...categoryMismatches.map((item) => `- \`${item.file}\` → \`${item.category}\``), '']
			: ['Todos os posts usam um slug presente em `categorias.json`.', '']),
		'## Posts por tag',
		'',
		'| Tag | Posts |',
		'| --- | ---: |',
		...(countRows(tagsJson, byTag).length ? countRows(tagsJson, byTag) : ['| — | 0 |']),
		'',
	);

	await mkdir(path.dirname(AUDIT_PATH), { recursive: true });
	await writeFile(AUDIT_PATH, `${lines.join('\n')}\n`, 'utf8');
	console.log(`auditoria gravada em ${path.relative(ROOT, AUDIT_PATH)}`);
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
