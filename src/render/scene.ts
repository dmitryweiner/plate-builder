// The 3D view (spec §7.4) is maker-kit's viewer: the plate on a grid, orbit
// controls, a low light so a 0.2 mm relief shades readably, frames drawn on
// demand. This adapter gives the app its SceneHandle and its three camera
// presets in the kit's frame: the plate lies flat, so its front is seen
// from the kit's `top` and its back from `bottom`. Kept thin: vitest does
// not load it, the smoke checks it.

import { createViewer, type CameraPreset as KitPreset } from 'maker-kit/3d/viewer';
import type { CameraPreset, SceneHandle, ViewMesh } from './view';

const PRESETS: Record<CameraPreset, KitPreset> = { front: 'top', iso: 'iso', back: 'bottom' };

export function createScene(canvas: HTMLCanvasElement): SceneHandle | null {
  const viewer = createViewer(canvas);
  if (!viewer) return null;
  return {
    setMesh: (mesh: ViewMesh | null) => viewer.setMeshes(mesh && mesh.indices.length > 0 ? [{ mesh }] : []),
    setCamera: (preset) => viewer.camera(PRESETS[preset]),
    dispose: () => viewer.dispose(),
  };
}
