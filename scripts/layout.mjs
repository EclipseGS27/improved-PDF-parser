/**
 * Reading a PDF page into lines and pictures with pdf.js. No Foundry code here, so the same reader runs in the
 * importer and in tests.
 *
 * A page becomes:
 * - lines: text items grouped by height on the page, left to right, each with its tokens (text, font, size, x)
 *   and its plain text. Page furniture is dropped: rotated side tabs, the watermark, page numbers.
 * - images: every picture drawn on the page, with where it sits (PDF points, origin bottom left) and its size in
 *   pixels, so the importer can tell creature art from decoration.
 */

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Text items on a page as tokens, without duplicates (some PDFs draw each glyph run twice for a bold effect) */
function tokensOf(items, styles, height, width) {
	const seen = new Set();
	const out = [];
	for (const it of items) {
		const s = it.str;
		if (!s || !s.trim()) continue;
		const [a, b, c, d, x, y] = it.transform;
		// rotated text: side tabs ("CHAPTER 3", "COMPENDIUM")
		if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) continue;
		const size = Math.hypot(a, b);
		if (size < 5) continue;
		// the purchaser watermark at the very bottom, and page numbers
		if (y < 40 || /Order #\d+/.test(s)) continue;
		// the outer margins: chapter tabs ("CHAPTER", a big chapter number, "COMPENDIUM"), corner glyphs
		const margin = x < 42 || x > width - 46;
		if (margin && s.trim().length <= 14 && (/^(CHAPTER|COMPENDIUM|W|\d{1,3})$/i.test(s.trim()) || size > 18)) continue;
		const key = `${Math.round(x)}|${Math.round(y)}|${s}`;
		if (seen.has(key)) continue;
		seen.add(key);
		// some books separate profile fields with a dash glyph instead of a bullet: read both as a bullet
		const str = /^\s*[-–—]\s*$/.test(s) ? '•' : s;
		out.push({ str, x, y, w: it.width, size, font: it.fontName, family: styles?.[it.fontName]?.fontFamily ?? '' });
	}
	return out;
}

/** Tokens grouped into lines: same height (icons sit a point lower or higher), then left to right */
function linesOf(tokens) {
	const sorted = [...tokens].sort((p, q) => q.y - p.y || p.x - q.x);
	const lines = [];
	for (const t of sorted) {
		const line = lines.find((l) => Math.abs(l.y - t.y) <= Math.max(2.2, t.size * 0.28) && t.x > l.minX - 400);
		if (line) {
			line.tokens.push(t);
			line.minX = Math.min(line.minX, t.x);
		} else lines.push({ y: t.y, minX: t.x, tokens: [t] });
	}
	for (const l of lines) {
		l.tokens.sort((p, q) => p.x - q.x);
		let text = '';
		let end = null;
		for (const t of l.tokens) {
			if (end !== null && t.x - end > t.size * 0.12 && !/\s$/.test(text) && !/^\s/.test(t.str)) text += ' ';
			text += t.str;
			end = t.x + (t.w || t.str.length * t.size * 0.5);
		}
		l.text = text.replace(/\s+/g, ' ').trim();
		l.x = l.tokens[0].x;
		l.size = Math.max(...l.tokens.map((t) => t.size));
	}
	return lines.sort((p, q) => q.y - p.y);
}

/** Every picture drawn on a page, with its box in page space */
async function imagesOf(page, OPS) {
	const ops = await page.getOperatorList();
	let ctm = [1, 0, 0, 1, 0, 0];
	const stack = [];
	const out = [];
	// pdf.js names pictures by the order it met them, which changes with what else was read on the page first:
	// the drawing order (the nth picture painted) is what stays the same
	let order = 0;
	for (let i = 0; i < ops.fnArray.length; i++) {
		const fn = ops.fnArray[i];
		const args = ops.argsArray[i];
		if (fn === OPS.save) stack.push(ctm);
		else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
		else if (fn === OPS.transform) ctm = mul(ctm, args);
		else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
			const name = args[0];
			if (typeof name !== 'string') continue;
			const index = order++;
			const w = Math.hypot(ctm[0], ctm[1]);
			const h = Math.hypot(ctm[2], ctm[3]);
			// the box's lower left corner, whichever way the image is flipped
			const x = Math.min(ctm[4], ctm[4] + ctm[0] + ctm[2]);
			const y = Math.min(ctm[5], ctm[5] + ctm[1] + ctm[3]);
			let px = null;
			try {
				const obj = page.objs.has(name) ? page.objs.get(name) : page.commonObjs.has(name) ? page.commonObjs.get(name) : null;
				if (obj) px = { width: obj.width, height: obj.height, kind: obj.kind ?? null, hasData: !!(obj.data || obj.bitmap) };
			} catch {
				px = null;
			}
			out.push({ name, index, x, y, w, h, px });
		}
	}
	return out;
}

/**
 * Read every page (or a range) of a PDF document.
 * @param {object} pdfjs the pdf.js library (its OPS table is read from it)
 * @param {object} doc a pdf.js document
 * @param {{from?:number, to?:number, images?:boolean, onPage?:(n:number, total:number)=>void}} [opts]
 */
export async function readPages(pdfjs, doc, { from = 1, to = doc.numPages, images = true, onPage = null } = {}) {
	const pages = [];
	for (let n = from; n <= to; n++) {
		const page = await doc.getPage(n);
		const vp = page.getViewport({ scale: 1 });
		const tc = await page.getTextContent();
		const lines = linesOf(tokensOf(tc.items, tc.styles, vp.height, vp.width));
		const imgs = images ? await imagesOf(page, pdfjs.OPS) : [];
		pages.push({ n, width: vp.width, height: vp.height, lines, images: imgs });
		page.cleanup?.();
		onPage?.(n, to);
	}
	return pages;
}
