import { MODULE_ID, PdfImporter } from './importer.mjs';

/** "Import from PDF" in the Actors sidebar (GM), and a button in the module settings */

Hooks.once('init', () => {
	game.settings.registerMenu(MODULE_ID, 'import', {
		name: 'Import creatures from a PDF',
		label: 'Open the importer',
		hint: 'Read a Fabula Ultima PDF you own and turn its stat blocks into Project FU NPCs, with their art.',
		icon: 'fa-solid fa-file-pdf',
		type: class extends PdfImporter {},
		restricted: true,
	});
	game.modules.get(MODULE_ID).api = { open: () => PdfImporter.open() };
});

Hooks.on('renderActorDirectory', (app, html) => {
	if (!game.user.isGM) return;
	const root = html instanceof HTMLElement ? html : html?.[0];
	const header = root?.querySelector('.directory-header .header-actions') ?? root?.querySelector('.directory-header');
	if (!header || header.querySelector('.fupdf-open')) return;
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'fupdf-open';
	btn.innerHTML = '<i class="fa-solid fa-file-pdf"></i> Import from PDF';
	btn.addEventListener('click', () => PdfImporter.open());
	header.append(btn);
});
