/**
 * Falha o build se um redirect do vercel.json apontar para post ou categoria inexistente
 * ou com noindex (redirect para noindex joga a autoridade fora).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { redirects } = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const categorias = JSON.parse(readFileSync(path.join(root, 'src/content/categorias.json'), 'utf8'));
const catMap = new Map(categorias.map((c) => [c.slug, c]));
const problemas = [];

for (const { source, destination } of redirects) {
	if (destination.includes(':')) continue; // destinos dinâmicos
	if (destination === '/' || destination.endsWith('.xml')) continue;
	const parts = destination.split('/').filter(Boolean);
	if (parts[0] === 'categoria') {
		const cat = catMap.get(parts[1]);
		if (!cat) problemas.push(`${source} -> ${destination}: categoria inexistente`);
		else if (cat.noindex) problemas.push(`${source} -> ${destination}: categoria com noindex`);
		continue;
	}
	const file = path.join(root, 'src/content/posts', `${parts[0]}.md`);
	if (!existsSync(file)) problemas.push(`${source} -> ${destination}: post inexistente`);
	else if (matter(readFileSync(file, 'utf8')).data.noindex === true) problemas.push(`${source} -> ${destination}: post com noindex`);
}

if (problemas.length) {
	console.error('Redirects inválidos:\n' + problemas.map((p) => `- ${p}`).join('\n'));
	process.exit(1);
}
console.log(`redirects ok (${redirects.length})`);
