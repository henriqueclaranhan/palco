import { describe, expect, it } from 'vitest';
import { resolveGridNavigationPage } from '../SlideGridDialog';

describe('resolveGridNavigationPage', () => {
  it('moves horizontally, vertically, and to grid boundaries', () => {
    expect(resolveGridNavigationPage(5, 'ArrowRight', 4, 20)).toBe(6);
    expect(resolveGridNavigationPage(5, 'ArrowLeft', 4, 20)).toBe(4);
    expect(resolveGridNavigationPage(5, 'ArrowDown', 4, 20)).toBe(9);
    expect(resolveGridNavigationPage(5, 'ArrowUp', 4, 20)).toBe(1);
    expect(resolveGridNavigationPage(12, 'Home', 4, 20)).toBe(1);
    expect(resolveGridNavigationPage(12, 'End', 4, 20)).toBe(20);
  });

  it('clamps out-of-range moves and returns null for unrelated keys', () => {
    expect(resolveGridNavigationPage(1, 'ArrowLeft', 4, 20)).toBe(1);
    expect(resolveGridNavigationPage(2, 'ArrowUp', 4, 20)).toBe(1);
    expect(resolveGridNavigationPage(19, 'ArrowDown', 4, 20)).toBe(20);
    expect(resolveGridNavigationPage(20, 'ArrowRight', 4, 20)).toBe(20);
    expect(resolveGridNavigationPage(5, 'Enter', 4, 20)).toBeNull();
    expect(resolveGridNavigationPage(1, 'ArrowRight', 4, 0)).toBeNull();
  });
});
