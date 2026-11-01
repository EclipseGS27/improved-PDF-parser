/**
 * Fabula Ultima stat blocks, from the lines of PDF pages (layout.mjs), as plain data. Written for the Core
 * Rulebook, the Bestiary and the Atlases, which all print profiles the same way:
 *
 *   NAME                                   Lv 20 • MONSTER
 *   CHAMPION 2 • SUPPORT • PART            (rank, role and tags; the Core Rulebook leaves it out for soldiers)
 *   A sentence of description              (Core Rulebook)
 *   Traits: brutal, cunning, fiery.
 *   6 advantageous approaches.  7 disadvantageous approaches.   (Bestiary)
 *   DEX d8  INS d8  MIG d8  WLP d10  HP 200 • 100  MP 140  Init. 10
 *   DEF +0  M.DEF +0   p a B VU d e F IM I VU l t   (an icon per damage type; a capital icon has an Affinity)
 *   BASIC ATTACKS / SPELLS / OTHER ACTIONS / SPECIAL RULES / IMMUNITIES
 */

export const SPECIES = ['beast', 'construct', 'demon', 'elemental', 'humanoid', 'monster', 'plant', 'undead'];
export const DAMAGE = { p: 'physical', a: 'air', b: 'bolt', d: 'dark', e: 'earth', f: 'fire', i: 'ice', l: 'light', t: 'poison' };
export const STATUSES = ['slow', 'dazed', 'weak', 'shaken', 'enraged', 'poisoned'];
const ATTR = { DEX: 'dex', INS: 'ins', MIG: 'mig', WLP: 'wlp' };
const ROLES = ['brute', 'hunter', 'mage', 'saboteur', 'sentinel', 'support'];

