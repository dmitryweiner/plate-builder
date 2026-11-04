// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApp, PREVIEW_DELAY_MS, type AppOptions, type Timers } from './app';
import { LOCALE_NAMES, LOCALES } from './i18n';
import type { CameraPreset, SceneHandle, ViewMesh } from './render/view';
import { loadSettings, type KeyValueStorage } from './storage';
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
  last() {
    const last = this.jobs.at(-1);
    if (!last) throw new Error('no job');
    return last;
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
    ...over,
  };
}

let stop: () => void = () => {};
let storage: MemoryStorage;
let csg: FakeCsg;
let scene: FakeScene;
let timers: ManualTimers;
let downloads: { name: string; bytes: number }[];

function start(languages: readonly string[] = ['en-US'], over: Partial<AppOptions> = {}) {
  stop = startApp({
    storage,
    languages,
    csg,
    createScene: () => scene,
    download: (name, data) => downloads.push({ name, bytes: data.byteLength }),
    timers,
    ...over,
  });
}

/** Lets the promise callbacks of answered jobs run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  storage = new MemoryStorage();
  csg = new FakeCsg();
  scene = new FakeScene();
  timers = new ManualTimers();
  downloads = [];
});
afterEach(() => stop());

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
    const before = csg.jobs.length;
    for (const value of ['110', '120', '130']) setInput('#plate-width', value, 'input');
    expect(timers.pending.size).toBe(1);
    expect([...timers.pending.values()][0]?.ms).toBe(PREVIEW_DELAY_MS);
    timers.flush();
    expect(csg.jobs.length).toBe(before + 1);
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
    expect(kinds).toEqual(['rectangle', 'ellipse', 'triangle', 'polygon', 'star', 'heart', 'shield', 'tag']);
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
    expect(csg.jobs).toHaveLength(1);
    $('[data-camera="iso"]', HTMLButtonElement).click();
  });
});
