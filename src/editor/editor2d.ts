// The 2D top view (spec §7.3): the plate drawn on a canvas by the main
// thread, its elements selected, moved, scaled and turned with the pointer
// (mouse, pen and touch alike). The maths is in gestures.ts and view.ts;
// this file turns events into calls and draws.

import { edgeOn } from '../geo/edges';
import { holeFootprint, placeRing } from '../geo/holes';
import { magnetFootprints } from '../geo/magnets';
import { bounds, type Bounds, type Point, type Ring } from '../geo/outline';
import type { ImageElement, PlateElement, PlateState, TextElement } from '../geo/state';
import { allElements, boxCorners, elementBox, findElement, hitsElement, hitTest, replaceElement } from './elements';
import { moveElement, pinchElement, rotateTowards, scaleFromCorner, snapPoint, snapTargets, type Snapped } from './gestures';
import { fitView, panView, toPlate, toScreen, zoomAt, type ViewTransform } from './view';

/** Snapping reach and handle sizes, CSS px (spec §7.3: 6 px). */
export const SNAP_PX = 6;
const HANDLE_PX = 9;
/** a finger is bigger than a mouse pointer */
const TOUCH_SLOP_PX = 14;
const ROTATE_HANDLE_PX = 28;
/** how far a press may wander and still be a tap */
const TAP_PX = 4;
const MARGIN_PX = 24;

export interface EditorOptions {
  canvas: HTMLCanvasElement;
  read(): PlateState;
  selected(): string | null;
  select(id: string | null): void;
  /** a gesture's frame (`final` false) or its end (true) */
  change(next: PlateState, final: boolean): void;
  /** the outline to draw: the worker's last one, or the primitive's at once */
  outline(): readonly Ring[];
  /** whether snapping is on (a toggle on touch; Alt turns it off for a mouse) */
  snapping(): boolean;
  /** the plate's size under it: its numbers ("100 × 60", drawn left to right in any language) and unit */
  sizeLabel(): { size: string; unit: string } | null;
  /** an image's height map as a picture (white high), or null while it is not decoded */
  picture(image: ImageElement): CanvasImageSource | null;
  /** a text's contours in its own frame (mm), or null while its font loads */
  textShape(text: TextElement): readonly Ring[] | null;
  /** a raised frame's contours (plate frame, mm), drawn as a tint; null without one */
  frame(): readonly Ring[] | null;
  /** how much of the canvas's bottom something covers (a phone's sheet), px: the plate is fitted above it */
  covered?(): number;
}

export interface EditorHandle {
  draw(): void;
  /** fits the plate into the view */
  fit(): void;
  /** frames a spot of the plate (a warning's) */
  frame(spot: Readonly<Point>): void;
  /** the current transform (tests, the smoke) */
  view(): ViewTransform;
  dispose(): void;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; start: ViewTransform; from: Point; moved: boolean }
  | { kind: 'move'; element: PlateElement; from: Point; moved: boolean }
  | { kind: 'scale'; element: PlateElement; corner: number }
  | { kind: 'rotate'; element: PlateElement }
  | { kind: 'pinch'; element: PlateElement; a0: Point; b0: Point }
  | { kind: 'zoom'; start: ViewTransform; a0: Point; b0: Point };

/** Theme colours of the canvas, read from CSS custom properties when drawn. */
function colors(canvas: HTMLCanvasElement) {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: read('--editor-bg', '#181b20'),
    grid: read('--editor-grid', 'rgba(228, 233, 239, 0.06)'),
    plate: read('--editor-plate', '#3a424d'),
    edge: read('--editor-edge', '#c9d1db'),
    accent: read('--accent', '#34c38f'),
    muted: read('--muted', '#94a0ad'),
  };
}

