# Agents guide

Plate Builder — a static, offline-capable web app that builds a flat plate
(a door sign, a keychain, a pet tag, a house number, a medal) for 3D
printing and exports it as STL. TypeScript + Vite, no framework, Three.js
for the 3D view, manifold-3d (WASM) for CSG in a module worker. UI in
English, Russian, Ukrainian and Hebrew (RTL). Deployed to GitHub Pages.

What to build: `docs/spec.md`. The order of work: `plans/PLAN.md`.

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

## Architectural invariants

- `src/geo/` is the pure core: no DOM, no Three.js, no WASM; tested in Node.
- All CSG runs in the worker (`src/worker/`). The main thread never imports
  `manifold-3d`; CI greps the main chunk for `manifold`.
- Everything from outside (UI, localStorage, a project file, a worker
  message) passes `sanitizeState`; sanitizers never throw and are idempotent
  (fuzz-tested).
- Manifold objects live in a `CsgScope` and are disposed.
- No two solids in one boolean share a plane by construction (`ε` offsets);
  where unavoidable, cutters get a few microns of jitter.
- The worker client keeps one waiting job per lane; a replaced job resolves
  to `null`; an export is never replaced by a preview.
- Time, randomness, storage and browser APIs are parameters, so tests fake
  them.

## What costs what

Measured on an M1 Mac, Chromium, worker time (`ms` of the job), from the smoke.

| Operation                                                                                  | Time    |
| ------------------------------------------------------------------------------------------ | ------- |
| first preview of the default plate (100 × 60 rectangle, 204 triangles), WASM load included | 6–13 ms |
| export of the same, STL encoding included                                                  | 1 ms    |
| export click → file saved (main thread, download included)                                 | ~110 ms |

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
  `sanitizeState`), `outline.ts` (primitive outlines as polygons), `mesh.ts`
  (`SurfaceMesh`, normals), `stl.ts` (binary STL, file names), `validate.ts`
  (watertightness, volume, what blocks an export).
- `src/worker/` — `protocol.ts` (typed messages), `client.ts` (lazy worker,
  one-deep queue per lane), `csg.worker.ts` (thin adapter), `jobs.ts` (what
  each job does), `build.ts` (the recipe of the solid), `csg.ts` (manifold
  loading, `CsgScope`); all but the adapter tested in Node with real WASM.
- `src/render/` — `view.ts` (what the app needs from the 3D view, types
  only), `scene.ts` (Three.js; checked by the smoke, not vitest).
- `src/ui/` — `controls.ts` (declarative slider / number / select / check
  rows), `plateCard.ts` (the Plate card's controls), `dom.ts`.
- `src/i18n/` — `en.ts` defines the messages, `ru.ts`, `uk.ts`, `he.ts` follow
  its type; `index.ts` — locales, detection, text direction, `staticText`;
  `plural.ts` — `Intl.PluralRules` helper.
- `src/storage.ts` — versioned, validated settings in localStorage.
- `src/sw-plugin.ts` — Vite plugin emitting `sw.js` that precaches the build;
  `src/pwa.ts` — its registration.
- `src/style.css` — mobile first, logical properties, light and dark.
- `public/` — manifest, icons (`icon.svg` is the source).
- `docs/` — the spec, user and design docs.

## Scripts

- `scripts/smoke.mjs` — the browser smoke (grows with each milestone).
- `scripts/lib/harness.mjs` — flags, vite on 5373/4373, console errors.
- `scripts/icons.mjs` — PWA icons from `public/icon.svg`.

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
- Do not change the stored format without bumping `VERSION` in
  `src/storage.ts` and a test for the reset or migration.
- No `as` casts in app code; a disabled lint rule carries its reason.
- A helper script that may be needed again goes to `scripts/` with a header
  comment and a line in this file. A new browser check is a step or a flag in
  `scripts/smoke.mjs`, not a new file.
- Each milestone gets its own branch and a pull request.
