import { describe, expect, it } from 'vitest';
import { formatRoomTitle } from '../useDocumentMeta';

describe('formatRoomTitle', () => {
  it('formats room title without a loaded document', () => {
    expect(formatRoomTitle('K7M2-P9X4')).toBe('Sala K7M2-P9X4 | Palco');
    expect(formatRoomTitle('K7M2-P9X4', null)).toBe('Sala K7M2-P9X4 | Palco');
    expect(formatRoomTitle('K7M2-P9X4', '   ')).toBe('Sala K7M2-P9X4 | Palco');
  });

  it('includes the PDF file name when present', () => {
    expect(formatRoomTitle('K7M2-P9X4', 'revisao-q4.pdf')).toBe(
      'revisao-q4.pdf - Sala K7M2-P9X4 | Palco'
    );
  });
});
