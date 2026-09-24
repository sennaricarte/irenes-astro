import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { z } from 'astro/zod';

const taxonomySchema = () =>
	z.object({
		slug: z.string(),
		name: z.string(),
		description: z.string().optional(),
		familia: z.string().optional(),
		noindex: z.boolean().default(false),
		originalUrl: z.string(),
	});

const posts = defineCollection({
	loader: glob({ base: './src/content/posts', pattern: '**/*.md' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			seoTitle: z.string().optional(),
			description: z.string(),
			pubDate: z.coerce.date(),
			sortOrder: z.number().optional(),
			updatedDate: z.coerce.date().optional(),
			category: z.string(),
			tags: z.array(z.string()).default([]),
			heroImage: image().optional(),
			heroAlt: z.string(),
			originalUrl: z.string().optional(),
		}),
});

const categorias = defineCollection({
	loader: file('src/content/categorias.json'),
	schema: taxonomySchema(),
});

const tags = defineCollection({
	loader: file('src/content/tags.json'),
	schema: taxonomySchema(),
});

const pilares = defineCollection({
	loader: glob({ base: './src/content/pilares', pattern: '**/*.md' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		group: z.enum(['ambientes', 'rituais']),
		noindex: z.boolean().default(false),
		posts: z.array(z.string()).default([]),
	}),
});

const paginas = defineCollection({
	loader: glob({ base: './src/content/paginas', pattern: '**/*.md' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
	}),
});

export const collections = { posts, categorias, paginas, tags, pilares };
