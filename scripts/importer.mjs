import { readPages } from './layout.mjs';
import { parseStatBlocks } from './parse.mjs';
import { assignArt, classifyImages } from './art.mjs';
import { nthPicture, picturePixels } from './pixels.mjs';
import { npcData } from './actor.mjs';

export const MODULE_ID = 'fu-pdf-importer';
const { ApplicationV2 } = foundry.applications.api;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'art';

let PDFJS = null;
/** pdf.js, shipped with the module */
async function pdfjs() {
	if (PDFJS) return PDFJS;
	PDFJS = await import(`/modules/${MODULE_ID}/lib/pdf.min.mjs`);
	PDFJS.GlobalWorkerOptions.workerSrc = `/modules/${MODULE_ID}/lib/pdf.worker.min.mjs`;
	return PDFJS;
}

/** The book, from the PDF's title or its first pages */
function guessBook(meta, pages, fileName) {
	const text = `${meta?.info?.Title ?? ''} ${pages.slice(0, 4).flatMap((p) => p.lines.map((l) => l.text)).join(' ')} ${fileName}`.toUpperCase();
	if (/TECHNO\s+FANTASY/.test(text)) return 'Techno Fantasy Atlas';
	if (/NATURAL\s+FANTASY/.test(text)) return 'Natural Fantasy Atlas';
	if (/HIGH\s+FANTASY/.test(text)) return 'High Fantasy Atlas';
	if (/BESTIARY/.test(text)) return 'Bestiary';
	if (/CORE\s+RULE/.test(text) || /FABULA ULTIMA/.test(text)) return 'Core Rulebook';
	return String(meta?.info?.Title || fileName.replace(/\.pdf$/i, '') || 'Imported book');
}

/* ------------------------------------------------------------------ */
/*  Pictures: pixels from the PDF, cropped, saved as WebP                 */
/* ------------------------------------------------------------------ */

async function drawPart(doc, img) {
	const page = await doc.getPage(img.srcPage ?? img.page);
	const ops = await page.getOperatorList();
	const name = nthPicture(ops, PDFJS.OPS, img.index) ?? img.name;
	const px = await picturePixels(page, name);
	if (!px) return null;
	const c = document.createElement('canvas');
	c.width = px.width;
	c.height = px.height;
	const ctx = c.getContext('2d');
	if (px.bitmap) ctx.drawImage(px.bitmap, 0, 0);
	else ctx.putImageData(new ImageData(px.rgba, px.width, px.height), 0, 0);
	return c;
}

/** Cut away fully see-through edges */
function trim(canvas) {
	const ctx = canvas.getContext('2d');
	const { width: w, height: h } = canvas;
	const d = ctx.getImageData(0, 0, w, h).data;
	let x0 = w;
	let y0 = h;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if (d[(y * w + x) * 4 + 3] > 8) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
	if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) return canvas;
	const pad = 4;
	const out = document.createElement('canvas');
	out.width = Math.min(w, x1 - x0 + 1 + pad * 2);
	out.height = Math.min(h, y1 - y0 + 1 + pad * 2);
	out.getContext('2d').drawImage(canvas, Math.max(0, x0 - pad), Math.max(0, y0 - pad), out.width, out.height, 0, 0, out.width, out.height);
	return out;
}

/** A picture, with the other half of a two-page spread put back beside it */
async function pictureCanvas(doc, img) {
	const main = await drawPart(doc, img);
	if (!main) return null;
	const other = img.spread?.right ?? img.spreadLeft ?? null;
	if (!other) return trim(main);
	const part = await drawPart(doc, other);
	// the same picture drawn on both pages: keep the one already read
	if (!part || part.width >= main.width * 0.9) return trim(main);
	const k = main.width / img.w;
	const left = img.spread ? img : other;
	const right = img.spread ? other : img;
	const lc = img.spread ? main : part;
	const rc = img.spread ? part : main;
	let rx = Math.round((left.pageW - left.x + right.x) * k);
	// art cut off at the left half's edge carries straight on in the right half: when the right half starts with
	// empty columns, close that gap so the two meet
	const lastOpaque = (cv, col) => {
		const d = cv.getContext('2d').getImageData(col, 0, 1, cv.height).data;
		let n = 0;
		for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
		return n;
	};
	if (lastOpaque(lc, lc.width - 1) > 4) {
		let lead = 0;
		while (lead < rc.width * 0.3 && lastOpaque(rc, lead) === 0) lead++;
		const overlap = lc.width - rx;
		if (lead > Math.max(0, overlap)) rx -= lead - Math.max(0, overlap);
	}
	const c = document.createElement('canvas');
	c.width = Math.max(lc.width, rx + rc.width);
	c.height = Math.max(lc.height, rc.height);
	const ctx = c.getContext('2d');
	ctx.drawImage(lc, 0, 0);
	ctx.drawImage(rc, rx, Math.round((left.y + left.h - (right.y + right.h)) * k));
	return trim(c);
}

