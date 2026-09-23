/**
 * Conferência somente leitura: cada URL de _extract/inventory.json
 * e cada pilar precisa existir em dist/ ou ser redirecionada para uma página que existe.
 */
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(await readFile(path.join(root, '_extract/inventory.json'), 'utf8'));
const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));

const pilarSlugs = ['banheiro', 'cozinha', 'quarto', 'sala', 'descompressao', 'dormir-bem', 'skincare-de-noite'];
const urls = [
	...inventory.map((item) => item.url),
	...pilarSlugs.map((slug) => `https://irenes.com.br/pilar/${slug}`),
];

function distFile(pathname) {
	const clean = pathname.endsWith('/') ? pathname : `${pathname}/`;
	if (clean === '/') return path.join(root, 'dist/index.html');
	return path.join(root, 'dist', clean.slice(1), 'index.html');
}

async function exists(file) {
	try {
		await access(file);
		return true;
	} catch {
		return false;
	}
}

function redirectDestination(url) {
	const categoria = url.searchParams.get('categoria');
	if (!categoria) return null;
	const rule = (vercel.redirects || []).find(
		(item) => item.source === '/' && (item.has || []).some((has) => has.key === 'categoria'),
	);
	if (!rule) return null;
	return rule.destination.replace(':valor', categoria);
}

const missing = [];
for (const raw of urls) {
	const url = new URL(raw);
	const redirected = redirectDestination(url);
	const pathname = redirected || (url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`);
	const file = distFile(pathname);
	if (!(await exists(file))) {
		missing.push(`${raw} → ${pathname}`);
	}
}

if (missing.length) {
	console.log(`sem destino: ${missing.length}`);
	for (const line of missing) console.log(line);
	process.exitCode = 1;
} else {
	console.log(`ok ${urls.length} URLs com destino em dist/`);
}
