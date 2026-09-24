import type { CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'posts'>;

export function comparePosts(a: Post, b: Post) {
	const byDate = b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
	if (byDate !== 0) return byDate;
	const byOrder = (a.data.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.data.sortOrder ?? Number.MAX_SAFE_INTEGER);
	if (byOrder !== 0) return byOrder;
	return a.id.localeCompare(b.id);
}

export function sortPosts<T extends Post>(posts: T[], options?: { indexableOnly?: boolean }) {
	const list = options?.indexableOnly ? posts.filter((post) => !post.data.noindex) : posts;
	return list.sort(comparePosts);
}
