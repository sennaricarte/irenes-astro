/**
 * Falha o build se um link externo do corpo não estiver em src/data/outbound-rel.json.
 * Valor "" (editorial) conta como mapeado. Links de irenes.com.br não entram.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postsDir = path.join(root, 'src/content/posts');
const mapPath = path.join(root, 'src/data/outbound-rel.json');

function isExternal(href) {
	if (!/^https?:\/\//i.test(href)) return false;
	try {
		return new URL(href).hostname.replace(/^www\./, '').toLowerCase() !== 'irenes.com.br';
	} catch {
		return false;
	}
}

function externalHrefs(body) {
	const hrefs = [];
	const markdown = /(?<!!)\[(?:\\.|[^\]])*\]\(\s*(https?:\/\/[^)\s]+)/g;
	const html = /<a\b[^>]*\shref=["'](https?:\/\/[^"']+)["']/gi;
	for (const match of body.matchAll(markdown)) hrefs.push(match[1]);
	for (const match of body.matchAll(html)) hrefs.push(match[1]);
	return hrefs.filter(isExternal);
}

const map = JSON.parse(readFileSync(mapPath, 'utf8'));
const missing = [];

for (const file of readdirSync(postsDir)) {
	if (!file.endsWith('.md')) continue;
	const slug = file.slice(0, -3);
	const { content } = matter(readFileSync(path.join(postsDir, file), 'utf8'));
	for (const href of externalHrefs(content)) {
		if (!Object.prototype.hasOwnProperty.call(map, href)) missing.push(`${slug}: ${href}`);
	}
}

if (missing.length) {
	console.error('Links externos sem entrada em src/data/outbound-rel.json:');
	for (const line of missing) console.error(`- ${line}`);
	process.exit(1);
}

console.log(`links externos ok (${Object.keys(map).length} no mapa)`);
