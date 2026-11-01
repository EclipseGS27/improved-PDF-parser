/**
 * A parsed stat block (parse.mjs) as a Project FU NPC: the numbers the book prints, set through the system's
 * own formulas so the sheet shows exactly them.
 *
 * Project FU derives an NPC's numbers:
 *   HP   = (MIG × 5 + level × 2 + HP bonus) × replaced soldiers (elite 2, champion X)
 *   MP   = (WLP × 5 + level + MP bonus) × (2 for champions)
 *   Init = (DEX + INS) / 2 + Init bonus + (elite 2, champion X)
 *   DEF  = DEX + DEF bonus, M.DEF = INS + M.DEF bonus
 * so each bonus is worked back from the printed number. Attacks and spells keep their printed Accuracy and
 * damage on the item, with the NPC's own level bonuses at 0, so nothing is counted twice.
 */

const AFF = { VU: -1, RS: 1, IM: 2, AB: 3 };
const ULTIMA = { minor: 5, major: 10, supreme: 15 };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Text as paragraphs, with the book's in-text bullet lists as lists */
export function html(text) {
	const parts = String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
	if (!parts.length) return '';
	const out = [];
	let list = [];
	const flush = () => {
		if (list.length) out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
		list = [];
	};
	for (const p of parts) {
		if (/^[•·]\s*/.test(p)) list.push(p.replace(/^[•·]\s*/, ''));
		else {
			flush();
			out.push(`<p>${esc(p)}</p>`);
		}
	}
	flush();
	return out.join('');
}

/** "Up to three creatures" -> how Project FU targets it */
function targeting(text) {
	const t = String(text ?? '').toLowerCase();
	if (/^self\b/.test(t)) return { rule: 'self', max: 0 };
	const n = { one: 1, two: 2, three: 3, four: 4, five: 5 };
	const up = t.match(/up to (one|two|three|four|five|\d)/);
	if (up) return { rule: 'multiple', max: Number(n[up[1]] ?? up[1]) || 3 };
	if (/^one\b/.test(t)) return { rule: 'single', max: 1 };
	return { rule: 'special', max: 0 };
}

const mult = (b) => (b.rank === 'champion' ? Math.max(2, b.replaced || 2) : b.rank === 'elite' ? 2 : 1);

/**
 * @param {object} b a stat block
 * @param {{book?:string, img?:string|null, token?:string|null, folder?:string|null}} [opts]
 */
