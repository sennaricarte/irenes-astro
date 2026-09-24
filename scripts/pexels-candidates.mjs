/**
 * Busca 5 fotos no Pexels para um post. Não escolhe nenhuma imagem.
 *
 * Uso:
 *   node scripts/pexels-candidates.mjs --slug=<slug>
 *   node scripts/pexels-candidates.mjs --slug=<slug> --query="termos"
 *
 * Sem --query, os termos saem do title do frontmatter.
 * Grava miniaturas e index.html em _extract/candidates/<slug>/.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function arg(name) {
	const prefix = `--${name}=`;
	const hit = argv.find((item) => item.startsWith(prefix));
	return hit ? hit.slice(prefix.length).trim() : '';
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function queryFromTitle(title) {
	return title
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function apiKey() {
	if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
	const raw = await readFile(path.join(root, '.env'), 'utf8');
	const line = raw.split(/\r?\n/).find((item) => item.startsWith('PEXELS_API_KEY='));
	return line?.slice('PEXELS_API_KEY='.length).trim().replace(/^["']|["']$/g, '') || '';
}

const slug = arg('slug');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
	console.error('Informe --slug=<slug> com letras minúsculas, números e hífens.');
	process.exit(1);
}

const postPath = path.join(root, 'src/content/posts', `${slug}.md`);
let title = slug;
try {
	const parsed = matter(await readFile(postPath, 'utf8'));
	title = String(parsed.data.title || slug);
} catch {
	console.error(`Post não encontrado: src/content/posts/${slug}.md`);
	process.exit(1);
}

const query = arg('query') || queryFromTitle(title);
if (!query) {
	console.error('Sem --query e sem title no frontmatter para derivar a busca.');
	process.exit(1);
}

const key = await apiKey().catch(() => '');
if (!key) {
	console.error('PEXELS_API_KEY ausente no .env');
	process.exit(1);
}

const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5`, {
	headers: { Authorization: key },
});
if (!response.ok) {
	console.error(`${slug}: HTTP ${response.status}`);
	process.exit(1);
}

const data = await response.json();
const photos = (data.photos || []).slice(0, 5);
if (!photos.length) {
	console.error(`${slug}: nenhuma foto para "${query}"`);
	process.exit(1);
}

const dir = path.join(root, '_extract/candidates', slug);
await mkdir(dir, { recursive: true });
const cards = [];
for (const photo of photos) {
	const file = `${photo.id}.jpg`;
	const image = await fetch(photo.src.tiny || photo.src.small);
	if (!image.ok) {
		console.error(`${slug}: miniatura ${photo.id} HTTP ${image.status}`);
		process.exit(1);
	}
	await writeFile(path.join(dir, file), Buffer.from(await image.arrayBuffer()));
	const card = {
		file,
		photographer: photo.photographer || '',
		id: photo.id,
		width: photo.width || 0,
		height: photo.height || 0,
		alt: photo.alt || '',
	};
	cards.push(card);
	console.log(`${slug} id ${card.id} ${card.width}x${card.height} ${card.photographer}`);
}

const figures = cards
	.map(
		(card) => `<figure>
  <img src="${card.file}" alt="${escapeHtml(card.alt)}">
  <figcaption>id ${card.id} · Fotógrafo: ${escapeHtml(card.photographer)} · ${card.width}×${card.height}</figcaption>
</figure>`,
	)
	.join('\n');

await writeFile(
	path.join(dir, 'index.html'),
	`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Candidatas — ${escapeHtml(title)}</title>
<style>
body { font-family: sans-serif; margin: 2rem; background: #fafafa; color: #262626; }
figure { display: inline-block; width: 220px; margin: 0 1rem 1rem 0; vertical-align: top; }
img { width: 100%; height: auto; }
figcaption { font-size: 0.85rem; margin-top: 0.4rem; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>Query: ${escapeHtml(query)}</p>
<p>Escolha um id e aplique com scripts/apply-cover.mjs. Nenhuma capa foi escolhida.</p>
${figures}
</body>
</html>
`,
	'utf8',
);
console.log(`candidatas em _extract/candidates/${slug}/index.html`);
