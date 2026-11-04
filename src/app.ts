import { defaultState, sanitizeState, type PlateState } from './geo/state';
import { stlFileName } from './geo/stl';
import { detectLocale, direction, isLocale, messages, staticText, type Locale, type Messages } from './i18n';
import type { CameraPreset, SceneHandle } from './render/view';
import { loadSettings, saveSettings, type KeyValueStorage, type Settings } from './storage';
import { renderControls, type ControlsHandle } from './ui/controls';
import { el } from './ui/dom';
import { plateControls } from './ui/plateCard';
import type { JobDone } from './worker/client';
import type { Job, JobResult, MeshResult } from './worker/protocol';

/** The pause after the last edit before a preview is built (spec §8.4). */
export const PREVIEW_DELAY_MS = 250;

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
}

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
    if (text !== undefined) node.setAttribute('aria-label', text);
  }
}

const isCamera = (value: unknown): value is CameraPreset => value === 'front' || value === 'iso' || value === 'back';

/** 12.5 → "12.5", 3 → "3": sizes without trailing zeros. */
const mm = (value: number) => String(Number(value.toFixed(1)));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the view and the export card show about the last build. */
type Build =
  { state: 'idle' } | { state: 'building' } | { state: 'done'; mesh: MeshResult; ms: number } | { state: 'failed'; reason: string };

type Exporting =
  { state: 'idle' } | { state: 'building' } | { state: 'saved'; name: string; ms: number } | { state: 'failed'; reason: string };

/** Starts the app on the current page; returns a function that removes its listeners. */
export function startApp({ storage = null, languages = [], csg, createScene, download, timers }: AppOptions): () => void {
  const localeSelect = el('locale', HTMLSelectElement);
  const status = el('status', HTMLOutputElement);
  const plateBox = el('plateControls', HTMLElement);
  const meshInfo = el('meshInfo', HTMLElement);
  const meshBlocked = el('meshBlocked', HTMLElement);
  const downloadButton = el('downloadStl', HTMLButtonElement);
  const exportStatus = el('exportStatus', HTMLOutputElement);
  const scene = createScene(el('view3d', HTMLCanvasElement));

  let settings: Settings = loadSettings(storage);
  let locale: Locale = detectLocale(settings.locale, languages);
  let state: PlateState = defaultState();
  let build: Build = { state: 'idle' };
  let exporting: Exporting = { state: 'idle' };
  let previewTimer: number | null = null;
  let stopped = false;
  let plateCard: ControlsHandle<PlateState> | null = null;

  const t = () => messages[locale];

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

  const renderCards = () => {
    plateCard = renderControls(plateBox, plateControls, { read: () => state, change: (next) => update(next), idPrefix: 'plate', t: t() });
  };

  const render = () => {
    translatePage(locale, t());
    localeSelect.value = locale;
    renderCards();
    renderStatus();
  };

  const preview = () => {
    previewTimer = null;
    build = { state: 'building' };
    renderStatus();
    csg.run({ kind: 'mesh', quality: 'preview', state }).then(
      (done) => {
        // null: a fresher preview replaced this one and will answer instead
        if (stopped || !done || done.result.kind !== 'mesh') return;
        build = { state: 'done', mesh: done.result, ms: done.ms };
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

  function update(next: PlateState) {
    state = sanitizeState(next);
    plateCard?.sync(state);
    schedulePreview(PREVIEW_DELAY_MS);
  }

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
    const name = stlFileName(state.name);
    csg.run({ kind: 'mesh', quality: 'export', state }).then(
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

  const onCamera = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const preset = event.target.closest<HTMLElement>('[data-camera]')?.dataset.camera;
    if (isCamera(preset)) scene?.setCamera(preset);
  };
  const cameras = document.querySelector<HTMLElement>('.cameras');

  localeSelect.addEventListener('change', onLocale);
  downloadButton.addEventListener('click', onExport);
  cameras?.addEventListener('click', onCamera);
  render();
  schedulePreview(0);

  return () => {
    stopped = true;
    if (previewTimer !== null) timers.clear(previewTimer);
    localeSelect.removeEventListener('change', onLocale);
    downloadButton.removeEventListener('click', onExport);
    cameras?.removeEventListener('click', onCamera);
    scene?.dispose();
  };
}