export function npcData(b, { book = '', img = null, token = null, folder = null } = {}) {
	const a = b.attrs ?? { dex: 8, ins: 8, mig: 8, wlp: 8 };
	const lv = b.level;
	const m = mult(b);
	const notes = [];
	// work the bonuses back from the printed numbers
	let hpBonus = 0;
	if (b.hp != null) {
		hpBonus = b.hp / m - (a.mig * 5 + lv * 2);
		if (!Number.isInteger(hpBonus)) {
			notes.push(`The book prints ${b.hp} HP; the sheet rounds it to the nearest value its formula allows.`);
			hpBonus = Math.round(hpBonus);
		}
	}
	const mpM = b.rank === 'champion' ? 2 : 1;
	let mpBonus = 0;
	if (b.mp != null) {
		mpBonus = b.mp / mpM - (a.wlp * 5 + lv);
		if (!Number.isInteger(mpBonus)) {
			notes.push(`The book prints ${b.mp} MP; the sheet rounds it to the nearest value its formula allows.`);
			mpBonus = Math.round(mpBonus);
		}
	}
	const rankInit = b.rank === 'soldier' ? 0 : m;
	const initBonus = b.init != null ? Math.round(b.init - (a.dex + a.ins) / 2 - rankInit) : 0;
	const defBonus = b.def ? (b.def.bonus ?? b.def.score - a.dex) : 0;
	const mdefBonus = b.mdef ? (b.mdef.bonus ?? b.mdef.score - a.ins) : 0;

	const desc = [];
	if (b.description) desc.push(html(b.description));
	if (b.approaches?.good) desc.push(`<p><strong>Advantageous approaches:</strong> ${esc(b.approaches.good)}</p>`);
	if (b.approaches?.bad) desc.push(`<p><strong>Disadvantageous approaches:</strong> ${esc(b.approaches.bad)}</p>`);
	if (b.equipment) desc.push(`<p><strong>Equipment:</strong> ${esc(b.equipment)}</p>`);
	if (b.tags?.length) desc.push(`<p><strong>Tags:</strong> ${esc(b.tags.join(', '))}</p>`);
	for (const n of [...(b.issues ?? []), ...notes]) desc.push(`<p><em>${esc(n)}</em></p>`);
	desc.push(`<p><small>Imported from ${esc(book)}${b.page ? `, PDF page ${b.page}` : ''}.</small></p>`);

	const system = {
		level: { value: lv },
		species: { value: b.species },
		rank: { value: b.rank, replacedSoldiers: m },
		role: { value: b.role || 'custom' },
		villain: { value: b.villain || '' },
		traits: { value: (b.traits ?? []).join(', ') },
		attributes: Object.fromEntries(['dex', 'ins', 'mig', 'wlp'].map((k) => [k, { base: a[k], current: a[k] }])),
		affinities: Object.fromEntries(['physical', 'air', 'bolt', 'dark', 'earth', 'fire', 'ice', 'light', 'poison'].map((t) => [t, { base: AFF[b.affinities?.[t]] ?? 0 }])),
		immunities: Object.fromEntries(['slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'].map((s) => [s, { base: (b.immunities ?? []).includes(s) }])),
		resources: { hp: { bonus: hpBonus, value: b.hp ?? undefined }, mp: { bonus: mpBonus, value: b.mp ?? undefined }, fp: { value: ULTIMA[b.villain] ?? 0 } },
		derived: { def: { bonus: defBonus }, mdef: { bonus: mdefBonus }, init: { bonus: initBonus } },
		bonuses: { accuracy: { accuracyCheck: 0, magicCheck: 0 }, damage: { melee: 0, ranged: 0, spell: 0 } },
		useEquipment: { value: !!b.equipment },
		description: desc.join(''),
	};
	if (system.resources.hp.value === undefined) delete system.resources.hp.value;
	if (system.resources.mp.value === undefined) delete system.resources.mp.value;

	const items = [];
	for (const at of b.attacks ?? []) {
		items.push({
			name: at.name,
			type: 'basic',
			img: at.range === 'ranged' ? 'icons/weapons/bows/shortbow-recurve.webp' : 'icons/skills/melee/strike-sword-slashing-red.webp',
			system: {
				attributes: { primary: { value: at.attrs[0] }, secondary: { value: at.attrs[1] } },
				accuracy: { value: at.accuracy ?? 0 },
				damage: { value: at.damage ?? 0 },
				hasDamage: !at.noDamage,
				type: { value: at.range },
				damageType: { value: at.type },
				defense: /targets? Magic Defense/i.test(at.effect ?? at.raw ?? '') ? 'mdef' : 'def',
				quality: { value: at.effect ?? '' },
			},
		});
	}
	for (const s of b.spells ?? []) {
		items.push({
			name: s.name,
			type: 'spell',
			img: 'icons/magic/symbols/runes-star-pentagon-blue.webp',
			system: {
				description: html(s.text),
				isOffensive: { value: !!s.offensive },
				duration: { value: s.duration },
				cost: { resource: 'mp', amount: String(s.mp ?? 0), perTarget: !!s.perTarget },
				targeting: targeting(s.target),
				hasRoll: { value: !!s.check },
				defense: 'mdef',
				rollInfo: {
					attributes: { primary: { value: s.check?.attrs?.[0] ?? 'ins' }, secondary: { value: s.check?.attrs?.[1] ?? 'wlp' } },
					accuracy: { value: s.check?.accuracy ?? 0 },
					damage: s.damage ? { hasDamage: { value: true }, value: s.damage.value, type: { value: s.damage.type } } : { hasDamage: { value: false }, value: 0, type: { value: 'physical' } },
				},
				summary: { value: s.target ? `${s.target}. ${s.duration === 'scene' ? 'Scene' : s.duration === 'instantaneous' ? 'Instantaneous' : 'Special'}.` : '' },
			},
		});
	}
	for (const x of b.actions ?? []) items.push({ name: x.name, type: 'miscAbility', img: 'icons/magic/control/buff-strength-muscle-damage-orange.webp', system: { description: html(x.text) } });
	for (const r of b.rules ?? []) items.push({ name: r.name, type: 'rule', img: 'icons/sundries/scrolls/scroll-runed-brown-purple.webp', system: { description: html(r.text) } });

	const data = {
		name: b.name,
		type: 'npc',
		img: img ?? 'icons/svg/mystery-man.svg',
		folder,
		system,
		items,
		prototypeToken: { name: b.name, disposition: -1, actorLink: false, texture: { src: token ?? img ?? 'icons/svg/mystery-man.svg' } },
		flags: { 'fu-pdf-importer': { book, page: b.page, entry: b.entry ?? '' } },
	};
	return data;
}
