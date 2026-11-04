import { createEditor, type EditorHandle } from './editor/editor2d';
import { findElement } from './editor/elements';
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
import { textRings, type TextRaster } from './geo/textShape';
import type { Raster } from './geo/heightmap';
import { processPixels } from './geo/heightmap';
import { stlFileName } from './geo/stl';
import { warnings as findWarnings, type Warning } from './geo/warnings';
import { detectLocale, direction, isLocale, messages, staticText, type Locale, type Messages } from './i18n';
import type { CameraPreset, SceneHandle } from './render/view';
import { addHole, addText, duplicateElement, elementName, nudgeElement, removeElement, toggleVisible } from './state/edit';
import { History } from './state/history';
import { loadSettings, saveSettings, type KeyValueStorage, type Settings } from './storage';
import { renderControls, type ControlsHandle } from './ui/controls';
import { el } from './ui/dom';
import { renderElementList } from './ui/elementsCard';
import { heightPicture, type ImportedImage } from './ui/imageImport';
import { plateControls } from './ui/plateCard';
import { elementControls } from './ui/selectedCard';
import { renderWarnings } from './ui/warningsCard';
import type { JobDone } from './worker/client';
import type { Job, JobResult, MeshResult } from './worker/protocol';

/** The pause after the last edit before a preview is built (spec §8.4). */
export const PREVIEW_DELAY_MS = 250;
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
  /** Texts are drawn with the bundled fonts: loading one, and drawing a block once its font is in. */
  texts: {
    fontReady(font: FontId): boolean;
    loadFont(font: FontId): Promise<void>;
    rasterize(text: TextElement): TextRaster | null;
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
export function startApp({ storage = null, languages = [], csg, createScene, download, timers, pictures, texts }: AppOptions): () => void {
  const localeSelect = el('locale', HTMLSelectElement);
  const status = el('status', HTMLOutputElement);
  const plateBox = el('plateControls', HTMLElement);
  const elementList = el('elementList', HTMLElement);
  const selectedCard = el('selectedCard', HTMLElement);
  const selectedTitle = el('selectedTitle', HTMLElement);
  const selectedBox = el('selectedControls', HTMLElement);
  const warningsCard = el('warningsCard', HTMLElement);
  const warningList = el('warningList', HTMLElement);
  const meshInfo = el('meshInfo', HTMLElement);
  const meshBlocked = el('meshBlocked', HTMLElement);
  const downloadButton = el('downloadStl', HTMLButtonElement);
  const exportStatus = el('exportStatus', HTMLOutputElement);
  const undoButton = el('undo', HTMLButtonElement);
  const redoButton = el('redo', HTMLButtonElement);
  const addHoleButton = el('addHole', HTMLButtonElement);
  const addImageButton = el('addImage', HTMLButtonElement);
  const addTextButton = el('addText', HTMLButtonElement);
  const imageFile = el('imageFile', HTMLInputElement);
  const elementsStatus = el('elementsStatus', HTMLElement);
  const selectedThumb = el('selectedThumb', HTMLCanvasElement);
  const snapping = el('snapping', HTMLInputElement);
  const views = el('views', HTMLElement);
  const scene = createScene(el('view3d', HTMLCanvasElement));

  let settings: Settings = loadSettings(storage);
  let locale: Locale = detectLocale(settings.locale, languages);
  const history = new History<PlateState>(defaultState());
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
    select: (id) => select(id),
    change: (next, final) => update(next, final),
    outline: () => outline,
    snapping: () => snapping.checked,
    sizeLabel: () => sizeLabel(),
    picture: (image) => picture(image),
    textShape: (text) => textShape(text)?.rings ?? null,
  });

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

  /** The plate's size under it in the 2D view: a crop's is its outline's. */
  function sizeLabel(): string {
    const { plate } = state();
    if (plate.kind !== 'crop') return `${mm(plate.width)} × ${mm(plate.height)} ${t().mm}`;
    if (outline.length === 0) return '';
    const b = bounds(outline);
    return `${mm(b.maxX - b.minX)} × ${mm(b.maxY - b.minY)} ${t().mm}`;
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
    renderElementList(elementList, s, selected, m, {
      select: (id) => select(id),
      toggle: (id) => update(toggleVisible(state(), id), true),
      duplicate: (id) => duplicate(id),
      remove: (id) => remove(id),
    });

    const element = findElement(s, selected);
    selectedCard.hidden = element === null;
    if (element) {
      selectedTitle.textContent = elementName(s, element.id, m.elementName);
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
    warnings = [...outlineWarnings, ...findWarnings(s, outline), ...fromBuild];
    renderWarnings(warningsCard, warningList, warnings, s, m, (spot) => {
      views.dataset.show = '2d';
      editor.frame(spot);
    });
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
    csg.run({ kind: 'mesh', quality: 'preview', state: state(), rasters: rasterList(), textRasters: textRasterList() }).then(
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
    // a crop keeps its last outline until the new one comes; a primitive's is known at once
    if (s.plate.kind !== 'crop') {
      outline = instantOutline(s.plate);
      outlineWarnings = [];
    }
    const crop = s.plate.kind === 'crop';
    csg.run({ kind: 'outline', state: s, ...(crop ? { rasters: rasterList(), textRasters: textRasterList() } : {}) }).then(
      (done) => {
        if (stopped || !done || done.result.kind !== 'outline' || key !== outlineFor) return;
        outline = done.result.rings;
        outlineWarnings = done.result.warnings;
        renderState();
        if (crop) editor.fit();
      },
      // a failed outline leaves the instant one; the mesh job reports the failure
      () => {},
    );
  };

  function update(next: PlateState, final: boolean) {
    const clean = sanitizeState(next);
    if (final) history.commit(clean);
    else history.live(clean);
    afterChange();
  }

  function afterChange() {
    if (selected && !findElement(state(), selected)) selected = null;
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
    saveSettings(storage, settings);
    render();
  };

  const onExport = () => {
    exporting = { state: 'building' };
    renderStatus();
    const name = stlFileName(state().name);
    // every picture decoded and every font in first: an export never leaves an element out
    ensureRasters();
    Promise.all([...decoding.values(), ...state().texts.map((text) => texts.loadFont(text.font))])
      .then(() => csg.run({ kind: 'mesh', quality: 'export', state: state(), rasters: rasterList(), textRasters: textRasterList() }))
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
    imageFile.removeEventListener('change', onImageFile);
    document.removeEventListener('keydown', onKey);
    editor.dispose();
    scene?.dispose();
  };
}
