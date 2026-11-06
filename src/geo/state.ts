// The project's schema: the plate, its images, texts, holes and magnets
// (spec §2–§5a), the defaults and the sanitiser.
//
// Everything from outside — the UI, localStorage, a project file, a worker
// message — passes sanitizeState. It never throws, it is idempotent, and its
// result is always within the ranges below (fuzz-tested), so the rest of the
// app never checks a field again.

export const STATE_VERSION = 1;

export const OUTLINE_KINDS = [
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'star',
  'heart',
  'shield',
  'tag',
  'vignette',
  'svg',
  'crop',
] as const;
export type OutlineKind = (typeof OUTLINE_KINDS)[number];

/** The kinds drawn from a formula, as opposed to a picture (vignette, SVG) or the elements (crop). */
export const PRIMITIVE_KINDS = [
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'star',
  'heart',
  'shield',
  'tag',
] as const satisfies readonly OutlineKind[];
export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

/** The profile of the plate's outer top and bottom edges (spec §2.2a). */
export const EDGE_PROFILES = ['fillet', 'chamfer'] as const;
export type EdgeProfile = (typeof EDGE_PROFILES)[number];
/** Which of the plate's outer edges are rounded or chamfered (spec §2.2a). */
export const EDGE_SIDES = ['both', 'top', 'bottom'] as const;
export type EdgeSides = (typeof EDGE_SIDES)[number];

export const HOLE_KINDS = ['round', 'slot', 'countersunk', 'keyhole'] as const;
export type HoleKind = (typeof HOLE_KINDS)[number];

/** Where the magnets go (spec §5a), every count's layouts; the first is the count's default. */
export const MAGNET_LAYOUT_IDS = [
  'centre',
  'top',
  'row',
  'column',
  'topCorners',
  'triangle',
  'triangleDown',
  'corners',
  'diamond',
] as const;
export type MagnetLayout = (typeof MAGNET_LAYOUT_IDS)[number];

const LAYOUTS_BY_COUNT: readonly (readonly MagnetLayout[])[] = [
  [],
  ['centre', 'top'],
  ['row', 'column', 'topCorners'],
  ['triangle', 'triangleDown', 'row', 'column'],
  ['corners', 'diamond', 'row', 'column'],
];

/** The layouts a number of magnets offers; none for 0. */
export function magnetLayouts(count: number): readonly MagnetLayout[] {
  return LAYOUTS_BY_COUNT[count] ?? [];
}

/** The layout kept when the count changes: the same if the new count has it, else the count's first. */
export function layoutFor(count: number, layout: MagnetLayout): MagnetLayout {
  const offered = magnetLayouts(count);
  return offered.length === 0 || offered.includes(layout) ? layout : offered[0];
}

/** Bundled fonts (spec §4): Rubik (Latin, Cyrillic, Hebrew), Oswald, PT Serif, Comfortaa, Marck Script (Latin, Cyrillic), Frank Ruhl Libre (Latin, Hebrew). */
export const FONT_IDS = ['rubik', 'oswald', 'ptSerif', 'comfortaa', 'marckScript', 'frankRuhl'] as const;
export type FontId = (typeof FONT_IDS)[number];

export const ALIGNS = ['left', 'center', 'right'] as const;
export type Align = (typeof ALIGNS)[number];

export interface Range {
  min: number;
  max: number;
  /** the default */
  def: number;
  /** whole numbers only */
  int?: boolean;
}