const HEADER = new RegExp(`^(.+?)\\s+Lv\\.?\\s*(\\d+)\\s*[•·]\\s*(${SPECIES.join('|')})\\b`, 'i');
const RANK = /^(SOLDIER|ELITE|CHAMPION\s*\(?(\d)\)?|COMPANION)\b(.*)$/i;
const STATS = /DEX\s*d(\d+)\s*INS\s*d(\d+)\s*MIG\s*d(\d+)\s*WLP\s*d(\d+)\s*HP\s*(\d+)\s*[•·]?\s*(\d+)?\s*MP\s*(\d+)\s*Init\.?\s*(\d+)/i;
const DEFS = /DEF\s*([+\-−–]?\s*\d+)(?:\s*\/\s*([+\-−–]?\s*\d+))?\s*M\.?\s*DEF\s*([+\-−–]?\s*\d+)/i;
const SECTION = /^(BASIC ATTACKS|SPELLS|OTHER ACTIONS|SPECIAL RULES|IMMUNITIES|SKILLS)\b\s*(.*)$/;
const num = (s) => Number(String(s ?? '').replace(/[−–]/g, '-').replace(/\s+/g, '')) || 0;
const clean = (s) => String(s ?? '').replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/ +([.,;:)])/g, '$1').replace(/\( +/g, '(').trim();
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-(’'])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/** A line that opens an entry in a section: an icon, a name, then a bullet */
function entryStart(line, section, block) {
	const t = line.tokens;
	const text = line.text;
	const bullet = text.indexOf('•');
	if (bullet < 1 || bullet > 60) return null;
	// an icon first: a single character set apart from the name (attacks, spells, other actions)
	const iconFirst = t.length > 1 && t[0].str.trim().length === 1 && t[1].x - t[0].x > t[0].size * 0.6;
	const icon = iconFirst ? t[0].str.trim() : '';
	let head = clean(text.slice(iconFirst ? text.indexOf(t[0].str) + t[0].str.length : 0, bullet));
	// the name: a few words starting with a capital; for special rules it sits at the block's left edge
	if (!/^[A-Z0-9“"[(]/.test(head) || head.split(/\s+/).length > 8) return null;
	if (!iconFirst && section !== 'rules' && section !== 'actions' && section !== 'skills') return null;
	if (!iconFirst && block.indent != null && line.x > block.indent + 6) return null;
	let offensive = false;
	// spells mark offensive ones with an icon after the name
	const m = head.match(/^(.*?)\s+([OoÒ])$/);
	if (m && section === 'spells') {
		head = m[1];
		offensive = true;
	}
	return { icon, name: head, rest: clean(text.slice(bullet + 1)), offensive };
}

/** "(DEX + MIG) +2 • (HR + 10) fire damage. Then..." */
function parseAttack(e, level) {
	const r = e.rest;
	const m = r.match(/^\(\s*(DEX|INS|MIG|WLP)\s*\+\s*(DEX|INS|MIG|WLP)\s*\)\s*([+\-−–]\s*\d+)?\s*•?\s*(?:\(\s*HR\s*\+\s*(\d+)\s*\)|(\d+))\s*([a-z]+)?(?:\s+or\s+([a-z]+))?\s*damage\.?\s*(.*)$/is);
	// an attack with a check but no damage ("The target suffers shaken...")
	const noDmg = r.match(/^\(\s*(DEX|INS|MIG|WLP)\s*\+\s*(DEX|INS|MIG|WLP)\s*\)\s*([+\-−–]\s*\d+)?\s*•\s*(.*)$/is);
	const icon = e.icon.toLowerCase();
	const ranged = icon === 'r' || /\branged\b/i.test(r.slice(0, 20)) || e.icon === 'a';
	if (!m && noDmg) return { name: e.name, range: ranged ? 'ranged' : 'melee', attrs: [ATTR[noDmg[1].toUpperCase()], ATTR[noDmg[2].toUpperCase()]], accuracy: noDmg[3] ? num(noDmg[3]) : 0, damage: 0, noDamage: true, type: 'physical', effect: clean(noDmg[4]), hrZero: false, raw: r };
	if (!m) return { name: e.name, range: ranged ? 'ranged' : 'melee', attrs: ['dex', 'mig'], accuracy: 0, damage: 0, type: 'physical', effect: r, hrZero: false, raw: r };
	const type = (m[6] ?? 'physical').toLowerCase();
	return {
		name: e.name,
		range: ranged ? 'ranged' : 'melee',
		attrs: [ATTR[m[1].toUpperCase()], ATTR[m[2].toUpperCase()]],
		accuracy: m[3] ? num(m[3]) : 0,
		damage: Number(m[4] ?? m[5] ?? 0),
		hrZero: !m[4] && !!m[5],
		type: Object.values(DAMAGE).includes(type) ? type : 'physical',
		// "fire or ice damage": the first type, and the choice noted in the effect
		effect: clean(`${m[7] ? `Deals ${type} or ${m[7].toLowerCase()} damage. ` : ''}${m[8] ?? ''}`),
		raw: r,
	};
}

/** "(INS + WLP) +5 • 10 × T MP • Up to three creatures • Instantaneous. Text" (no check for spells that just happen) */
function parseSpell(e) {
	const parts = e.rest.split('•').map(clean);
	let check = null;
	if (/^\(\s*(DEX|INS|MIG|WLP)\s*\+/.test(parts[0] ?? '')) {
		const m = parts.shift().match(/^\(\s*(DEX|INS|MIG|WLP)\s*\+\s*(DEX|INS|MIG|WLP)\s*\)\s*([+\-−–]\s*\d+)?/i);
		if (m) check = { attrs: [ATTR[m[1].toUpperCase()], ATTR[m[2].toUpperCase()]], accuracy: m[3] ? num(m[3]) : 0 };
	}
	const costText = parts.shift() ?? '';
	const cm = costText.match(/(\d+)\s*(×\s*T)?\s*MP/i);
	const target = parts.shift() ?? '';
	const tail = parts.join(' • ');
	const dm = tail.match(/^([A-Za-z]+)\.?\s*(.*)$/);
	const durationWord = (dm?.[1] ?? '').toLowerCase();
	const text = clean(dm?.[2] ?? tail);
	const dmg = text.match(/\(\s*HR\s*\+\s*(\d+)\s*\)\s*([a-z]+)\s+damage/i);
	return {
		name: e.name,
		offensive: e.offensive || !!check,
		check,
		mp: cm ? Number(cm[1]) : 0,
		perTarget: !!cm?.[2],
		target: clean(target),
		duration: durationWord === 'scene' ? 'scene' : durationWord === 'instantaneous' ? 'instantaneous' : 'special',
		damage: dmg ? { value: Number(dmg[1]), type: Object.values(DAMAGE).includes(dmg[2].toLowerCase()) ? dmg[2].toLowerCase() : 'physical' } : null,
		text,
		raw: e.rest,
	};
}

/** The affinity icons after DEF and M.DEF: a capital icon is followed by RS, IM, VU or AB */
function parseAffinities(tokens) {
	const out = {};
	let last = null;
	for (const t of tokens) {
		for (const part of t.str.trim().split(/\s+/)) {
			if (/^(RS|IM|VU|AB)$/.test(part) && last) {
				out[last] = part;
				last = null;
			} else if (part.length === 1 && DAMAGE[part.toLowerCase()]) last = DAMAGE[part.toLowerCase()];
		}
	}
	return out;
}

/** "COMMISSIONER VYNE (Champion 3)", "CECILIA (Elite)": the rank some books print in the name */
function rankInName(c) {
	const m = c.name.match(/\s*\(([^()]*?,\s*)?(Soldier|Elite|Champion\s*(\d))\)\s*$/i);
	if (!m) return;
	// "EIGHT (VIII, Champion 2)": keep what else the brackets say
	// Roman numerals stay in capitals ("Eight (VIII)")
	const extra = m[1] ? m[1].replace(/,\s*$/, '').trim() : '';
	c.name = `${c.name.slice(0, m.index).trim()}${extra ? ` (${/^[ivxlc]+$/i.test(extra) ? extra.toUpperCase() : extra})` : ''}`;
	m[1] = m[2];
	m[2] = m[3];
	c.rank = m[2] ? 'champion' : m[1].toLowerCase();
	c.replaced = m[2] ? Number(m[2]) : c.rank === 'elite' ? 2 : 1;
}

const blank = (page, line, m) => ({
	name: titleCase(clean(m[1])).replace(/\(([A-Za-z]{2,4})\)/g, (all, w) => (clean(m[1]).includes(`(${w.toUpperCase()})`) ? `(${w.toUpperCase()})` : all)),
	level: Number(m[2]),
	species: m[3].toLowerCase(),
	rank: 'soldier',
	replaced: 1,
	role: '',
	tags: [],
	villain: '',
	description: [],
	traits: [],
	approaches: { good: '', bad: '' },
	equipment: '',
	attrs: null,
	hp: null,
	crisis: null,
	mp: null,
	init: null,
	def: null,
	mdef: null,
	affinities: {},
	immunities: [],
	attacks: [],
	spells: [],
	actions: [],
	rules: [],
	page: page.n,
	top: line.y,
	bottom: line.y,
	left: line.x,
	issues: [],
});

/**
 * Every stat block in the pages, in order.
 * @param {Array} pages from readPages
 */
export function parseStatBlocks(pages) {
	const out = [];
	let cur = null;
	let section = null;
	let entry = null;
	let block = null;
	const close = () => {
		if (cur) finish(cur);
		cur = null;
		entry = null;
		section = null;
	};

	for (const page of pages) {
		// a block may run on from the previous page: keep it open only while the lines still look like it
		let carried = !!cur;
		for (const line of page.lines) {
			const text = line.text;
			const head = text.match(HEADER);
			if (head && !/SEE INDIVIDUAL/i.test(text)) {
				close();
				cur = blank(page, line, head);
				rankInName(cur);
				block = { indent: null, stats: false };
				out.push(cur);
				carried = false;
				continue;
			}
			if (!cur) continue;
			if (carried) {
				// on a new page: only section headings and entries carry on the block
				if (!SECTION.test(text) && !(section && (entryStart(line, section, block) || Math.abs(line.x - (block.indent ?? line.x)) < 20))) {
					close();
					continue;
				}
				carried = false;
			}
			// big text that isn't part of a profile ends it (a new entry's title, a TACTICS heading)
			if (line.size >= 13 || /^(TACTICS|ENVIRONMENTS|ALLIES|REWARDS|IN YOUR CAMPAIGN|DURING (ODD|EVEN) ROUNDS)\b/i.test(text)) {
				close();
				continue;
			}
			cur.bottom = line.y;

			if (!block.stats) {
				const rank = text.match(RANK);
				if (rank && !cur.attrs) {
					const word = rank[1].toUpperCase();
					cur.rank = word.startsWith('CHAMPION') ? 'champion' : word.toLowerCase();
					cur.replaced = cur.rank === 'champion' ? Number(rank[2]) || 2 : cur.rank === 'elite' ? 2 : 1;
					for (const tag of rank[3].split(/[•·]/).map((s) => s.trim().toLowerCase()).filter(Boolean)) {
						if (ROLES.includes(tag)) cur.role = tag;
						else cur.tags.push(tag);
					}
					continue;
				}
				const vill = text.match(/\b(minor|major|supreme)\s+villain\b/i);
				if (vill && !cur.attrs) {
					cur.villain = vill[1].toLowerCase();
					const champ = text.match(/champion\s*(\d)/i);
					if (champ) {
						cur.rank = 'champion';
						cur.replaced = Number(champ[1]);
					} else if (/\belite\b/i.test(text)) {
						cur.rank = 'elite';
						cur.replaced = 2;
					}
					continue;
				}
				if (/^Traits:/i.test(text)) {
					cur.traits = clean(text.replace(/^Traits:/i, '')).replace(/\.$/, '');
					cur._traitsOpen = !/\.\s*$/.test(text);
					continue;
				}
				if (cur._traitsOpen && !STATS.test(text) && !/^[67]\b/.test(text)) {
					cur.traits = clean(`${cur.traits} ${text}`).replace(/\.$/, '');
					cur._traitsOpen = !/\.\s*$/.test(text);
					continue;
				}
				cur._traitsOpen = false;
				const appr = text.match(/^([67])\s*(?:[67]\s*)?(.*)$/);
				if (appr && line.tokens[0].family === 'monospace') {
					cur.approaches[appr[1] === '6' ? 'good' : 'bad'] = clean(appr[2]);
					cur._appr = appr[1];
					continue;
				}
				const st = text.match(STATS) ?? (/DEX\s*d\d+\s*INS\s*d\d+/i.test(text) ? [] : null);
				if (st) {
					// field by field, so "HP Special" or "Init. -" don't lose the rest
					const die = (k) => Number(text.match(new RegExp(`${k}\\s*d(\\d+)`, 'i'))?.[1]) || 6;
					cur.attrs = { dex: die('DEX'), ins: die('INS'), mig: die('MIG'), wlp: die('WLP') };
					const hp = text.match(/HP\s*(\d+)\s*(?:[•·]\s*(\d+))?/i);
					cur.hp = hp ? Number(hp[1]) : null;
					cur.crisis = hp?.[2] ? Number(hp[2]) : hp ? Math.floor(Number(hp[1]) / 2) : null;
					if (!hp) cur.issues.push(`HP is "${(text.match(/HP\s*(\S+)/i)?.[1] ?? '?')}": see its special rules.`);
					const mp = text.match(/MP\s*(\d+)/i);
					cur.mp = mp ? Number(mp[1]) : null;
					const init = text.match(/Init\.?\s*(\d+)/i);
					cur.init = init ? Number(init[1]) : null;
					continue;
				}
				const df = text.match(DEFS);
				if (df) {
					const d = df[1].replace(/\s+/g, '');
					const md = df[3].replace(/\s+/g, '');
					// "DEF +3/+1": two forms; the first is used and the other noted
					if (df[2]) cur.issues.push(`Two Defense values (${d}/${df[2].replace(/\s+/g, '')}): the first is used.`);
					// "+2" is a bonus over the die; a bare number is the full score
					cur.def = /^[+\-−–]/.test(d) ? { bonus: num(d) } : { score: num(d) };
					cur.mdef = /^[+\-−–]/.test(md) ? { bonus: num(md) } : { score: num(md) };
					const after = line.tokens.filter((t) => t.x > (line.tokens.find((k) => /M\.?\s*DEF/.test(k.str))?.x ?? 0) + 20);
					cur.affinities = parseAffinities(after);
					block.stats = true;
					continue;
				}
				if (cur._appr && !cur.attrs) {
					const k = cur._appr === '6' ? 'good' : 'bad';
					cur.approaches[k] = clean(`${cur.approaches[k]} ${text}`);
					continue;
				}
				if (!cur.attrs) {
					cur.description.push(text);
					continue;
				}
			}

			// "Equipment: shock baton (...), riot shield (...)" may run over a few lines
			if (/^Equipment:/i.test(text)) {
				cur.equipment = clean(text.replace(/^Equipment:/i, ''));
				section = 'equipment';
				continue;
			}
			const sec = text.match(SECTION);
			if (sec) {
				section = { 'BASIC ATTACKS': 'attacks', SPELLS: 'spells', 'OTHER ACTIONS': 'actions', 'SPECIAL RULES': 'rules', IMMUNITIES: 'immunities', SKILLS: 'rules' }[sec[1]];
				entry = null;
				if (section === 'immunities' && sec[2]) cur.immunities.push(...listStatuses(sec[2]));
				continue;
			}
			if (!section) continue;
			if (section === 'equipment') {
				cur.equipment = clean(`${cur.equipment} ${text}`);
				continue;
			}
			if (section === 'immunities') {
				cur.immunities.push(...listStatuses(text));
				continue;
			}
			const start = entryStart(line, section, block);
			if (start) {
				if (block.indent == null && !start.icon) block.indent = line.x;
				entry = { ...start, section };
				cur[section === 'attacks' ? '_attacks' : section === 'spells' ? '_spells' : section === 'actions' ? '_actions' : '_rules'] ??= [];
				cur[section === 'attacks' ? '_attacks' : section === 'spells' ? '_spells' : section === 'actions' ? '_actions' : '_rules'].push(entry);
				continue;
			}
			// carries on the entry above (a bulleted list inside an entry keeps its bullets on new lines)
			if (entry) entry.rest = /^[•·]\s/.test(text) ? `${entry.rest}\n${clean(text)}` : `${entry.rest} ${text}`.replace(/[ \t]+/g, ' ').trim();
		}
	}
	close();
	return out;
}

const listStatuses = (text) => STATUSES.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(text));

/** Turn the raw entries into attacks, spells, actions and rules, and check the block is whole */
function finish(c) {
	c.attacks = (c._attacks ?? []).map((e) => parseAttack(e, c.level));
	c.spells = (c._spells ?? []).map(parseSpell);
	c.actions = (c._actions ?? []).map((e) => ({ name: e.name, text: e.rest }));
	c.rules = (c._rules ?? []).map((e) => ({ name: e.name, text: e.rest }));
	delete c._attacks;
	delete c._spells;
	delete c._actions;
	delete c._rules;
	delete c._traitsOpen;
	delete c._appr;
	c.description = clean(c.description.join(' '));
	if (typeof c.traits === 'string') c.traits = c.traits.split(/,\s*/).map((t) => t.trim()).filter(Boolean);
	// immunities written into the rules ("is immune to dazed, enraged, and shaken")
	for (const r of c.rules) {
		const m = r.text.match(/immun\w*\s+to\s+([a-z ,]+?(?:and [a-z]+)?)[.;)]/i);
		if (m) c.immunities.push(...listStatuses(m[1]));
	}
	c.immunities = [...new Set(c.immunities)];
	if (!c.attrs) c.issues.push('No Attributes line found.');
	if (!c.def) c.issues.push('No DEF line found.');
	if (!c.attacks.length && !c.spells.length && !c.actions.length) c.issues.push('No attacks, spells or actions found.');
	for (const a of c.attacks) if (!a.damage && !a.noDamage) c.issues.push(`Attack "${a.name}": damage not read.`);
}
