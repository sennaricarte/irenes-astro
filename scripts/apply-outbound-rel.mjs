/**
 * Lê _extract/outbound-classificar.csv e grava src/data/outbound-rel.json.
 * Dry-run por padrão. Grava só com --apply.
 *
 * tipo:
 *   pago → sponsored
 *   editorial → ""
 *   rede → nofollow
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = path.join(root, '_extract', 'outbound-classificar.csv');
const JSON_PATH = path.join(root, 'src', 'data', 'outbound-rel.json');
const apply = process.argv.includes('--apply');

function parseCsv(text) {
	const rows = [];
	let row = [];
	let cell = '';
	let quoted = false;
	const source = text.replace(/^\uFEFF/, '');
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (quoted) {
			if (char === '"') {
				if (source[index + 1] === '"') {
					cell += '"';
					index += 1;
				} else quoted = false;
			} else cell += char;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === ',') {
			row.push(cell);
			cell = '';
		} else if (char === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else if (char !== '\r') cell += char;
	}
	if (cell.length || row.length) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((item) => item.some((value) => value.trim()));
}

function column(header, name) {
	return header.findIndex((item) => item.trim().toLowerCase() === name);
}

const table = parseCsv(await readFile(CSV_PATH, 'utf8'));
const header = table[0].map((item) => item.trim().toLowerCase());
const urlCol = column(header, 'url');
const tipoCol = column(header, 'tipo');
if (urlCol < 0 || tipoCol < 0) throw new Error('CSV precisa das colunas url e tipo');

const next = {};
const counts = { pago: 0, editorial: 0, rede: 0, semTipo: 0 };
const seen = new Map();

for (const row of table.slice(1)) {
	const url = (row[urlCol] || '').trim();
	const tipo = (row[tipoCol] || '').trim().toLowerCase();
	if (!url) continue;
	if (!tipo) {
		counts.semTipo += 1;
		continue;
	}
	let rel;
	let bucket;
	if (tipo === 'pago') {
		rel = 'sponsored';
		bucket = 'pago';
	} else if (tipo === 'editorial') {
		rel = '';
		bucket = 'editorial';
	} else if (tipo === 'rede') {
		rel = 'nofollow';
		bucket = 'rede';
	} else {
		throw new Error(`tipo inválido em ${url}: ${tipo}`);
	}
	if (seen.has(url) && seen.get(url) !== rel) {
		throw new Error(`URL com classificação divergente: ${url}`);
	}
	if (!seen.has(url)) counts[bucket] += 1;
	seen.set(url, rel);
	next[url] = rel;
}

const ordered = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
console.log(`${apply ? 'gravado' : 'dry-run'}: ${Object.keys(ordered).length} URLs`);
console.log(`pago → sponsored: ${counts.pago}`);
console.log(`rede → nofollow: ${counts.rede}`);
console.log(`editorial → vazio: ${counts.editorial}`);
console.log(`sem tipo (ignoradas): ${counts.semTipo}`);

if (apply) {
	await writeFile(JSON_PATH, `${JSON.stringify(ordered, null, '\t')}\n`, 'utf8');
}