/** Every numeric field's range and default, mm unless said otherwise (spec §2–§5, §13). */
export const RANGES = {
  plateSize: { min: 10, max: 300, def: 100 },
  thickness: { min: 0.6, max: 20, def: 3 },
  /** the upper limit is half the smaller side; the geometry lowers it further where the outline would vanish */
  rounding: { min: 0, max: 150, def: 4 },
  sides: { min: 5, max: 12, def: 6, int: true },
  points: { min: 4, max: 12, def: 5, int: true },
  innerRatio: { min: 0.2, max: 0.9, def: 0.5 },
  /** the upper limit is half the outer wall's height (wallHeight) */
  edgeSize: { min: 0, max: 10, def: 0 },
  rimWidth: { min: 0.8, max: 20, def: 3 },
  rimHeight: { min: 0.2, max: 10, def: 1 },
  frameHeight: { min: 0.2, max: 10, def: 1 },
  padding: { min: 0, max: 30, def: 3 },
  /** an element's centre, either axis */
  position: { min: -1000, max: 1000, def: 0 },
  /** degrees, counter-clockwise */
  rotation: { min: 0, max: 360, def: 0 },
  imageSize: { min: 5, max: 300, def: 60 },
  reliefHeight: { min: 0.1, max: 10, def: 1.5 },
  level: { min: 0, max: 255, def: 0, int: true },
  /** px */
  blur: { min: 0, max: 5, def: 0 },
  /** % of the relief height */
  threshold: { min: 0, max: 100, def: 10 },
  /** a stored picture's side, px */
  pixels: { min: 1, max: 512, def: 1, int: true },
  /** capital letter height */
  textSize: { min: 2, max: 100, def: 8 },
  /** × size */
  lineSpacing: { min: 0.8, max: 2, def: 1.2 },
  textHeight: { min: 0.2, max: 10, def: 1 },
  /** the upper limit is T − 0.4 */
  engraveDepth: { min: 0.2, max: 19.6, def: 0.6 },
  arcRadius: { min: 5, max: 300, def: 50 },
  holeDiameter: { min: 1, max: 50, def: 4 },
  slotLength: { min: 2, max: 100, def: 12 },
  slotWidth: { min: 1, max: 30, def: 3 },
  screw: { min: 2, max: 8, def: 4.5 },
  /** more than the screw */
  screwHead: { min: 3, max: 20, def: 8.5 },
  keyHead: { min: 4, max: 16, def: 8 },
  /** less than the head */
  keyShank: { min: 2, max: 10, def: 4 },
  keySlot: { min: 4, max: 40, def: 10 },
  magnetCount: { min: 0, max: 4, def: 0, int: true },
  magnetDiameter: { min: 3, max: 30, def: 10 },
  magnetThickness: { min: 0.5, max: 10, def: 2 },
  /** added to the diameter: room for glue and the printer's tolerance */
  magnetFit: { min: 0, max: 1, def: 0.2 },
  /** material between a pocket and the outline */
  magnetEdge: { min: 1, max: 30, def: 3 },
} as const satisfies Record<string, Range>;

export const LIMITS = {
  images: 8,
  texts: 10,
  holes: 16,
  textLines: 10,
  textChars: 300,
  projectName: 60,
  /** a stored picture's data URL; a 512 px photo is ~200 kB */
  imageUrlChars: 2_000_000,
  svgUrlChars: 2_000_000,
} as const;

/** Material an engraving leaves under itself, mm (spec §4, `text.engraveDeep`). */
export const ENGRAVE_FLOOR = 0.4;

export interface Plate {
  kind: OutlineKind;
  width: number;
  height: number;
  thickness: number;
  rounding: number;
  /** regular polygon */
  sides: number;
  /** star */
  points: number;
  innerRatio: number;
  /** a catalog entry's id (vignette) */
  vignette: string;
  /** an uploaded SVG as a data URL (own SVG outline) */
  svg: string;
  /** vignette and own SVG: stretch to width × height unless on */
  keepProportions: boolean;
  /** vignette and own SVG: the silhouette raised as a frame */
  frame: boolean;
  frameHeight: number;
  /** crop around the elements */
  padding: number;
  rim: boolean;
  rimWidth: number;
  rimHeight: number;
  /** the outer edges' fillet radius or chamfer leg; 0 = sharp */
  edgeSize: number;
  edgeProfile: EdgeProfile;
  edgeSides: EdgeSides;
}

/**
 * The height of the plate's outer wall, mm: T, plus the rim or a vignette's
 * or own SVG's frame standing on the outline, the higher of the two.
 */
export function wallHeight(plate: Pick<Plate, 'kind' | 'thickness' | 'rim' | 'rimHeight' | 'frame' | 'frameHeight'>): number {
  const framed = plate.frame && (plate.kind === 'vignette' || plate.kind === 'svg');
  return plate.thickness + Math.max(plate.rim ? plate.rimHeight : 0, framed ? plate.frameHeight : 0);
}

interface Placed {
  id: string;
  visible: boolean;
  /** centre, plate frame, mm */
  x: number;
  y: number;
  /** degrees, counter-clockwise */
  rotation: number;
}

export interface ImageElement extends Placed {
  type: 'image';
  /** the processed grayscale + alpha picture as a PNG data URL */
  src: string;
  pixelWidth: number;
  pixelHeight: number;
  /** the long side on the plate */
  size: number;
  height: number;
  invert: boolean;
  black: number;
  white: number;
  blur: number;
  threshold: number;
  inOutline: boolean;
}

