# Plate Builder — specification

A web app that builds a flat plate (a door sign, a keychain, a pet tag, a
house number, a medal) for 3D printing and exports it as STL. The person
puts images whose brightness becomes height, texts and holes on a plate,
chooses the plate's outline, and downloads a file ready for the slicer.

The app is called **Plate Builder** everywhere a person sees it; the
repository is `plate-builder`. It is a sibling of
[Case Constructor](../../case-constructor/) and
[ClayForm](../../clayform/): the same stack, the same architectural
invariants (a pure geometry core, CSG in a worker, sanitised state), and a
lot of code to borrow (see "Borrowed from siblings" at the end).

The source of this document is `plans/INITIAL-IDEA.md` plus the decisions
taken with the user on 2026-11-04 (listed in `plans/PLAN.md`).

## 1. Units, frames and words

- Everything is in **millimetres**, angles in degrees, counter-clockwise
  positive as seen from the front.
- The **plate frame**: x to the right, y up as the plate is seen from the
  front, z out of the front face. The back face lies at **z = 0** (it is
  the face on the print bed); the top of the base is at **z = T**, the
  plate's thickness.
- The origin is the centre of the outline for primitives, vignettes and
  SVG outlines. For the crop outline (§2.4), which follows the elements,
  the origin stays where it was; the outline moves around the elements.
- **Base**: the slab of thickness T under the whole outline.
- **Relief**: everything above the base — images, raised texts, the rim,
  the vignette's frame. Every relief height is measured from z = T.
- **Element**: an image, a text or a hole. Each has a position (x, y) of
  its centre, a rotation, a size, and its own parameters.

## 2. The plate

### 2.1 Thickness

`T` from 0.6 to 20 mm, default 3. Everything else stands on it or cuts
into it.

### 2.2 Outline kinds

| Kind                                                  | Parameters                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| Rectangle                                             | width, height                                                   |
| Ellipse (circle when equal)                           | width, height                                                   |
| Triangle (isosceles, apex up)                         | width, height                                                   |
| Regular polygon                                       | width, height (the polygon is fitted and stretched), sides 5–12 |
| Star                                                  | width, height, points 4–12, inner ratio 0.2–0.9                 |
| Heart, shield, tag (a rectangle with one pointed end) | width, height                                                   |
| Vignette (§2.5)                                       | catalog entry, width, height, keep proportions                  |
| Own SVG (§2.6)                                        | file, width, height, keep proportions                           |
| Crop around the elements (§2.4)                       | padding                                                         |

Every kind has **corner rounding** r (0 … the largest that keeps the
outline): the outline is shrunk by r and grown back by r with round joins,
so any convex corner becomes an arc of radius r and the size does not
change. A rectangle with r = 0 keeps sharp corners.

### 2.2a Edges

The plate's outer top and bottom edges, all along the outline, can be
**rounded** (a quarter circle) or **chamfered** (45°) with one size `e`
(0 = sharp, up to half the outer wall's height and 10 mm): both edges, the
top one only or the bottom one only, the other staying sharp. The
outer wall is `T`, plus the rim's or a vignette's / own SVG's frame height
when either stands on the outline (the higher of the two): with a rim, its
top's outer edge is the one rounded, its inner edge stays sharp.

- At a distance `t < e` from the back face or from the wall's top (where
  that edge is rounded), the plate's section is the outline shrunk by the profile's inset there
  (`e − √(e² − (e − t)²)` for a fillet, `e − t` for a chamfer); above the
  wall by `e` with a top edge. So within `e` of the outline everything is
  cut down to the top edge: the base, the rim, the frame, an image or a raised text that
  reaches it. A thin part narrower than `2e` gets a ridge.
