// English is the default locale and defines the shape of every message set.
// Plain string messages can be used in index.html via data-i18n / data-i18n-label.
export const en = {
  title: 'Plate Builder',
  description: 'Design a flat plate — a sign, a keychain, a tag — and download it as STL for 3D printing.',
  heading: 'Plate Builder',
  intro: 'A plate for 3D printing: an outline, images, texts and holes.',
  languageLabel: 'Language',
  source: 'Source code',
  engineLoading: 'Loading the geometry engine…',

  engineReady: (ms: number) => `Geometry engine ready in ${Math.round(ms)} ms`,
  engineFailed: (reason: string) => `The geometry engine did not start: ${reason}`,
};

export type Messages = typeof en;