export interface TextElement extends Placed {
  type: 'text';
  text: string;
  font: FontId;
  /** capital letter height */
  size: number;
  lineSpacing: number;
  align: Align;
  mode: 'raised' | 'engraved';
  height: number;
  depth: number;
  arc: boolean;
  arcRadius: number;
  arcSide: 'outside' | 'inside';
  inOutline: boolean;
}

export interface HoleElement extends Placed {
  type: 'hole';
  kind: HoleKind;
  /** round */
  diameter: number;
  /** slot */
  length: number;
  width: number;
  /** countersunk */
  screw: number;
  head: number;
  /** keyhole */
  keyHead: number;
  keyShank: number;
  keySlot: number;
}

export type PlateElement = ImageElement | TextElement | HoleElement;

/** Round magnets set into the back (spec §5a): one size, placed by a layout. */
export interface Magnets {
  /** 0: none */
  count: number;
  layout: MagnetLayout;
  diameter: number;
  thickness: number;
  fit: number;
  edge: number;
}

export interface PlateState {
  version: typeof STATE_VERSION;
  /** the project's name, also the exported file's */
  name: string;
  plate: Plate;
  images: ImageElement[];
  texts: TextElement[];
  holes: HoleElement[];
  magnets: Magnets;
}

export function defaultPlate(): Plate {
  return {
    kind: 'rectangle',
    width: RANGES.plateSize.def,
    height: 60,
    thickness: RANGES.thickness.def,
    rounding: RANGES.rounding.def,
    sides: RANGES.sides.def,
    points: RANGES.points.def,
    innerRatio: RANGES.innerRatio.def,
    vignette: '',
    svg: '',
    keepProportions: true,
    frame: true,
    frameHeight: RANGES.frameHeight.def,
    padding: RANGES.padding.def,
    rim: false,
    rimWidth: RANGES.rimWidth.def,
    rimHeight: RANGES.rimHeight.def,
    edgeSize: RANGES.edgeSize.def,
    edgeProfile: 'fillet',
    edgeSides: 'both',
  };
}

export function defaultMagnets(): Magnets {
  return {
    count: RANGES.magnetCount.def,
    layout: 'centre',
    diameter: RANGES.magnetDiameter.def,
    thickness: RANGES.magnetThickness.def,
    fit: RANGES.magnetFit.def,
    edge: RANGES.magnetEdge.def,
  };
}

export function defaultState(): PlateState {
  return { version: STATE_VERSION, name: 'plate', plate: defaultPlate(), images: [], texts: [], holes: [], magnets: defaultMagnets() };
}

const placed = (): Omit<Placed, 'id'> => ({ visible: true, x: 0, y: 0, rotation: 0 });

/** A new image fitted to 60 % of the plate; the id is assigned by sanitizeState. */
export function defaultImage(state: PlateState, src: string, pixelWidth: number, pixelHeight: number): ImageElement {
  const { width, height } = state.plate;
  // the picture's box fits 60 % of the plate both ways; size is its long side
  const landscape = pixelWidth >= pixelHeight;
  const size = landscape
    ? Math.min(0.6 * width, (0.6 * height * pixelWidth) / pixelHeight)
    : Math.min(0.6 * height, (0.6 * width * pixelHeight) / pixelWidth);
  return {
    ...placed(),
    id: '',
    type: 'image',
    src,
    pixelWidth,
    pixelHeight,
    size: clamp(size, RANGES.imageSize),
    height: RANGES.reliefHeight.def,
    invert: false,
    black: 0,
    white: 255,
    blur: RANGES.blur.def,
    threshold: RANGES.threshold.def,
    inOutline: true,
  };
}

export function defaultText(state: PlateState): TextElement {
  return {
    ...placed(),
    id: '',
    type: 'text',
    text: 'Text',
    font: 'rubik',
    size: RANGES.textSize.def,
    lineSpacing: RANGES.lineSpacing.def,
    align: 'center',
    mode: 'raised',
    height: RANGES.textHeight.def,
    depth: RANGES.engraveDepth.def,
    arc: false,
    arcRadius: clamp(state.plate.width / 2, RANGES.arcRadius),
    arcSide: 'outside',
    inOutline: true,
  };
}

export function defaultHole(kind: HoleKind): HoleElement {
  return {
    ...placed(),
    id: '',
    type: 'hole',
    kind,
    diameter: RANGES.holeDiameter.def,
    length: RANGES.slotLength.def,
    width: RANGES.slotWidth.def,
    screw: RANGES.screw.def,
    head: RANGES.screwHead.def,
    keyHead: RANGES.keyHead.def,
    keyShank: RANGES.keyShank.def,
    keySlot: RANGES.keySlot.def,
  };
}

