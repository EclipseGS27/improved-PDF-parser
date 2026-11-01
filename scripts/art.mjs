/**
 * Which pictures are creature art, and whose. No Foundry code here.
 *
 * The books show a creature two ways:
 * - the entry's illustration: a big picture on the page that opens the entry (often with a transparent
 *   background), shared by every profile in it (the parts of a Chimera, the forms of a boss);
 * - a portrait: a small picture beside a profile's name, when an entry has several profiles.
 * Everything else is decoration: page backgrounds and borders, chapter art repeated on many pages, masks and
 * slivers of art bleeding over from the facing page.
 */

const area = (i) => i.w * i.h;

/** A picture's signature, to spot decoration that repeats through the book */
const sig = (i) => `${i.px?.width ?? 0}x${i.px?.height ?? 0}|${Math.round(i.w)}x${Math.round(i.h)}`;

/**
 * Sort a book's pictures into decoration, portraits and illustrations.
 * @param {Array} pages from readPages (with images)
 */
export function classifyImages(pages) {
	const seen = new Map();
	for (const p of pages) for (const sg of new Set(p.images.map(sig))) seen.set(sg, (seen.get(sg) ?? 0) + 1);
	const out = [];
	for (const p of pages) {
		const pageArea = p.width * p.height;
		const names = new Set();
		for (const img of p.images) {
			// the same picture drawn twice on a page (a shadow copy, a mask pass)
			if (names.has(img.name)) continue;
			names.add(img.name);
			const px = img.px;
			let kind = 'art';
			if (!px || !px.width || !px.height) kind = 'skip';
			// 1-bit pictures are masks and stencils
			else if (px.kind === 1) kind = 'skip';
			// slivers of art bleeding in from the facing page, rules and borders
			else if (img.w < 24 || img.h < 24) kind = 'skip';
			// art that repeats through the book is decoration: page backgrounds, chapter art (full-page creature art
			// is unique, so it stays; small portraits can share a size)
			else if ((seen.get(sig(img)) ?? 0) > 3 && area(img) > pageArea * 0.08) kind = 'skip';
			else if (area(img) >= pageArea * 0.12) kind = 'illustration';
			else if (img.w <= 140 && img.h <= 140 && px.width >= 48) kind = 'portrait';
			else kind = 'other';
			// art placed entirely off the page shows on the facing page: count it there (but read it from here)
			let page = p.n;
			let x = img.x;
			if (img.x >= p.width - 2) {
				page += 1;
				x -= p.width;
			} else if (img.x + img.w <= 2) {
				page -= 1;
				x += p.width;
			}
			out.push({ ...img, x, page, srcPage: p.n, kind, pageW: p.width, pageH: p.height });
		}
	}
	return out;
}

/**
 * Art that runs across a two-page spread is drawn as two pictures: most of it on one page, the rest on the facing
 * page, at the same height. Pair them, so the importer can stitch them back into one picture.
 */
function spreads(images) {
	const all = images.filter((i) => i.kind !== 'skip' || (i.px?.kind !== 1 && i.w >= 6 && i.w < 60));
	for (const a of images.filter((i) => i.kind === 'illustration' || i.kind === 'other')) {
		if (a.x + a.w < a.pageW - 4) continue;
		const b = all.find((i) => i.page === a.page + 1 && i.x <= 4 && Math.abs(i.y - a.y) < 3 && Math.abs(i.h - a.h) < 3 && i !== a);
		if (!b) continue;
		a.spread = { right: b, width: Math.max(a.w, a.pageW + b.x + b.w - a.x) };
		b.partOf = a;
		if (a.kind === 'other' && (a.w + b.w) * a.h >= a.pageW * a.pageH * 0.12) a.kind = 'illustration';
	}
	// pictures that start on the right page with a sliver on the left one
	for (const b of images.filter((i) => i.kind === 'illustration' || i.kind === 'other')) {
		if (b.x > 4 || b.partOf) continue;
		const a = all.find((i) => i.page === b.page - 1 && i.x + i.w >= i.pageW - 4 && Math.abs(i.y - b.y) < 3 && Math.abs(i.h - b.h) < 3 && !i.spread && i !== b);
		if (!a) continue;
		b.spreadLeft = a;
		a.partOf = b;
	}
}

/** Entry titles: the big heading that opens each entry, by page */
function titlePages(pages) {
	const out = [];
	for (const p of pages) for (const l of p.lines) if (l.size >= 20 && /^[A-Z0-9][A-Z0-9 ’'\-,.&/]{2,}$/.test(l.text) && l.text.length < 40) out.push({ page: p.n, title: l.text });
	return out;
}

/**
 * Give each stat block its art: { portrait, illustration } (picture records from classifyImages, or null).
 * The illustration is the biggest picture of the creature's entry: from the page with the entry's title to the
 * page after the profile, without reaching into the next entry.
 * @param {Array} blocks from parseStatBlocks
 * @param {Array} images from classifyImages
 * @param {Array} [pages] the pages, for entry titles
 */
export function assignArt(blocks, images, pages = []) {
	spreads(images);
	const titles = titlePages(pages);
	const illustrations = images.filter((i) => i.kind === 'illustration' && !i.partOf);
	const portraits = images.filter((i) => i.kind === 'portrait');
	const used = new Set();
	const size = (i) => (i.spread ? i.spread.width : i.w) * i.h;
	// a narrow strip is a piece of something bigger: only when there is nothing else
	const strip = (i) => !i.spread && (i.w / i.h < 0.3 || i.h / i.w < 0.3);
	for (const b of blocks) {
		// a portrait sits beside the name: left of it, its top near the name's line
		const near = portraits
			.filter((i) => i.page === b.page && !used.has(`${i.page}|${i.name}`) && i.x < b.left + 10 && i.y + i.h > b.top - 40 && i.y < b.top + 30)
			.sort((p, q) => Math.abs(p.y + p.h - b.top) - Math.abs(q.y + q.h - b.top));
		// two profiles with the same name side by side (a Gashadokuro's two arms) share a portrait
		const twin = !near[0] && blocks.find((o) => o !== b && o.page === b.page && o.name === b.name && o.art?.portrait);
		b.art = { portrait: near[0] ?? twin?.art.portrait ?? null, illustration: null };
		if (near[0]) used.add(`${near[0].page}|${near[0].name}`);
		const open = [...titles].reverse().find((t) => t.page <= b.page && t.page >= b.page - 10);
		const next = titles.find((t) => t.page > b.page);
		const from = open ? open.page : b.page - 6;
		const to = Math.min(b.page + 1, next ? next.page - 1 : b.page + 1);
		const best = (list) => best1(list.filter((i) => !strip(i))) ?? best1(list);
		const best1 = (list) => [...list].sort((p, q) => size(q) - size(p))[0] ?? null;
		// the entry's own pages first; the facing page after the profile only when they have nothing
		b.art.illustration = best(illustrations.filter((i) => i.page >= from && i.page <= b.page)) ?? best(illustrations.filter((i) => i.page > b.page && i.page <= to));
		b.entry = open?.title ?? '';
	}
	return blocks;
}
