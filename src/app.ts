import { createEditor, type EditorHandle } from './editor/editor2d';
import { allElements, findElement } from './editor/elements';
import { measuredTextBoxes } from './geo/boxes';
import { bounds, primitiveOutline, type Ring } from './geo/outline';
import {
  defaultImage,
  defaultState,
  LIMITS,
  PRIMITIVE_KINDS,
  sanitizeState,
  type FontId,
  type ImageElement,
  type Plate,
  type PlateState,
  type PrimitiveKind,
  type TextElement,
} from './geo/state';
import { maskRings, textRings, type TextRaster } from './geo/textShape';
import type { Raster } from './geo/heightmap';
import { processPixels } from './geo/heightmap';
import { colourChanges } from './geo/printHints';
import { stlFileName } from './geo/stl';
import { warnings as findWarnings, type Warning } from './geo/warnings';
import { detectLocale, direction, isLocale, messages, staticText, type Locale, type Messages } from './i18n';
import type { CameraPreset, SceneHandle } from './render/view';
import { addHole, addText, duplicateElement, nudgeElement, removeElement, toggleVisible } from './state/edit';
import { History } from './state/history';
import { BUILT_IN_PRESETS } from './state/presets';
import { projectFileName, projectFileText, readProjectFile } from './state/projectFile';
import { loadSettings, saveSettings, type KeyValueStorage, type Settings } from './storage';
import { renderControls, type ControlsHandle } from './ui/controls';
import { el, scrollIntoContainer } from './ui/dom';
import { elementsOf, renderElementGroup, syncHints, type ElementActions, type ElementType } from './ui/elementsCard';
import { renderPresetList } from './ui/presetList';
import { setupSheet, type NarrowQuery } from './ui/sheet';
import { heightPicture, type ImportedImage } from './ui/imageImport';
import { silhouetteSize, type VignetteEntry } from './ui/svgRaster';
import { plateControls } from './ui/plateCard';
import { elementControls } from './ui/selectedCard';
import { renderWarnings } from './ui/warningsCard';
import type { JobDone } from './worker/client';
import type { Job, JobResult, MeshResult } from './worker/protocol';

/** The pause after the last edit before a preview is built (spec §8.4). */
export const PREVIEW_DELAY_MS = 250;
/** The pause after the last edit before the project is saved to the browser's storage. */
export const SAVE_DELAY_MS = 1000;
/** Arrow keys move the selected element this far, mm; with Shift ten times as far (spec §7.3). */
export const NUDGE_MM = 0.5;

export interface Timers {
  set(fn: () => void, ms: number): number;
  clear(id: number): void;
}

export interface AppOptions {
  storage?: KeyValueStorage | null;
  /** Browser languages in preference order (`navigator.languages`). */
  languages?: readonly string[];
  /** The CSG worker's client. */
  csg: { run(job: Job): Promise<JobDone<JobResult> | null> };
  /** The 3D view on its canvas; null when there is none (no WebGL). */
  createScene: (canvas: HTMLCanvasElement) => SceneHandle | null;
  /** Saves a file for the person (a download in the browser). */
  download: (name: string, data: ArrayBuffer) => void;
  timers: Timers;
  /** true where the panel is a bottom sheet (a phone); none means never */
  narrow?: NarrowQuery;
  /** Texts are drawn with the bundled fonts: loading one, and drawing a block once its font is in. */
  texts: {
    fontReady(font: FontId): boolean;
    loadFont(font: FontId): Promise<void>;
    rasterize(text: TextElement): TextRaster | null;
  };
  /** Vignettes and own SVG outlines: the catalog, an SVG loaded (its proportions), drawn at a size, a file read. */
  silhouettes: {
    catalog(): Promise<VignetteEntry[]>;
    load(url: string): Promise<number>;
    raster(url: string, widthMm: number, heightMm: number): TextRaster | null;
    readFile(file: File): Promise<string>;
  };
  /** Reading pictures needs the browser's decoders: a file into the stored picture, a stored one back into pixels. */
  pictures: {
    importFile(file: File): Promise<ImportedImage>;
    decode(src: string): Promise<Raster>;
  };
}

/** How many processed pictures the 2D view keeps (each image's current levels, and a few recent ones). */
const PICTURE_CACHE = 24;

/** Translates the static page: texts and labels marked in index.html, title, description, lang and dir. */
function translatePage(locale: Locale, t: Messages) {
  document.documentElement.lang = locale;
  document.documentElement.dir = direction(locale);
  document.title = t.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const text = staticText(t, node.dataset.i18n ?? '');
    if (text !== undefined) node.textContent = text;
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const text = staticText(t, node.dataset.i18nLabel ?? '');
    if (text === undefined) continue;
    node.setAttribute('aria-label', text);
    // an icon button's tooltip says the same
    if (node.hasAttribute('title')) node.title = text;
  }
}

const isCamera = (value: unknown): value is CameraPreset => value === 'front' || value === 'iso' || value === 'back';
const isPrimitive = (kind: Plate['kind']): kind is PrimitiveKind => PRIMITIVE_KINDS.some((k) => k === kind);