export function createEditor(o: EditorOptions): EditorHandle {
  const { canvas } = o;
  const ctx = canvas.getContext?.('2d') ?? null;
  let view: ViewTransform = { scale: 3, cx: 0, cy: 0 };
  let fitted = false;
  /** whether the person panned or zoomed: until then a resize fits the plate again */
  let viewTouched = false;
  let gesture: Gesture = { kind: 'none' };
  let guides: Snapped['guides'] = { x: null, y: null };
  /** pointers down, CSS px relative to the canvas */
  const pointers = new Map<number, Point>();
  let touch = false;

  const size = () => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  };
  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  const plateBox = (): Bounds => {
    const rings = o.outline();
    return rings.length ? bounds(rings) : { minX: -50, maxX: 50, minY: -30, maxY: 30 };
  };

  /** The part of the canvas the plate is fitted into: all of it but what is covered below. */
  const visible = (s: { width: number; height: number }) => ({
    width: s.width,
    height: Math.max(s.height / 3, s.height - (o.covered?.() ?? 0)),
  });

  function fit(): void {
    const s = size();
    if (s.width === 0 || s.height === 0) return;
    view = fitView(visible(s), plateBox(), MARGIN_PX);
    fitted = true;
    viewTouched = false;
    draw();
  }

  /** Which handle of the selected element is under a screen point: a corner index, 'rotate' or null. */
  function handleAt(p: Readonly<Point>): number | 'rotate' | null {
    const element = findElement(o.read(), o.selected());
    if (!element) return null;
    const reach = touch ? TOUCH_SLOP_PX : HANDLE_PX;
    const rot = rotateHandle(element);
    if (Math.hypot(rot[0] - p[0], rot[1] - p[1]) <= reach) return 'rotate';
    const corners = boxCorners(element).map((c) => toScreen(view, c));
    const index = corners.findIndex((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) <= reach);
    return index >= 0 ? index : null;
  }

  /** The rotation handle on screen: above the middle of the box's top edge, in the element's own up direction. */
  function rotateHandle(e: PlateElement): Point {
    const corners = boxCorners(e).map((c) => toScreen(view, c));
    const top: Point = [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2];
    const a = (e.rotation * Math.PI) / 180;
    // the element's +y on screen is (−sin a, −cos a): y grows downwards
    return [top[0] - Math.sin(a) * ROTATE_HANDLE_PX, top[1] - Math.cos(a) * ROTATE_HANDLE_PX];
  }

  const update = (element: PlateElement) => o.change(replaceElement(o.read(), element), false);

  function onDown(event: PointerEvent): void {
    touch = event.pointerType === 'touch';
    const p = local(event);
    pointers.set(event.pointerId, p);
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // a pointer the browser does not know (a synthetic one): the gesture works without capture
    }
    event.preventDefault();

    if (pointers.size === 2) {
      const [a0, b0] = [...pointers.values()];
      const selected = findElement(o.read(), o.selected());
      // two fingers on the selected element scale and turn it; elsewhere they zoom the view
      if (gesture.kind === 'move' && selected) {
        gesture = { kind: 'pinch', element: findElement(o.read(), selected.id) ?? selected, a0, b0 };
      } else {
        gesture = { kind: 'zoom', start: view, a0, b0 };
      }
      guides = { x: null, y: null };
      return;
    }
    if (pointers.size > 2) return;

    const selected = findElement(o.read(), o.selected());
    // a press on the element itself moves it, even where a handle's reach overlaps a small one
    const handle = selected && hitsElement(selected, toPlate(view, p)) ? null : handleAt(p);
    if (selected && handle === 'rotate') {
      gesture = { kind: 'rotate', element: selected };
      return;
    }
    if (selected && typeof handle === 'number') {
      gesture = { kind: 'scale', element: selected, corner: handle };
      return;
    }
    const slop = (touch ? TOUCH_SLOP_PX : 2) / view.scale;
    const hit = hitTest(o.read(), toPlate(view, p), slop);
    if (hit) {
      if (hit.id !== o.selected()) o.select(hit.id);
      gesture = { kind: 'move', element: hit, from: toPlate(view, p), moved: false };
    } else {
      gesture = { kind: 'pan', start: view, from: p, moved: false };
    }
  }

  function onMove(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    const p = local(event);
    pointers.set(event.pointerId, p);
    const snap = o.snapping() && !event.altKey;

    if (gesture.kind === 'pan') {
      const dx = p[0] - gesture.from[0];
      const dy = p[1] - gesture.from[1];
      if (!gesture.moved && Math.hypot(dx, dy) < TAP_PX) return;
      gesture.moved = true;
      viewTouched = true;
      view = panView(gesture.start, dx, dy);
      draw();
    } else if (gesture.kind === 'move') {
      const at = toPlate(view, p);
      const dx = at[0] - gesture.from[0];
      const dy = at[1] - gesture.from[1];
      if (!gesture.moved && Math.hypot(dx, dy) * view.scale < TAP_PX) return;
      gesture.moved = true;
      let next = moveElement(gesture.element, dx, dy);
      if (snap) {
        const snapped = snapPoint([next.x, next.y], snapTargets(allElements(o.read()), next.id), SNAP_PX / view.scale);
        next = { ...next, x: snapped.point[0], y: snapped.point[1] };
        guides = snapped.guides;
      } else guides = { x: null, y: null };
      update(next);
    } else if (gesture.kind === 'scale') {
      update(scaleFromCorner(gesture.element, gesture.corner, toPlate(view, p)));
    } else if (gesture.kind === 'rotate') {
      update(rotateTowards(gesture.element, toPlate(view, p), event.shiftKey ? 15 : null));
    } else if (gesture.kind === 'pinch' || gesture.kind === 'zoom') {
      const [a1, b1] = [...pointers.values()];
      if (gesture.kind === 'pinch') {
        update(pinchElement(gesture.element, toPlate(view, gesture.a0), toPlate(view, gesture.b0), toPlate(view, a1), toPlate(view, b1)));
      } else {
        const d0 = Math.hypot(gesture.b0[0] - gesture.a0[0], gesture.b0[1] - gesture.a0[1]);
        const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
        const mid0: Point = [(gesture.a0[0] + gesture.b0[0]) / 2, (gesture.a0[1] + gesture.b0[1]) / 2];
        const mid1: Point = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2];
        viewTouched = true;
        view = panView(zoomAt(gesture.start, mid0, d0 > 0 ? d1 / d0 : 1), mid1[0] - mid0[0], mid1[1] - mid0[1]);
        draw();
      }
    }
  }

  function onUp(event: PointerEvent): void {
    if (!pointers.delete(event.pointerId)) return;
    const ended = gesture;
    // a pinch ends with its first finger lifted; the other one does nothing more
    if (pointers.size > 0) {
      if (ended.kind === 'pinch' || ended.kind === 'zoom') gesture = { kind: 'none' };
      if (ended.kind === 'pinch') o.change(o.read(), true);
      return;
    }
    gesture = { kind: 'none' };
    guides = { x: null, y: null };
    if (ended.kind === 'pan' && !ended.moved) o.select(null);
    const edited = (ended.kind === 'move' && ended.moved) || ended.kind === 'scale' || ended.kind === 'rotate' || ended.kind === 'pinch';
    if (edited) o.change(o.read(), true);
    else draw();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    viewTouched = true;
    view = zoomAt(view, local(event), Math.exp(-event.deltaY * 0.0015));
    draw();
  }

  function draw(): void {
    const s = size();
    if (!ctx || s.width === 0 || s.height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(s.width * dpr);
    const h = Math.round(s.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (!viewTouched) fitted = false;
    }
    if (!fitted) {
      view = fitView(visible(s), plateBox(), MARGIN_PX);
      fitted = true;
    }
    // the transform, for the smoke to see where the view looks
    canvas.dataset.view = `${view.scale.toFixed(3)} ${view.cx.toFixed(1)} ${view.cy.toFixed(1)}`;
    const c = colors(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.background;
    ctx.fillRect(0, 0, s.width, s.height);

    drawGrid(ctx, s, c.grid);
    const state = o.read();
    const outline = o.outline();
    const path = (rings: readonly Ring[]) => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach((pt, i) => {
          const [x, y] = toScreen(view, pt);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    };
    path(outline);
    ctx.fillStyle = c.plate;
    ctx.fill('evenodd');
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // images as their height maps, clipped to the plate as the solid is
    ctx.save();
    path(outline);
    ctx.clip('evenodd');
    // the rim and the frame as tints of the edge colour
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = c.edge;
    if (state.plate.rim) {
      ctx.lineWidth = 2 * state.plate.rimWidth * view.scale;
      ctx.strokeStyle = c.edge;
      path(outline);
      ctx.stroke();
    }
    const frame = o.frame();
    if (frame) {
      path(frame);
      ctx.fill('nonzero');
    }
    ctx.globalAlpha = 1;
    for (const image of state.images) {
      const picture = image.visible ? o.picture(image) : null;
      if (!picture) continue;
      const box = elementBox(image);
      const [sx, sy] = toScreen(view, [image.x, image.y]);
      ctx.save();
      ctx.translate(sx, sy);
      // counter-clockwise in the plate is clockwise on a y-down screen
      ctx.rotate((-image.rotation * Math.PI) / 180);
      ctx.drawImage(
        picture,
        box.minX * view.scale,
        -box.maxY * view.scale,
        (box.maxX - box.minX) * view.scale,
        (box.maxY - box.minY) * view.scale,
      );
      ctx.restore();
    }

    // texts as their ink: raised darker, engraved lighter
    for (const text of state.texts) {
      const rings = text.visible ? o.textShape(text) : null;
      if (!rings) continue;
      path(rings.map((ring) => placeRing(text, ring)));
      ctx.fillStyle = text.mode === 'raised' ? c.edge : c.background;
      ctx.fill('nonzero');
    }
    ctx.restore();

    // the magnets' pockets are in the back: dashed, as a keyhole's channel
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 1;
    for (const pocket of magnetFootprints(state.magnets, outline, edgeOn(state.plate, 'bottom'))) {
      path([pocket]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const hole of state.holes) {
      if (!hole.visible) continue;
      path([placeRing(hole, holeFootprint(hole))]);
      // a keyhole is hidden behind the front skin: drawn dashed, not cut
      if (hole.kind === 'keyhole') {
        ctx.setLineDash([4, 3]);
      } else {
        ctx.fillStyle = c.background;
        ctx.fill();
      }
      ctx.strokeStyle = c.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // snap guides
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    if (guides.x !== null) {
      const [x] = toScreen(view, [guides.x, 0]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s.height);
      ctx.stroke();
    }
    if (guides.y !== null) {
      const [, y] = toScreen(view, [0, guides.y]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s.width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const selected = findElement(state, o.selected());
    if (selected) {
      const corners = boxCorners(selected).map((pt) => toScreen(view, pt));
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      const rot = rotateHandle(selected);
      const top: Point = [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2];
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(rot[0], rot[1]);
      ctx.stroke();
      ctx.fillStyle = c.plate;
      for (const [x, y] of corners) {
        ctx.fillRect(x - 4.5, y - 4.5, 9, 9);
        ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
      }
      ctx.beginPath();
      ctx.arc(rot[0], rot[1], 5.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    // the size under the plate: the numbers left to right in any language (spec §12), the unit after
    // them as the page reads; two pieces, as canvas text has no bidi isolation
    const label = o.sizeLabel();
    if (label) {
      const box = plateBox();
      const [lx, ly] = toScreen(view, [(box.minX + box.maxX) / 2, box.minY]);
      ctx.fillStyle = c.muted;
      ctx.font = '12px system-ui, sans-serif';
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      const gap = ctx.measureText(' ').width;
      const sizeWidth = ctx.measureText(label.size).width;
      const unitWidth = ctx.measureText(label.unit).width;
      const rtl = document.documentElement.dir === 'rtl';
      const left = lx - (sizeWidth + gap + unitWidth) / 2;
      const y = Math.min(s.height - 4, ly + 16);
      ctx.fillText(label.size, rtl ? left + unitWidth + gap : left, y);
      ctx.fillText(label.unit, rtl ? left : left + sizeWidth + gap, y);
    }
  }

  /** Lines every 10 mm, every 1 mm when zoomed in enough to see them. */
  function drawGrid(g: CanvasRenderingContext2D, s: { width: number; height: number }, color: string): void {
    const step = view.scale * 1 >= 8 ? 1 : view.scale * 5 >= 8 ? 5 : 10;
    const [x0, y1] = toPlate(view, [0, 0]);
    const [x1, y0] = toPlate(view, [s.width, s.height]);
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const [sx] = toScreen(view, [x, 0]);
      g.moveTo(Math.round(sx) + 0.5, 0);
      g.lineTo(Math.round(sx) + 0.5, s.height);
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = toScreen(view, [0, y]);
      g.moveTo(0, Math.round(sy) + 0.5);
      g.lineTo(s.width, Math.round(sy) + 0.5);
    }
    g.stroke();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  resize?.observe(canvas);

  return {
    draw,
    fit,
    frame(spot) {
      const s = size();
      if (s.width === 0) return;
      const scale = Math.max(view.scale, 6);
      view = { scale, cx: s.width / 2 - spot[0] * scale, cy: s.height / 2 + spot[1] * scale };
      fitted = true;
      viewTouched = true;
      draw();
    },
    view: () => view,
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      resize?.disconnect();
    },
  };
}
