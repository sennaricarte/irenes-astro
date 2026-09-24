/**
 * Aplica uma foto do Pexels como capa de um post.
 *
 * Uso:
 *   node scripts/apply-cover.mjs --slug=<slug> --pexels-id=<id> --alt="<texto>"
 *   node scripts/apply-cover.mjs --slug=<slug> --pexels-id=<id> --alt="<texto>" --apply
 *
 * O padrão é dry-run. Só grava com --apply.
 * Atualiza apenas as linhas heroImage e heroAlt do frontmatter.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');

function arg(name) {
	const prefix = `--${name}=`;
	const hit = argv.find((item) => item.startsWith(prefix));
	return hit ? hit.slice(prefix.length).trim() : '';
}

async function apiKey() {
	if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY.trim();
	const raw = await readFile(path.join(root, '.env'), 'utf8');
	const line = raw.split(/\r?\n/).find((item) => item.startsWith('PEXELS_API_KEY='));
	return line?.slice('PEXELS_API_KEY='.length).trim().replace(/^["']|["']$/g, '') || '';
}

export function patchFrontmatter(raw, imageRel, alt) {
	if (!raw.startsWith('---')) throw new Error('frontmatter ausente');
	const nl = raw.includes('\r\n') ? '\r\n' : '\n';
	const end = raw.indexOf(`${nl}---`, 3);
	if (end < 0) throw new Error('frontmatter sem fechamento');
	let head = raw.slice(0, end);
	const rest = raw.slice(end);
	const imageLine = `heroImage: ${imageRel}`;
	const altLine = `heroAlt: ${JSON.stringify(alt)}`;

	function replaceLine(source, key, line) {
		const re = new RegExp(`^${key}:.*$`, 'm');
		if (!re.test(source)) return { source, found: false };
		return { source: source.replace(re, line), found: true };
	}

	const image = replaceLine(head, 'heroImage', imageLine);
	head = image.source;
	const altField = replaceLine(head, 'heroAlt', altLine);
	head = altField.source;
	if (!image.found || !altField.found) {
		const extra = [];
		if (!image.found) extra.push(imageLine);
		if (!altField.found) extra.push(altLine);
		if (!head.endsWith(nl)) head += nl;
		head += extra.join(nl);
	}
	return head + rest;
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (invoked) {
await run();
}

async function run() {
const slug = arg('slug');
const pexelsId = arg('pexels-id');
const alt = arg('alt');

if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
	console.error('Informe --slug=<slug> com letras minúsculas, números e hífens.');
	process.exit(1);
}
if (!/^\d+$/.test(pexelsId)) {
	console.error('Informe --pexels-id=<id> numérico.');
	process.exit(1);
}
if (!alt) {
	console.error('Informe --alt="<texto>".');
	process.exit(1);
}

const postRel = path.join('src/content/posts', `${slug}.md`);
const postPath = path.join(root, postRel);
const imageRel = `../../assets/posts/${slug}/capa.jpg`;
const imagePath = path.join(root, 'src/assets/posts', slug, 'capa.jpg');

let raw;
try {
	raw = await readFile(postPath, 'utf8');
} catch {
	console.error(`Post não encontrado: ${postRel}`);
	process.exit(1);
}

const key = await apiKey().catch(() => '');
if (!key) {
	console.error('PEXELS_API_KEY ausente no .env');
	process.exit(1);
}

const photoResponse = await fetch(`https://api.pexels.com/v1/photos/${pexelsId}`, {
	headers: { Authorization: key },
});
if (!photoResponse.ok) {
	console.error(`Pexels HTTP ${photoResponse.status} para a foto ${pexelsId}`);
	process.exit(1);
}
const photo = await photoResponse.json();
const original = photo?.src?.original;
if (!original) {
	console.error(`Foto ${pexelsId} sem URL original.`);
	process.exit(1);
}

const next = patchFrontmatter(raw, imageRel, alt);
const width = photo.width || '?';
const height = photo.height || '?';
console.log(`${apply ? 'apply' : 'dry-run'} ${slug}`);
console.log(`baixaria ${original} (${width}×${height}) para src/assets/posts/${slug}/capa.jpg`);
console.log(`heroImage: ${imageRel}`);
console.log(`heroAlt: ${JSON.stringify(alt)}`);
if (next === raw) console.log('frontmatter já está com esses valores');

if (!apply) {
	console.log('nada gravado (use --apply)');
	process.exit(0);
}

const imageResponse = await fetch(original);
if (!imageResponse.ok) {
	console.error(`Download HTTP ${imageResponse.status}`);
	process.exit(1);
}
const input = Buffer.from(await imageResponse.arrayBuffer());
const output = await sharp(input).rotate().resize({ width: 1600 }).jpeg({ quality: 82 }).toBuffer();
await mkdir(path.dirname(imagePath), { recursive: true });
await writeFile(imagePath, output);
if (next !== raw) await writeFile(postPath, next, 'utf8');
console.log(`gravou src/assets/posts/${slug}/capa.jpg (${output.length} bytes)`);
if (next !== raw) console.log(`atualizou ${postRel}`);
}