/** The outline the 2D view can draw at once, before the worker's (with rounding) arrives. */
const instantOutline = (plate: Plate): Ring[] => [primitiveOutline({ ...plate, kind: isPrimitive(plate.kind) ? plate.kind : 'rectangle' })];

const pictured = (plate: Plate) => plate.kind === 'vignette' || plate.kind === 'svg';
/** The SVG the outline comes from: an uploaded one, or a catalog file (relative to the app). */
const silhouetteUrl = (plate: Plate): string =>
  plate.kind === 'svg' ? plate.svg : plate.kind === 'vignette' && plate.vignette ? `vignettes/${plate.vignette}.svg` : '';

/** What shapes a text's raster and contours: its cache key. */
const textKey = (x: TextElement) =>
  JSON.stringify([x.text, x.font, x.size, x.lineSpacing, x.align, x.arc, x.arc ? x.arcRadius : 0, x.arc ? x.arcSide : '']);

/** 12.5 → "12.5", 3 → "3": sizes without trailing zeros. */
const mm = (value: number) => String(Number(value.toFixed(1)));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Whether a key press belongs to a form field rather than to the editor. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

/** What the view and the export card show about the last build. */
type Build =
  { state: 'idle' } | { state: 'building' } | { state: 'done'; mesh: MeshResult; ms: number } | { state: 'failed'; reason: string };

type Exporting =
  { state: 'idle' } | { state: 'building' } | { state: 'saved'; name: string; ms: number } | { state: 'failed'; reason: string };

