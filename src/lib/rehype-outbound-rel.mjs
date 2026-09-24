/**
 * Aplica rel de src/data/outbound-rel.json nos links externos do corpo.
 * Links internos não são alterados.
 * target="_blank" em link externo ganha noopener.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'outbound-rel.json');

function readMap() {
	try {
		const parsed = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}

function isExternal(href) {
	if (!/^https?:\/\//i.test(href)) return false;
	try {
		return new URL(href).hostname.replace(/^www\./, '').toLowerCase() !== 'irenes.com.br';
	} catch {
		return false;
	}
}

function relTokens(value) {
	if (!value) return [];
	const parts = Array.isArray(value) ? value : [value];
	return parts.flatMap((item) => String(item).split(/\s+/)).filter(Boolean);
}

function walk(node, map) {
	if (!node || typeof node !== 'object') return;
	if (node.type === 'element' && node.tagName === 'a') {
		const href = node.properties?.href;
		if (typeof href === 'string' && isExternal(href)) {
			const tokens = new Set(relTokens(node.properties.rel));
			if (Object.prototype.hasOwnProperty.call(map, href)) {
				const mapped = map[href];
				if (mapped !== '' && mapped !== 'sponsored' && mapped !== 'nofollow') {
					throw new Error(`rel inválido em outbound-rel.json para ${href}`);
				}
				tokens.delete('sponsored');
				tokens.delete('nofollow');
				if (mapped) tokens.add(mapped);
			}
			const target = node.properties.target;
			const blank = target === '_blank' || (Array.isArray(target) && target.includes('_blank'));
			if (blank) tokens.add('noopener');
			if (tokens.size) node.properties.rel = [...tokens];
			else delete node.properties.rel;
		}
	}
	if (Array.isArray(node.children)) {
		for (const child of node.children) walk(child, map);
	}
}

export default function rehypeOutboundRel() {
	const map = readMap();
	return (tree) => walk(tree, map);
}
