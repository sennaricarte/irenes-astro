/**
 * Busca 5 fotos no Pexels para cada post ainda sem capa.
 * Lê PEXELS_API_KEY do .env. Não escolhe nenhuma imagem.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const slugs = [
	'entupimento-em-apartamento-responsabilidade-como-resolver',
	'desentupidora-especializada-quando-chamar',
	'emergencia-hidraulica-em-casa-guia-primeiras-horas',
	'sifao-entupido-mau-cheiro-como-limpar',
];

async function apiKey() {
	if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
	const raw = await readFile('.env', 'utf8');
	const line = raw.split(/\r?\n/).find((item) => item.startsWith('PEXELS_API_KEY='));
	return line?.slice('PEXELS_API_KEY='.length).trim().replace(/^["']|["']$/g, '') || '';
}

const key = await apiKey().catch(() => '');
if (!key) {
	console.error('PEXELS_API_KEY ausente no .env');
	process.exit(1);
}

function queryFromTitle(title) {
	return title
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

for (const slug of slugs) {
	const markdown = await readFile(path.join('src/content/posts', `${slug}.md`), 'utf8');
	if (/^heroImage:/m.test(markdown)) {
		console.log(`capa já existe ${slug}`);
		continue;
	}
	const title = markdown.match(/^title:\s*"([^"]+)"/m)?.[1] || slug;
	const query = queryFromTitle(title);
	const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5`, {
		headers: { Authorization: key },
	});
	if (!response.ok) {
		console.error(`${slug}: HTTP ${response.status}`);
		process.exitCode = 1;
		continue;
	}
	const data = await response.json();
	const photos = (data.photos || []).slice(0, 5);
	const dir = path.join('_extract/candidates', slug);
	await mkdir(dir, { recursive: true });
	const cards = [];
	for (const photo of photos) {
		const file = `${photo.id}.jpg`;
		const image = await fetch(photo.src.tiny || photo.src.small);
		await writeFile(path.join(dir, file), Buffer.from(await image.arrayBuffer()));
		cards.push({ file, photographer: photo.photographer, id: photo.id, alt: photo.alt || '' });
		console.log(slug, file, photo.photographer);
	}
	const figures = cards
		.map(
			(card) => `<figure>
  <img src="${card.file}" alt="${card.alt.replace(/"/g, '&quot;')}">
  <figcaption>${card.file} — Fotógrafo: ${card.photographer} — id ${card.id}</figcaption>
</figure>`,
		)
		.join('\n');
	await writeFile(
		path.join(dir, 'index.html'),
		`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Candidatas — ${title.replace(/</g, '')}</title>
<style>
body { font-family: sans-serif; margin: 2rem; background: #fafafa; color: #262626; }
figure { display: inline-block; width: 220px; margin: 0 1rem 1rem 0; vertical-align: top; }
img { width: 100%; height: auto; }
figcaption { font-size: 0.85rem; margin-top: 0.4rem; }
</style>
</head>
<body>
<h1>${title.replace(/</g, '')}</h1>
<p>Query: ${query.replace(/</g, '')}</p>
${figures}
</body>
</html>
`,
		'utf8',
	);
}
