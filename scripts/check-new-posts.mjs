/**
 * Valida posts novos (sem originalUrl) antes do build.
 * Falha se a categoria ou alguma tag não existir, se a description
 * passar de 160 caracteres, ou se heroImage apontar para um arquivo ausente.
 */
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postsDir = path.join(root, 'src/content/posts');
const DESCRIPTION_MAX = 160;

const categories = new Set(
	JSON.parse(await readFile(path.join(root, 'src/content/categorias.json'), 'utf8')).map((item) => item.slug),
);
const tags = new Set(
	JSON.parse(await readFile(path.join(root, 'src/content/tags.json'), 'utf8')).map((item) => item.slug),
);

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

const failures = [];
let checked = 0;

for (const file of await readdir(postsDir)) {
	if (!file.endsWith('.md')) continue;
	const slug = file.slice(0, -3);
	const mdPath = path.join(postsDir, file);
	const { data } = matter(await readFile(mdPath, 'utf8'));
	const original = typeof data.originalUrl === 'string' ? data.originalUrl.trim() : '';
	if (original) continue;
	checked += 1;

	const category = typeof data.category === 'string' ? data.category : '';
	if (!categories.has(category)) {
		failures.push(`${slug}: category "${category}" não existe em categorias.json`);
	}

	const postTags = Array.isArray(data.tags) ? data.tags : [];
	for (const tag of postTags) {
		if (!tags.has(tag)) failures.push(`${slug}: tag "${tag}" não existe em tags.json`);
	}

	const description = typeof data.description === 'string' ? data.description : '';
	if (description.length > DESCRIPTION_MAX) {
		failures.push(`${slug}: description tem ${description.length} caracteres (máximo ${DESCRIPTION_MAX})`);
	}

	if (typeof data.heroImage === 'string' && data.heroImage.trim()) {
		const target = path.resolve(path.dirname(mdPath), data.heroImage);
		if (!(await exists(target))) {
			failures.push(`${slug}: heroImage não encontrado (${data.heroImage})`);
		}
	}
}

if (failures.length) {
	console.error('Posts novos inválidos:');
	for (const line of failures) console.error(`- ${line}`);
	process.exit(1);
}

console.log(`posts novos ok (${checked})`);
