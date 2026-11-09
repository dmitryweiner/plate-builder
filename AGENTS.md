# Agents guide

Plate Builder — a static, offline-capable web app that builds a flat plate
(a door sign, a keychain, a pet tag, a house number, a medal) for 3D
printing and exports it as STL. TypeScript + Vite, no framework, Three.js
for the 3D view, manifold-3d (WASM) for CSG in a module worker. UI in
English, Russian, Ukrainian and Hebrew (RTL). Deployed to GitHub Pages.

What to build: `docs/spec.md`. The order of work: `plans/PLAN.md`.

Built on **maker-kit** (`~/projects/maker-kit`, the shared library of the
3D-printing tools), installed by git tag in `package.json`. Its modules are
imported as `maker-kit/core/history` and so on; its docs are in its
`docs/`. Moving onto it is maker-kit's milestone M1, one PR per group. For
joint work on the app and the kit: `npm link ../maker-kit`; a kit change
reaches the app as a new tag.

The shared conventions behind this setup are in `~/projects/CLAUDE.md` and
`~/projects/_conventions/`; this file is what holds for this repository.

## Commands

Node.js — the version in `.node-version` (`fnm use`; check `node -v`).

- `npm ci` — install dependencies.
- `npm run dev` — dev server.
- `npm run check` — typecheck + oxlint + prettier + unit tests. Must pass before
  any work is called done.
- `npm run smoke` — browser smoke on the dev server (port 5373); `-- --preview`
  builds and serves on 4373, and also checks offline mode; `-- --shots` saves
  screenshots to `shots/`.
- `npm run build` — typecheck and build into `dist/`.
- `npm run format` — prettier.
- `npm run icons` — render the PWA PNG icons from `public/icon.svg`.

CI (`.github/workflows/ci.yml`) runs `check`, the preview smoke and the
`manifold` grep over the main chunk on every push and PR; a push to `main`
publishes `dist/` to GitHub Pages.

## Plans

| File                    | What                                     |
| ----------------------- | ---------------------------------------- |
| `plans/INITIAL-IDEA.md` | the idea as first written                |
| `plans/PLAN.md`         | milestones M0…M10, decisions, deviations |
| `plans/PLAN-DESIGN.md`  | Case Constructor's look, element groups  |
| `plans/PLAN-MAGNETS.md` | magnet pockets on the back (M11)         |
| `plans/PLAN-FILLET.md`  | rounded or chamfered edges (M12)         |

## Architectural invariants

- `src/geo/` is the pure core: no DOM, no Three.js, no WASM; tested in Node.
- All CSG runs in the worker (`src/worker/`). The main thread never imports
  `manifold-3d`; CI greps the main chunk for `manifold`.
- Everything from outside (UI, localStorage, a project file, a worker
  message) passes `sanitizeState`; sanitizers never throw and are idempotent
  (fuzz-tested).
- Manifold objects live in a `CsgScope` and are disposed.
- The edges are no boolean: the outline's prism is one terraced mesh
  (`edgedPrisms` in `worker/build.ts`); neighbouring terraces' insets differ
  by at least `EDGE_MIN_GAP`, so their rings never cross.
- No two solids in one boolean share a plane by construction (`ε` offsets);
  where unavoidable, cutters get a few microns of jitter.
- The worker client keeps one waiting job per lane; a replaced job resolves
  to `null`; an export is never replaced by a preview.
- Time, randomness, storage and browser APIs are parameters, so tests fake
  them.

## What costs what

Measured on an M1 Mac, Chromium, worker time (`ms` of the job), with
`npm run smoke -- --measure` (last full pass at M10).

