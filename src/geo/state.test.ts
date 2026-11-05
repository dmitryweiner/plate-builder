import { describe, expect, it } from 'vitest';
import {
  defaultHole,
  defaultImage,
  defaultState,
  defaultText,
  FONT_IDS,
  HOLE_KINDS,
  LIMITS,
  MAGNET_LAYOUT_IDS,
  magnetLayouts,
  OUTLINE_KINDS,
  RANGES,
  sanitizeState,
  STATE_VERSION,
  type PlateState,
} from './state';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** A full state with one element of each kind, every field set. */
function fullState(): PlateState {
  const state = defaultState();
  return {
    ...state,
    images: [{ ...defaultImage(state, PNG, 64, 32), id: 'i1' }],
    texts: [{ ...defaultText(state), id: 't1' }],
    holes: [
      { ...defaultHole('round'), id: 'h1' },
      { ...defaultHole('keyhole'), id: 'h2' },
    ],
    magnets: { ...state.magnets, count: 4, layout: 'diamond', diameter: 12, thickness: 3 },
  };
}

function inRange(value: number, range: { min: number; max: number }): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(range.min);
  expect(value).toBeLessThanOrEqual(range.max);
}

/** Every number of the state within its range, every enum known: what the rest of the app relies on. */
function expectValid(state: PlateState): void {
  expect(state.version).toBe(STATE_VERSION);
  const p = state.plate;
  expect(OUTLINE_KINDS).toContain(p.kind);
  inRange(p.width, RANGES.plateSize);
  inRange(p.height, RANGES.plateSize);
  inRange(p.thickness, RANGES.thickness);
  inRange(p.rounding, { min: 0, max: Math.min(p.width, p.height) / 2 });
  inRange(p.sides, RANGES.sides);
  expect(Number.isInteger(p.sides)).toBe(true);
  inRange(p.points, RANGES.points);
  expect(Number.isInteger(p.points)).toBe(true);
  inRange(p.innerRatio, RANGES.innerRatio);
  inRange(p.rimWidth, RANGES.rimWidth);
  inRange(p.rimHeight, RANGES.rimHeight);
  inRange(p.frameHeight, RANGES.frameHeight);
  inRange(p.padding, RANGES.padding);
  expect(state.images.length).toBeLessThanOrEqual(LIMITS.images);
  expect(state.texts.length).toBeLessThanOrEqual(LIMITS.texts);
  expect(state.holes.length).toBeLessThanOrEqual(LIMITS.holes);
  const ids = [...state.images, ...state.texts, ...state.holes].map((e) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const e of [...state.images, ...state.texts, ...state.holes]) {
    inRange(e.x, RANGES.position);
    inRange(e.y, RANGES.position);
    expect(e.rotation).toBeGreaterThanOrEqual(0);
    expect(e.rotation).toBeLessThan(360);
  }
  for (const image of state.images) {
    expect(image.src.startsWith('data:image/png;base64,')).toBe(true);
    inRange(image.size, RANGES.imageSize);
    inRange(image.height, RANGES.reliefHeight);
    expect(image.black).toBeLessThan(image.white);
    inRange(image.black, { min: 0, max: 254 });
    inRange(image.white, { min: 1, max: 255 });
    inRange(image.blur, RANGES.blur);
    inRange(image.threshold, RANGES.threshold);
    inRange(image.pixelWidth, RANGES.pixels);
    inRange(image.pixelHeight, RANGES.pixels);
  }
  for (const text of state.texts) {
    expect(text.text.split('\n').length).toBeLessThanOrEqual(LIMITS.textLines);
    expect(text.text.length).toBeLessThanOrEqual(LIMITS.textChars);
    expect(FONT_IDS).toContain(text.font);
    inRange(text.size, RANGES.textSize);
    inRange(text.lineSpacing, RANGES.lineSpacing);
    inRange(text.height, RANGES.textHeight);
    inRange(text.depth, { min: RANGES.engraveDepth.min, max: p.thickness - 0.4 + 1e-9 });
    inRange(text.arcRadius, RANGES.arcRadius);
  }
  const m = state.magnets;
  inRange(m.count, RANGES.magnetCount);
  expect(Number.isInteger(m.count)).toBe(true);
  expect(MAGNET_LAYOUT_IDS).toContain(m.layout);
  expect(m.count === 0 || magnetLayouts(m.count).includes(m.layout)).toBe(true);
  inRange(m.diameter, RANGES.magnetDiameter);
  inRange(m.thickness, RANGES.magnetThickness);
  inRange(m.fit, RANGES.magnetFit);
  inRange(m.edge, RANGES.magnetEdge);
  for (const hole of state.holes) {
    expect(HOLE_KINDS).toContain(hole.kind);
    inRange(hole.diameter, RANGES.holeDiameter);
    inRange(hole.length, RANGES.slotLength);
    inRange(hole.width, RANGES.slotWidth);
    inRange(hole.screw, RANGES.screw);
    expect(hole.head).toBeGreaterThan(hole.screw);
    inRange(hole.head, RANGES.screwHead);
    expect(hole.keyShank).toBeLessThan(hole.keyHead);
    inRange(hole.keyHead, RANGES.keyHead);
    inRange(hole.keyShank, RANGES.keyShank);
    inRange(hole.keySlot, RANGES.keySlot);
  }
}

