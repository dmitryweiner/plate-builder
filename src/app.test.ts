// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startApp, PREVIEW_DELAY_MS, type AppOptions, type Timers } from './app';
import { LOCALE_NAMES, LOCALES } from './i18n';
import type { CameraPreset, SceneHandle, ViewMesh } from './render/view';
import { loadSettings, type KeyValueStorage } from './storage';
import type { Raster } from './geo/heightmap';
import type { JobDone } from './worker/client';
import type { Job, JobResult, MeshResult } from './worker/protocol';

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>')).replace(/<script[^>]*><\/script>/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

function $<T extends Element>(selector: string, type: abstract new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing ${selector}`);
  return el;
}
const text = (selector: string) => $(selector, HTMLElement).textContent;
function selectLocale(locale: string) {
  const select = $('#locale', HTMLSelectElement);
  select.value = locale;
  select.dispatchEvent(new Event('change'));
}
function setInput(selector: string, value: string, event = 'change') {
  const input = $(selector, HTMLInputElement);
  input.value = value;
  input.dispatchEvent(new Event(event));
}

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

/** A worker client double: jobs wait until the test answers them. */
class FakeCsg {
  jobs: { job: Job; settle: (done: JobDone<JobResult> | null) => void; fail: (error: Error) => void }[] = [];
  run(job: Job): Promise<JobDone<JobResult> | null> {
    return new Promise((settle, fail) => this.jobs.push({ job, settle, fail }));
  }
  /** The last mesh job (outline jobs run beside them). */
  last() {
    const last = this.jobs.findLast((j) => j.job.kind === 'mesh');
    if (!last) throw new Error('no mesh job');
    return last;
  }
  meshJobs() {
    return this.jobs.filter((j) => j.job.kind === 'mesh');
  }
}

class FakeScene implements SceneHandle {
  meshes: (ViewMesh | null)[] = [];
  cameras: CameraPreset[] = [];
  setMesh(mesh: ViewMesh | null) {
    this.meshes.push(mesh);
  }
  setCamera(preset: CameraPreset) {
    this.cameras.push(preset);
  }
  dispose() {}
}

/** Timers that run only when the test says so. */
class ManualTimers implements Timers {
  private next = 1;
  pending = new Map<number, { fn: () => void; ms: number }>();
  set(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clear(id: number) {
    this.pending.delete(id);
  }
  flush() {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const { fn } of due) fn();
  }
}

function meshResult(over: Partial<MeshResult> = {}): MeshResult {
  return {
    kind: 'mesh',
    quality: 'preview',
    positions: new Float32Array(9),
    indices: new Uint32Array([0, 1, 2]),
    report: {
      finite: true,
      indicesValid: true,
      watertight: true,
      volume: 18000,
      bbox: { min: [-50, -30, 0], max: [50, 30, 3] },
      degenerateTriangles: 0,
      triangleCount: 12,
      vertexCount: 8,
    },
    problems: [],
    stl: null,
    warnings: [],
    ...over,
  };
}

/** Fonts the test has "loaded"; a text raster is a block as wide as the text is long. */
let loadedFonts: Set<string>;
const texts: AppOptions['texts'] = {
  fontReady: (font) => loadedFonts.has(font),
  loadFont: (font) => {
    loadedFonts.add(font);
    return Promise.resolve();
  },
  rasterize: (block) => {
    const width = 10 * block.size * block.text.length;
    const height = 10 * block.size + 20;
    return {
      width,
      height,
      data: new Uint8Array(width * height).fill(255),
      pxPerMm: 10,
      originX: width / 2,
      originY: height / 2,
      cap: block.size,
    };
  },
};

let stop: () => void = () => {};
let storage: MemoryStorage;
let csg: FakeCsg;
let scene: FakeScene;
let timers: ManualTimers;
let downloads: { name: string; bytes: number }[];
/** decodes waiting for the test, by data URL */
let decodes: Map<string, (raster: Raster) => void>;
const PNG = 'data:image/png;base64,AAAA';
const raster2x1: Raster = { width: 2, height: 1, data: new Uint8Array([255, 255, 0, 255]) };
const pictures: AppOptions['pictures'] = {
  importFile: (file) =>
    file.name === 'broken.png'
      ? Promise.reject(new Error('not a picture'))
      : Promise.resolve({ src: PNG, width: 200, height: 100, raster: raster2x1 }),
  decode: (src) => new Promise((done) => decodes.set(src, done)),
};

function start(languages: readonly string[] = ['en-US'], over: Partial<AppOptions> = {}) {
  stop = startApp({
    storage,
    languages,
    csg,
    createScene: () => scene,
    download: (name, data) => downloads.push({ name, bytes: data.byteLength }),
    timers,
    pictures,
    texts,
    ...over,
  });
}

/** Lets the promise callbacks of answered jobs run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  // jsdom draws nothing on a canvas; the 2D view handles that
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  storage = new MemoryStorage();
  csg = new FakeCsg();
  scene = new FakeScene();
  timers = new ManualTimers();
  downloads = [];
  decodes = new Map();
  loadedFonts = new Set();
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe('language', () => {
  it('lists every locale in the switcher by its own name', () => {
    const options = [...$('#locale', HTMLSelectElement).options].map((o) => [o.value, o.textContent]);
    expect(options).toEqual(LOCALES.map((l) => [l, LOCALE_NAMES[l]]));
  });

  it('follows the browser when nothing is saved', () => {
    start(['ru-RU', 'en']);
    expect(document.documentElement.lang).toBe('ru');
    expect(document.title).toBe('Конструктор табличек');
    expect(text('#plateCard h2')).toBe('Табличка');
    expect($('#locale', HTMLSelectElement).getAttribute('aria-label')).toBe('Язык');
  });

  it('falls back to English', () => {
    start(['de-DE']);
    expect(document.documentElement.lang).toBe('en');
    expect(text('.brand')).toBe('Plate Builder');
  });

  it('saves the switcher choice and prefers it over the browser', () => {
    start(['en-US']);
    selectLocale('he');
    expect(loadSettings(storage).locale).toBe('he');
    stop();
    document.body.innerHTML = body;
    start(['ru-RU']);
    expect(document.documentElement.lang).toBe('he');
    expect($('#locale', HTMLSelectElement).value).toBe('he');
  });

  it('turns the page right-to-left for Hebrew and back', () => {
    start();
    selectLocale('he');
    expect(document.documentElement.dir).toBe('rtl');
    selectLocale('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('keeps the plate and redraws its card when the language changes', () => {
    start();
    setInput('#plate-width', '120');
    selectLocale('uk');
    expect($('#plate-width-n', HTMLInputElement).value).toBe('120');
    expect(text('label[for="plate-width"]')).toBe('Ширина');
  });
});

describe('preview', () => {
  it('builds the plate at start and shows the mesh with its size', async () => {
    start();
    timers.flush();
    const { job, settle: answer } = csg.last();
    expect(job).toMatchObject({ kind: 'mesh', quality: 'preview', state: { plate: { kind: 'rectangle', width: 100 } } });
    expect(text('#status')).toBe('Building…');
    const result = meshResult();
    answer({ result, ms: 40 });
    await settle();
    expect(scene.meshes).toEqual([{ positions: result.positions, indices: result.indices }]);
    expect(text('#meshInfo')).toBe('100 × 60 × 3 mm · 12 triangles');
    expect(text('#status')).toBe('built in 40 ms');
  });

  it('waits for a pause in the edits and builds once', () => {
    start();
    timers.flush();
    const before = csg.meshJobs().length;
    for (const value of ['110', '120', '130']) setInput('#plate-width', value, 'input');
    expect(timers.pending.size).toBe(1);
    expect([...timers.pending.values()][0]?.ms).toBe(PREVIEW_DELAY_MS);
    timers.flush();
    expect(csg.meshJobs().length).toBe(before + 1);
    expect(csg.last().job).toMatchObject({ state: { plate: { width: 130 } } });
  });

  it('sanitises what the controls give', () => {
    start();
    setInput('#plate-rounding-n', '999');
    timers.flush();
    expect(csg.last().job).toMatchObject({ state: { plate: { rounding: 30 } } });
  });

  it('keeps the previous mesh when a fresher job replaced the build', async () => {
    start();
    timers.flush();
    csg.last().settle(null);
    await settle();
    expect(scene.meshes).toEqual([]);
    expect(text('#status')).toBe('Building…');
  });

  it('says when the geometry engine fails', async () => {
    start();
    timers.flush();
    csg.last().fail(new Error('no WASM'));
    await settle();
    expect(text('#status')).toBe('The geometry engine failed: no WASM');
  });
});

describe('plate card', () => {
  it('offers every primitive outline and shows only the parameters of the chosen one', () => {
    start();
    const kinds = [...$('#plate-kind', HTMLSelectElement).options].map((o) => o.value);
    expect(kinds).toEqual(['rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'heart', 'shield', 'tag', 'crop']);
    const sidesRow = () => $('#plate-sides', HTMLInputElement).closest('.row');
    expect(sidesRow()?.hasAttribute('hidden')).toBe(true);
    const select = $('#plate-kind', HTMLSelectElement);
    select.value = 'polygon';
    select.dispatchEvent(new Event('change'));
    expect(sidesRow()?.hasAttribute('hidden')).toBe(false);
    expect($('#plate-points', HTMLInputElement).closest('.row')?.hasAttribute('hidden')).toBe(true);
  });

  it('limits the rounding by the plate size', () => {
    start();
    setInput('#plate-height-n', '20');
    expect($('#plate-rounding', HTMLInputElement).max).toBe('10');
  });
});

describe('export', () => {
  it('builds the export and downloads the STL named after the project', async () => {
    start();
    $('#downloadStl', HTMLButtonElement).click();
    expect($('#downloadStl', HTMLButtonElement).disabled).toBe(true);
    expect(text('#exportStatus')).toBe('Building the STL…');
    await settle();
    const { job, settle: answer } = csg.last();
    expect(job).toMatchObject({ kind: 'mesh', quality: 'export' });
    answer({ result: meshResult({ quality: 'export', stl: new ArrayBuffer(684) }), ms: 120 });
    await settle();
    expect(downloads).toEqual([{ name: 'plate.stl', bytes: 684 }]);
    expect(text('#exportStatus')).toBe('plate.stl saved, built in 120 ms');
    expect($('#downloadStl', HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks the export of a broken mesh and says why', async () => {
    start();
    timers.flush();
    csg.last().settle({ result: meshResult({ problems: ['open', 'inverted'] }), ms: 5 });
    await settle();
    expect($('#meshBlocked', HTMLElement).hidden).toBe(false);
    expect(text('#meshBlocked')).toBe(
      'The mesh is broken (the surface is not closed, the surface is inside out); the STL cannot be exported.',
    );
    expect($('#downloadStl', HTMLButtonElement).disabled).toBe(true);
  });
});

describe('3D view', () => {
  it('moves the camera to a preset', () => {
    start();
    $('[data-camera="back"]', HTMLButtonElement).click();
    $('[data-camera="front"]', HTMLButtonElement).click();
    expect(scene.cameras).toEqual(['back', 'front']);
  });

  it('works without a view (no WebGL) and without storage', () => {
    start([], { createScene: () => null, storage: null });
    timers.flush();
    expect(csg.meshJobs()).toHaveLength(1);
    $('[data-camera="iso"]', HTMLButtonElement).click();
  });
});

const press = (key: string, over: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...over }));
const holes = () => {
  const job = csg.last().job;
  return job.kind === 'mesh' ? job.state.holes : [];
};

describe('elements', () => {
  it('adds a hole, selects it and shows its card', () => {
    start();
    expect(text('#elementList')).toBe('No elements yet.');
    $('#addHole', HTMLButtonElement).click();
    expect([...document.querySelectorAll('.element-row')].map((r) => r.textContent)).toEqual(['○Hole 1⧉✕']);
    expect($('#selectedCard', HTMLElement).hidden).toBe(false);
    expect(text('#selectedTitle')).toBe('Hole 1');
    expect($('#element-diameter-n', HTMLInputElement).value).toBe('4');
    timers.flush();
    expect(holes()).toHaveLength(1);
  });

  it('edits the selected hole by its card and changes the rows with its kind', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    setInput('#element-x-n', '20');
    const kind = $('#element-holeKind', HTMLSelectElement);
    kind.value = 'keyhole';
    kind.dispatchEvent(new Event('change'));
    expect($('#element-keySlot', HTMLInputElement).closest('.row')?.hasAttribute('hidden')).toBe(false);
    expect($('#element-diameter', HTMLInputElement).closest('.row')?.hasAttribute('hidden')).toBe(true);
    timers.flush();
    expect(holes()[0]).toMatchObject({ x: 20, kind: 'keyhole' });
  });

  it('duplicates, hides and deletes from the list', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    $('.element-row [aria-label^="Duplicate"]', HTMLButtonElement).click();
    expect(text('#selectedTitle')).toBe('Hole 2');
    const eye = document.querySelectorAll<HTMLInputElement>('.element-visible')[1];
    eye?.click();
    expect(document.querySelectorAll('.hidden-element')).toHaveLength(1);
    $('.element-row [aria-label="Delete: Hole 1"]', HTMLButtonElement).click();
    expect([...document.querySelectorAll('.element-row')].map((r) => r.textContent)).toEqual(['○Hole 1⧉✕']);
  });

  it('selects from the list', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    $('#addHole', HTMLButtonElement).click();
    $('.element-row[data-id="h1"] .element-name', HTMLButtonElement).click();
    expect(text('#selectedTitle')).toBe('Hole 1');
    expect($('.element-row[data-id="h1"]', HTMLElement).classList.contains('selected')).toBe(true);
  });
});

describe('history', () => {
  it('undoes and redoes with the buttons and the keys, a slider drag being one step', () => {
    start();
    expect($('#undo', HTMLButtonElement).disabled).toBe(true);
    for (const value of ['110', '120', '130']) setInput('#plate-width', value, 'input');
    setInput('#plate-width', '130', 'change');
    $('#undo', HTMLButtonElement).click();
    expect($('#plate-width-n', HTMLInputElement).value).toBe('100');
    expect($('#redo', HTMLButtonElement).disabled).toBe(false);
    press('z', { ctrlKey: true, shiftKey: true });
    expect($('#plate-width-n', HTMLInputElement).value).toBe('130');
    press('z', { metaKey: true });
    expect($('#plate-width-n', HTMLInputElement).value).toBe('100');
    press('y', { ctrlKey: true });
    expect($('#plate-width-n', HTMLInputElement).value).toBe('130');
  });

  it('undo of an added hole removes it and its selection', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    press('z', { ctrlKey: true });
    expect(text('#elementList')).toBe('No elements yet.');
    expect($('#selectedCard', HTMLElement).hidden).toBe(true);
  });
});

describe('keyboard', () => {
  it('nudges, duplicates, deletes and deselects the selected element', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    press('ArrowRight');
    press('ArrowUp', { shiftKey: true });
    expect($('#element-x-n', HTMLInputElement).value).toBe('0.5');
    expect($('#element-y-n', HTMLInputElement).value).toBe('5');
    press('d', { ctrlKey: true });
    expect(document.querySelectorAll('.element-row')).toHaveLength(2);
    press('Delete');
    expect(document.querySelectorAll('.element-row')).toHaveLength(1);
    $('.element-name', HTMLButtonElement).click();
    press('Escape');
    expect($('#selectedCard', HTMLElement).hidden).toBe(true);
  });

  it('leaves keys typed into a field alone', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    $('#element-x-n', HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(document.querySelectorAll('.element-row')).toHaveLength(1);
  });
});

const outlines = () => csg.jobs.filter((j) => j.job.kind === 'outline').length;

describe('warnings and outline', () => {
  it('lists a warning with the element name and hides the card when it is gone', () => {
    start();
    $('#addHole', HTMLButtonElement).click();
    setInput('#element-x-n', '47');
    expect($('#warningsCard', HTMLElement).hidden).toBe(false);
    expect(text('#warningList li span')).toBe('Hole 1: only 1 mm of material to the edge; 2 mm or more holds better.');
    $('#warningList button', HTMLButtonElement).click();
    setInput('#element-x-n', '0');
    expect($('#warningsCard', HTMLElement).hidden).toBe(true);
  });

  it('asks the worker for the outline when the plate changes, not when an element does', () => {
    start();
    expect(outlines()).toBe(1);
    $('#addHole', HTMLButtonElement).click();
    expect(outlines()).toBe(1);
    setInput('#plate-rounding-n', '10');
    expect(outlines()).toBe(2);
  });

  it('switches the phone view between 2D and 3D', () => {
    start();
    $('.view-tabs [data-show="3d"]', HTMLButtonElement).click();
    expect($('#views', HTMLElement).dataset.show).toBe('3d');
  });
});

/** Picks a file in the hidden input as the browser would. */
function chooseFile(name: string) {
  const input = $('#imageFile', HTMLInputElement);
  Object.defineProperty(input, 'files', { value: [new File(['x'], name, { type: 'image/png' })], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('images', () => {
  it('adds an image from a file, fitted to the plate, selected, its raster sent with the preview', async () => {
    start();
    chooseFile('logo.png');
    await settle();
    expect(text('#selectedTitle')).toBe('Image 1');
    expect($('#element-size-n', HTMLInputElement).value).toBe('60');
    expect($('#element-height-n', HTMLInputElement).value).toBe('1.5');
    // the crop's own rows wait for the crop outline
    expect($('#element-threshold', HTMLInputElement).closest('.row')?.hasAttribute('hidden')).toBe(true);
    timers.flush();
    const job = csg.last().job;
    expect(job.kind === 'mesh' && job.rasters).toEqual([raster2x1]);
  });

  it('says when a file cannot be read', async () => {
    start();
    chooseFile('broken.png');
    await settle();
    expect($('#elementsStatus', HTMLElement).hidden).toBe(false);
    expect(text('#elementsStatus')).toBe('The picture could not be read: not a picture');
    expect(document.querySelectorAll('.element-row')).toHaveLength(0);
  });

  it('a duplicate shares the decoded picture: nothing to decode again', async () => {
    start();
    chooseFile('logo.png');
    await settle();
    $('.element-row [aria-label^="Duplicate"]', HTMLButtonElement).click();
    timers.flush();
    const preview = csg.last().job;
    expect(preview.kind === 'mesh' && preview.rasters).toEqual([raster2x1, raster2x1]);
    expect(decodes.size).toBe(0);
  });

  it('waits for every picture before an export', async () => {
    start();
    chooseFile('logo.png');
    await settle();
    $('#downloadStl', HTMLButtonElement).click();
    await settle();
    const job = csg.last().job;
    expect(job).toMatchObject({ kind: 'mesh', quality: 'export' });
    expect(job.kind === 'mesh' && job.rasters).toEqual([raster2x1]);
  });
});

describe('texts', () => {
  it('adds a text, waits for its font, then sends its raster with the preview', async () => {
    start();
    $('#addText', HTMLButtonElement).click();
    expect(text('#selectedTitle')).toBe('Text 1');
    expect($('#element-text', HTMLTextAreaElement).value).toBe('Text');
    expect([...$('#element-text-font', HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'Rubik',
      'Oswald',
      'PT Serif',
      'Comfortaa',
      'Marck Script',
      'Frank Ruhl Libre',
    ]);
    // the font was asked for when the text was first drawn
    expect(loadedFonts.has('rubik')).toBe(true);
    await settle();
    timers.flush();
    const job = csg.last().job;
    expect(job.kind === 'mesh' && job.textRasters?.[0]?.width).toBe(10 * 8 * 4);
  });

  it('shows the rows of the text’s kind and arc', async () => {
    start();
    $('#addText', HTMLButtonElement).click();
    const row = (id: string) => $(`#${id}`, HTMLElement).closest('.row');
    expect(row('element-text-depth')?.hasAttribute('hidden')).toBe(true);
    const mode = $('#element-text-mode', HTMLSelectElement);
    mode.value = 'engraved';
    mode.dispatchEvent(new Event('change'));
    expect(row('element-text-depth')?.hasAttribute('hidden')).toBe(false);
    expect(row('element-text-height')?.hasAttribute('hidden')).toBe(true);
    expect(row('element-text-arcRadius')?.hasAttribute('hidden')).toBe(true);
    $('#element-text-arc', HTMLInputElement).click();
    expect(row('element-text-arcRadius')?.hasAttribute('hidden')).toBe(false);
    expect($('#element-text-arcRadius-n', HTMLInputElement).value).toBe('50');
  });

  it('types into the text as one step per edit and warns about joined arc lines', () => {
    start();
    $('#addText', HTMLButtonElement).click();
    const area = $('#element-text', HTMLTextAreaElement);
    area.value = 'Kitchen\nDoor';
    area.dispatchEvent(new Event('input'));
    area.dispatchEvent(new Event('change'));
    $('#element-text-arc', HTMLInputElement).click();
    expect(text('#warningList')).toContain('Text 1: an arc takes one line; the lines are joined.');
    $('#undo', HTMLButtonElement).click();
    $('#undo', HTMLButtonElement).click();
    expect($('#element-text', HTMLTextAreaElement).value).toBe('Text');
  });

  it('shows the warnings the worker found', async () => {
    start();
    $('#addText', HTMLButtonElement).click();
    timers.flush();
    csg.last().settle({ result: meshResult({ warnings: [{ code: 'text.thin', ids: ['t1'], spot: [0, 0] }] }), ms: 5 });
    await settle();
    expect(text('#warningList')).toContain('Text 1 has strokes thinner than 0.8 mm');
  });
});

