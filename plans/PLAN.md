# Plate Builder — implementation plan

What to build: `docs/spec.md`. This plan is the order of work, milestones
M0…M10, each a branch and a PR into `main`, each ending with `npm run
check` and the smoke green. TDD throughout: red → green → refactor; the
pure core is tested in Node, the DOM with jsdom, the whole app with the
Playwright smoke at a phone and a desktop viewport.

Deviations from the plan are recorded at its end as they happen.

## Decisions made with the user (2026-11-04)

1. **Editing**: a 2D top view where elements are dragged, scaled and
   turned with handles (mouse and touch), plus a 3D preview; exact values in
   the element's card.
2. **Vignettes**: a figured outline **and** an optional raised frame from
   the same silhouette; CC0 / public domain SVGs from the internet.
3. **Colours**: one STL plus a "change filament at Z" hint; no multi-part
   export.
4. **Holes**: round through, slot, countersunk, hidden keyhole.
5. **Languages**: en, ru, uk, he (RTL).
6. **Text**: several lines with alignment, text on an arc; bundled fonts
   only, rasterised (no font parser, no font upload).
7. **Crop outline**: an image's edge is where its height passes a threshold
   (transparency is height 0); texts join the outline with a switch; inner
   holes filled; padding slider.
8. **Also in v1**: a rim along the outline, built-in and user presets, an
   own SVG as the outline. Not in v1: a chamfered or rounded top edge.

Defaults taken without asking (change them here if needed): plain TS + DOM,
no React; English docs and plans; images stored ≤ 512 px as PNG data URLs
inside the project; images are always raised; overlapping images combine
by max.

## M0 — Scaffold

- `git init`; `/new-web-app` from `web-app-template` (TS 7, oxlint +
  prettier, vitest, i18n, PWA, storage, deploy workflow, smoke harness).
  Package name `plate-builder`, app name "Plate Builder".
- i18n: add `uk` to the template's en/ru/he; the "every key in every
  language" test covers four.
- Add `three`, `@types/three`, `manifold-3d`. `vite.config.ts`:
  `worker.format: 'es'`, `optimizeDeps.exclude: ['manifold-3d']`,
  `base: './'`.
- Worker skeleton: `protocol.ts` (typed in/out messages with `jobId`),
  `client.ts` (lazy worker, one-deep queue per job kind, a replaced job
  resolves to `null`, export jobs never evicted), `csg.worker.ts` that
  loads manifold and answers a `ping` with its time.
- CI: the deploy workflow greps the main chunk for `manifold`.
- Smoke on its own ports with `--strictPort` (5373 dev / 4373 preview);
  `--preview` rebuilds first. Phone (390 × 844) and desktop viewports.
- Project `CLAUDE.md`: commands, plans index, Node, invariants (from
  spec §8.5), scripts list, an empty "what costs what" table.
- `node -v` matches `.node-version`.

Tests: the client's queue (a waiting job replaced, a replaced job
resolves `null`, an export job survives previews) with a fake worker;
i18n keys. Done: the empty app deploys from a PR merge; smoke opens it on
both viewports and gets the worker's pong.

## M1 — State, primitive outlines, the base, STL

- `geo/state.ts`: the whole schema of the spec (plate, images, texts,
  holes, version), defaults, `sanitizeState` (never throws, idempotent,
  clamps every range of spec §13 and the tables of §2–§5). Fuzz test with
  random JSON and mutated valid states.
- `geo/outline.ts`: rectangle, ellipse, triangle, polygon, star, heart,
  shield, tag as polygons (CCW, centred, exact width × height, segment count
  from a chord tolerance).
- Worker `build.ts`: outline → `CrossSection` → corner rounding (offset −r
  then +r, `simplify`) → base extrusion; the `outline` job returns the
  rounded polygons.
- `geo/stl.ts`, `geo/validate.ts` (borrow from case-constructor):
  watertight, degenerate triangles, volume.
- 3D view (`render/scene.ts`): orbit, grid, low light from above, camera
  presets; the mesh from the worker's `mesh` job.
- UI: the Plate card (kind, size, thickness, rounding); Export card with the
  STL download.

Tests: every primitive's bbox equals its size, its area against the
formula, orientation; rounding keeps the bbox and its corners' radius
(distance from the arc centre); the base mesh is watertight with volume =
area × T; STL round trip (header, count, normals). Smoke: each primitive,
slider extremes, a real STL download (time printed).

