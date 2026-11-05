# Plate Builder — edge fillet

A new plate parameter, **edge fillet** ("Скругление рёбер"): the plate's
outer top and bottom edges, all along the outline, become a quarter circle
(or a 45° chamfer) of size `r` instead of a sharp 90° edge. Case
Constructor has the same parameter (`shape.edgeR`, `param.edgeR`); its
geometry (a loft of rounded rectangles turned into a solid by a convex
hull) does not carry over: a plate's outline is any shape, mostly not
convex.

Spec §14 lists "chamfered or rounded top edge of the plate" as not in v1;
this work moves it in.

One branch (`m12-edge-fillet`), one pull request. Every step keeps
`npm run check` and `npm run smoke` green; every behaviour change starts
with a failing test.

## Decisions made with the user (2026-11-05)

| Question   | Decision                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Edges      | **Top and bottom**, always both, **one size** for the two (as Case Constructor): at most half the outer wall's height.                  |
| Profile    | **A fillet or a chamfer** (45°): a select beside the size.                                                                              |
| Rim, frame | **The outer top edge of what stands on the outline** is rounded (the rim's or the frame's top); the rim's inner edge stays sharp.       |
| Presets    | **The small ones get it**: keychain, pet tag, medal, fridge magnet; the door sign, house number, name plate stay sharp. A new plate: 0. |

## Measured before planning (Node, manifold-3d 3.5.4, M1)

Top-edge fillet `r = 1.5` on a plate `T = 3`:

| Outline                 | Terraces, 8 / 16 levels              | Minkowski (eroded prism ⊕ sphere) |
| ----------------------- | ------------------------------------ | --------------------------------- |
| rectangle 100 × 60      | 4 ms / 1 ms                          | 3 ms                              |
| 5-point star (10 vert.) | 4 ms / 3 ms                          | 636 ms                            |
| heart, 800 vertices     | 55 ms / 103 ms (33k / 63k triangles) | crashes (WASM out of bounds)      |

So the edges are built from **terraces**: robust on any outline and cheap;
Minkowski on a non-convex outline is slow and fails. A smooth loft between
the offset outlines is not possible in general: offsetting changes a
ring's vertex count and topology (thin parts vanish, islands split).

## Defaults taken without asking (say if any is wrong)

- **Fields**: `plate.edgeSize`, mm, range 0–10, default 0 (sharp);
  `plate.edgeProfile`: `'fillet' | 'chamfer'`, default `'fillet'`. Like
  `rounding`, the sanitizer caps the size, here at half the outer wall's
  height `zEdge` (`T`, plus the rim's or frame's height when either stands
  on the outline: the higher of the two): the two edges must not meet.
  `T = 3` without a rim allows 1.5 mm.
- **Controls** in the Plate card right after corner rounding, for every
  outline kind: the slider "Edge fillet" / "Скругление рёбер" /
  "Заокруглення ребер" / "עיגול מקצועות" (Case Constructor's texts), hint
  "the top and bottom outer edges, mm; 0 = sharp"; the select "Edge
  profile": fillet / chamfer 45°, shown when the size is above 0.
- **Geometry**: at height `z` the plate's section is the outline shrunk
  by `inset(z)`. Fillet: `r − √(r² − (r − t)²)` with `t` the distance from
  the nearer of `0` and `zEdge` while `t < r`, else 0; chamfer: `r − t`.
  Above `zEdge` the inset stays `r`. So within `r` of the outline
  everything is trimmed to the edge's surface: the base, the rim, the
  frame, and any image or raised text that reaches the edge (a full-bleed
  photo gets a rounded edge too). Where the shrunk outline is empty or
  loses a thin part, that part gets a ridge instead of a flat top — what a
  ball rolled along it would leave. The back face that touches the bed is
  the outline shrunk by `r`.
- **Levels**: a fillet's are uniform in angle along the quarter circle, a
  chamfer's uniform in height; the profile between two levels is at most
  0.5 mm long for a preview and 0.1 mm for an export (the printer's layer
  scale: a sliced print shows no steps of its own); at least 4 levels per
  edge, at most 48. A 1.5 mm fillet: 5 levels per edge / 24.
- **Booleans**: the edges are one more cutter, in the one subtraction at
  the end (no new boolean pass, no shared walls). Per level, the prism of
  `outline.offset(+CUT_OVERLAP) − outline.offset(−inset)`: a top level
  from its `z` to above the top, a bottom level from below the back face
  (`−CUT_OVERSHOOT`) to its `z`. A level that falls on `T`, a rim's,
  frame's, text's or a magnet pocket's height gets a few microns of
  jitter; an empty band is skipped (an empty prism empties the solid in
  manifold).
- **Pure part** in `src/geo/edges.ts`: `wallHeight(plate)`,
  `edgeLevels(plate, quality)` (heights and insets of both edges),
  `edgeInset`. The cutter itself (`edgeCutter`) in `worker/build.ts`.
- **Magnets**: their `edge` (material between a pocket and the outline)
  is counted from the foot of the bottom edge, so the positions use
  `edge + r`: the pocket never opens into the fillet. With `r = 0` nothing
  moves. `magnet.noRoom` follows the same distance. Then no pocket reaches
  the top edge's band either (`r` ≤ the pocket's distance), so
  `magnet.thin` does not change.
- **Holes**: their edges stay sharp; a hole in the edge band simply cuts
  through it (`hole.nearEdge` already warns).
- **Warnings** (spec §10), main thread, none blocks export:
  `text.onEdge` (new) — a text's box comes within `r` of the outline: its
  edge would be rounded off. Images do not get it (full-bleed is usually
  meant). Texts in four languages.
