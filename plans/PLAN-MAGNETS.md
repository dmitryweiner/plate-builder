# Plate Builder — magnets on the back

Flat round magnets (a fridge magnet) set into the back of the plate. The
solid gets a cylindrical pocket per magnet, nothing more: no magnet model,
no supports. The person picks how many magnets (1–4), their size, and a
layout (the corners, the middle, a row…); the app finds where they go on
the plate's outline.

Spec §14 lists magnets as "not in v1"; this work moves them in (spec §5a).

One branch (`m11-magnets`), one pull request. Every step keeps
`npm run check` and `npm run smoke` green; every behaviour change starts
with a failing test.

## Decisions made with the user (2026-11-05)

| Question  | Decision                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pocket    | **Open at the back**: the magnet is glued in after printing and sits flush with the back face. No hidden pocket with a print pause. |
| Placement | **Layouts only**: a count, a layout and the edge distance; no offset of the group, no dragging of single magnets.                   |
| Preset    | **A built-in "Fridge magnet" preset**.                                                                                              |

## Defaults taken without asking (say if any is wrong)

- **One setting for the whole plate**, not elements: `state.magnets`, its
  own card "Magnets" after the Holes group. All magnets are the same size
  (a set bought together).
- **Fields and ranges** (mm):

  | Field       | Range                | Default | What                                                     |
  | ----------- | -------------------- | ------- | -------------------------------------------------------- |
  | `count`     | 0–4                  | 0       | 0 = no magnets                                           |
  | `layout`    | per count, see below | first   | where they go                                            |
  | `diameter`  | 3–30                 | 10      | the magnet's                                             |
  | `thickness` | 0.5–10               | 2       | the magnet's                                             |
  | `fit`       | 0–1                  | 0.2     | added to the diameter: room for glue and print tolerance |
  | `edge`      | 1–30                 | 3       | material between a pocket and the outline                |

  The pocket is `diameter + fit` across and `thickness + 0.1` deep: the
  magnet sits flush with the back face. A fridge magnet's hold drops fast
  with any gap, so the pocket is not made deeper "to be safe".

