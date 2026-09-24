/**
 * Conferência somente leitura do site no ar.
 * Uso: node scripts/live-check.mjs https://irenes.com.br
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseArg = process.argv[2];
if (!baseArg) {
	console.error('Informe a URL base: node scripts/live-check.mjs https://irenes.com.br');
	process.exit(1);
}

const base = new URL(baseArg);
const inventory = JSON.parse(await readFile(path.join(root, '_extract/inventory.json'), 'utf8'));

function originalUrl(raw) {
	const url = new URL(raw);
	return new URL(`${url.pathname}${url.search}`, base).href;
}

const checks = [
	...inventory.map((item) => ({
		label: originalUrl(item.url),
		kind: 'inventario',
		expect: 'ok',
	})),
	{ label: new URL('/sitemap.xml', base).href, kind: 'extra', expect: 'sitemap' },
	{ label: new URL('/robots.txt', base).href, kind: 'extra', expect: 'direct-200' },
	{ label: new URL('/busca/?q=skincare', base).href, kind: 'extra', expect: 'direct-200' },
	{ label: new URL('/pagina-inexistente-live-check', base).href, kind: 'extra', expect: 'missing' },
];

async function request(url) {
	const response = await fetch(url, {
		redirect: 'manual',
		headers: { 'user-agent': 'irenes-live-check' },
		signal: AbortSignal.timeout(20000),
	});
	return { status: response.status, location: response.headers.get('location') };
}

async function trace(start) {
	const hops = [];
	let current = start;
	for (let salto = 0; salto <= 3; salto += 1) {
		const step = await request(current);
		hops.push({ url: current, status: step.status, location: step.location });
		const redirected = [301, 302, 307, 308].includes(step.status) && step.location;
		if (!redirected || salto === 3) break;
		current = new URL(step.location, current).href;
	}
	return hops;
}

function permanentChain(hops) {
	const redirects = hops.slice(0, -1);
	const last = hops.at(-1);
	return last?.status === 200 && redirects.length > 0 && redirects.length <= 2 && redirects.every((hop) => hop.status === 301 || hop.status === 308);
}

function verdict(check, hops) {
	const first = hops[0];
	const last = hops.at(-1);
	if (check.expect === 'direct-200') {
		return first.status === 200 && hops.length === 1 ? 'OK' : 'falha';
	}
	if (check.expect === 'missing') {
		const saw200 = hops.some((hop) => hop.status === 200);
		return !saw200 && last.status === 404 ? 'OK' : 'falha';
	}
	const locations = hops.map((hop) => hop.location).filter(Boolean).join(' ');
	const standard = (first.status === 200 && hops.length === 1) || permanentChain(hops);
	if (check.expect === 'sitemap') {
		return standard && locations.includes('sitemap-index.xml') ? 'OK' : 'falha';
	}
	return standard ? 'OK' : 'falha';
}

async function mapPool(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	async function run() {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await worker(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
	return results;
}

const rows = await mapPool(checks, 6, async (check) => {
	try {
		const hops = await trace(check.label);
		const first = hops[0];
		const last = hops.at(-1);
		return {
			...check,
			ok: verdict(check, hops) === 'OK',
			initial: first.status,
			location: first.location ?? '',
			saltos: Math.max(0, hops.length - 1),
			final: last.status,
			chain: hops.map((hop) => `${hop.status}${hop.location ? ` → ${hop.location}` : ''}`).join(' | '),
		};
	} catch (error) {
		return {
			...check,
			ok: false,
			initial: 'erro',
			location: '',
			saltos: 0,
			final: 'erro',
			chain: error instanceof Error ? error.message : String(error),
		};
	}
});

const inventoryRows = rows.filter((row) => row.kind === 'inventario');
const extraRows = rows.filter((row) => row.kind === 'extra');
const failures = rows.filter((row) => !row.ok);

function cell(value) {
	return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

const lines = [
	'# Live check',
	'',
	`Base: ${base.href}`,
	`Gerado em: ${new Date().toISOString()}`,
	'',
	'## Resumo',
	'',
	`- Inventário: ${inventoryRows.filter((row) => row.ok).length} OK, ${inventoryRows.filter((row) => !row.ok).length} falhas, ${inventoryRows.length} URLs`,
	`- Extras: ${extraRows.filter((row) => row.ok).length} OK, ${extraRows.filter((row) => !row.ok).length} falhas, ${extraRows.length} testes`,
	'',
	'## Extras',
	'',
	'| URL | Resultado | Status inicial | Location | Saltos | Status final |',
	'| --- | --- | --- | --- | --- | --- |',
	...extraRows.map(
		(row) => `| ${cell(row.label)} | ${row.ok ? 'OK' : 'falha'} | ${cell(row.initial)} | ${cell(row.location)} | ${row.saltos} | ${cell(row.final)} |`,
	),
	'',
	'## Falhas',
	'',
];

if (failures.length === 0) {
	lines.push('Nenhuma falha.');
} else {
	lines.push('| URL | Status inicial | Location | Saltos | Status final | Cadeia |');
	lines.push('| --- | --- | --- | --- | --- | --- |');
	for (const row of failures) {
		lines.push(`| ${cell(row.label)} | ${cell(row.initial)} | ${cell(row.location)} | ${row.saltos} | ${cell(row.final)} | ${cell(row.chain)} |`);
	}
}

lines.push('');
const report = path.join(root, '_extract/live-check.md');
await mkdir(path.dirname(report), { recursive: true });
await writeFile(report, lines.join('\n'));

console.log(lines.slice(0, 12).join('\n'));
console.log(`Relatório: ${report}`);
process.exit(failures.length === 0 ? 0 : 1);
