import { describe, expect, it } from 'vitest';
import { blockLines } from './textRaster';

// The block's geometry, its scale and RTL detection are the kit's
// (`maker-kit/ui/textRaster`, tested there); the app maps its element.
describe('blockLines', () => {
  it('draws a straight block line by line and joins an arc’s lines', () => {
    expect(blockLines({ text: 'Dom\n12', arc: false })).toEqual(['Dom', '12']);
    expect(blockLines({ text: 'Dom\n12', arc: true })).toEqual(['Dom 12']);
  });
});
