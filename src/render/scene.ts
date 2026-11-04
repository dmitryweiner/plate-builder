// The Three.js layer (spec §7.4): the plate lying on a grid, orbit controls,
// a light from above at a low angle so a 0.2 mm relief casts readable
// shading, camera presets. It takes finished buffers from the worker and
// knows nothing of the geometry. The model is z-up (the back face on the bed
// at z = 0); the group turns it y-up for display. Kept thin: vitest does not
// load it, the smoke checks it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CameraPreset, SceneHandle, ViewMesh } from './view';

/** the page's background in either theme is close to this; the view keeps one look */
const CLEAR_COLOR = 0x1d2233;
const PLATE_COLOR = 0xe9e4da;
const GRID_COLORS = { center: 0x56607e, lines: 0x343b52 } as const;
/** faces meeting at more than this angle get their own normals: a slab's edges stay sharp */
const CREASE = (40 * Math.PI) / 180;

/** Directions to the camera from the target, in the display frame (y up). */
const PRESETS: Record<CameraPreset, [number, number, number]> = {
  front: [0, 1, 0.0001],
  iso: [0.55, 0.75, 0.9],
  back: [0, -1, 0.0001],
};

export function createScene(canvas: HTMLCanvasElement): SceneHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    // no WebGL: the app works on without its 3D view
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(CLEAR_COLOR);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x30364a, 0.75));
  // low and from one side: shallow relief reads by its shadows' gradient
  const key = new THREE.DirectionalLight(0xfff6ea, 2.2);
  key.position.set(-1, 0.45, 0.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc6d2ff, 0.35);
  fill.position.set(1, 0.3, -0.8);
  scene.add(fill);
  // from below and aside, for the back preset: keyhole pockets shade
  const under = new THREE.DirectionalLight(0xffffff, 1.5);
  under.position.set(-0.8, -0.6, 0.5);
  scene.add(under);

  // z-up (model) → y-up (screen)
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  scene.add(group);
  const material = new THREE.MeshStandardMaterial({ color: PLATE_COLOR, metalness: 0, roughness: 0.75, side: THREE.DoubleSide });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  let grid: THREE.GridHelper | null = null;
  let gridSize = 0;
  let mesh: THREE.Mesh | null = null;
  let radius = 60;
  let fitted = false;
  let disposed = false;

  function setGrid(size: number): void {
    // whole centimetres, a little wider than the plate
    const cells = Math.max(4, Math.ceil((size * 1.3) / 10));
    if (grid && cells * 10 === gridSize) return;
    if (grid) {
      scene.remove(grid);
      grid.dispose();
    }
    gridSize = cells * 10;
    grid = new THREE.GridHelper(gridSize, cells, GRID_COLORS.center, GRID_COLORS.lines);
    // a hair under the back face, or the face flickers through the lines
    grid.position.y = -0.05;
    scene.add(grid);
  }

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function frame(): void {
    if (disposed) return;
    resize();
    controls.update();
    // from under the bed the grid would lie over the back face (keyholes): it shows from above only
    if (grid) grid.visible = camera.position.y > controls.target.y;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /** Puts the camera so that the plate's bounding sphere fills the view, looking from `direction`. */
  function place(direction: THREE.Vector3): void {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1;
    controls.target.set(0, 0, 0);
    camera.position.copy(direction).setLength(distance);
    camera.near = Math.max(0.1, distance / 200);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
  }

  const lookFrom = (preset: CameraPreset): void => place(new THREE.Vector3(...PRESETS[preset]));

  function show(next: ViewMesh | null): void {
    if (mesh) {
      group.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }
    if (!next || next.indices.length === 0) return;
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute('position', new THREE.BufferAttribute(next.positions, 3));
    indexed.setIndex(new THREE.BufferAttribute(next.indices, 1));
    const geometry = toCreasedNormals(indexed, CREASE);
    indexed.dispose();
    geometry.computeBoundingBox();
    mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    const box = geometry.boundingBox ?? new THREE.Box3();
    const size = new THREE.Vector3();
    box.getSize(size);
    setGrid(Math.max(size.x, size.y));
    const nextRadius = size.length() / 2;
    // fitted once, and again (from where it looks now) when the plate changes its size a lot
    if (!fitted || Math.abs(nextRadius - radius) > radius * 0.25) {
      radius = nextRadius;
      if (fitted) place(camera.position.clone().sub(controls.target));
      else lookFrom('iso');
      fitted = true;
    }
  }

  return {
    setMesh: show,
    setCamera: lookFrom,
    dispose() {
      disposed = true;
      controls.dispose();
      show(null);
      material.dispose();
      grid?.dispose();
      renderer.dispose();
    },
  };
}