const outlineJobs = () => csg.jobs.filter((j) => j.job.kind === 'outline');

describe('crop and rim', () => {
  it('crops around the elements: the size gives way to the padding, the outline job gets the rasters', async () => {
    start();
    $('#addText', HTMLButtonElement).click();
    await settle();
    const kind = $('#plate-kind', HTMLSelectElement);
    kind.value = 'crop';
    kind.dispatchEvent(new Event('change'));
    const row = (id: string) => $(`#${id}`, HTMLElement).closest('.row');
    expect(row('plate-width')?.hasAttribute('hidden')).toBe(true);
    expect(row('plate-padding')?.hasAttribute('hidden')).toBe(false);
    const job = outlineJobs().at(-1)?.job;
    expect(job?.kind === 'outline' && job.textRasters?.[0]?.width).toBe(10 * 8 * 4);
    expect($('#element-text-inOutline', HTMLInputElement).closest('.row')?.hasAttribute('hidden')).toBe(false);
  });

  it('asks again when an element of the crop moves, and shows the outline’s warnings', async () => {
    start();
    $('#addText', HTMLButtonElement).click();
    await settle();
    setInput('#plate-padding-n', '1');
    const kind = $('#plate-kind', HTMLSelectElement);
    kind.value = 'crop';
    kind.dispatchEvent(new Event('change'));
    const before = outlineJobs().length;
    setInput('#element-x-n', '10');
    expect(outlineJobs().length).toBe(before + 1);
    outlineJobs()
      .at(-1)
      ?.settle({
        result: { kind: 'outline', rings: [], warnings: [{ code: 'outline.islands', ids: [], params: { count: 2 }, spot: [0, 0] }] },
        ms: 1,
      });
    await settle();
    expect(text('#warningList')).toContain('The outline falls into 2 pieces');
  });

  it('shows the rim’s sizes only with the rim on', () => {
    start();
    const row = (id: string) => $(`#${id}`, HTMLElement).closest('.row');
    expect(row('plate-rimWidth')?.hasAttribute('hidden')).toBe(true);
    $('#plate-rim', HTMLInputElement).click();
    expect(row('plate-rimWidth')?.hasAttribute('hidden')).toBe(false);
    timers.flush();
    expect(csg.last().job).toMatchObject({ state: { plate: { rim: true } } });
  });
});

describe('cards', () => {
  it('give every control its own id', () => {
    start();
    $('#addText', HTMLButtonElement).click();
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});
