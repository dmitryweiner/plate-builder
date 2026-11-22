# Plate Builder — sealed magnets, text tweaks, fonts, the preset button

Six wishes from the user (2026-11-22):

1. Magnets can be **sealed inside the plate** besides glued into an open
   pocket (a select); sealed shows a slider: how deep.
2. A **new text takes the focus**: its text field, ready to type.
3. The text size **steps by 0.1 mm**.
4. **Smoothing of the letters** ("as an image has").
5. **More free fonts**, good-looking ones.
6. The **current preset's name keeps its size** in the top bar.

Every step keeps `npm run check` and `npm run smoke` green; every behaviour
change starts with a failing test.

## Decisions made with the user (2026-11-22)

| Question         | Decision                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Sealed magnets   | **A closed pocket** inside the plate, the magnet put in during a print pause; the slider is the material between the back and the magnet |
| Letter smoothing | **The raised letters' top edges** rounded or chamfered, as the plate's edge fillet — not their corners in plan                           |
| Fonts            | **Seven**, picked from a specimen page: Lobster, Playfair Display, Russo One, Rubik Bubbles, Pacifico, Bona Nova, Press Start 2P         |
| The name's size  | **The top bar's name button** (the one that opens the presets), not the name field in the Presets dialog                                 |

## 1. Sealed magnets (M13)

PLAN-MAGNETS.md left "a hidden pocket closed on both sides (a print pause
to put the magnets in)" out of M11; this brings it in. Spec §14 drops it,
§5a gets it.

