# Plate Builder — the Case Constructor look, in emerald

The interface takes the design of `~/projects/case-constructor`: a dark,
dense panel of uppercase-titled cards, a top bar that carries the project's
actions, slider rows with − / + — in an emerald colour scheme. The element
list splits into groups by kind, as Case Constructor's "Labels" card holds
its labels: a "Texts" card with each text in it, "Images", "Holes".

One branch (`design-emerald`), one pull request. Every step keeps
`npm run check` and `npm run smoke` green; a step that changes behaviour
starts with a failing test.

## Decisions made with the user (2026-11-04)

| Question       | Decision                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme          | **Dark only**, as Case Constructor (`color-scheme: dark`). The light theme goes away.                                                                                                |
| Element groups | **Accordion inside the groups**: each element a foldable card in its kind's card; the selected one is open with its controls. The separate "Selected element" card goes away.        |
| Top bar        | **As in Case Constructor**: "Presets…" (a modal list), 💾 save as preset, 📂 open a project file, ⬇️ save it, ↶ ↷, 🌐 language. The Project and Presets parts leave the Export card. |
| Slider rows    | **As in Case Constructor plus the exact field**: the label at the start, − slider +, then the number field and its unit, in one line.                                                |

## Defaults taken without asking (say if any is wrong)

- **Accent**: emerald `#34c38f` (hover/strong `#5fd6a8`), soft fill
  `rgb(52 195 143 / 14%)`, text on it `#04201a`. The rest of the palette is
  Case Constructor's: `--bg #15181c`, `--panel #1c2026`, `--card #252a31`,
  `--text #e4e9ef`, `--muted #94a0ad`, `--line #343b44`, `--warn #e3b341`,
  `--bad #e06c5c`.
- **Group order**: Texts, Images, Holes (the user's example starts with
  texts).
- **A group card's head**: `Texts · 2 / 10` — the count and the limit; the
  add button is disabled at the limit instead of an error after the click.
- **An element's head**: caret, kind icon, name ("Text 1"), and a muted
  hint after it: a text's first line, a hole's kind ("slot"); then the
  visibility switch, duplicate, delete.
- **The project name** (it names the STL and the project file) moves to the
  Export card, right above "Download STL"; the "Presets…" button shows it,
  as Case Constructor's shows the open preset.
- **RTL**: the full mirroring of this project stays (`dir="rtl"`, logical
  properties); Case Constructor's text-only RTL is not taken.
- **Mobile first** stays: base rules for a phone, `min-width` queries up;
  the bottom sheet stays as it is, restyled. On a phone the top bar wraps
  into two lines as in Case Constructor; touch targets stay ≥ 40 px there,
  the desktop gets Case Constructor's density (14 px text, 22–28 px
  controls).
- **The 3D view and the 2D canvas** take the page's background (`#15181c`
  family); the plate's material colour stays.
- **Icon and manifest**: the icon recoloured emerald on the dark
  background, `theme_color` / `background_color` from the palette, PNGs
  re-rendered with `npm run icons`.
- No change to the stored format: `VERSION` in `src/storage.ts` stays.

## Not in this work

- Turning selects into segmented buttons (hole kind, alignment, font) —
  possible later, one control at a time.
- Case Constructor's progress bar, port captions, warning badges on the
  model: the plate's own warnings card and "show" stay.

## Steps

### D1 — Palette and base

- `src/style.css`: Case Constructor's tokens with the emerald accent on
  `:root`, the `prefers-color-scheme` block removed, `color-scheme: dark`;
  body 14 px; cards `--card` on `--panel` with uppercase muted `h2`;
  buttons `tb-btn` / `primary` / `secondary` in Case Constructor's shapes;
  inputs and selects on `--panel`; the focus ring in the accent.
- 2D editor canvas tokens (`--editor-bg`, `--editor-grid`,
  `--editor-plate`, `--editor-edge`) for the dark scheme; fallbacks in
  `editor2d.ts` follow.
- `src/render/scene.ts`: clear colour and grid from the palette.
- `index.html` `theme-color`, `public/manifest.webmanifest`,
  `public/icon.svg`, `npm run icons`.
- Test first: `theme-color` in `index.html` equals the manifest's
  `theme_color` (they drifted apart easily so far).

### D2 — Slider rows

- `src/ui/controls.ts`: a range row is `label | − slider + | exact field |
unit` in one grid line; the label column ~96 px (Russian and Ukrainian
  labels wrap inside it rather than squeeze the slider). Check, select and
  text rows line up with the same label column.
- − / + move by the control's `step`, clamp to its range, and are one undo
  step each (`final = true`); their `aria-label`s are translated
  ("Decrease Width", "Increase Width").
