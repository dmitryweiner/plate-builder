// An image's relief as a solid (spec §6, §8.4): a heightfield on a regular
// grid over the picture's rectangle, in the image's own frame. Its top
// follows the height function from a zero level just under the base's top
// (so it never shares that plane), its sides go straight down, and its flat
// bottom lies inside the base. Shared vertices, outward winding: ready for
// manifold.

export interface GridSpec {
  /** the picture's size, mm */
  width: number;
  height: number;
  /** the wanted cell size, mm; the cells fit the picture exactly, so they may come out a little smaller */
  step: number;
  /** z of height 0 (T − ε) */
  zero: number;
  /** z of the flat bottom, inside the base */
  bottom: number;
  /** a plane no top vertex may lie on (the base's top, T) */
  avoid: number;
}

/** Cells along each side. */
export function gridSize(width: number, height: number, step: number): [number, number] {
  return [Math.max(1, Math.ceil(width / step - 1e-9)), Math.max(1, Math.ceil(height / step - 1e-9))];
}

/** Moves a height off the avoided plane by a hair. */
const AVOID_GAP = 1e-4;

export function heightfieldMesh(
  sample: (x: number, y: number) => number,
  spec: GridSpec,
): { positions: Float32Array; indices: Uint32Array } {
  const [nx, ny] = gridSize(spec.width, spec.height, spec.step);
  const dx = spec.width / nx;
  const dy = spec.height / ny;
  const x0 = -spec.width / 2;
  const y0 = -spec.height / 2;
  const top = (nx + 1) * (ny + 1);
  const boundary = 2 * (nx + ny);
  // top grid, a bottom vertex under each boundary vertex, the bottom's centre
  const positions = new Float32Array((top + boundary + 1) * 3);
  const id = (i: number, j: number) => j * (nx + 1) + i;

  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      // the last row and column sit exactly on the picture's edge
      const x = i === nx ? -x0 : x0 + i * dx;
      const y = j === ny ? -y0 : y0 + j * dy;
      let z = spec.zero + sample(x, y);
      if (Math.abs(z - spec.avoid) < AVOID_GAP) z = spec.avoid + AVOID_GAP;
      const v = id(i, j) * 3;
      positions[v] = x;
      positions[v + 1] = y;
      positions[v + 2] = z;
    }
  }

  // the boundary, counter-clockwise from above: bottom edge, right, top, left
  const ring: number[] = [];
  for (let i = 0; i < nx; i++) ring.push(id(i, 0));
  for (let j = 0; j < ny; j++) ring.push(id(nx, j));
  for (let i = nx; i > 0; i--) ring.push(id(i, ny));
  for (let j = ny; j > 0; j--) ring.push(id(0, j));
  ring.forEach((t, k) => {
    const v = (top + k) * 3;
    positions[v] = positions[t * 3];
    positions[v + 1] = positions[t * 3 + 1];
    positions[v + 2] = spec.bottom;
  });
  const centre = top + boundary;
  positions[centre * 3] = 0;
  positions[centre * 3 + 1] = 0;
  positions[centre * 3 + 2] = spec.bottom;

  const indices = new Uint32Array((nx * ny * 2 + boundary * 3) * 3);
  let n = 0;
  const tri = (a: number, b: number, c: number) => {
    indices[n++] = a;
    indices[n++] = b;
    indices[n++] = c;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = id(i, j);
      const b = id(i + 1, j);
      const c = id(i + 1, j + 1);
      const d = id(i, j + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  for (let k = 0; k < boundary; k++) {
    const k1 = (k + 1) % boundary;
    const [t0, t1, b0, b1] = [ring[k], ring[k1], top + k, top + k1];
    // the side wall, facing out
    tri(t0, b0, b1);
    tri(t0, b1, t1);
    // the bottom, a fan from its centre, facing down
    tri(centre, b1, b0);
  }
  return { positions, indices };
}