- **Layouts** (which ones a count offers; a count change keeps the layout
  if the new count has it, else takes that count's first):

  | Count | Layouts                                                            |
  | ----- | ------------------------------------------------------------------ |
  | 1     | centre; top (the plate hangs straight from it instead of turning)  |
  | 2     | row (left–right); column (top–bottom); top corners                 |
  | 3     | triangle (top middle + bottom corners); triangle down; row; column |
  | 4     | corners; diamond (the sides' middles); row; column                 |

- **Positions on any outline**: each layout is a set of anchors in the
  outline's box (corners, side middles, the centre; rows spread evenly).
  The box is inset by the pocket's radius plus `edge`. An anchor whose
  pocket would come closer than `edge` to the outline (a circle's "corner",
  a heart's, a rounded rectangle's) slides towards the box's centre until it
  fits. One pure function, `magnetPositions(magnets, outlineRings)`, used by
  both the 2D view (with the outline it draws) and the worker (with
  `outlineRings(section)`), so the two agree. On a crop the magnets follow
  the outline like everything else; they take no part in the crop itself
  (as holes do not).
- **Not draggable**: the 2D view draws the pockets dashed (hidden, as a
  keyhole's channel), they cannot be selected. The back camera of the 3D
  view shows them.
- **Warnings** (spec §10), found on the main thread, spot at the magnet:
  - `magnet.thin` — less than 0.8 mm of front skin over a pocket (with the
    thickness needed), as `keyhole.thin`.
  - `magnet.noRoom` — a pocket does not fit inside the outline with its
    edge even at the centre, or two pockets come closer than 1 mm.
  - `magnet.overlap` — a pocket overlaps a hole, or an engraved text's
    floor comes within 0.4 mm of a pocket's ceiling.
    None blocks export; only `mesh.invalid` does.
- **Storage**: the field is new and the sanitiser fills it with "no
  magnets", so a saved project, a user preset or a `*.plate.json` without it
  opens unchanged. `STATE_VERSION` and `VERSION` in `src/storage.ts` stay:
  a bump resets every save, which the rule exists to make safe, not to
  force. Tests prove the old shapes load (recorded as a deviation).
- **Booleans**: the pockets join the cutters, in the one subtraction at
  the end. A pocket runs from `−CUT_OVERSHOOT` to its depth; its ceiling
  gets a few microns of jitter per magnet so it never shares a plane with a
  keyhole's levels.
- **Limits** (spec §13): 4 magnets.

## Not in this work

- Rectangular / bar magnets, magnets of different sizes on one plate.
- Free placement, a group offset, dragging of single magnets.
- A hidden pocket closed on both sides (a print pause to put the magnets in).
- Polarity marks, a magnet model in the 3D view.

## Steps

1. **State** (`geo/state.ts`): `Magnets`, `MAGNET_LAYOUTS` by count,
   `RANGES` for the fields, `defaultMagnets()`, `sanitizeMagnets` (layout
   valid for the count, else the count's first). Tests: defaults, clamps,
   layout fallback, idempotence; the fuzz test gets magnets. Storage and
   project-file tests: a v2 save and a file without `magnets` load with
   `count: 0`, everything else kept.
2. **Geometry** (`geo/magnets.ts`, pure): pocket size; layout anchors;
   `magnetPositions` (inset box, slide towards the centre until the pocket
   keeps `edge` from the outline); footprints (circles, plate frame);
   `magnetCutters` (prisms, the `Cutter` type of `holes.ts`);
   `magnetMinThickness`. Tests: each layout on a 100 × 60 rectangle lands
   exactly at the inset corners / middles; on a circle the four corners
   sit on the diagonals at `edge` from the rim; a too small plate reports
   no room; row spacing even.
3. **Worker** (`worker/build.ts`): the pockets join the cutters. Tests
   with real WASM: watertight; volume removed = n · π R² · depth; the front
   face's area unchanged (nothing shows through); a pocket under an image
   and under a raised text; every built-in preset still builds.
4. **Warnings** (`geo/warnings.ts`) and their texts in four languages.
   Tests: crafted states for each code, and none for the defaults.
5. **UI**: `SelectControl.options` may be a function of the state (the
   layout list follows the count) — test in `controls.test.ts`; the
   Magnets card in `index.html` (`data-i18n`) and `ui/magnetsCard.ts`
   (count: none / 1–4; layout, diameter, thickness, fit, edge shown when
   there are magnets; a muted line "pocket Ø 10.2 × 2.1 mm"). jsdom tests:
   rows hidden at none, layout options per count, one undo step per change.
6. **2D view** (`editor/editor2d.ts`): pockets drawn dashed at their
   positions, under the elements, not hit-tested.
7. **Smoke** (`scripts/smoke.mjs`): four magnets at the corners, the back
   camera, an export that passes the mesh check; the Magnets card on the
   phone viewport. `--measure` gets a row for the default plate with four
   magnets.
8. **Preset** "Fridge magnet" (`state/presets.ts`, names in four
   languages): a crop around a new picture drawn for the project (an apple,
   in `scripts/preset-pictures.mjs`) and a short raised text, padding 3,
   T = 4, two 10 × 2 magnets in a row. Tests: it builds watertight in Node
   with no warning; the smoke's "every preset builds without a warning"
   covers it in the browser.
9. **Docs**: spec §5a (magnets), §6 (the recipe: − pockets), §10, §13,
   §14; `docs/guide-magnets.md` with a back-view picture from
   `scripts/snap.mjs --view back`; `docs/README.md`; AGENTS.md (layout,
   plans index, what costs what); a line in `plans/PLAN.md`.

## Deviations

_Recorded here as they happen._