- The profile is built from **terraces**, each the outline shrunk by the
  profile's inset at the terrace's middle, each piece of the profile at most
  0.5 mm (preview) or 0.1 mm (export, a printed layer's scale) long, 4–48
  per edge; terraces whose insets differ by less than 0.025 mm are merged.
  The stack is built as one mesh, not by booleans.
- Holes, the rim's inner side and a frame's windows keep sharp edges.
- A fillet's lowest layers overhang the bed a little; the chamfer prints
  without any; with the top edge only, the whole back face lies on the bed.

### 2.3 Rim

An optional raised border along the outline: width 0.8–20 mm, height
0.2–10 mm above the base. It is the outline minus the outline shrunk by the
width, so it follows any kind, including vignettes and crops. Holes cut
through it like through everything else.

### 2.4 Crop around the elements

The outline follows the elements themselves:

1. Each image contributes its **mask**: pixels whose height (after levels,
   inversion and smoothing, §3) is above the image's **crop threshold**
   (0–100 % of its relief height, default 10 %). Transparent pixels have
   height 0, so a PNG with transparency and a logo on a white background
   (inverted) both work.
2. Each text with **"In the outline"** on (default on) contributes its ink.
3. An image can be left out of the outline with the same switch (default on).
4. The masks are unioned, grown by the **padding** (0–30 mm, default 3,
   round joins) and their inner holes are filled: only outer contours stay.
5. Corner rounding (§2.2) applies on top.

Elements that sit apart give separate islands; a warning says so (a plate
printed as two pieces is rarely what was meant) and suggests more padding.
Holes do not take part in the outline.

### 2.5 Vignettes

A vignette is a decorative **closed frame**: its outer edge is the plate's
outline, and the frame itself may be a raised ornament.

- The catalog is a set of SVG files in `public/vignettes/` with an index
  (`id`, a name per language, source URL, author, licence). Only CC0 /
  public domain files go in (OpenClipart, publicdomainvectors.org, Wikimedia
  Commons PD categories); every entry's licence is checked and recorded.
  Expected size of v1's catalog: 10–15 frames (cartouche, oval wreath,
  scrolled corners, Art Nouveau, Art Deco, a medal's laurels, a ribbon
  banner…).
- An entry must be one filled silhouette (one colour) with a single outer
  contour and an inner window. `scripts/vignettes.mjs --check` verifies
  each file and renders a contact sheet.
- Parameters: width and height (stretched to them unless "keep proportions"
  is on), **frame relief** on/off (default on), frame height 0.2–10 mm.
- The outline is the outer contour of the silhouette; the frame relief is
  the silhouette itself, raised by its height. With the frame off, the
  vignette is just a figured outline.

The SVG is rasterised by the browser (§8.3) and traced into contours, so
there is no SVG path parser in the app.

### 2.6 Own SVG outline

The person uploads an SVG; it is handled like a vignette (the same
rasterisation and tracing; frame relief available). Its filled area is the
plate; a file whose silhouette has several outer contours gives several
islands and the same warning as the crop.

## 3. Images

Up to 8 images. Each is uploaded as PNG, JPEG, WebP, GIF (first frame) or
SVG, decoded by the browser and kept as **grayscale + alpha**, at most
**512 px** on the long side (the limit is to be confirmed by measurement in
M3 of the plan; 1024 is the fallback if 512 looks coarse on a 150 mm plate).

Parameters:

| Parameter                           | Range                | Default                |
| ----------------------------------- | -------------------- | ---------------------- |
| Size (long side on the plate)       | 5–300 mm             | fits 60 % of the plate |
| Position x, y                       | anywhere             | the plate's centre     |
| Rotation                            | 0–360°               | 0                      |
| Relief height (white = full height) | 0.1–10 mm            | 1.5                    |
| Invert (black = full height)        | on/off               | off                    |
| Levels: black point, white point    | 0–255, black < white | 0, 255                 |
| Smoothing (blur radius)             | 0–5 px               | 0                      |
| Crop threshold (§2.4)               | 0–100 %              | 10 %                   |
| In the outline (§2.4)               | on/off               | on                     |

The height at a point is `h = height · L(v) · a`, where `v` is the pixel's
brightness (inverted when asked), `L` the levels mapping clamped to 0…1,
`a` the alpha, all sampled bilinearly between pixel centres. Outside the
picture h = 0. Where images overlap, the higher one wins (**max**, not a
sum). Images are always raised; an engraved image is not in v1.

The card shows the processed picture (what will become height: white is
high) so the effect of levels and inversion is visible before the 3D view
catches up.

## 4. Texts

Up to 10 text blocks. Each has:

| Parameter                    | Range                                                                                                          | Default                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Text                         | up to 10 lines, 300 characters                                                                                 | "Text"                 |
| Font                         | one of the bundled fonts                                                                                       | Rubik                  |
| Size (capital letter height) | 2–100 mm                                                                                                       | 8                      |
| Line spacing                 | 0.8–2.0 × size                                                                                                 | 1.2                    |
| Alignment                    | left, centre, right                                                                                            | centre                 |
| Raised / engraved            |                                                                                                                | raised                 |
| Height (raised)              | 0.2–10 mm                                                                                                      | 1                      |
| Depth (engraved)             | 0.2 mm … T − 0.4 mm                                                                                            | 0.6                    |
| Position x, y; rotation      |                                                                                                                | centre, 0              |
| On an arc                    | on/off                                                                                                         | off                    |
| Arc radius                   | 5–300 mm                                                                                                       | half the plate's width |
| Arc side                     | outside (letters stand on the arc, read along its top) / inside (letters hang under it, read along its bottom) | outside                |
| In the outline (§2.4)        | on/off                                                                                                         | on                     |

- **Fonts**: 5–7 OFL fonts bundled as woff2 in `public/fonts/` (Latin and
  Cyrillic subsets, Hebrew where the font has it): Rubik (with Hebrew),
  Oswald, PT Serif, Comfortaa (from the siblings), plus a script font and a
  Hebrew serif to be picked in M4. They load only when a text uses them;
  nothing comes from a CDN, so a rebuild always gets the same letters.
- **Rasterised text**: the browser draws the text block into a canvas at
  10 px/mm (`ctx.direction` follows the text, so Hebrew is shaped right to
  left); the contours are traced from that raster with sub-pixel accuracy
  (§8.3). There is no font parser and no own font upload in v1.
- **Multi-line**: lines are laid out by the app with the font's measured
  advance; alignment is per block.
- **On an arc**: the block (one line; extra lines are joined with spaces
  and a note says so) is drawn as a straight strip and its contours are
  bent onto the arc: x along the strip becomes the angle, y the radius. The
  block's position is the arc's centre, its rotation turns the middle of
  the text away from the top. The letters keep their kerning; they come out
  slightly wedge-shaped, as on a coin. A text longer than the circle is
  squeezed to fit, with a warning.
- **Raised** text is solid from just inside the base up to `T + height`.
  It adds to whatever is under it; a warning says when an image under it is
  higher than the text (the text would be buried).
- **Engraved** text is cut from `T − depth` upwards through everything, so
  it cuts into images and the rim too.

## 5. Holes

Up to 16 holes, each cutting through everything above it.

| Kind                            | Parameters                                       | Default                  |
| ------------------------------- | ------------------------------------------------ | ------------------------ |
| Round                           | diameter 1–50 mm                                 | 4                        |
| Slot (stadium)                  | length 2–100 mm, width 1–30 mm, rotation         | 12 × 3                   |
| Countersunk                     | screw diameter 2–8 mm, head diameter, 90° cone   | M4: 4.5 / 8.5            |
| Keyhole (hidden, from the back) | screw head diameter, shank diameter, slot length | head 8, shank 4, slot 10 |

- **Countersunk**: a through hole for the screw, a 90° cone down from the
  top of the base, and the head's cylinder above the base (it clears the
  relief so the head can sit).
- **Keyhole**: a pocket in the back face, closed at the front. From the
  back: an entry hole of the head's diameter, then a slot of the shank's
  width through the back skin (the lip) and a channel of the head's width
  behind it, along the slot. Sizes follow Case Constructor's keyholes
  (`extras.ts`, `keyholeSizes`). It needs `T ≥` lip + head height + front
  skin (about 5 mm for an M4 head); thinner plates get a warning with the
  thickness needed. It prints with the back on the bed: the channel's
  ceiling is a short bridge.
- Position, rotation (slots and keyholes; a keyhole's slot points towards
  its rotation, up by default — the plate hangs down from the screw).

## 5a. Magnets

Up to 4 round magnets of one size, set into the back face (`state.magnets`;
not elements: they are placed by a layout, not one by one).

| Parameter | Range     | Default | What                                                   |
| --------- | --------- | ------- | ------------------------------------------------------ |
| count     | 0–4       | 0       | 0: no magnets                                          |
| layout    | by count  | first   | see below; a count change keeps it if the count has it |
| diameter  | 3–30 mm   | 10      | the magnet's                                           |
| thickness | 0.5–10 mm | 2       | the magnet's                                           |
| fit       | 0–1 mm    | 0.2     | added to the diameter                                  |
| edge      | 1–30 mm   | 3       | material between a pocket and the outline              |

