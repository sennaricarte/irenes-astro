// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.dirname(fileURLToPath(import.meta.url));

function blockedPaths() {
	const blocked = new Set(['/busca/', '/404/', '/404.html']);
	const categorias = JSON.parse(fs.readFileSync(path.join(root, 'src/content/categorias.json'), 'utf8'));
	for (const item of categorias) {
		if (item.noindex) blocked.add(`/categoria/${item.slug}/`);
	}
	const tags = JSON.parse(fs.readFileSync(path.join(root, 'src/content/tags.json'), 'utf8'));
	for (const item of tags) {
		if (item.noindex) blocked.add(`/tag/${item.slug}/`);
	}
	const pilaresDir = path.join(root, 'src/content/pilares');
	if (fs.existsSync(pilaresDir)) {
		for (const file of fs.readdirSync(pilaresDir)) {
			if (!file.endsWith('.md')) continue;
			const { data } = matter(fs.readFileSync(path.join(pilaresDir, file), 'utf8'));
			if (data.noindex) blocked.add(`/pilar/${file.slice(0, -3)}/`);
		}
	}
	return blocked;
}

function postLastmods() {
	const lastmods = new Map();
	const postsDir = path.join(root, 'src/content/posts');
	for (const file of fs.readdirSync(postsDir)) {
		if (!file.endsWith('.md')) continue;
		const { data } = matter(fs.readFileSync(path.join(postsDir, file), 'utf8'));
		const source = data.updatedDate ?? data.pubDate;
		const date = source instanceof Date ? source : new Date(source);
		if (Number.isNaN(date.getTime())) continue;
		lastmods.set(`/${file.slice(0, -3)}/`, date.toISOString());
	}
	return lastmods;
}

const blocked = blockedPaths();
const postLastmod = postLastmods();

// https://astro.build/config
export default defineConfig({
	site: 'https://irenes.com.br',
	output: 'static',
	trailingSlash: 'always',
	build: {
		inlineStylesheets: 'always',
	},
	integrations: [
		sitemap({
			filter(page) {
				const pathname = new URL(page).pathname;
				const withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
				return !blocked.has(pathname) && !blocked.has(withSlash);
			},
			serialize(item) {
				const pathname = new URL(item.url).pathname;
				const withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`;
				const lastmod = postLastmod.get(withSlash);
				if (!lastmod) {
					const copy = { ...item };
					delete copy.lastmod;
					return copy;
				}
				return { ...item, lastmod };
			},
		}),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