- **2D view**: nothing new is drawn; the 3D view shows the edges (the
  magnets move with `r`, so the 2D view gets `edgeSize` where it places
  them — the same `magnetPositions` call as the worker).
- **Print hints** (colour-change heights): unchanged — the edges do not
  move `T` or the reliefs' tops.
- **Printing**: a fillet's lowest layers overhang (a 1 mm fillet on 0.2 mm
  layers hangs out up to ~0.4 mm per layer at first); small fillets print
  well, the chamfer always does. The guide says so; no warning.
- **Presets**: keychain, pet tag (`T = 2`), medal — fillet 0.8 mm; fridge
  magnet — fillet 1 mm.
- **Storage**: the fields are new; the sanitizer fills them with 0 and
  `'fillet'`, so saves, user presets and `*.plate.json` without them open
  unchanged. No `VERSION` / `STATE_VERSION` bump (as at M11); tests prove
  the old shapes load.

## Not in this work

- Different sizes or profiles for the top and the bottom edge, or only one
  of them.
- Rounded edges of holes, of the rim's inner side, of a frame's windows,
  of texts.
- Different sizes along the outline.

## Steps

1. **State** (`geo/state.ts`): `edgeSize`, `edgeProfile`, `RANGES.edgeSize`,
   `EDGE_PROFILES`, defaults, the sanitizer's cap at half the wall height.
   Tests: defaults, clamps (also after lowering `T` or turning the rim
   off), an unknown profile → `'fillet'`, idempotence, the fuzz test;
   storage and project-file tests: a save without the fields loads with 0
   and `'fillet'`, everything else kept.
2. **Pure geometry** (`geo/edges.ts`): `wallHeight`, `edgeInset`,
   `edgeLevels`. Tests: the levels' count per quality, size and profile;
   bottom levels in `(0, r]`, top ones in `[zEdge − r, zEdge)`; the insets
   on the circle / on the 45° line, monotone; `r = 0` gives none.
3. **Worker** (`worker/build.ts`): the edge cutter joins the cutters.
   Tests with real WASM: watertight for every primitive kind, a vignette,
   a crop, with a rim, with a frame, with an image reaching the edge, with
   magnets and a keyhole, both profiles; a 100 × 60 rectangle with the
   largest size — the top and back faces are the outline shrunk by `r`
   (area check), the volume matches the analytic one within the terraces'
   error; `r = 0` gives exactly today's mesh; every built-in preset still
   builds.
4. **Magnets** (`geo/magnets.ts`): positions and `magnet.noRoom` with
   `edge + r`. Tests: a corner layout moves in by `r`; `r = 0` unchanged.
5. **Warnings** (`geo/warnings.ts`): `text.onEdge`, its texts in four
   languages. Tests: crafted states, none for the defaults.
6. **UI** (`ui/plateCard.ts`, `src/i18n/*`): the slider and the profile
   select after corner rounding. jsdom tests: the rows for every kind, the
   select hidden at 0, one undo step per change.
7. **Smoke** (`scripts/smoke.mjs`): a plate with a 1.5 mm fillet and a
   rim, then a chamfer, the exports pass the mesh check; the timings
   printed (preview / export) for the default plate, the heart, the
   reference plate.
8. **Presets** (`state/presets.ts`): the sizes above. Tests: they build
   watertight with no warning; the smoke's "every preset builds without a
   warning" covers them in the browser.
9. **Docs**: spec §2.2a "Edges" (new), §5a (the magnets' edge counted from
   the fillet's foot), §6 (the recipe: − edges), §10 (`text.onEdge`), §11
   (the new fields load with defaults), §14 (the line removed);
   `docs/guide-plate.md` with a picture from `scripts/snap.mjs`; AGENTS.md
   (layout: `geo/edges.ts`; plans index; what costs what); a line in
   `plans/PLAN.md`.

## Deviations

- **No cutter: the prism itself is terraced.** Planned as one more cutter
  in the final subtraction. Built instead: the outline's prism — the base
  and the prism that clips the reliefs — is a stack of slabs, each the
  outline shrunk by its terrace's inset, built **directly as one mesh**
  (walls, the ring-shaped steps between neighbours triangulated by
  `manifold.triangulate`, the two caps), no boolean at all. Two
  boolean versions were measured first and dropped: a union of nested
  cores, and a union of stacked slabs — both ~10× slower (a heart with a
  1.5 mm fillet: preview 414 ms, export 2.4 s; direct: 41 ms / 177 ms),
  because every slab's cap is a fan of long triangles crossing every wall
  of its neighbours. The direct mesh needs neighbouring rings not to cross:
  terraces whose insets differ by less than `EDGE_MIN_GAP` (0.025 mm, over
  twice the shrunk outlines' own error) are merged — near the wall a
  fillet's insets differ by microns.
- **Jitter** (`EDGE_JITTER`, 2.3 µm) moves every terrace's height and inset
  off the profile's own round values: a chamfer's terraces would fall on
  `T` under a rim, on a rim's width or on a keyhole's lip.
- **`wallHeight` lives in `geo/state.ts`**, not `geo/edges.ts`: the
  sanitizer needs it, and `edges.ts` imports `state.ts`.
- **No hint under the slider**: the controls have no hint line; the guide
  explains the size's limit and the profile.
- **The profile's labels**: "Rounded" / "Chamfer 45°" (ru "Скругление" /
  "Фаска 45°"), the select "Edge profile".