Layouts: 1 — centre, top; 2 — row, column, top corners; 3 — triangle,
triangle point down, row, column; 4 — corners, diamond, row, column.

- **Pocket**: a cylinder of `diameter + fit` open at the back, `thickness +
0.1` deep, so the magnet is flush with the back face (its hold drops fast
  with a gap). The magnets are glued in after printing.
- **Placement**: each layout is a set of anchors in the outline's box,
  inset by the pocket's radius and the edge (rows spread evenly); the edge
  is counted from the foot of the plate's bottom edge (§2.2a), `e` in from
  the outline when the bottom edge is rounded, so a pocket never opens into
  it. An anchor
  whose pocket comes closer than the edge to the outline slides towards the
  box's middle until it fits. The 2D view and the worker place them with the
  same function on the same outline rings. Magnets take no part in a crop.
- The 2D view draws the pockets dashed; they cannot be selected.

## 6. How the solid is made

```
plate = ( base ∪ rim ∪ frame ∪ images ∪ raised texts ) ∩ outline prism
        − engraved texts − holes − magnet pockets
```

- **base**: the outline extruded from z = 0 to T.
- **outline prism**: the outline extruded from z = 0 to well above the
  highest relief; it clips everything to the plate. An element that pokes
  out of the outline is clipped, and a warning names it. With edges (§2.2a)
  the base and this prism are the terraced stack instead of a plain
  extrusion: it rounds or chamfers what reaches the edge.
