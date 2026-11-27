import { describe, expect, it } from 'vitest';
import { resolvePresentationShortcut } from '../useKeyboardAndSwipe';

describe('resolvePresentationShortcut', () => {
  it('maps g and G to toggle_slide_grid and ignores key repeat', () => {
    expect(resolvePresentationShortcut('g', { repeat: false, totalPages: 40 })).toBe(
      'toggle_slide_grid'
    );
    expect(resolvePresentationShortcut('G', { repeat: false, totalPages: 40 })).toBe(
      'toggle_slide_grid'
    );
    expect(
      resolvePresentationShortcut('g', { repeat: true, totalPages: 40 })
    ).toBeNull();
  });

  it('maps f and F to toggle_fullscreen and ignores key repeat', () => {
    expect(resolvePresentationShortcut('f', { repeat: false, totalPages: 40 })).toBe(
      'toggle_fullscreen'
    );
    expect(resolvePresentationShortcut('F', { repeat: false, totalPages: 40 })).toBe(
      'toggle_fullscreen'
    );
    expect(
      resolvePresentationShortcut('F', { repeat: true, totalPages: 40 })
    ).toBeNull();
  });

  it('maps slide navigation keys and guards Home/End when totalPages is 0', () => {
    expect(
      resolvePresentationShortcut('ArrowRight', { repeat: false, totalPages: 10 })
    ).toBe('next');
    expect(
      resolvePresentationShortcut('ArrowLeft', { repeat: false, totalPages: 10 })
    ).toBe('prev');
    expect(resolvePresentationShortcut('Home', { repeat: false, totalPages: 10 })).toBe(
      'first'
    );
    expect(resolvePresentationShortcut('End', { repeat: false, totalPages: 10 })).toBe(
      'last'
    );
    expect(
      resolvePresentationShortcut('Home', { repeat: false, totalPages: 0 })
    ).toBeNull();
    expect(
      resolvePresentationShortcut('End', { repeat: false, totalPages: 0 })
    ).toBeNull();
  });
});
