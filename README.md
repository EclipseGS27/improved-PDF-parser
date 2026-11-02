# Fabula Ultima PDF Importer

Turn the Fabula Ultima PDFs you own into ready-to-use Project FU NPCs: every stat block, and every creature's art.

Works with the **Core Rulebook**, the **Bestiary**, and the **High, Natural and Techno Fantasy Atlases** (Foundry v13, Project FU system).

## Install
Manifest URL:
```
https://github.com/EclipseGS27/improved-PDF-parser/releases/latest/download/module.json
```

## Use it
1. As the GM, click **Import from PDF** at the top of the Actors sidebar (or Module Settings → Open the importer).
2. Choose a PDF. It is read in your browser; nothing is uploaded except the art, which goes to your Foundry data folder.
3. Review what it found: every stat block with its level, rank, role and entry, how many attacks, spells and rules, whether it has art, and any notes. Untick what you don't want, pick an Actors folder or a world compendium (made for you if it doesn't exist) and where the art goes.
4. Click **Import**.

## What you get
- **Every stat block as an NPC**: level, Species, rank (elite, champion X), Bestiary role, Villain and Ultima Points, Traits, Attributes, every Affinity, status immunities, and HP, MP, Initiative, DEF and M.DEF exactly as printed (the importer works out the bonuses Project FU's formulas need to land on the book's numbers).
- **Attacks** with their Attributes, printed Accuracy, damage, damage type, range, Magic Defense targeting and effect text; **spells** with their check, MP cost (per target too), targets, duration, damage and text; **other actions** and **special rules** with their full text, bulleted lists kept.
- The Bestiary's **advantageous and disadvantageous approaches**, Atlas **equipment**, and where in the PDF each creature came from, in the description.
- **All the art**:
  - the entry's **illustration** as the actor's portrait, shared by every profile in that entry (the Chimera's body, head and tail all get the Chimera);
  - the small **portrait beside a profile** as its token (or the illustration, if you prefer);
  - full-page and full-bleed art, art placed across the gutter, and **art split over a two-page spread, stitched back together**;
  - transparent backgrounds kept, empty edges trimmed, saved as WebP;
  - optionally **every other illustration** in the book, in an `other` folder.
- Re-importing updates the creatures already in the folder (their items are replaced) instead of making duplicates.

## Tested on
All five books: 60 Core Rulebook profiles, 140 Bestiary profiles, 16 + 16 + 19 in the Atlases. Every profile is found, every printed HP, MP and Initiative is reproduced, and every creature gets art.

## Credits
PDF reading by [pdf.js](https://github.com/mozilla/pdf.js) (Apache 2.0, see `lib/LICENSE-pdfjs`). Fabula Ultima is by Need Games; this module ships no book content, it reads the PDFs you own.