| Operation                                                                                  | Time                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| first preview of the default plate (100 × 60 rectangle, 204 triangles), WASM load included | 4–13 ms                                                 |
| export of the same, STL encoding included                                                  | 1 ms                                                    |
| export click → file saved (main thread, download included)                                 | ~75 ms                                                  |
| the default plate with four magnets at the corners (1036 triangles) — preview / export     | 15 ms / 8 ms                                            |
| the default plate with a 1.5 mm fillet (1868 triangles) — preview / export                 | 16 ms / 29 ms                                           |
| a 100 × 60 heart with a 1.5 mm fillet or chamfer (17k triangles) — preview                 | ~45 ms                                                  |
| a cartouche vignette with its frame and a 2 mm fillet — preview / export                   | 44 ms / 104 ms                                          |
| preview with four holes, one of each kind (100 × 60 × 6, 1300 triangles)                   | ~15 ms                                                  |
| one raised text "PLATE BUILDER" on an arc, 8 mm (7.8k triangles) — preview                 | ~60 ms                                                  |
| crop around a 36 mm picture and a text, padding 3, with its outline job                    | ~200 ms                                                 |
| crop around a 37 mm line-art JPEG (threshold 10 %, its dark background's noise) — preview  | 360 ms (7 s before the mask's holes were filled first)  |
| **reference plate** (spec §8.4: 100 × 60, a 512 px image, two texts) — preview             | 380 ms (target 500)                                     |
| the same — export                                                                          | 1.9 s (target 5)                                        |
| 100 × 60 plate, one 512 px image of 55 mm — preview (0.275 mm grid, 81k triangles)         | 300 ms                                                  |
| the same — export (0.107 mm grid, the pixel size; ~530k triangles)                         | 1.6 s                                                   |
| 300 × 300 plate, one 512 px image of 290 mm — preview (675k triangles)                     | 2.0 s                                                   |
| the same — export (0.2 mm grid, ~4.2M triangles)                                           | 14.5 s                                                  |
| **worst case**: eight 100 mm photos tiling 300 × 300 — export                              | 22.6 s in the worker, 26.5 s from the click (target 60) |

