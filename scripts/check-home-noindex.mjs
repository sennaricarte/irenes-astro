/**
 * Falha o build se src/data/home.json citar um post com noindex.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectSlugs(value, slugs) {
	if (typeof value === 'string') slugs.push(value);
	else if (Array.isArray(value)) value.forEach((item) => collectSlugs(item, slugs));
	else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectSlugs(item, slugs));
}

export function checkHomeNoindex() {
	const home = JSON.parse(readFileSync(path.join(root, 'src/data/home.json'), 'utf8'));
	const slugs = [];
	collectSlugs(home, slugs);
	const blocked = [];
	for (const slug of slugs) {
		const file = path.join(root, 'src/content/posts', `${slug}.md`);
		if (!existsSync(file)) continue;
		const { data } = matter(readFileSync(file, 'utf8'));
		if (data.noindex) blocked.push(slug);
	}
	if (blocked.length) {
		throw new Error(`home.json aponta posts com noindex: ${blocked.join(', ')}`);
	}
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
	try {
		checkHomeNoindex();
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}
}
