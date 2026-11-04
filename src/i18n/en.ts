import { plural } from './plural';

// English is the default locale and defines the shape of every message set.
// Plain string messages can be used in index.html via data-i18n / data-i18n-label.
export const en = {
  title: 'Plate Builder',
  description: 'Design a flat plate — a sign, a keychain, a tag — and download it as STL for 3D printing.',
  languageLabel: 'Language',
  source: 'Source code',
  mm: 'mm',

  plateCard: 'Plate',
  outline: 'Outline',
  kindRectangle: 'Rectangle',
  kindEllipse: 'Ellipse',
  kindTriangle: 'Triangle',
  kindPolygon: 'Polygon',
  kindStar: 'Star',
  kindHeart: 'Heart',
  kindShield: 'Shield',
  kindTag: 'Tag',
  width: 'Width',
  height: 'Height',
  thickness: 'Thickness',
  rounding: 'Corner rounding',
  sides: 'Sides',
  points: 'Points',
  innerRatio: 'Inner ratio',

  view3d: '3D view',
  cameraFront: 'Front',
  cameraIso: 'Angle',
  cameraBack: 'Back',

  exportCard: 'Export',
  downloadStl: 'Download STL',
  exporting: 'Building the STL…',
  building: 'Building…',
  engineLoading: 'Loading the geometry engine…',

  meshSize: (w: string, h: string, z: string) => `${w} × ${h} × ${z} mm`,
  triangles: (n: number) => `${n} ${plural('en', n, { one: 'triangle', other: 'triangles' })}`,
  builtIn: (ms: number) => `built in ${Math.round(ms)} ms`,
  exported: (name: string, ms: number) => `${name} saved, built in ${Math.round(ms)} ms`,
  engineFailed: (reason: string) => `The geometry engine failed: ${reason}`,
  meshBlocked: (problems: string) => `The mesh is broken (${problems}); the STL cannot be exported.`,
  meshProblem: {
    nonFinite: 'coordinates are not numbers',
    badIndices: 'triangles point at missing vertices',
    empty: 'the mesh is empty',
    open: 'the surface is not closed',
    inverted: 'the surface is inside out',
    degenerate: 'too many degenerate triangles',
  },
};

export type Messages = typeof en;