- Tests first in `controls.test.ts`: − and + change the value by `step`,
  stop at `min` / `max`, call `change(…, true)`; a hidden (`when`) row hides
  its buttons too. New messages in `en.ts` → `ru`, `uk`, `he`.

### D3 — Element groups (the accordion)

- `index.html`: the Elements and Selected cards replaced by three cards —
  `#textsCard`, `#imagesCard`, `#holesCard` — each with a list and a wide
  "+ Add …" button at its end.
- `src/ui/elementsCard.ts` → renders one group: a foldable card per element
  (`.fcard`, head as in "Defaults"). The open card is exactly the selected
  element: a click on a closed head selects it (and the 2D view follows),
  a click on the open head deselects. Selecting in the 2D view opens its
  card and scrolls it into view (`block: 'nearest'`); on a phone the sheet
  opens as now.
- The controls' container is one node that moves into the selected
  element's card; the lists are rebuilt only when their key changes (ids,
  kinds, visibility, selection, language), never on a value change — a text
  being typed keeps its focus. A text's hint in its head follows its text
  without a rebuild. The image's height thumbnail moves into its card.
- `selectedCard.ts` keeps the controls themselves (unchanged); the title
  and the thumbnail wiring in `app.ts` move to the group renderer.
- Tests first in `app.test.ts` (jsdom, the real `index.html`): adding a
  text puts an open card into Texts and none elsewhere; selecting a hole in
  the list opens its card and closes the text's; a click on the open head
  deselects; delete removes the card; duplicate adds an open copy; a group
  head shows `n / limit` and its add button disables at the limit; typing
  in a text field keeps focus and updates the head's hint; a language
  switch keeps the open card. The existing tests that use `#elementList`,
  `#selectedCard`, `#selectedTitle` move to the new structure.

### D4 — Top bar and the presets dialog

- `index.html`: the top bar as in Case Constructor — brand, "Presets…"
  (shows the project name, ellipsis when long), 💾, 📂, ⬇️, ↶, ↷, spacer,
  🌐 + language select. Each icon button has a translated `title` and
  `aria-label` (`data-i18n-label` plus a `data-i18n-title` attribute
  handled by `staticText`).
- A `#presets` dialog: the built-in presets and the user's (rename,
  delete, "changed" mark — `presetList.ts` as now), a close button, Esc and
  a click on the backdrop close it, focus returns to the button.
- The Export card keeps: the project name, "Download STL", its progress
  and status, the print hints. The storage banner's "Save project file"
  stays where it is.
- Phone: the top bar in two lines (brand, presets, language; then the
  buttons), no horizontal scroll at 360 px.
- Tests first: the dialog opens and closes (button, Esc, backdrop), picking
  a preset loads it and closes the dialog; 💾 / 📂 / ⬇️ do what the old
  buttons did; every new `data-i18n-*` key exists in every language (the
  existing check covers it once the attribute is known to it).

### D5 — The rest restyled

- Warnings card, export card, banner, vignette picker, sheet handle and
  "Settings" button, the view overlays (2D / 3D tabs, cameras, swap, snap)
  in Case Constructor's style: translucent dark chips, the active one in
  the accent outline and soft fill.
- `scripts/smoke.mjs`: selectors follow D3 / D4; a phone step (390 × 844)
  checks no horizontal overflow of the top bar and that selecting in the 2D
  view scrolls the open element card into the sheet; a Hebrew step checks
  the groups mirror.
- Shots at 1280 × 860 and 390 × 844 in English and Hebrew looked at before
  the step is done.

### D6 — Docs

- `docs/spec.md` §7.1–7.2: the top bar, the cards (Plate, Texts, Images,
  Holes, Warnings, Export), the accordion, the presets dialog, dark only.
- `docs/guide-*.md`: where things moved (presets and files to the top bar,
  an element's controls in its group); every picture in `docs/images/`
  re-shot with `scripts/snap.mjs` (`--select` opens the element's card in
  its group; `--panel` scrolls to it).
- `AGENTS.md`: the layout lines for `elementsCard.ts`, `selectedCard.ts`,
  `presetList.ts`; this plan in the plans table. `plans/PLAN.md`:
  a line under Deviations pointing here.

## Risks

- **Focus while typing** (D3): moving the controls' node between cards
  blurs a focused field. It moves only on a selection change, which never
  happens mid-typing; the test pins it.
- **Dense rows on a phone** (D2): − / + next to a slider and a number field
  in 360 px. If the shot shows the slider shorter than ~120 px, the phone
  drops − / + (the exact field already gives precision).
- **Docs pictures** (D6): about ten shots; `snap.mjs` makes them
  repeatable, but each one is looked at.