## M2 — 2D editor and holes

- `editor/`: canvas top view (DPR-aware, mm ↔ px transform, pan, zoom to
  fit, wheel and pinch), drawing of the outline, grid, size; hit testing in
  the plate frame; selection box with corner and rotation handles; drag as
  one undo step; two-finger scale + rotate of the selection; snapping
  (axes, other centres, 15° with Shift) with guides; keyboard shortcuts.
- `state/history.ts`: undo/redo, a gesture or a slider drag is one step.
- Elements card (list, visibility, duplicate, delete, add) and the selected
  element's card.
- Holes: `geo/holes.ts` (round, slot, countersunk with its head cylinder,
  keyhole: entry, lip slot, channel, from the back), subtracted in the
  worker; the hole warnings (`hole.nearEdge`, `keyhole.thin`,
  `element.overlap`, `element.outside`) in `geo/warnings.ts` with spots.
- 3D: the back camera to see keyholes.

Tests: pure gesture maths (drag deltas in a rotated, zoomed view; handle
scale keeps the opposite corner's distance; rotation about the centre;
snapping thresholds in screen px) in Node; the editor's pointer flow in
jsdom with synthetic pointer events; every hole kind's mesh watertight and
its volume removed matching the formula; a keyhole has no opening on the
front face (the front's area unchanged); warnings for crafted states.
Smoke: add, drag, scale, turn, undo each hole kind; a phone drag.

## M3 — Images

- `ui/imageImport.ts`: a file → grayscale + alpha (clayform's averaging,
  extended with alpha; transparent no longer flattened onto white), ≤ 512 px,
  stored as a PNG data URL; the main thread keeps a decoded cache by URL.
- `geo/heightmap.ts`: `h(x, y)` with levels, invert, alpha, separable box
  blur, bilinear sampling, 0 outside.
- `geo/grid.ts`: a heightfield solid in the image frame on a regular grid
  (top surface, side walls, a flat bottom inside the base, zero level `ε`
  below `T`), flat-run merging; returned as a manifold-ready mesh (shared
  vertices, consistent winding).
- Worker: images turned and moved, unioned with the base, clipped by the
  outline prism; preview vs export grid steps (spec §8.4).
- Image card with the processed thumbnail; the 2D view draws the height map.
- **Measure**: preview and export of one 512 px image on 100 × 60 and on
  300 × 300, with and without flat-run merging; record in CLAUDE.md "what
  costs what". Decide here whether 512 px stays or 1024 is needed, and
  whether merging is worth it. Write the decision at the end of this plan.

Tests: heightmap against hand-computed pixels (levels, invert, alpha,
blur, outside); the grid solid is watertight for random fields, flat ones,
a single bright pixel, all-zero; its volume equals the sum of cells; two
overlapping images give the max (sampled heights of the result); a turned
image's top at a known point. Smoke: upload a PNG with transparency and a
JPEG, each parameter's extremes, export timing printed.

## M4 — Texts

- Fonts: copy Rubik (Latin, Cyrillic, Hebrew), Oswald, PT Serif, Comfortaa
  with their OFL files from the siblings; pick and add a script font and a
  Hebrew serif (both OFL, with Latin + Cyrillic where they have it). Lazy
  loading as in `clayform/src/ui/fonts.ts`; a text waits for its font
  instead of drawing with a fallback.
- `ui/textRaster.ts`: a block → raster at 10 px/mm (cap height measured
  from the font, line layout and alignment, `direction` for RTL), cached by
  key; rasters travel to the worker with the state.
- `geo/contour.ts`: marching squares at 50 % with interpolation, holes,
  orientation, simplification. Used by texts now, by the crop and vignettes
  later.
- `geo/textLayout.ts`: arc bending of contours (densify edges, then map),
  outside/inside, squeeze to fit; joining of extra lines.
- Worker: raised texts unioned (from inside the base to `T + height`),
  engraved cut from `T − depth` up, both clipped by the outline.
- Text warnings: `text.buried`, `text.engraveDeep`, `text.arcTooLong`,
  `text.arcLines`; `text.thin` via offset −0.4 / +0.4 area loss in the
  worker.

Tests: contours of synthetic rasters (a disc's area ≈ πr², a ring has a
hole, a checkerboard's orientation, sub-pixel position of a soft edge);
arc mapping (a point at x = 0 lands on the top of the circle, length along
the arc preserved at mid-radius, inside vs outside reading direction);
line layout and alignment with fake metrics; text solids watertight;
engraved depth measured from the mesh. Smoke: a two-line text in each font,
Cyrillic and Hebrew, raised and engraved, on an arc, the font waiting.

## M5 — Crop outline and rim

- Image masks: the threshold field traced by `contour.ts` in the image's
  frame, turned and moved; texts' contours when "In the outline" is on.
- Worker `outline` job: union → offset by padding (round) → outer contours
  only → corner rounding; island count; `outline.islands`, `outline.empty`.
- Rim: outline minus outline offset by −width, extruded to its height.
- The 2D view draws the worker's outline (the last one) for crop; primitives
  stay main-thread-instant.

Tests: a disc image cropped with padding p gives a circle of r + p; two
far images give two islands and the warning; a ring-shaped mask comes out
filled; a text-only crop; the rim's area against the formula on a
rectangle and its watertight union with relief. Smoke: crop around an image
and a text, padding extremes, rim on every kind.

## M6 — Vignettes and own SVG

- Find 10–15 closed decorative frames on OpenClipart,
  publicdomainvectors.org and Wikimedia Commons (PD/CC0 only). Each goes
  to `public/vignettes/<id>.svg` with an entry in `public/vignettes/index.json`
  (id, names in four languages, source URL, author, licence). The user
  reviews the contact sheet before they are committed.
- `scripts/vignettes.mjs`: `--check` (each SVG rasterises to one outer
  contour with an inner window, the index is complete and its licences are
  in the allowed set), `--sheet <dir>` (a contact sheet PNG/HTML of all
  entries, outline and frame shown). Listed in CLAUDE.md.
- `ui/svgRaster.ts`: an SVG (catalog or uploaded) → raster at 10 px/mm
  for the chosen size and proportions; uploaded files are sanitised
  (rendered through `<img>`, so scripts never run; size limit).
- Worker: outline = outer contours of the traced silhouette; frame relief
  = the silhouette extruded to its height; `frame.thin`.
- Plate card: vignette picker with thumbnails; own SVG upload.

Tests: the index schema; a synthetic frame SVG fixture traced to one outer
contour and one hole; stretched vs proportional sizes; frame solid
watertight. Smoke: every catalog vignette with and without its frame, an
uploaded SVG, an SVG with two islands warned.

## M7 — Warnings, print hints, export panel

- The Warnings card: every code of spec §10, element names, "show" framing
  the spot in the 2D view; warnings computed without CSG on the main
  thread, the rest from the worker's last build.
- `relief.tall`, `mesh.invalid` (blocks export, says why).
- Export card: size, height, triangle count, the print hints and the
  colour-change heights (distinct tops of base, raised texts, rim, frame;
  the gradient note when images are present).
- Export progress bar; the export job is never evicted.

Tests: colour-change heights for crafted states (dedupe, order, the
gradient note); each warning's trigger and its absence one step off.
Smoke: a state with every warning, "show" moves the view, a blocked export.

## M8 — Projects, presets, storage

- Current project autosave (debounced) under one versioned key; the
  refusing-storage banner (outlives rebuilds, gone once a save works).
- Project file `*.plate.json` download/upload; a foreign or broken file
  refused with a message.
- Built-in presets (spec §11) with pictures drawn for the project; a first
  visit opens the first one; user presets: save, rename, delete; "changed"
  state shown when the open preset is edited.

Tests: storage round trip with a fake `Storage` (quota error, broken JSON,
old version), project file round trip, every preset passes `sanitizeState`
unchanged and builds a valid mesh. Smoke: reload keeps the project and the
images, a refusing storage's banner, a file round trip, presets.

## M9 — Layout, languages, PWA polish

- Phone bottom sheet; desktop split with the size swap; RTL layout in
  Hebrew (panel on the right, the canvas's numbers LTR).
- All four dictionaries complete; static texts via `data-i18n`.
- PWA: precache fonts and vignettes; offline smoke (`--preview`, network
  off after the first load).

Smoke: all four languages (switch, memory, a fresh `he-IL` browser), the
sheet on a phone, offline reload.

## M10 — Docs and release

- `docs/`: user guide (`README.md` index, plate, images, texts, holes,
  export and printing, projects and presets, limitations), with
  screenshots from `scripts/snap.mjs`.
- `README.md` (English; `README.ru.md` optional), licence, credits for
  fonts and vignettes.
- A last full measurement pass into "what costs what".

## Scripts (planned)

- `scripts/smoke.mjs` — the browser smoke (grows with each milestone).
- `scripts/snap.mjs` — a screenshot in a given state (`--preset`, `--set`,
  `--upload`, `--view 2d|3d`, `--camera`, `--lang`, `--width/--height`,
  `--eval`), as in case-constructor.
- `scripts/inspect.mjs` — builds a project in Node and reports triangles,
  watertightness, volume, bbox, stage timings; `--stl <dir>`.
- `scripts/vignettes.mjs` — catalog check and contact sheet (M6).
- `scripts/lib/harness.mjs` — flags, vite on 5373/4373, console errors,
  CPU throttle, locale.

## Risks

- **Heightfield size**: a 300 mm plate at 0.2 mm is 1.5 M cells per image.
  Mitigations in order: flat-run merging, the export step tied to the
  image's real pixel size, manifold's `simplify`, a coarser step with a
  note for huge plates. Measured in M3 before anything else is built on it.
- **Coplanar faces** between the heightfield, the base and extrusions:
  avoided by construction (`ε` levels), jitter as a fallback.
- **Vignette sourcing**: few CC0 frames are closed silhouettes; some may
  need cleaning (fill the strokes, close the gaps) — done by hand in an
  editor and recorded as "modified" in the index.
- **Storage quota** with several photos: PNG data URLs keep it small; the
  banner and the project file cover the rest.

## Deviations

- **M0**: the GitHub repository was created after M0 was done, so M0 went to
  `main` as a direct push rather than a PR; from M1 on, a PR per milestone.
- **M0**: the worker client is generic over the job type with a small policy
  (lane, kept, transfer), so its queue is tested with fake jobs; the app's
  lanes are one per job kind.
- **M1**: `noUncheckedIndexedAccess` is off, as in cast-builder: the geometry
  indexes typed arrays in every inner loop.
- **M1**: a rounded primitive is stretched back to its width × height
  (rounding pulls a triangle's apex in), so the typed size is the printed
  size.
- **M1**: the vignette, own SVG and crop kinds are in the schema but build as
  a rectangle until M5–M6; the Plate card offers primitives only.
- **M2**: corner handles scale all of a hole's sizes together (a slot's
  width with its length, a countersink's head with its screw, a keyhole's
  head, shank and slot), so the box scales uniformly and the opposite corner
  stays put.
- **M2**: a press inside the selected element always moves it; its handles
  win only outside it (a small hole's handles would otherwise cover it on
  touch, where two fingers scale instead).
- **M2**: keyhole sizes: lip 1.5 mm, channel 0.6 × shank + 0.6 mm, front
  skin 0.8 mm — 5.3 mm for M4, the "about 5 mm" of the spec. A countersink
  is one solid of revolution (three separate cutters left slivers).
- **M2**: a basic Warnings card with "show" arrives now for the hole
  warnings; M7 completes it.
- **M2**: on desktop the page is bound to the window height (the panel
  scrolls); before, the views grew with the panel.
- **M3 decision** (measured, see "What costs what" in AGENTS.md): images
  stay at 512 px; flat-run merging is not built — the reference plate's
  preview takes 120 ms and its export 1.6 s; a 290 mm image on a 300 × 300
  plate previews in 1.9 s and exports in 14 s.
- **M3**: the measurement runs in the browser's worker as a smoke flag
  (`--measure`) rather than `scripts/inspect.mjs`, which needs a TS runner
  the project does not have.
- **M3**: the 2D view's plate is a mid-tone, so a picture's white highs show
  on it in the light theme.
- **M4**: the two new fonts are Marck Script (a script, Latin + Cyrillic)
  and Frank Ruhl Libre (a Hebrew serif with Latin), both OFL.
- **M4**: arc sides, where the spec's words were ambiguous: outside — the
  baseline on the circle, letters outwards, along the top, read clockwise;
  inside — the baseline on the circle, letters towards the centre, along the
  bottom, upright, read left to right.
- **M4**: `text.engraveDeep` is not raised: the depth's range (≤ T − 0.4)
  already keeps 0.4 mm of base, so the case cannot happen.
- **M4**: element boxes moved to `geo/boxes.ts`; text boxes measured from
  their rasters are kept there by the app (`measuredTextBoxes`), the worker
  does not need them.