async function ensureDir(path) {
	const FP = foundry.applications.apps.FilePicker.implementation;
	let acc = '';
	for (const part of path.split('/').filter(Boolean)) {
		acc = acc ? `${acc}/${part}` : part;
		try {
			await FP.createDirectory('data', acc, {});
		} catch {
			/* already there */
		}
	}
}

async function save(canvas, dir, name) {
	const FP = foundry.applications.apps.FilePicker.implementation;
	const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.9));
	if (!blob) return null;
	const file = new File([blob], `${name}.webp`, { type: 'image/webp' });
	const res = await FP.upload('data', dir, file, {}, { notify: false });
	return res?.path ?? `${dir}/${name}.webp`;
}

/* ------------------------------------------------------------------ */
/*  The window                                                         */
/* ------------------------------------------------------------------ */

export class PdfImporter extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: 'fu-pdf-importer',
		classes: ['fupdf-app'],
		window: { title: 'Import Fabula Ultima creatures from a PDF', icon: 'fa-solid fa-file-pdf', resizable: true },
		position: { width: 760, height: 720 },
	};

	static open() {
		if (!game.user.isGM) return ui.notifications.warn('Only the GM can import creatures.');
		return (foundry.applications.instances.get('fu-pdf-importer') ?? new PdfImporter()).render({ force: true });
	}

	state = { step: 'pick', progress: 0, total: 0, note: '' };
	opts = { folder: '', artDir: '', token: 'portrait', update: true, extras: false };

	async _renderHTML() {
		const s = this.state;
		const div = document.createElement('div');
		div.className = 'fupdf';
		if (s.step === 'pick') {
			div.innerHTML = `
				<p class="lead">Pick a Fabula Ultima PDF you own: the Core Rulebook, the Bestiary or an Atlas. Every stat block becomes a Project FU NPC with its attacks, spells, other actions and special rules, and every creature gets its art: the entry's illustration as its portrait, and the small picture beside its profile (or the illustration) as its token.</p>
				<label class="drop"><i class="fa-solid fa-file-pdf"></i><span>Choose a PDF…</span><input type="file" accept="application/pdf,.pdf" data-file></label>
				<p class="note">The PDF is read in your browser; nothing leaves your computer except the art, saved to your Foundry data folder.</p>`;
		} else if (s.step === 'reading' || s.step === 'importing') {
			const pct = s.total ? Math.round((s.progress / s.total) * 100) : 0;
			div.innerHTML = `<div class="busy"><b>${s.step === 'reading' ? 'Reading the book' : 'Importing'}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${esc(s.note)}</small></div>`;
		} else if (s.step === 'review') {
			const blocks = this.blocks ?? [];
			const sel = blocks.filter((b) => b.sel).length;
			const withArt = blocks.filter((b) => b.art?.illustration || b.art?.portrait).length;
			const issues = blocks.filter((b) => b.issues?.length).length;
			div.innerHTML = `
				<header class="sum"><b>${esc(this.book)}</b><span>${blocks.length} stat blocks · ${withArt} with art · ${issues} with notes · ${this.extraArt?.length ?? 0} other illustrations</span></header>
				<div class="opts">
					<label><span>Actor folder</span><input type="text" data-o="folder" value="${esc(this.opts.folder)}"></label>
					<label><span>Save art to</span><input type="text" data-o="artDir" value="${esc(this.opts.artDir)}"></label>
					<label><span>Token art</span><select data-o="token"><option value="portrait" ${this.opts.token === 'portrait' ? 'selected' : ''}>The small portrait (else the illustration)</option><option value="illustration" ${this.opts.token === 'illustration' ? 'selected' : ''}>The illustration</option></select></label>
					<label class="chk"><input type="checkbox" data-o="update" ${this.opts.update ? 'checked' : ''}> Update creatures already imported to that folder</label>
					<label class="chk"><input type="checkbox" data-o="extras" ${this.opts.extras ? 'checked' : ''}> Also save every other illustration in the book (${this.extraArt?.length ?? 0})</label>
				</div>
				<div class="tools"><input type="search" placeholder="Filter…" data-filter><button type="button" data-act="all">All</button><button type="button" data-act="none">None</button></div>
				<div class="list">${blocks
					.map(
						(b, i) => `<label class="row ${b.issues?.length ? 'warn' : ''}" data-i="${i}" data-q="${esc(`${b.name} ${b.species} ${b.entry ?? ''}`.toLowerCase())}">
						<input type="checkbox" data-sel="${i}" ${b.sel ? 'checked' : ''}>
						<span class="nm"><b>${esc(b.name)}</b><small>${esc(b.entry && b.entry.toLowerCase() !== b.name.toLowerCase() ? `${b.entry} · ` : '')}Lv ${b.level} · ${esc(b.species)} · ${esc(b.rank === 'champion' ? `champion ${b.replaced}` : b.rank)}${b.role ? ` · ${esc(b.role)}` : ''}${b.villain ? ` · ${esc(b.villain)} villain` : ''}</small></span>
						<span class="ct">${b.attacks.length} att · ${b.spells.length} sp · ${b.actions.length + b.rules.length} rules</span>
						<span class="art">${b.art?.illustration ? '<i class="fa-solid fa-image" data-tooltip="Illustration"></i>' : ''}${b.art?.portrait ? '<i class="fa-solid fa-user" data-tooltip="Portrait"></i>' : ''}</span>
						${b.issues?.length ? `<i class="fa-solid fa-triangle-exclamation" data-tooltip="${esc(b.issues.join(' '))}"></i>` : '<span></span>'}
					</label>`,
					)
					.join('')}</div>
				<footer><span class="sp">${sel} selected</span><button type="button" data-act="back">Another PDF</button><button type="button" class="go" data-act="import" ${sel ? '' : 'disabled'}><i class="fa-solid fa-download"></i> Import ${sel}</button></footer>`;
		} else if (s.step === 'done') {
			div.innerHTML = `<div class="busy"><b>Done</b><p>${esc(s.note)}</p><button type="button" data-act="back">Import another PDF</button></div>`;
		}
		return div;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
	}

	_onRender() {
		const root = this.element;
		root.querySelector('[data-file]')?.addEventListener('change', (ev) => {
			const f = ev.target.files?.[0];
			if (f) this.#read(f);
		});
		root.querySelectorAll('[data-o]').forEach((el) => el.addEventListener('change', () => (this.opts[el.dataset.o] = el.type === 'checkbox' ? el.checked : el.value)));
		root.querySelectorAll('[data-sel]').forEach((el) =>
			el.addEventListener('change', () => {
				this.blocks[Number(el.dataset.sel)].sel = el.checked;
				this.#count();
			}),
		);
		root.querySelector('[data-filter]')?.addEventListener('input', (ev) => {
			const q = ev.target.value.trim().toLowerCase();
			for (const r of root.querySelectorAll('.row')) r.hidden = !!q && !r.dataset.q.includes(q);
		});
		root.querySelectorAll('[data-act]').forEach((el) =>
			el.addEventListener('click', () => {
				const act = el.dataset.act;
				if (act === 'back') {
					this.state = { step: 'pick', progress: 0, total: 0, note: '' };
					return this.render();
				}
				if (act === 'all' || act === 'none') {
					for (const r of root.querySelectorAll('.row')) if (!r.hidden) this.blocks[Number(r.dataset.i)].sel = act === 'all';
					return this.render();
				}
				if (act === 'import') return this.#import();
			}),
		);
	}

	#count() {
		const n = this.blocks.filter((b) => b.sel).length;
		const sp = this.element.querySelector('footer .sp');
		if (sp) sp.textContent = `${n} selected`;
		const go = this.element.querySelector('[data-act="import"]');
		if (go) {
			go.disabled = !n;
			go.innerHTML = `<i class="fa-solid fa-download"></i> Import ${n}`;
		}
	}

	#progress(step, progress, total, note) {
		this.state = { step, progress, total, note };
		const bar = this.element?.querySelector('.bar i');
		const small = this.element?.querySelector('.busy small');
		if (bar && this.state.step === step) {
			bar.style.width = `${total ? Math.round((progress / total) * 100) : 0}%`;
			if (small) small.textContent = note;
		} else this.render();
	}

	async #read(file) {
		try {
			this.bytes = new Uint8Array(await file.arrayBuffer());
			this.fileName = file.name;
			const lib = await pdfjs();
			const doc = await lib.getDocument({ data: this.bytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
			this.#progress('reading', 0, doc.numPages, 'Opening…');
			await this.render();
			const pages = await readPages(lib, doc, { onPage: (n, total) => this.#progress('reading', n, total, `Page ${n} of ${total}`) });
			const meta = await doc.getMetadata().catch(() => null);
			this.book = guessBook(meta, pages, file.name);
			const images = classifyImages(pages);
			this.blocks = assignArt(parseStatBlocks(pages), images, pages).map((b) => ({ ...b, sel: true }));
			// illustrations no creature uses: the book's other art, saved on request
			const used = new Set(this.blocks.flatMap((b) => [b.art.illustration, b.art.portrait].filter(Boolean).map((i) => `${i.srcPage}|${i.name}`)));
			// (banners, logos and ornaments are long and thin: left out)
			this.extraArt = images.filter((i) => i.kind === 'illustration' && !i.partOf && !used.has(`${i.srcPage}|${i.name}`) && i.w / i.h < 2.4 && i.h / i.w < 2.4);
			this.opts.folder = this.book;
			this.opts.artDir = `fu-pdf-art/${slug(this.book)}`;
			doc.destroy();
			if (!this.blocks.length) ui.notifications.warn('No Fabula Ultima stat blocks were found in this PDF.');
			this.state = { step: 'review', progress: 0, total: 0, note: '' };
			this.render();
		} catch (err) {
			console.error(`${MODULE_ID} | reading the PDF`, err);
			ui.notifications.error(`Could not read that PDF: ${err.message}`);
			this.state = { step: 'pick', progress: 0, total: 0, note: '' };
			this.render();
		}
	}

	async #import() {
		const list = this.blocks.filter((b) => b.sel);
		if (!list.length) return;
		const lib = await pdfjs();
		// a fresh copy of the document: its pictures are read again page by page
		const doc = await lib.getDocument({ data: this.bytes.slice(), disableFontFace: true, verbosity: 0 }).promise;
		const total = list.length + (this.opts.extras ? this.extraArt.length : 0);
		this.#progress('importing', 0, total, 'Preparing…');
		await this.render();
		const dir = this.opts.artDir.replace(/^\/+|\/+$/g, '');
		await ensureDir(dir);
		let folder = game.folders.find((f) => f.type === 'Actor' && f.name === this.opts.folder);
		folder ??= await Folder.create({ name: this.opts.folder || this.book, type: 'Actor', color: '#5a3a8a' });
		const saved = new Map();
		const art = async (img, name) => {
			if (!img) return null;
			const key = `${img.srcPage}|${img.name}`;
			if (saved.has(key)) return saved.get(key);
			let path = null;
			try {
				const canvas = await pictureCanvas(doc, img);
				if (canvas) path = await save(canvas, dir, name);
			} catch (err) {
				console.warn(`${MODULE_ID} | art ${name}`, err);
			}
			saved.set(key, path);
			return path;
		};
		let made = 0;
		let updated = 0;
		let skipped = 0;
		for (const [i, b] of list.entries()) {
			this.#progress('importing', i, total, `${b.name} (${i + 1} of ${list.length})`);
			const base = slug(`${b.name}-${b.level}`);
			const ill = await art(b.art.illustration, `${slug(b.entry || b.name)}-p${b.art.illustration?.page ?? 0}`);
			const por = await art(b.art.portrait, `${base}-portrait`);
			const img = ill ?? por;
			const token = this.opts.token === 'portrait' ? (por ?? ill) : (ill ?? por);
			const data = npcData(b, { book: this.book, img, token, folder: folder.id });
			const existing = game.actors.find((a) => a.folder?.id === folder.id && a.name === b.name && a.system?.level?.value === b.level);
			if (existing) {
				if (!this.opts.update) {
					skipped++;
					continue;
				}
				// the role is left as it is: changing it makes Project FU recalculate the Attributes
				const { role, ...system } = data.system;
				await existing.deleteEmbeddedDocuments('Item', existing.items.map((it) => it.id));
				await existing.update({ img: data.img, system, prototypeToken: data.prototypeToken });
				await existing.createEmbeddedDocuments('Item', data.items);
				updated++;
			} else {
				await Actor.implementation.create(data);
				made++;
			}
		}
		let extras = 0;
		if (this.opts.extras) {
			await ensureDir(`${dir}/other`);
			for (const [i, img] of this.extraArt.entries()) {
				this.#progress('importing', list.length + i, total, `Other art ${i + 1} of ${this.extraArt.length}`);
				try {
					const canvas = await pictureCanvas(doc, img);
					if (canvas && (await save(canvas, `${dir}/other`, `page-${img.page}-${i + 1}`))) extras++;
				} catch (err) {
					console.warn(`${MODULE_ID} | other art`, err);
				}
			}
		}
		doc.destroy();
		const note = `${made} created, ${updated} updated${skipped ? `, ${skipped} skipped (already there)` : ''} in “${folder.name}”. Art saved to ${dir}${extras ? `, plus ${extras} other illustrations in ${dir}/other` : ''}.`;
		ui.notifications.info(note);
		this.state = { step: 'done', progress: 0, total: 0, note };
		this.render();
	}
}
