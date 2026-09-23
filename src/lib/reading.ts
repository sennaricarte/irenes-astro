/** Minutos de leitura. 220 palavras/min: com 200 o guia de skincare ficava em 11; o original mostra 10. */
export const READING_WORDS_PER_MINUTE = 220;

export function readingMinutes(markdown: string, wordsPerMinute = READING_WORDS_PER_MINUTE) {
	const text = markdown
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[#>*_~`|]/g, ' ');
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.ceil(words / wordsPerMinute));
}