- **Fields** (`Magnets`): `mount: 'glued' | 'sealed'`, default `'glued'`
  (today's pocket, open at the back); `cover`, mm, range 0.2–5, default 0.4
  — the plate's material between the back face and the magnet (two 0.2 mm
  layers; a fridge magnet's hold drops fast with any gap).
- **UI** (Magnets card): a select "Mount" after the layout — "Glued in
  from the back" / "Sealed inside (print pause)"; when sealed, a slider
  "Depth from the back" for `cover`, step 0.1. The pocket note under the
  card says which: "Pocket ⌀ 10.2 mm, 2.1 mm deep, open at the back." /
  "Closed pocket ⌀ 10.2 × 2.2 mm, 0.4 mm over the back face."
- **Geometry** (`geo/magnets.ts`): a sealed pocket runs from `cover` to
  its ceiling, a closed void in the solid (a valid mesh: the gate checks
  edges, and every edge of the void is in two triangles). The ceiling is
  `cover + thickness + 0.1` **rounded up to a multiple of 0.2 mm**, the
  usual layer: the pause then falls between two layers, and the magnet
  stays under the nozzle's path (0.1–0.3 mm of room over it). Floor and
  ceiling get the micron of jitter per magnet the open pockets have.
- **Print hint** (Export card), in place of the glue line: "Pause the
  print at 2.6 mm (before the first layer above that height), put the
  magnets in, resume." — `geo/printHints.ts` gives the height, the app the
  words.
- **Warnings** (`geo/warnings.ts`): `magnet.thin` asks for
  `cover + pocket depth + 0.8` when sealed; `magnet.overlap` with an
  engraved text compares its floor with the sealed pocket's ceiling; a
  hole through a sealed pocket opens it — the existing overlap warning.
- **Storage**: two new fields, filled by the sanitiser (glued, 0.4), no
  version bump — as M11 did; tests that a save, a user preset and a
  `*.plate.json` without them load unchanged.
- **Tests**: state (defaults, ranges, idempotence, fuzz); geometry (the
  ceiling's rounding, z0/z1 of the cutters); worker with real WASM
  (watertight, the volume removed, the back face's and the front's areas
  unchanged — nothing shows); warnings; jsdom (the slider only when
  sealed, one undo step per change); smoke (sealed magnets, the export
  passes the mesh check, the hint names the height).
- **Docs**: spec §5a, §9, §10, §14; `docs/guide-magnets.md` (when which,
  how to set a pause in a slicer); AGENTS.md if a timing moves.

## 2. A new text takes the focus

After "+ Add text" the new text's card opens (it does today) and its text
field `#element_text` gets the focus with its default "Text" selected, so
typing replaces it. Only on adding — not on selecting, duplicating or
opening a project. On a phone this brings up the keyboard; that is the
point. Test: jsdom on the real `index.html` — after the click,
`document.activeElement` is the field and the selection covers "Text".

## 3. Text size step 0.1

`textRange('size', …, 0.5, …)` → `0.1` in `ui/selectedCard.ts`: the
slider, its −/+ and the number field all take the step. Test: jsdom, + on
8 gives 8.1.

## 4. Rounded letter edges (M14)

The plate's edge fillet (M12) for a raised text: the letters' top edges
become a quarter circle or a 45° chamfer. Walls below the edge stay
vertical; the 2D view, the boxes and the crop do not change (the footprint
is the same).

- **Fields** (`TextElement`): `edgeSize`, mm, range 0–5, default 0 (sharp;
  old texts unchanged), capped by the sanitiser at the text's `height`;
  `edgeProfile`: `'fillet' | 'chamfer'`, default `'fillet'`.
- **UI** (the text's card, raised only): the slider and the select right
  after "Height", in the plate card's words ("Edge fillet", "Edge
  profile", "Rounded" / "Chamfer 45°"); the select shown when the size is
  above 0.
- **Geometry**: the levels are `geo/edges.ts`'s `edgeLevels` (the same
  profile, steps, `EDGE_MIN_GAP` merging and `EDGE_JITTER`), counted down
  from the text's top; a new pure `textEdgeSlabs(thickness, text, step)`
  gives the slabs from `T/2` (where the text starts inside the base) up
  to `T + height`. The worker builds a rounded text as one terraced mesh
  with the existing `terraceSolid`, each slab the text's section shrunk by
  its inset (`offset(−inset, 'Round')`), in place of `prismOf`. Where a
  stroke is thinner than twice the size its top ends lower, in a ridge —
  what a ball rolled along it leaves; a letter is never cut through.
- **Tests**: pure — the slabs' heights and insets, the cap, 0 gives one
  slab; worker with WASM — a square "text" raster with a chamfer: watertight,
  the top face shrinks by the chamfer on each side, the height unchanged,
  the volume what the chamfer predicts; a real text on an arc builds; every
  preset unchanged; jsdom — the controls only for a raised text; smoke — a
  rounded text built and exported, its preview time printed.
- **Cost**: to be measured (`--measure`, "PLATE BUILDER" 8 mm with a
  0.5 mm fillet), written into AGENTS.md "what costs what". If a preview
  goes over ~300 ms, the preview takes fewer levels (the export keeps
  0.1 mm steps).
- **Docs**: spec §4 (the table), §6 (the recipe), §14; `docs/guide-texts.md`
  with a picture from `scripts/snap.mjs`.

## 5. Seven more fonts (M15)

Picked by the user from a specimen of sixteen candidates
(https://claude.ai/artifact/LihDHWbq8Zv3f5goSSz9vd, private):

| Font             | Weight | Scripts                 | What it is                   |
| ---------------- | ------ | ----------------------- | ---------------------------- |
| Lobster          | 400    | Latin, Cyrillic         | a bold script for signs      |
| Playfair Display | 900    | Latin, Cyrillic         | a high-contrast serif        |
| Russo One        | 400    | Latin, Cyrillic         | a sporty sans, house numbers |
| Rubik Bubbles    | 400    | Latin, Cyrillic, Hebrew | bubbly, keychains and kids   |
| Pacifico         | 400    | Latin, Cyrillic         | a brush script               |
| Bona Nova        | 700    | Latin, Cyrillic, Hebrew | a book serif                 |
| Press Start 2P   | 400    | Latin, Cyrillic         | pixels, 8-bit                |

- **Files**: woff2 subsets as Google Fonts cuts them (the ranges
  `ui/fonts.ts` already has) and each family's `OFL.txt` from
  `github.com/google/fonts`, into `public/fonts/`. A new script
  `scripts/fonts.mjs <family> <weight> <subsets…>` fetches them (it will be
  needed again), with a header comment and a line in AGENTS.md.
- **Code**: `FONT_IDS` and `FONTS` get the seven, in the menu after
  today's six in the order above. A saved project's font id stays valid.
- **Precache**: the service worker takes all of `public/fonts/`; the
  seven add some 150–300 kB (measured, said in the PR).
- **Tests**: state (the id list, a project with each id survives the
  sanitiser); the smoke's font loop ("two lines in each font") gets the
  seven, Hebrew in the two that have it; the offline step loads one of the
  new ones.
- **Docs**: spec §4 ("5–7 fonts" → thirteen), `docs/guide-texts.md`.

## 6. The top bar's name button keeps its width (maker-kit)

On a desktop the button with the project's name (it opens the presets)
is as wide as the name, up to 240 px (`kit.css`, `.preset-button`,
`flex: 0 1 auto`): a short name ("шма") makes it narrow, another name
moves every tool after it. On a phone it already fills its line and does
not move.

The button is maker-kit's, so the fix goes there (`~/projects/CLAUDE.md`:
a kit piece is changed in the kit): on a desktop it is always 240 px wide
(`flex: 0 1 240px`) — narrower only when the bar itself has no room, never
because of the name; a long name ends in "…" as today. A step in the kit's
smoke: the button's width the same with a three-letter name and a long one,
in English and Hebrew. Tag v0.5.3; this app moves to it. Case Constructor,
Clayform and Mathsculpt use the same button and get it when they next
move.

## Order and branches

One branch and PR each, smallest first:

1. `text-focus-step` — items 2 and 3.
2. maker-kit `preset-button-width` → v0.5.3; here `kit-v0.5.3` — item 6.
3. `m13-sealed-magnets` — item 1.
4. `m14-text-edges` — item 4.
5. `m15-fonts` — item 5.

## Defaults taken without asking (say if any is wrong)

- The sealed pocket's ceiling on a 0.2 mm layer boundary; no layer-height
  setting.
- `cover` default 0.4 mm, range 0.2–5.
- A new text's "Text" selected when it gets the focus.
- A text's edge: 0–5 mm, at most its height; raised texts only.
- New fonts after the existing six in the menu.
- The name button: 240 px on a desktop, in every app on the kit.

## Not in this work

- A layer-height setting, pauses for anything but magnets.
- Different mounts for different magnets of one plate.
- Rounded edges of engraved letters (the groove's mouth); rounded letter
  corners in plan; own font upload.
- The name field in the Presets dialog (it shrinks beside "changed"; left
  as it is).

## Deviations

- **M13**: the mount's words are shorter than planned — "Sealed (print
  pause)", "Утопить (пауза печати)": the longer ones were cut off in the
  select on a desktop. The depth's row is "Depth from the back" /
  "Утопить на", with a hint (the plastic between the back face and the
  magnet).
- **M13**: no `--measure` row: a sealed pocket costs what an open one does;
  the smoke's sealed step reads the flat levels of the real STL (0, 0.4,
  2.6, 3.4 mm) instead.