/** Mulberry32: a small seeded generator, so a failing fuzz case can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomValue(random: () => number, depth = 0): unknown {
  const pick = Math.floor(random() * (depth > 2 ? 7 : 9));
  const numbers = [0, -1, 1e9, -1e9, Number.NaN, Infinity, 0.5, 3, 359.9, 400, -0];
  switch (pick) {
    case 0:
      return null;
    case 1:
      return random() < 0.5;
    case 2:
      return numbers[Math.floor(random() * numbers.length)];
    case 3:
      return (random() - 0.5) * 1000;
    case 4:
      return ['', 'x', 'rubik', 'hole', 'keyhole', 'star', PNG, 'i1', 'a\nb\nc', '\u0000\u0007ab', 'corners', 'top'][
        Math.floor(random() * 12)
      ];
    case 5:
      return undefined;
    case 6:
      return 'text '.repeat(Math.floor(random() * 100));
    case 7:
      return Array.from({ length: Math.floor(random() * 20) }, () => randomValue(random, depth + 1));
    default:
      return Object.fromEntries(
        [
          'version',
          'plate',
          'images',
          'texts',
          'holes',
          'magnets',
          'count',
          'layout',
          'kind',
          'width',
          'id',
          'x',
          'size',
          'text',
          'src',
          'head',
          'screw',
        ].map((k) => [k, randomValue(random, depth + 1)]),
      );
  }
}

/** Sets a random path in a JSON-like tree to a random value. */
function mutate(value: unknown, random: () => number): unknown {
  if (typeof value !== 'object' || value === null || random() < 0.15) return randomValue(random);
  if (Array.isArray(value)) {
    const copy = [...value];
    if (copy.length === 0 || random() < 0.2) copy.push(randomValue(random));
    else {
      const i = Math.floor(random() * copy.length);
      copy[i] = mutate(copy[i], random);
    }
    return copy;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return value;
  const [key, child] = entries[Math.floor(random() * entries.length)] ?? ['', null];
  return { ...value, [key]: mutate(child, random) };
}

describe('defaultState', () => {
  it('is a valid state that sanitising leaves as it is', () => {
    const state = defaultState();
    expectValid(state);
    expect(sanitizeState(state)).toEqual(state);
  });

  it('is a fresh object every time', () => {
    const a = defaultState();
    a.plate.width = 50;
    expect(defaultState().plate.width).not.toBe(50);
  });
});

describe('magnets', () => {
  it('are none by default, 10 × 2 mm with 0.2 mm of fit and 3 mm of edge', () => {
    expect(defaultState().magnets).toEqual({ count: 0, layout: 'centre', diameter: 10, thickness: 2, fit: 0.2, edge: 3 });
  });

  it('offer layouts by count', () => {
    expect(magnetLayouts(0)).toEqual([]);
    expect(magnetLayouts(1)).toEqual(['centre', 'top']);
    expect(magnetLayouts(2)).toEqual(['row', 'column', 'topCorners']);
    expect(magnetLayouts(3)).toEqual(['triangle', 'triangleDown', 'row', 'column']);
    expect(magnetLayouts(4)).toEqual(['corners', 'diamond', 'row', 'column']);
  });

  it('come back as none from a state saved before them', () => {
    const old: Record<string, unknown> = { ...fullState() };
    delete old.magnets;
    expect(sanitizeState(old).magnets).toEqual(defaultState().magnets);
    expect(sanitizeState(old).holes).toEqual(fullState().holes);
  });

  it('keep a layout the count has, else take the count’s first', () => {
    const state = fullState();
    const with2 = (layout: string) => sanitizeState({ ...state, magnets: { ...state.magnets, count: 2, layout } }).magnets.layout;
    expect(with2('column')).toBe('column');
    expect(with2('corners')).toBe('row');
    expect(with2('blob')).toBe('row');
    // with none, any known layout stays, to come back when magnets do
    expect(sanitizeState({ ...state, magnets: { ...state.magnets, count: 0, layout: 'corners' } }).magnets.layout).toBe('corners');
  });

  it('clamp the count and the sizes', () => {
    const state = fullState();
    const m = sanitizeState({ ...state, magnets: { count: 7.4, layout: 'row', diameter: 100, thickness: 0, fit: -1, edge: 0 } }).magnets;
    expect(m).toEqual({ count: 4, layout: 'row', diameter: 30, thickness: 0.5, fit: 0, edge: 1 });
  });
});

describe('element defaults', () => {
  it('fit an image to 60 % of the plate and keep its proportions in pixels', () => {
    const state = defaultState();
    const image = defaultImage(state, PNG, 400, 100);
    expect(image.size).toBeCloseTo(0.6 * state.plate.width);
    expect([image.pixelWidth, image.pixelHeight]).toEqual([400, 100]);
    const tall = defaultImage(state, PNG, 100, 400);
    expect(tall.size).toBeCloseTo(0.6 * state.plate.height);
  });

  it('give a text an arc of half the plate width', () => {
    const state = defaultState();
    expect(defaultText(state).arcRadius).toBe(state.plate.width / 2);
    expect(defaultText(state).text).toBe('Text');
  });

  it('give each hole kind the spec defaults', () => {
    expect(defaultHole('round').diameter).toBe(4);
    expect([defaultHole('slot').length, defaultHole('slot').width]).toEqual([12, 3]);
    expect([defaultHole('countersunk').screw, defaultHole('countersunk').head]).toEqual([4.5, 8.5]);
    const keyhole = defaultHole('keyhole');
    expect([keyhole.keyHead, keyhole.keyShank, keyhole.keySlot]).toEqual([8, 4, 10]);
  });
});

describe('sanitizeState', () => {
  it('turns anything that is not a state into the default', () => {
    for (const input of [null, undefined, 3, 'x', [], {}]) expect(sanitizeState(input)).toEqual(defaultState());
  });

  it('keeps a valid full state as it is', () => {
    const state = fullState();
    expectValid(state);
    expect(sanitizeState(state)).toEqual(state);
  });

  it('clamps the plate to the ranges of the spec', () => {
    const state = defaultState();
    const plate = sanitizeState({
      ...state,
      plate: { ...state.plate, width: 5000, height: 1, thickness: 0.1, sides: 30, points: 2.6, innerRatio: 2 },
    }).plate;
    expect([plate.width, plate.height, plate.thickness, plate.sides, plate.points, plate.innerRatio]).toEqual([300, 10, 0.6, 12, 4, 0.9]);
  });

  it('limits the corner rounding to half the smaller side', () => {
    const state = defaultState();
    expect(sanitizeState({ ...state, plate: { ...state.plate, width: 40, height: 20, rounding: 50 } }).plate.rounding).toBe(10);
  });

  it('replaces wrong types and unknown kinds with defaults', () => {
    const state = defaultState();
    const plate = sanitizeState({ ...state, plate: { ...state.plate, kind: 'blob', width: '80', rim: 'yes' } }).plate;
    expect(plate.kind).toBe(state.plate.kind);
    expect(plate.width).toBe(state.plate.width);
    expect(plate.rim).toBe(state.plate.rim);
  });

  it('cuts the element lists to their limits', () => {
    const state = defaultState();
    const holes = Array.from({ length: 30 }, () => defaultHole('round'));
    expect(sanitizeState({ ...state, holes }).holes).toHaveLength(LIMITS.holes);
  });

  it('drops an image without a PNG data URL', () => {
    const state = fullState();
    const images = [
      { ...state.images[0], src: 'https://example.com/a.png' },
      { ...state.images[0], src: 'data:image/svg+xml,<svg/>' },
    ];
    expect(sanitizeState({ ...state, images }).images).toEqual([]);
  });

  it('keeps black below white in the levels', () => {
    const state = fullState();
    const image = sanitizeState({ ...state, images: [{ ...state.images[0], black: 200, white: 100 }] }).images[0];
    expect(image?.black).toBe(200);
    expect(image?.white).toBe(201);
    const top = sanitizeState({ ...state, images: [{ ...state.images[0], black: 255, white: 255 }] }).images[0];
    expect([top?.black, top?.white]).toEqual([254, 255]);
  });

  it('limits an engraving to leave 0.4 mm of base', () => {
    const state = fullState();
    const text = sanitizeState({
      ...state,
      plate: { ...state.plate, thickness: 1 },
      texts: [{ ...state.texts[0], mode: 'engraved', depth: 5 }],
    }).texts[0];
    expect(text?.depth).toBeCloseTo(0.6);
  });

  it('limits text to 10 lines and 300 characters, without control characters', () => {
    const state = fullState();
    const long = Array.from({ length: 15 }, (_, i) => `line ${i}\u0007`).join('\n');
    const text = sanitizeState({ ...state, texts: [{ ...state.texts[0], text: long }] }).texts[0]?.text ?? '';
    expect(text.split('\n')).toHaveLength(10);
    expect(text).not.toContain('\u0007');
    const wide = sanitizeState({ ...state, texts: [{ ...state.texts[0], text: 'x'.repeat(500) }] }).texts[0]?.text ?? '';
    expect(wide).toHaveLength(300);
  });

  it('keeps a screw head wider than the screw and a keyhole head wider than its shank', () => {
    const state = fullState();
    const holes = [
      { ...state.holes[0], kind: 'countersunk', screw: 8, head: 5 },
      { ...state.holes[1], keyHead: 6, keyShank: 7 },
    ];
    const [countersunk, keyhole] = sanitizeState({ ...state, holes }).holes;
    expect(countersunk?.head).toBeGreaterThan(8);
    expect(keyhole?.keyShank).toBeLessThan(6);
  });

  it('normalises rotation into 0…360', () => {
    const state = fullState();
    const holes = [
      { ...state.holes[0], rotation: -90 },
      { ...state.holes[1], rotation: 720 + 15 },
    ];
    expect(sanitizeState({ ...state, holes }).holes.map((h) => h.rotation)).toEqual([270, 15]);
  });

  it('gives elements unique ids of their kind, keeping the valid ones', () => {
    const state = fullState();
    const holes = [
      { ...state.holes[0], id: 'h3' },
      { ...state.holes[0], id: 'h3' },
      { ...state.holes[0], id: 't9' },
      { ...state.holes[0], id: 7 },
    ];
    expect(sanitizeState({ ...state, holes }).holes.map((h) => h.id)).toEqual(['h3', 'h1', 'h2', 'h4']);
  });

  it('never throws, is idempotent and always valid (fuzz)', () => {
    const random = rng(20261104);
    const valid = fullState();
    for (let i = 0; i < 3000; i++) {
      let input: unknown = i % 3 === 0 ? randomValue(random) : valid;
      if (i % 3 !== 0) for (let m = 0; m < 1 + Math.floor(random() * 5); m++) input = mutate(input, random);
      const once = sanitizeState(input);
      expectValid(once);
      expect(sanitizeState(once)).toEqual(once);
      expect(sanitizeState(JSON.parse(JSON.stringify(once)))).toEqual(once);
    }
  });
});