Decided at M3: 512 px stays (at 150 mm a pixel is 0.29 mm, under a 0.4 mm
nozzle's line), and flat-run merging is not built: the reference plate is
well within its targets, and on a 300 mm plate the preview, not the export,
is what waits; if that matters, the first step is a coarser preview grid for
huge images.

## Test-driven development is mandatory

Every behaviour change goes red → green → refactor:

1. Write a failing test that describes the new behaviour or reproduces the bug.
   Run it and see it fail for the expected reason.
2. Write the minimal code that makes it pass.
3. Refactor with the tests green.

Pure logic → `*.test.ts` in node; anything touching the DOM → jsdom
(`// @vitest-environment jsdom`, the real `index.html`); what needs a real
browser (service worker, layout, workers) → a step in `scripts/smoke.mjs`.

## Layout

- `src/main.ts` — entry: starts the app with browser storage, languages, the
  CSG worker client, the 3D view and the download; registers the service
  worker in production.
- `src/app.ts` — DOM wiring: translation of the page, the cards, the preview
  after a pause in the edits, the export.
- `src/geo/` — the pure core: `state.ts` (schema, ranges, defaults,
  `sanitizeState`), `outline.ts` (primitive outlines as polygons),
  `heightmap.ts` (an image's height function), `grid.ts` (its heightfield
  solid), `contour.ts` (marching squares), `textLayout.ts` (line alignment,
  arc bending), `textShape.ts` (a text raster's contours), `boxes.ts`
  (element boxes; measured text boxes), `printHints.ts` (colour-change
  heights),
  `holes.ts` (footprints, boxes and cutters of the hole kinds),
  `magnets.ts` (magnet layouts placed on the outline, pockets, cutters),
  `edges.ts` (the edges' profile, terraces and slabs),
  `warnings.ts` (the warnings that need no CSG). Meshes, STL and the
  export gate are maker-kit's `3d/mesh`, `3d/stl`, `3d/validate`.
- `src/worker/` — `protocol.ts` (the jobs and results; the envelope is
  maker-kit's `worker/protocol`), `client.ts` (maker-kit's `WorkerClient`
  with the app's policy), `csg.worker.ts` (a thin adapter over the kit's
  `serveJobs`), `jobs.ts` (what
  each job does), `build.ts` (the recipe of the solid), `csg.ts` (manifold
  loading, `CsgScope`); all but the adapter tested in Node with real WASM.
- `src/editor/` — the 2D view: `view.ts` (mm ↔ px, fit, zoom, pan),
  `elements.ts` (boxes, hit tests, uniform scaling), `gestures.ts` (move,
  corner scale, rotate, pinch, snapping), `editor2d.ts` (pointer events and
  drawing on the canvas).
- `src/state/` — `edit.ts` (add, duplicate, delete, show/hide, nudge,
  element names), `projectFile.ts` (`*.plate.json`, the kit's wrapper),
  `presets.ts` (the built-in presets; their names are `preset.<id>.name`),
  `presetPictures.ts` (their pictures, generated).
- `src/render/` — `view.ts` (what the app needs from the 3D view, types
  only), `scene.ts` (maker-kit's `3d/viewer` behind that interface: Front,
  Angle, Back are the kit's `top`, `iso`, `bottom`; checked by the smoke,
  not vitest).
- `src/ui/` — `plateCard.ts`, `magnetsCard.ts`, `selectedCard.ts` (the cards' rows for maker-kit's `ui/controls`: ids
  `<prefix>_<key>`, `_n`, `_dec`, `_inc`), `elementsCard.ts` (the element groups: a foldable card
  per element, the selected one open), `warningsCard.ts`,
  `imageImport.ts` (files → grayscale + alpha PNG, decoding, height
  pictures), `fonts.ts` (bundled fonts, loaded on first use),
  `textRaster.ts` (a text block drawn at 10 px/mm), `svgRaster.ts`
  (vignette catalog schema, SVG silhouettes, own SVG files), `dom.ts`
  (`scrollIntoContainer`). The rest of the page is maker-kit's: the
  sheet, the bar over the 3D view (`ui/progress`), the storage banner, the
  presets dialog (`ui/modal`) and its list, ↶ ↷ and their keys
  (`ui/historyKeys`; the app's own keys wait while a dialog is open), the
  language picker, downloads (`ui/files`).
- `public/fonts/` — woff2 subsets with their OFL licences.
- `public/vignettes/` — the catalog: `index.json` (id, names in four
  languages, source, author, licence) and one `<id>.svg` each.
- `src/i18n/` — `en.ts` defines the messages (the kit's `kit.*` strings
  spread first), `ru.ts`, `uk.ts`, `he.ts` follow its type; `index.ts` —
  locales, detection, text direction, `staticText`, `translator` (the
  kit's `Translate` over the string messages); `plural.ts` —
  `Intl.PluralRules` helper for the messages that are functions.
- `src/storage.ts` — one versioned key (a kit `StoredRecord`): the language,
  the current project, the user presets; every field sanitised, a refused
  write says why (`full`, `blocked`). Undo and redo: the kit's
  `core/history`.
- `src/sw-plugin.ts` — Vite plugin emitting `sw.js` that precaches the build;
  `src/pwa.ts` — its registration.
- `src/style.css` — Plate Builder's own rules over maker-kit's `kit.css`
  (imported first in `main.ts`; the kit's rules are in `@layer kit`, so
  these win): the two views, element rows, vignettes. The density is the
  kit's (16 px text and 40 px controls on a phone, 14 px and 28 px on a
  desktop); the app's own pieces follow its tokens.
  The palette is the kit's with `data-accent="emerald"` (`--panel` of the
  kit's `tokens.css` is the theme colour, a test keeps `index.html` and the
  manifest equal to it).
- `public/` — manifest, icons (`icon.svg` is the source).
- `docs/` — the spec, user and design docs.

## Scripts

- `scripts/smoke.mjs` — the browser smoke (grows with each milestone);
  `--preview` (build + offline), `--shots` (screenshots), `--measure` (image
  timings for "what costs what"). Each step starts from a blank project
  (seeded storage); `app.first()` opens a first visit.
- `scripts/snap.mjs` — a screenshot in a given state (`--preset`, `--lang`,
  `--width/--height`, `--view`, `--camera`, `--swap`, `--select`, `--panel`,
  `--eval`); the docs' pictures come from it.
- `scripts/preset-pictures.mjs` — draws the built-in presets' pictures (a
  star, a logo, an apple) into `src/state/presetPictures.ts`.
- `scripts/lib/harness.mjs` — maker-kit's harness (`maker-kit/harness`: flags,
  the vite server, console errors, `app.step` / `app.run`, downloads, STL
  checks, throttling) on Plate Builder's ports, 5373/4373.
- `scripts/icons.mjs` — PWA icons from `public/icon.svg`.
- `scripts/vignettes.mjs` — the vignette catalog: `--check` (one piece with
  a window, the index complete, licences allowed), `--sheet <dir>` (a
  contact sheet: each frame and its outline) for review before a new one is
  committed.

## Conventions

- Code comments, docs and README in English.
- The package name in `package.json` is the app id: Vite injects it as
  `__APP_ID__`, the storage key and the service worker's cache prefix. All
  apps on `<user>.github.io` share one origin, so it must be unique.
- Every interface text lives in `src/i18n/`. Static texts in `index.html` are
  marked `data-i18n="key"` (text) or `data-i18n-label="key"` (`aria-label`) and
  keep the English text as the default; tests check every key in every
  language. A new message goes to `en.ts` first; TypeScript then demands it in
  the others.
- Language: the saved choice, else the first supported browser language, else
  English. Switching redraws without losing state. RTL locales set
  `dir="rtl"` on `<html>`; CSS uses logical properties only.
- Do not change the stored format without bumping the record's `version` in
  `src/storage.ts` and a test for the reset or migration.
- No `as` casts in app code; a disabled lint rule carries its reason.
- A helper script that may be needed again goes to `scripts/` with a header
  comment and a line in this file. A new browser check is a step or a flag in
  `scripts/smoke.mjs`, not a new file.
- Each milestone gets its own branch and a pull request.