// ---------------------------------------------------------------------------
// Sanitising

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `+ 0` turns −0 into 0: a JSON round trip would do the same and break idempotence. */
function clamp(value: number, range: { min: number; max: number; int?: boolean }): number {
  const rounded = range.int ? Math.round(value) : value;
  return Math.min(range.max, Math.max(range.min, rounded)) + 0;
}

function num(value: unknown, range: Range, max: number = range.max, min: number = range.min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return clamp(range.def, { min, max, int: range.int });
  return clamp(value, { min, max, int: range.int });
}

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

function angle(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const a = ((value % 360) + 360) % 360;
  // 359.9999999 % 360 may round up to 360 after the shift
  return a >= 360 ? 0 : a + 0;
}

// eslint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL_BUT_LINE_FEED = /[\u0000-\u0009\u000b-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex -- removing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;

/** Drops control characters except the line feed; trims to the limits. */
function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const lines = value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_FEED, '').split('\n');
  return lines.slice(0, LIMITS.textLines).join('\n').slice(0, LIMITS.textChars);
}

function dataUrl(value: unknown, prefix: string, limit: number): string {
  return typeof value === 'string' && value.startsWith(prefix) && value.length <= limit ? value : '';
}

function sanitizePlate(input: unknown): Plate {
  const d = defaultPlate();
  const p = isRecord(input) ? input : {};
  const width = num(p.width, RANGES.plateSize, RANGES.plateSize.max);
  const height = num(p.height, { ...RANGES.plateSize, def: d.height });
  const vignette = typeof p.vignette === 'string' && /^[a-z0-9-]{1,64}$/.test(p.vignette) ? p.vignette : '';
  const plate = {
    kind: oneOf(p.kind, OUTLINE_KINDS, d.kind),
    width,
    height,
    thickness: num(p.thickness, RANGES.thickness),
    rounding: num(p.rounding, RANGES.rounding, Math.min(width, height) / 2),
    sides: num(p.sides, RANGES.sides),
    points: num(p.points, RANGES.points),
    innerRatio: num(p.innerRatio, RANGES.innerRatio),
    vignette,
    svg: dataUrl(p.svg, 'data:image/svg+xml', LIMITS.svgUrlChars),
    keepProportions: bool(p.keepProportions, d.keepProportions),
    frame: bool(p.frame, d.frame),
    frameHeight: num(p.frameHeight, RANGES.frameHeight),
    padding: num(p.padding, RANGES.padding),
    rim: bool(p.rim, d.rim),
    rimWidth: num(p.rimWidth, RANGES.rimWidth),
    rimHeight: num(p.rimHeight, RANGES.rimHeight),
  };
  return {
    ...plate,
    // the two edges must not meet
    edgeSize: num(p.edgeSize, RANGES.edgeSize, Math.min(RANGES.edgeSize.max, wallHeight(plate) / 2)),
    edgeProfile: oneOf(p.edgeProfile, EDGE_PROFILES, d.edgeProfile),
    edgeSides: oneOf(p.edgeSides, EDGE_SIDES, d.edgeSides),
  };
}

function sanitizePlaced(e: Fields): Omit<Placed, 'id'> {
  return {
    visible: bool(e.visible, true),
    x: num(e.x, RANGES.position),
    y: num(e.y, RANGES.position),
    rotation: angle(e.rotation),
  };
}

function sanitizeImage(e: Fields): ImageElement | null {
  const src = dataUrl(e.src, 'data:image/png;base64,', LIMITS.imageUrlChars);
  if (!src) return null;
  const black = num(e.black, RANGES.level, 254);
  return {
    ...sanitizePlaced(e),
    id: typeof e.id === 'string' ? e.id : '',
    type: 'image',
    src,
    pixelWidth: num(e.pixelWidth, RANGES.pixels),
    pixelHeight: num(e.pixelHeight, RANGES.pixels),
    size: num(e.size, RANGES.imageSize),
    height: num(e.height, RANGES.reliefHeight),
    invert: bool(e.invert, false),
    black,
    white: num(e.white, { ...RANGES.level, def: 255 }, 255, black + 1),
    blur: num(e.blur, RANGES.blur),
    threshold: num(e.threshold, RANGES.threshold),
    inOutline: bool(e.inOutline, true),
  };
}

