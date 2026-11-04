import { describe, expect, it } from 'vitest';
import { ALLOWED_LICENCES, parseCatalog, silhouetteSize } from './svgRaster';

describe('silhouetteSize', () => {
  it('stretches to width × height unless proportions are kept', () => {
    expect(silhouetteSize(100, 60, 2, false)).toEqual([100, 60]);
  });

  it('keeps proportions inside width × height', () => {
    expect(silhouetteSize(100, 60, 2, true)).toEqual([100, 50]);
    expect(silhouetteSize(100, 60, 1, true)).toEqual([60, 60]);
    expect(silhouetteSize(100, 60, 0, true)).toEqual([100, 60]);
  });
});

describe('parseCatalog', () => {
  const entry = {
    id: 'oval-wreath',
    file: 'oval-wreath.svg',
    names: { en: 'Oval wreath', ru: 'Овальный венок', uk: 'Овальний вінок', he: 'זר סגלגל' },
    source: 'https://example.org/oval',
    author: 'Someone',
    licence: 'CC0-1.0',
  };

  it('takes complete entries', () => {
    expect(parseCatalog({ vignettes: [entry] })).toEqual([entry]);
  });

  it('drops an entry with a missing name, a bad id or a licence that is not allowed', () => {
    const broken = [
      { ...entry, names: { en: 'x' } },
      { ...entry, id: 'Bad Id' },
      { ...entry, licence: 'CC-BY-4.0' },
      { ...entry, file: '../x.svg' },
      null,
    ];
    expect(parseCatalog({ vignettes: broken })).toEqual([]);
    expect(parseCatalog('nope')).toEqual([]);
    expect(ALLOWED_LICENCES).toContain('CC0-1.0');
  });
});