- **images**: each image is a heightfield solid built in the image's own
  frame on a regular grid (§8.4), its bottom inside the base and its zero
  level `ε` below `T` (so it never shares a plane with the base's top), then
  turned and moved into place. Their union is the max of the heights.
- **raised texts, rim, frame**: 2D contours (cross-sections) extruded from
  just inside the base to their heights.
- **engraved texts**: contours extruded from `T − depth` to above the top.
- **holes**: cutters as in §5.
- **magnet pockets**: cylinders from below the back face to their depth
  (§5a), each a micron deeper than the one before, so no two cutters share
  a plane.
- Booleans are done once at the end: one union of everything additive, one
  intersection, one subtraction of the union of cutters.

The result must be a closed manifold mesh: watertight, no degenerate
triangles, positive volume. Every build checks it; a failed check blocks
export and reports what went wrong.

**Printing**: back face on the bed, no supports needed (everything rises
from the base, keyhole channels are bridges).

## 7. Editor

### 7.1 Layout

Case Constructor's look: a dark theme only, with an emerald accent; dense
cards with uppercase titles.

- **Top bar**: the brand; the project's name, which opens the **presets**
  dialog (built-in and own presets; closed by ✕, Esc or a click beside
  it; a pick closes it); 📄 new (an empty 100 × 60 rectangle), 💾 save
  as preset, 📂 open a project file, ⬇️ save it, ↶ ↷ undo and redo; 🌐
  the language. On a phone it takes two lines:
  the brand and the language, then the name and the buttons.
- **Phone (mobile first)**: the view fills the screen; the panel is a
  bottom sheet that can be pulled up, as in Case Constructor. A switch
  above the view toggles **2D / 3D**.
- **Tablet and desktop (≥ 1024 px wide)**: the panel on the start side
  (left; right in Hebrew), the 2D editor and the 3D view side by side, the
  3D one smaller; a button swaps their sizes.

### 7.2 Panel

Cards, top to bottom:

1. **Plate** — outline kind and its parameters, thickness, corner rounding,
   rim, vignette frame, crop padding.
2. **Texts**, **Images**, **Holes** — a card per kind, as Case
   Constructor's labels sit in their card. Its title shows the count and
   the limit ("Texts 2 / 10"); in it a foldable card per element (an icon,
   a name, a hint — a text's first line, a hole's kind —, a visibility
   toggle, duplicate, delete) and "+ Add …" at the end, disabled at the
   limit. The open card is the selected element's and holds its
   parameters, with exact numeric fields for position, size and rotation.
   A click on a closed card's head selects the element, on the open one
   deselects it; selecting in the 2D view opens its card and brings it
   into view.
3. **Warnings** — each with a "show" action that frames its spot in the 2D
   view.
4. **Export** — the project's name (it names the files), STL download, the
   print hints (§9).

A slider row is, from 1024 px, one line: the name, − slider +, the exact
number and its unit; on a phone the name stands above. − and + move by the
slider's step, one undo step a click.

### 7.3 2D view

A top view of the plate on a canvas (device-pixel-ratio aware), drawn by
the main thread without waiting for the worker:

- the outline (the last one the worker returned; for primitives it is
  computed on the main thread at once), the rim and the frame as tints;
- images as their processed height maps (white = high, transparent where
  h = 0), texts as their ink (raised darker, engraved lighter), holes as
  cut-outs; a millimetre grid and the plate's size.

Interaction (pointer events, so mouse, pen and touch alike):

- Tap/click selects; drag moves the selected element; drag on empty space
  pans; wheel or pinch on empty space zooms.
- The selected element has a box with **corner handles** (uniform scale:
  an image's size, a text's size, a hole's diameter / slot length) and a
  **rotation handle**. On touch, a two-finger gesture on the selected
  element scales and rotates it.
- Snapping: the centre to the plate's axes and to other elements' centres
  and axes (within 6 screen px, guides drawn); rotation to 15° steps with
  Shift. Alt (or a toggle on touch) disables snapping.
- Keys: arrows nudge 0.5 mm (Shift: 5 mm), Delete removes, Ctrl/Cmd+D
  duplicates, Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z undo and redo, Escape deselects.
- A drag is one undo step.

### 7.4 3D view

Three.js, orbit controls, the plate lying on a grid, a light from above at
a low angle so a 0.2 mm relief is readable. The mesh is the worker's
preview build (§8.4). While a build runs, the previous mesh stays with a
thin progress bar. Camera presets: front, iso, back (to check keyholes).

## 8. Architecture

### 8.1 Stack

TypeScript 7 (strict, `noEmit`) + Vite, plain TS + DOM (no React), oxlint
(type-aware) + prettier, vitest (+ jsdom for DOM tests), Playwright smoke.
Started from `~/projects/web-app-template` via `/new-web-app`. Dependencies:
`three`, `manifold-3d`. No others without the user's approval.

### 8.2 Modules

```
src/geo/       pure core: no DOM, no Three.js, no WASM
  state.ts       the project's schema, defaults, sanitizers
  outline.ts     primitive outlines as polygons
  contour.ts     marching squares: raster → polygons with holes
  heightmap.ts   an image's height function (levels, invert, alpha, blur)
  grid.ts        heightfield mesh of an image on a grid
  textLayout.ts  line layout, arc bending of contours
  holes.ts       hole cutters as solids' specs
  magnets.ts     magnet layouts on the outline, pocket cutters
  warnings.ts    the warnings that need no CSG
  stl.ts         binary STL encoder
  validate.ts    watertightness and degeneracy checks
src/worker/    CSG with manifold-3d: protocol.ts, client.ts, csg.worker.ts,
               build.ts (the recipe of §6), csg.ts (CsgScope)
src/render/    Three.js scene (3D view)
src/editor/    2D canvas view, hit testing, handles, gestures, snapping
src/ui/        cards, controls, fonts, rasterisers (text, SVG), image import
src/state/     history (undo/redo), storage, presets, project file
src/i18n/      en (the type), ru, uk, he
```

### 8.3 Main thread vs worker

- The **main thread** owns everything that needs the DOM: decoding image
  files, drawing texts with fonts, rasterising SVG. It sends the worker
  plain data: the sanitised state plus rasters (`Uint8Array`, transferred).
- The **worker** owns all CSG. It traces rasters into contours
  (`geo/contour.ts`, pure), builds outlines (corner rounding and the crop
  need `CrossSection.offset`), the solid, and the checks.
- **Tracing**: marching squares on the anti-aliased raster at the 50 %
  level, with linear interpolation along cell edges — smooth contours with
  sub-pixel accuracy, holes kept, orientation by area sign, then simplified
  (tolerance a quarter pixel). Text, vignettes, own SVG and image masks for
  the crop all go through it.
- The main thread never imports WASM; CI greps the main chunk for
  `manifold`.

### 8.4 Builds

Two kinds of worker jobs, each with a queue one job deep (a waiting job is
replaced by a fresher one; a running one cannot be stopped):

| Job       | When                                                               | Returns                                                |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `outline` | on every change of the plate or of an element that shapes the crop | outline polygons, rim and frame contours, island count |
| `mesh`    | 250 ms after the last change (preview) / on Export (full)          | mesh, warnings, check result, timings                  |

The image grid step: **preview** 0.5 mm, **export** the smaller of the
image's pixel size and 0.2 mm, never below 0.1 mm. Flat runs of the grid
(h = 0 and equal heights) are merged before meshing where it does not
break the manifold. An export job is never evicted by previews.

Targets (to be measured and recorded in the project's CLAUDE.md, "what
costs what"): outline job < 50 ms; preview of a 100 × 60 mm plate with one
512 px image and two texts < 500 ms; export of the same < 5 s; export of
the worst case (8 images on 300 × 300 mm) finishes, with a progress bar,
under 60 s.

### 8.5 Invariants

- Everything from outside (UI, localStorage, a project file, a worker
  message) passes `sanitizeState`; sanitizers never throw and are
  idempotent (fuzz-tested).
- Manifold objects live in a `CsgScope` and are disposed.
- No two solids in one boolean share a plane by construction (`ε` offsets,
  as with the heightfield's zero level); where unavoidable, cutters get a
  few microns of jitter (Case Constructor's `JITTER_MM`).
- Time, randomness, storage and browser APIs are parameters, so tests fake
  them.

## 9. Export

- **STL**, binary, millimetres, file name from the project name
  (`door-sign.stl`).
- The export panel shows the plate's overall size and height, triangle
  count, and **print hints**:
  - "Print with the back on the bed; no supports needed."
  - **Colour change**: the distinct heights where the colour can change —
    the top of the base (`T`), the top of the raised texts, of the rim and
    the frame — each as "change filament at Z = … mm (the first layer above
    it)". Images are a gradient, so for them the hint says a colour change
    gives bands, not a picture. A single STL plus this hint is the only
    multi-colour support in v1.
  - **Magnets**: glue them into the pockets after printing (their number and
    size).
- Export is blocked while the mesh check fails; the message says why.

## 10. Warnings

| Code                       | When                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `outline.islands`          | the outline (crop, SVG) has more than one piece                          |
| `outline.empty`            | crop with nothing to crop around, or an SVG with no filled area          |
| `element.outside`          | an element pokes out of the outline and is clipped                       |
| `element.overlap`          | two holes overlap, or a hole crosses a text                              |
| `hole.nearEdge`            | less than 2 mm of material between a hole and the outline                |
| `keyhole.thin`             | the plate is too thin for a hidden keyhole (with the T needed)           |
| `text.thin` / `frame.thin` | strokes thinner than 0.8 mm (two nozzle widths) would not print well     |
| `text.buried`              | a raised text is lower than the image under it                           |
| `text.onEdge`              | a text comes within the top edge's size of the outline and is cut there  |
| `text.engraveDeep`         | engraved depth leaves less than 0.4 mm of base                           |
| `text.arcTooLong`          | an arc text did not fit the circle and was squeezed (with %)             |
| `text.arcLines`            | an arc text had several lines, joined into one                           |
| `relief.tall`              | the relief is more than 3 × T (a tall thin relief on a thin base warps)  |
| `magnet.thin`              | less than 0.8 mm over a magnet's pocket (with the T needed)              |
| `magnet.noRoom`            | a pocket does not fit with its edge, or two pockets are under 1 mm apart |
| `magnet.overlap`           | a pocket crosses a hole, or an engraving leaves under 0.4 mm over it     |
| `mesh.invalid`             | the mesh check failed (blocks export)                                    |

Thin strokes are found in the worker: the contour shrunk by 0.4 mm and grown
back loses more than 5 % of its area. Warnings name the element ("Text 2")
and carry a spot for the 2D view.

## 11. Projects, presets, storage

- **Current project**: saved automatically (debounced) to one versioned
  localStorage key (the app id prefix, `__APP_ID__`). Images are stored
  inside it as small PNG data URLs of the processed grayscale + alpha
  picture (a logo is a few kB, a 512 px photo ~200 kB). If the browser
  refuses to save (quota, private mode), a banner says the project is not
  kept and offers the project file; it goes away once a save succeeds.
- **Project file**: `*.plate.json` download and upload, the same schema
  with its version; a foreign or broken file is refused with a message. A
  field added later (the magnets, the edges) is filled with its default when
  a save or a file lacks it, so the version stays.
- **Undo / redo** over the whole state, a drag or a slider move being one
  step.
- **Built-in presets** (7): door sign (rectangle, two lines, two
  countersunk holes), keychain (crop around a name, round hole), pet tag
  (circle, arc text, small hole), house number (vignette with frame, a big
  number, two keyholes), medal (circle, image, arc text, rim), name plate
  with a logo, fridge magnet (crop around an apple and a text, two
  magnets). Their pictures are drawn for the project (no third-party
  images). A first visit opens the first preset.
- **User presets**: "save as preset", rename, delete; kept in storage like
  the project.

## 12. Languages, PWA, deploy

- Interface in **English** (the default and fallback, `en.ts` is the
  type), **Russian**, **Ukrainian** and **Hebrew** (RTL: `dir="rtl"` on
  `<html>`, logical CSS properties; the 2D view's numbers stay LTR). Order:
  saved choice → `navigator.languages` → `en`. Static texts via
  `data-i18n`; tests check every key in every language.
- **PWA**: manifest and the template's own service worker precaching the
  build, fonts and vignettes included — the app works offline.
- **Deploy**: GitHub Pages via GitHub Actions on every push to `main`
  (`npm ci`, `npm run check`, `npm run build`, the `manifold` grep, upload).
- Licence: GPL-3.0-or-later. Fonts: OFL, licence files next to them.
  Vignettes: CC0 / public domain, sources in their index.

## 13. Limits

| What                  | Limit                                                      |
| --------------------- | ---------------------------------------------------------- |
| Plate width / height  | 10–300 mm                                                  |
| Thickness             | 0.6–20 mm                                                  |
| Images                | 8, ≤ 512 px stored, files up to 20 MB on input             |
| Texts                 | 10 blocks, 10 lines, 300 characters each                   |
| Holes                 | 16                                                         |
| Magnets               | 4                                                          |
| Highest relief        | 10 mm above the base                                       |
| Raster for text / SVG | 10 px/mm, ≤ 4096 px per side (coarser beyond, with a note) |

## 14. Not in v1

- Engraved (sunken) images; lithophanes (light through the plate).
- Elements on the back face (except keyholes).
- Vector fonts from font files, own font upload.
- Multi-part STL or 3MF for multi-material printers.
- Stands, mounting accessories; magnets other than round ones, or placed
  one by one, or closed inside the plate (§5a).
- Curved or bent plates.

## 15. Borrowed from siblings

| What                                                | From                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| Image file → grayscale (averaging, Rec. 601)        | `clayform/src/ui/ornament.ts` (extend with alpha)                               |
| Bilinear sampling, inversion                        | `clayform/src/geo/mark.ts`                                                      |
| Fonts loading, subsets, OFL files                   | `clayform/src/ui/fonts.ts`, `case-constructor/src/ui/fonts.ts`, `public/fonts/` |
| Text raster in the main thread, raster sanitizer    | `case-constructor/src/ui/labelRaster.ts`, `geo/label.ts`                        |
| Arc layout of a text strip                          | `clayform/src/geo/mark.ts` (`markLayout`)                                       |
| Raster → CrossSection → extrude                     | `case-constructor/src/geo/extrasSolids.ts` (`labelSolid`)                       |
| Keyhole sizes                                       | `case-constructor/src/geo/extras.ts`                                            |
| Worker protocol and one-deep queue, `CsgScope`      | `case-constructor/src/worker/`, `geo/csg.ts`                                    |
| STL encoder, mesh validation                        | `case-constructor/src/geo/stl.ts`, `validate.ts`                                |
| Three.js scene                                      | `case-constructor/src/render/scene.ts`                                          |
| History, project file, user presets, storage banner | `case-constructor/src/state/`, `ui/storageNote.ts`                              |
| Cards, controls, mobile sheet                       | `case-constructor/src/ui/`                                                      |
| Smoke / snap harness                                | `case-constructor/scripts/`                                                     |
