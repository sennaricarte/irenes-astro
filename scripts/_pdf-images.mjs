import { readFile, writeFile, mkdir } from 'node:fs/promises';

const pdf = await readFile('c:/Users/blogo/Downloads/fullpage_snapshot_solverwp_com_2026-09-23-22-11-24.pdf');
await mkdir('_extract/solver', { recursive: true });

const hits = [];
for (let i = 0; i < pdf.length - 1; i += 1) {
	if (pdf[i] === 0xff && pdf[i + 1] === 0xd8) {
		const end = pdf.indexOf(Buffer.from([0xff, 0xd9]), i + 2);
		if (end > i) hits.push({ type: 'jpg', start: i, end: end + 2 });
		i = end > i ? end : i + 1;
	}
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
let from = 0;
while (from < pdf.length) {
	const start = pdf.indexOf(png, from);
	if (start < 0) break;
	const end = pdf.indexOf(Buffer.from('IEND'), start);
	if (end > start) hits.push({ type: 'png', start, end: end + 8 });
	from = start + 4;
}
hits.sort((a, b) => a.start - b.start);
console.log('images', hits.length);
let n = 0;
for (const hit of hits) {
	const buf = pdf.subarray(hit.start, hit.end);
	if (buf.length < 8000) continue;
	n += 1;
	const file = `_extract/solver/page-${n}.${hit.type === 'jpg' ? 'jpg' : 'png'}`;
	await writeFile(file, buf);
	console.log(file, buf.length);
}