/** T − 0.4 to the micron: without rounding, 0.6 − 0.4 falls under the 0.2 minimum. */
export function maxEngraveDepth(thickness: number): number {
  return Math.round((thickness - ENGRAVE_FLOOR) * 1e6) / 1e6;
}

function sanitizeText(e: Fields, thickness: number): TextElement {
  return {
    ...sanitizePlaced(e),
    id: typeof e.id === 'string' ? e.id : '',
    type: 'text',
    text: cleanText(e.text, 'Text'),
    font: oneOf(e.font, FONT_IDS, 'rubik'),
    size: num(e.size, RANGES.textSize),
    lineSpacing: num(e.lineSpacing, RANGES.lineSpacing),
    align: oneOf(e.align, ALIGNS, 'center'),
    mode: oneOf(e.mode, ['raised', 'engraved'], 'raised'),
    height: num(e.height, RANGES.textHeight),
    depth: num(e.depth, RANGES.engraveDepth, maxEngraveDepth(thickness)),
    arc: bool(e.arc, false),
    arcRadius: num(e.arcRadius, RANGES.arcRadius),
    arcSide: oneOf(e.arcSide, ['outside', 'inside'], 'outside'),
    inOutline: bool(e.inOutline, true),
  };
}

function sanitizeHole(e: Fields): HoleElement {
  const screw = num(e.screw, RANGES.screw);
  const keyHead = num(e.keyHead, RANGES.keyHead);
  return {
    ...sanitizePlaced(e),
    id: typeof e.id === 'string' ? e.id : '',
    type: 'hole',
    kind: oneOf(e.kind, HOLE_KINDS, 'round'),
    diameter: num(e.diameter, RANGES.holeDiameter),
    length: num(e.length, RANGES.slotLength),
    width: num(e.width, RANGES.slotWidth),
    screw,
    head: num(e.head, RANGES.screwHead, RANGES.screwHead.max, screw + 1),
    keyHead,
    keyShank: num(e.keyShank, RANGES.keyShank, keyHead - 1),
    keySlot: num(e.keySlot, RANGES.keySlot),
  };
}

/** A state saved before magnets has none: the field's absence is "no magnets". */
function sanitizeMagnets(input: unknown): Magnets {
  const m = isRecord(input) ? input : {};
  const count = num(m.count, RANGES.magnetCount);
  return {
    count,
    layout: layoutFor(count, oneOf(m.layout, MAGNET_LAYOUT_IDS, magnetLayouts(count)[0] ?? 'centre')),
    diameter: num(m.diameter, RANGES.magnetDiameter),
    thickness: num(m.thickness, RANGES.magnetThickness),
    fit: num(m.fit, RANGES.magnetFit),
    edge: num(m.edge, RANGES.magnetEdge),
  };
}

function list<T>(value: unknown, limit: number, item: (fields: Fields) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    if (out.length >= limit) break;
    if (!isRecord(entry)) continue;
    const element = item(entry);
    if (element) out.push(element);
  }
  return out;
}

/**
 * Ids are a kind's letter and a number (`i1`, `t2`, `h3`). A valid id keeps
 * its first holder; the rest get the smallest free numbers, in order.
 */
function assignIds<T extends { id: string }>(elements: T[], prefix: string): T[] {
  const pattern = new RegExp(`^${prefix}[1-9]\\d{0,5}$`);
  const used = new Set<string>();
  const keep = elements.map((e) => {
    if (!pattern.test(e.id) || used.has(e.id)) return false;
    used.add(e.id);
    return true;
  });
  let n = 1;
  return elements.map((e, i) => {
    if (keep[i]) return e;
    while (used.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    used.add(id);
    return { ...e, id };
  });
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return 'plate';
  const name = value.replace(CONTROL, '').trim().slice(0, LIMITS.projectName).trim();
  return name || 'plate';
}

export function sanitizeState(input: unknown): PlateState {
  if (!isRecord(input)) return defaultState();
  const plate = sanitizePlate(input.plate);
  return {
    version: STATE_VERSION,
    name: cleanName(input.name),
    plate,
    images: assignIds(list(input.images, LIMITS.images, sanitizeImage), 'i'),
    texts: assignIds(
      list(input.texts, LIMITS.texts, (e) => sanitizeText(e, plate.thickness)),
      't',
    ),
    holes: assignIds(list(input.holes, LIMITS.holes, sanitizeHole), 'h'),
    magnets: sanitizeMagnets(input.magnets),
  };
}
