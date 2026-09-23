import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
	if (!site) throw new Error('Defina site em astro.config.mjs');
	const body = [`User-agent: *`, `Allow: /`, `Disallow: /busca/`, `Sitemap: ${new URL('sitemap-index.xml', site).href}`, ''].join('\n');
	return new Response(body, {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
};