/** Starts the app on the current page; returns a function that removes its listeners. */
export function startApp({
  storage = null,
  languages = [],
  csg,
  createScene,
  download,
  timers,
  pictures,
  texts,
  silhouettes,
  narrow = { matches: false, addEventListener: () => {} },
}: AppOptions): () => void {
  const localeSelect = el('locale', HTMLSelectElement);
  const status = el('status', HTMLOutputElement);
  const plateBox = el('plateControls', HTMLElement);
  /** the element groups: their lists, counts and add buttons */
  const groups: { type: ElementType; list: HTMLElement; count: HTMLElement; add: HTMLButtonElement; limit: number }[] = [
    {
      type: 'text',
      list: el('textList', HTMLElement),
      count: el('textsCount', HTMLElement),
      add: el('addText', HTMLButtonElement),
      limit: LIMITS.texts,
    },
    {
      type: 'image',
      list: el('imageList', HTMLElement),
      count: el('imagesCount', HTMLElement),
      add: el('addImage', HTMLButtonElement),
      limit: LIMITS.images,
    },
    {
      type: 'hole',
      list: el('holeList', HTMLElement),
      count: el('holesCount', HTMLElement),
      add: el('addHole', HTMLButtonElement),
      limit: LIMITS.holes,
    },
  ];
  const selectedBody = el('selectedBody', HTMLElement);
  const selectedBox = el('selectedControls', HTMLElement);
  const warningsCard = el('warningsCard', HTMLElement);
  const warningList = el('warningList', HTMLElement);
  const meshInfo = el('meshInfo', HTMLElement);
  const meshBlocked = el('meshBlocked', HTMLElement);
  const downloadButton = el('downloadStl', HTMLButtonElement);
  const exportStatus = el('exportStatus', HTMLOutputElement);
  const exportProgress = el('exportProgress', HTMLProgressElement);
  const storageBanner = el('storageBanner', HTMLElement);
  const bannerSave = el('bannerSave', HTMLButtonElement);
  const projectName = el('projectName', HTMLInputElement);
  const saveProjectButton = el('saveProject', HTMLButtonElement);
  const openProjectButton = el('openProject', HTMLButtonElement);
  const projectFile = el('projectFile', HTMLInputElement);
  const projectStatus = el('projectStatus', HTMLElement);
  const presetList = el('presetList', HTMLElement);
  const presetsOpen = el('presetsOpen', HTMLButtonElement);
  const presetsDialog = el('presets', HTMLElement);
  const presetsClose = el('presetsClose', HTMLButtonElement);
  const savePresetButton = el('savePreset', HTMLButtonElement);
  const buildProgress = el('buildProgress', HTMLProgressElement);
  const printHints = el('printHints', HTMLElement);
  const undoButton = el('undo', HTMLButtonElement);
  const redoButton = el('redo', HTMLButtonElement);
  const addHoleButton = el('addHole', HTMLButtonElement);
  const addImageButton = el('addImage', HTMLButtonElement);
  const addTextButton = el('addText', HTMLButtonElement);
  const vignettePicker = el('vignettePicker', HTMLElement);
  const svgChooser = el('svgChooser', HTMLElement);
  const svgUpload = el('svgUpload', HTMLButtonElement);
  const svgFile = el('svgFile', HTMLInputElement);
  const plateStatus = el('plateStatus', HTMLElement);
  const imageFile = el('imageFile', HTMLInputElement);
  const elementsStatus = el('elementsStatus', HTMLElement);
  const selectedThumb = el('selectedThumb', HTMLCanvasElement);
  const snapping = el('snapping', HTMLInputElement);
  const views = el('views', HTMLElement);
  const scene = createScene(el('view3d', HTMLCanvasElement));
  const panel = el('panel', HTMLElement);
  // the view fits the plate above the sheet: again whenever the sheet comes or goes
  const sheet = setupSheet({
    panel,
    button: el('sheetOpen', HTMLButtonElement),
    close: el('sheetClose', HTMLButtonElement),
    narrow,
    onChange: () => editor.fit(),
  });

  let settings: Settings = loadSettings(storage);
  let locale: Locale = detectLocale(settings.locale, languages);
  // a first visit opens the first preset; afterwards, the project as it was left
  const firstPreset = BUILT_IN_PRESETS[0];
  const history = new History<PlateState>(settings.project ?? firstPreset?.state ?? defaultState());
  /** the preset opened last and the project as it was then: "changed" once they differ */
  let opened: { id: string; json: string } | null =
    settings.project || !firstPreset ? null : { id: firstPreset.id, json: JSON.stringify(firstPreset.state) };
  let saveTimer: number | null = null;
  let selected: string | null = null;
  let outline: Ring[] = instantOutline(history.state.plate);
  /** the plate the last outline job was asked for, to ask again only when it changes */
  let outlineFor = '';
  let warnings: Warning[] = [];
  let build: Build = { state: 'idle' };
  let exporting: Exporting = { state: 'idle' };
  let previewTimer: number | null = null;
  let stopped = false;
  let plateCard: ControlsHandle<PlateState> | null = null;
  let selectedControls: { id: string; kind: string; handle: ControlsHandle<PlateState> } | null = null;
  /** decoded pictures by their data URL; a failed decode stays null */
  const rasters = new Map<string, Raster | null>();
  const decoding = new Map<string, Promise<void>>();
  /** text rasters and their shapes (element frame, mm), by what shapes them */
  const textShapes = new Map<string, { raster: TextRaster; rings: Ring[] } | null>();
  /** warnings from the last build: what only the contours tell */
  let workerWarnings: Warning[] = [];
  /** what the element lists and the warnings last showed, so they are made again only when it changes */
  let elementListKey = '';
  /** the element whose card was last brought into view */
  let shownSelected: string | null = null;
  const actions: ElementActions = {
    select: (id) => select(id),
    toggle: (id) => update(toggleVisible(state(), id), true),
    duplicate: (id) => duplicate(id),
    remove: (id) => remove(id),
  };
  let warningsKey = '';
  let presetsKey = '';
  /** the vignette catalog, once fetched */
  let catalog: VignetteEntry[] = [];
  /** SVG proportions by URL, once loaded; a failed load stays NaN */
  const aspects = new Map<string, number>();
  /** warnings from the last outline (islands, nothing to crop): fresher than a build's */
  let outlineWarnings: Warning[] = [];
  /** processed height pictures for the 2D view, by picture and levels */
  const processed = new Map<string, CanvasImageSource | null>();

  const t = () => messages[locale];
  const state = () => history.state;

  const editor: EditorHandle = createEditor({
    canvas: el('view2d', HTMLCanvasElement),
    read: state,
    selected: () => selected,
    // on a phone, a selected element brings up its card; a tap on empty space clears the view
    select: (id) => {
      select(id);
      if (narrow.matches) {
        if (id) sheet.open();
        else sheet.close();
      }
    },
    change: (next, final) => update(next, final),
    outline: () => outline,
    snapping: () => snapping.checked,
    sizeLabel: () => sizeLabel(),
    picture: (image) => picture(image),
    textShape: (text) => textShape(text)?.rings ?? null,
    frame: () => frameRings(),
    covered: () => (narrow.matches && sheet.isOpen() ? panel.getBoundingClientRect().height : 0),
  });

  /** The silhouette's contours for the 2D view's frame tint, traced once per raster. */
  let frameCache: { raster: TextRaster; rings: Ring[] } | null = null;
  function frameRings(): Ring[] | null {
    const plate = state().plate;
    if (!pictured(plate) || !plate.frame) return null;
    const raster = silhouette();
    if (!raster) return null;
    if (frameCache?.raster !== raster) frameCache = { raster, rings: maskRings(raster) };
    return frameCache.rings;
  }

  /**
   * A text's raster and contours, once its font is in. A missing font starts
   * loading; the text then waits (it is not drawn with a fallback).
   */
  function textShape(text: TextElement): { raster: TextRaster; rings: Ring[] } | null {
    if (!texts.fontReady(text.font)) {
      void texts.loadFont(text.font).then(
        () => {
          if (stopped) return;
          requestOutline();
          renderState();
          schedulePreview(PREVIEW_DELAY_MS);
        },
        () => {},
      );
      return null;
    }
    const key = textKey(text);
    if (!textShapes.has(key)) {
      if (textShapes.size > 64) textShapes.delete(textShapes.keys().next().value ?? '');
      const raster = texts.rasterize(text);
      textShapes.set(key, raster ? { raster, rings: textRings(raster, text).rings } : null);
    }
    return textShapes.get(key) ?? null;
  }

  /** Measured boxes for the texts whose shapes are known; the rest keep their estimate. */
  function measureTexts(): void {
    measuredTextBoxes.clear();
    for (const text of state().texts) {
      const rings = textShape(text)?.rings;
      if (rings?.length) measuredTextBoxes.set(text.id, bounds(rings));
    }
  }

  const textRasterList = () => state().texts.map((text) => textShape(text)?.raster ?? null);

  /** The silhouette at the plate's size, once its SVG is loaded; a missing one starts loading. */
  function silhouette(): TextRaster | null {
    const { plate } = state();
    const url = silhouetteUrl(plate);
    if (!pictured(plate) || !url) return null;
    const aspect = aspects.get(url);
    if (aspect === undefined) {
      aspects.set(url, Number.NaN);
      silhouettes.load(url).then(
        (loaded) => {
          aspects.set(url, loaded);
          if (stopped) return;
          requestOutline();
          renderState();
          schedulePreview(PREVIEW_DELAY_MS);
        },
        () => {},
      );
      return null;
    }
    if (!Number.isFinite(aspect)) return null;
    const [w, h] = silhouetteSize(plate.width, plate.height, aspect, plate.keepProportions);
    return silhouettes.raster(url, w, h);
  }

  /** The catalog's thumbnails, the chosen one pressed. */
  function renderPicker(): void {
    const { plate } = state();
    vignettePicker.hidden = plate.kind !== 'vignette';
    svgChooser.hidden = plate.kind !== 'svg';
    if (vignettePicker.hidden) return;
    vignettePicker.textContent = '';
    for (const entry of catalog) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vignette';
      button.dataset.id = entry.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(entry.id === plate.vignette));
      button.setAttribute('aria-label', entry.names[locale]);
      button.title = entry.names[locale];
      const img = document.createElement('img');
      img.src = `vignettes/${entry.file}`;
      img.alt = '';
      button.append(img);
      button.addEventListener('click', () => update({ ...state(), plate: { ...state().plate, vignette: entry.id } }, true));
      vignettePicker.append(button);
    }
  }

  /** The plate's size under it in the 2D view: a crop's is its outline's. */
  function sizeLabel(): { size: string; unit: string } | null {
    const { plate } = state();
    const unit = t().mm;
    if (plate.kind !== 'crop' && !pictured(plate)) return { size: `${mm(plate.width)} × ${mm(plate.height)}`, unit };
    if (outline.length === 0) return null;
    const b = bounds(outline);
    return { size: `${mm(b.maxX - b.minX)} × ${mm(b.maxY - b.minY)}`, unit };
  }

  /** Starts decoding the pictures not decoded yet; each, once in, redraws and rebuilds. */
  function ensureRasters(): void {
    for (const { src } of state().images) {
      if (rasters.has(src) || decoding.has(src)) continue;
      decoding.set(
        src,
        pictures.decode(src).then(
          (raster) => {
            rasters.set(src, raster);
            decoding.delete(src);
            if (stopped) return;
            requestOutline();
            renderState();
            schedulePreview(PREVIEW_DELAY_MS);
          },
          () => {
            rasters.set(src, null);
            decoding.delete(src);
          },
        ),
      );
    }
  }

  const rasterList = () => state().images.map((image) => rasters.get(image.src) ?? null);

  function picture(image: ImageElement): CanvasImageSource | null {
    const raster = rasters.get(image.src);
    if (!raster) return null;
    const key = `${image.src.length}:${image.src.slice(-64)}|${image.invert}|${image.black}|${image.white}|${image.blur}`;
    if (!processed.has(key)) {
      if (processed.size >= PICTURE_CACHE) processed.delete(processed.keys().next().value ?? '');
      processed.set(key, heightPicture(processPixels(raster, image), raster.width, raster.height));
    }
    return processed.get(key) ?? null;
  }

  const renderStatus = () => {
    const m = t();
    if (build.state === 'building') status.textContent = m.building;
    else if (build.state === 'done') status.textContent = m.builtIn(build.ms);
    else if (build.state === 'failed') status.textContent = m.engineFailed(build.reason);
    else status.textContent = '';

    const mesh = build.state === 'done' ? build.mesh : null;
    if (mesh) {
      const { min, max } = mesh.report.bbox;
      meshInfo.textContent = `${m.meshSize(mm(max[0] - min[0]), mm(max[1] - min[1]), mm(max[2] - min[2]))} · ${m.triangles(mesh.report.triangleCount)}`;
    }
    const problems = mesh?.problems ?? [];
    meshBlocked.hidden = problems.length === 0;
    meshBlocked.textContent = problems.length ? m.meshBlocked(problems.map((p) => m.meshProblem[p]).join(', ')) : '';
    downloadButton.disabled = exporting.state === 'building' || problems.length > 0;

    // manifold says nothing from inside a boolean: the bars run until the job is done
    buildProgress.hidden = build.state !== 'building';
    exportProgress.hidden = exporting.state !== 'building';
    if (exporting.state === 'building') exportStatus.textContent = m.exporting;
    else if (exporting.state === 'saved') exportStatus.textContent = m.exported(exporting.name, exporting.ms);
    else if (exporting.state === 'failed') exportStatus.textContent = m.engineFailed(exporting.reason);
    else exportStatus.textContent = '';
  };

  /** The parts that follow the state: cards, lists, warnings, the 2D view, undo buttons. */
  const renderState = () => {
    const s = state();
    const m = t();
    measureTexts();
    plateCard?.sync(s);
    renderPicker();
    // lists are made again only when they change: a click that blurs a field (whose change re-renders)
    // must find its button still there on mouseup
    const listKey = JSON.stringify([
      locale,
      selected,
      allElements(s).map((e) => [e.id, e.type, e.type === 'hole' ? e.kind : '', e.visible]),
    ]);
    if (listKey !== elementListKey) {
      elementListKey = listKey;
      // parked while no card is open; a card that opens takes it
      selectedBody.hidden = true;
      panel.append(selectedBody);
      for (const group of groups) {
        renderElementGroup(group.list, group.type, s, selected, m, actions, selectedBody);
      }
      // a selection made elsewhere (the 2D view, a key, a new element) shows its card's head
      if (selected !== shownSelected) {
        shownSelected = selected;
        const head = selectedBody.closest('.element-row')?.querySelector('.element-head');
        if (head) scrollIntoContainer(panel, head);
      }
    }
    for (const group of groups) {
      const n = elementsOf(s, group.type).length;
      group.count.textContent = `${n} / ${group.limit}`;
      group.add.disabled = n >= group.limit;
      syncHints(group.list, s, group.type, m);
    }

    const element = findElement(s, selected);
    if (element) {
      const kind = element.type === 'hole' ? element.kind : element.type;
      // the rows are made again only for another element or kind; a value change just syncs them
      if (selectedControls?.id !== element.id || selectedControls.kind !== kind) {
        const handle = renderControls(selectedBox, elementControls(element.id), {
          read: state,
          change: (next, final) => update(next, final),
          idPrefix: 'element',
          t: m,
        });
        selectedControls = { id: element.id, kind, handle };
      } else selectedControls.handle.sync(s);
    } else {
      selectedControls = null;
      selectedBox.textContent = '';
    }
    drawThumb(element?.type === 'image' ? element : null);

    measureTexts();
    // the worker's warnings belong to the build they came from: kept only for elements still there
    const fromBuild = workerWarnings.filter((w) => !w.code.startsWith('outline.') && w.ids.every((id) => findElement(s, id)));
    const ink = new Map(
      s.texts.flatMap((text) => {
        const rings = textShape(text)?.rings;
        return rings ? [[text.id, rings] as const] : [];
      }),
    );
    warnings = [...outlineWarnings, ...findWarnings(s, outline, ink), ...fromBuild];
    // the last build's mesh check: a warning that blocks the export
    const problems = build.state === 'done' ? build.mesh.problems : [];
    if (problems.length) warnings.push({ code: 'mesh.invalid', ids: [], spot: [0, 0] });
    const shownKey = JSON.stringify([locale, warnings.map((w) => ({ ...w, spot: null })), problems, allElements(s).map((e) => e.id)]);
    if (shownKey !== warningsKey) {
      warningsKey = shownKey;
      renderWarnings(
        warningsCard,
        warningList,
        warnings,
        s,
        m,
        (index) => {
          const spot = warnings[index]?.spot;
          if (!spot) return;
          views.dataset.show = '2d';
          editor.frame(spot);
        },
        problems,
      );
    }
    renderHints();
    if (document.activeElement !== projectName) projectName.value = s.name;
    presetsOpen.textContent = s.name;
    presetsOpen.title = m.presetsHeading;
    presetsOpen.setAttribute('aria-label', `${m.presetsHeading}: ${s.name}`);
    renderPresets();
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
    editor.draw();
  };

  /** The selected image's height map in its card: the effect of levels before the 3D view catches up. */
  function drawThumb(image: ImageElement | null): void {
    const source = image ? picture(image) : null;
    const ctx = source ? selectedThumb.getContext('2d') : null;
    selectedThumb.hidden = !ctx;
    if (!ctx || !source || !image) return;
    const long = Math.max(image.pixelWidth, image.pixelHeight);
    selectedThumb.width = Math.round((240 * image.pixelWidth) / long);
    selectedThumb.height = Math.round((240 * image.pixelHeight) / long);
    selectedThumb.title = t().heightPreview;
    ctx.clearRect(0, 0, selectedThumb.width, selectedThumb.height);
    ctx.drawImage(source, 0, 0, selectedThumb.width, selectedThumb.height);
  }

  function renderPresets(): void {
    const changed = opened && JSON.stringify(state()) !== opened.json ? opened.id : null;
    const key = JSON.stringify([locale, changed, settings.presets.map((p) => [p.id, p.name])]);
    if (key === presetsKey) return;
    presetsKey = key;
    renderPresetList(presetList, BUILT_IN_PRESETS, settings.presets, changed, t(), locale, {
      open: (id) => {
        openPreset(id);
        closePresets();
      },
      rename: (id, name) => {
        settings = {
          ...settings,
          presets: settings.presets.map((p) => (p.id === id && name.trim() ? { ...p, name: name.trim().slice(0, 60) } : p)),
        };
        persist();
        renderState();
      },
      remove: (id) => {
        settings = { ...settings, presets: settings.presets.filter((p) => p.id !== id) };
        if (opened?.id === id) opened = null;
        persist();
        renderState();
      },
    });
  }

  /** Opens a project in place of the current one: one step, so undo brings the old one back. */
  function openProject(next: PlateState, preset: string | null): void {
    selected = null;
    history.commit(sanitizeState(next));
    opened = preset ? { id: preset, json: JSON.stringify(state()) } : null;
    afterChange();
    editor.fit();
  }

  /** The presets dialog over everything; closed, the focus goes back to its button. */
  const openPresets = () => {
    presetsDialog.hidden = false;
    presetsOpen.setAttribute('aria-expanded', 'true');
    presetsClose.focus();
  };
  const closePresets = () => {
    if (presetsDialog.hidden) return;
    presetsDialog.hidden = true;
    presetsOpen.setAttribute('aria-expanded', 'false');
    presetsOpen.focus();
  };
  const onPresetsBackdrop = (event: MouseEvent) => {
    if (event.target === presetsDialog) closePresets();
  };

  function openPreset(id: string): void {
    const preset = BUILT_IN_PRESETS.find((p) => p.id === id) ?? settings.presets.find((p) => p.id === id);
    if (preset) openProject(preset.state, id);
  }

  /** Saves to the browser's storage; the banner says so when it refuses, and goes once a save works. */
  function persist(): void {
    if (saveTimer !== null) timers.clear(saveTimer);
    saveTimer = null;
    settings = { ...settings, project: state() };
    storageBanner.hidden = saveSettings(storage, settings);
  }
  const schedulePersist = () => {
    if (saveTimer !== null) timers.clear(saveTimer);
    saveTimer = timers.set(persist, SAVE_DELAY_MS);
  };

  const saveProjectFile = () => download(projectFileName(state().name), new TextEncoder().encode(projectFileText(state())).buffer);
  const pickProject = () => projectFile.click();
  const onProjectFile = () => {
    const file = projectFile.files?.[0];
    projectFile.value = '';
    if (!file) return;
    projectStatus.hidden = true;
    void file.text().then((text) => {
      if (stopped) return;
      const read = readProjectFile(text);
      if (read.ok) {
        openProject(read.state, null);
        return;
      }
      projectStatus.hidden = false;
      projectStatus.textContent = { broken: t().projectBroken, foreign: t().projectForeign, newer: t().projectNewer }[read.reason];
    });
  };
  const onProjectName = () => update({ ...state(), name: projectName.value }, true);
  const savePreset = () => {
    const n = Math.max(0, ...settings.presets.map((p) => Number(p.id.slice(1)) || 0)) + 1;
    const id = `u${n}`;
    settings = { ...settings, presets: [...settings.presets, { id, name: state().name, state: state() }] };
    opened = { id, json: JSON.stringify(state()) };
    persist();
    renderState();
  };

  /** The print hints (spec §9): the back on the bed, and where a colour change makes sense. */
  function renderHints(): void {
    const m = t();
    const { heights, gradient } = colourChanges(state());
    const lines = [
      m.printBack,
      ...(heights.length > 1 ? heights.map((z) => m.colourChange(mm(z))) : []),
      ...(gradient ? [m.gradientNote] : []),
    ];
    printHints.textContent = '';
    for (const line of lines) printHints.append(Object.assign(document.createElement('li'), { textContent: line }));
  }

  const renderCards = () => {
    plateCard = renderControls(plateBox, plateControls, {
      read: state,
      change: (next, final) => update(next, final),
      idPrefix: 'plate',
      t: t(),
    });
    selectedControls = null;
  };

  const render = () => {
    translatePage(locale, t());
    localeSelect.value = locale;
    renderCards();
    renderState();
    renderStatus();
  };

  const preview = () => {
    previewTimer = null;
    build = { state: 'building' };
    renderStatus();
    csg
      .run({
        kind: 'mesh',
        quality: 'preview',
        state: state(),
        rasters: rasterList(),
        textRasters: textRasterList(),
        silhouette: silhouette(),
      })
      .then(
        (done) => {
          // null: a fresher preview replaced this one and will answer instead
          if (stopped || !done || done.result.kind !== 'mesh') return;
          build = { state: 'done', mesh: done.result, ms: done.ms };
          workerWarnings = done.result.warnings;
          renderState();
          scene?.setMesh({ positions: done.result.positions, indices: done.result.indices });
          renderStatus();
        },
        (error: unknown) => {
          if (stopped) return;
          build = { state: 'failed', reason: errorText(error) };
          renderStatus();
        },
      );
  };

  const schedulePreview = (ms: number) => {
    if (previewTimer !== null) timers.clear(previewTimer);
    previewTimer = timers.set(preview, ms);
  };

  /** The outline with its rounding comes from the worker; until then the primitive's is drawn. */
  /**
   * The crop follows the elements and their pictures: everything that shapes
   * it is in its key, a picture by whether it is decoded yet.
   */
  const outlineKey = (s: PlateState): string => {
    if (pictured(s.plate)) {
      const url = silhouetteUrl(s.plate);
      return JSON.stringify([{ ...s.plate, svg: s.plate.svg.length }, url.slice(-64), Number.isFinite(aspects.get(url) ?? Number.NaN)]);
    }
    if (s.plate.kind !== 'crop') return JSON.stringify(s.plate);
    const images = s.images.map((image) => [image.src.length, image.src.slice(-32), rasters.get(image.src) ? 1 : 0, { ...image, src: '' }]);
    const shaped = s.texts.map((text) => [text, textShape(text) ? 1 : 0]);
    return JSON.stringify([s.plate, images, shaped]);
  };

  const requestOutline = () => {
    const s = state();
    const key = outlineKey(s);
    if (key === outlineFor) return;
    outlineFor = key;
    // a crop or a silhouette keeps its last outline until the new one comes; a primitive's is known at once
    if (s.plate.kind !== 'crop' && !pictured(s.plate)) {
      outline = instantOutline(s.plate);
      outlineWarnings = [];
    }
    const crop = s.plate.kind === 'crop';
    const followed = crop || pictured(s.plate);
    csg
      .run({
        kind: 'outline',
        state: s,
        ...(crop ? { rasters: rasterList(), textRasters: textRasterList() } : {}),
        ...(pictured(s.plate) ? { silhouette: silhouette() } : {}),
      })
      .then(
        (done) => {
          if (stopped || !done || done.result.kind !== 'outline' || key !== outlineFor) return;
          outline = done.result.rings;
          outlineWarnings = done.result.warnings;
          renderState();
          if (followed) editor.fit();
        },
        // a failed outline leaves the instant one; the mesh job reports the failure
        () => {},
      );
  };

  function update(next: PlateState, final: boolean) {
    let clean = sanitizeState(next);
    // a vignette outline without a vignette takes the catalog's first
    const first = catalog[0];
    if (clean.plate.kind === 'vignette' && !clean.plate.vignette && first)
      clean = { ...clean, plate: { ...clean.plate, vignette: first.id } };
    if (final) history.commit(clean);
    else history.live(clean);
    afterChange();
  }

  function afterChange() {
    if (selected && !findElement(state(), selected)) selected = null;
    schedulePersist();
    ensureRasters();
    requestOutline();
    renderState();
    schedulePreview(PREVIEW_DELAY_MS);
  }

  function select(id: string | null) {
    if (id === selected) return;
    selected = id;
    renderState();
  }

  const onImageFile = () => {
    const file = imageFile.files?.[0];
    imageFile.value = '';
    if (!file || state().images.length >= LIMITS.images) return;
    elementsStatus.hidden = true;
    pictures.importFile(file).then(
      (imported) => {
        if (stopped) return;
        rasters.set(imported.src, imported.raster);
        const image = defaultImage(state(), imported.src, imported.width, imported.height);
        const next = sanitizeState({ ...state(), images: [...state().images, image] });
        selected = next.images.at(-1)?.id ?? null;
        update(next, true);
      },
      (error: unknown) => {
        if (stopped) return;
        elementsStatus.hidden = false;
        elementsStatus.textContent = t().imageFailed(errorText(error));
      },
    );
  };
  const pickImage = () => imageFile.click();

  const pickSvg = () => svgFile.click();
  const onSvgFile = () => {
    const file = svgFile.files?.[0];
    svgFile.value = '';
    if (!file) return;
    plateStatus.hidden = true;
    silhouettes.readFile(file).then(
      (svg) => {
        if (stopped) return;
        update({ ...state(), plate: { ...state().plate, kind: 'svg', svg } }, true);
      },
      (error: unknown) => {
        if (stopped) return;
        plateStatus.hidden = false;
        plateStatus.textContent = t().svgFailed(errorText(error));
      },
    );
  };

  const addTextNow = () => {
    const { state: next, id } = addText(state());
    if (!id) return;
    selected = id;
    update(next, true);
  };

  const addHoleNow = () => {
    const { state: next, id } = addHole(state());
    if (!id) return;
    selected = id;
    update(next, true);
  };
  function duplicate(id: string) {
    const { state: next, id: copy } = duplicateElement(state(), id);
    if (!copy) return;
    selected = copy;
    update(next, true);
  }
  function remove(id: string) {
    if (selected === id) selected = null;
    update(removeElement(state(), id), true);
  }
  const undo = () => {
    if (history.undo() !== null) afterChange();
  };
  const redo = () => {
    if (history.redo() !== null) afterChange();
  };

  const onKey = (event: KeyboardEvent) => {
    // the open dialog takes Esc, even from its name fields
    if (!presetsDialog.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePresets();
      }
      return;
    }
    if (typing(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (!selected) return;
    const step = event.shiftKey ? NUDGE_MM * 10 : NUDGE_MM;
    const arrows: Record<string, [number, number]> = {
      arrowleft: [-step, 0],
      arrowright: [step, 0],
      arrowup: [0, step],
      arrowdown: [0, -step],
    };
    const arrow = arrows[key];
    if (arrow) {
      event.preventDefault();
      update(nudgeElement(state(), selected, arrow[0], arrow[1]), true);
    } else if (key === 'delete' || key === 'backspace') {
      event.preventDefault();
      remove(selected);
    } else if (mod && key === 'd') {
      event.preventDefault();
      duplicate(selected);
    } else if (key === 'escape') {
      select(null);
    }
  };

  const onLocale = () => {
    const value = localeSelect.value;
    if (!isLocale(value)) return;
    locale = value;
    settings = { ...settings, locale: value };
    persist();
    render();
  };

  const onExport = () => {
    exporting = { state: 'building' };
    renderStatus();
    const name = stlFileName(state().name);
    // every picture decoded and every font in first: an export never leaves an element out
    ensureRasters();
    Promise.all([...decoding.values(), ...state().texts.map((text) => texts.loadFont(text.font))])
      .then(() =>
        csg.run({
          kind: 'mesh',
          quality: 'export',
          state: state(),
          rasters: rasterList(),
          textRasters: textRasterList(),
          silhouette: silhouette(),
        }),
      )
      .then(
        (done) => {
          if (stopped || !done || done.result.kind !== 'mesh') return;
          const { stl, problems } = done.result;
          if (stl && problems.length === 0) {
            download(name, stl);
            exporting = { state: 'saved', name, ms: done.ms };
          } else {
            exporting = { state: 'idle' };
            build = { state: 'done', mesh: done.result, ms: done.ms };
          }
          renderStatus();
        },
        (error: unknown) => {
          if (stopped) return;
          exporting = { state: 'failed', reason: errorText(error) };
          renderStatus();
        },
      );
  };

  const onViews = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const camera = event.target.closest<HTMLElement>('[data-camera]')?.dataset.camera;
    if (isCamera(camera)) scene?.setCamera(camera);
    const show = event.target.closest<HTMLElement>('.view-tabs [data-show]')?.dataset.show;
    if (show === '2d' || show === '3d') {
      views.dataset.show = show;
      editor.draw();
    }
    if (event.target.closest('#swapViews')) {
      views.classList.toggle('swapped');
      editor.draw();
    }
  };

  localeSelect.addEventListener('change', onLocale);
  downloadButton.addEventListener('click', onExport);
  views.addEventListener('click', onViews);
  undoButton.addEventListener('click', undo);
  redoButton.addEventListener('click', redo);
  addHoleButton.addEventListener('click', addHoleNow);
  addImageButton.addEventListener('click', pickImage);
  addTextButton.addEventListener('click', addTextNow);
  svgUpload.addEventListener('click', pickSvg);
  bannerSave.addEventListener('click', saveProjectFile);
  saveProjectButton.addEventListener('click', saveProjectFile);
  openProjectButton.addEventListener('click', pickProject);
  projectFile.addEventListener('change', onProjectFile);
  projectName.addEventListener('change', onProjectName);
  savePresetButton.addEventListener('click', savePreset);
  presetsOpen.addEventListener('click', openPresets);
  presetsClose.addEventListener('click', closePresets);
  presetsDialog.addEventListener('click', onPresetsBackdrop);
  svgFile.addEventListener('change', onSvgFile);
  silhouettes.catalog().then(
    (entries) => {
      catalog = entries;
      if (!stopped) renderPicker();
    },
    () => {},
  );
  imageFile.addEventListener('change', onImageFile);
  document.addEventListener('keydown', onKey);
  ensureRasters();
  requestOutline();
  render();
  editor.fit();
  schedulePreview(0);

  return () => {
    stopped = true;
    if (previewTimer !== null) timers.clear(previewTimer);
    localeSelect.removeEventListener('change', onLocale);
    downloadButton.removeEventListener('click', onExport);
    views.removeEventListener('click', onViews);
    undoButton.removeEventListener('click', undo);
    redoButton.removeEventListener('click', redo);
    addHoleButton.removeEventListener('click', addHoleNow);
    addImageButton.removeEventListener('click', pickImage);
    addTextButton.removeEventListener('click', addTextNow);
    svgUpload.removeEventListener('click', pickSvg);
    bannerSave.removeEventListener('click', saveProjectFile);
    saveProjectButton.removeEventListener('click', saveProjectFile);
    openProjectButton.removeEventListener('click', pickProject);
    projectFile.removeEventListener('change', onProjectFile);
    projectName.removeEventListener('change', onProjectName);
    savePresetButton.removeEventListener('click', savePreset);
    presetsOpen.removeEventListener('click', openPresets);
    presetsClose.removeEventListener('click', closePresets);
    presetsDialog.removeEventListener('click', onPresetsBackdrop);
    if (saveTimer !== null) {
      timers.clear(saveTimer);
      persist();
    }
    svgFile.removeEventListener('change', onSvgFile);
    imageFile.removeEventListener('change', onImageFile);
    document.removeEventListener('keydown', onKey);
    editor.dispose();
    scene?.dispose();
  };
}
