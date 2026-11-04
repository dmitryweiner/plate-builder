// What the app needs from the 3D view. Types only, so the app and its jsdom
// tests do not load Three.js; render/scene.ts implements it.

export type CameraPreset = 'front' | 'iso' | 'back';

export interface ViewMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface SceneHandle {
  /** the plate's mesh, z up, the back face at z = 0; null clears the view */
  setMesh(mesh: ViewMesh | null): void;
  setCamera(preset: CameraPreset): void;
  dispose(): void;
}
