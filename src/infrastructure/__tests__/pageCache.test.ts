import { describe, expect, it } from 'vitest';
import { LruPageCache, type RenderedPageEntry } from '../pageCache';

function fakeEntry(key: string): RenderedPageEntry {
  return {
    key,
    canvas: {} as HTMLCanvasElement,
    cssWidth: 800,
    cssHeight: 600,
  };
}

describe('LruPageCache', () => {
  it('evicts the least recently used entry when capacity is exceeded', () => {
    const cache = new LruPageCache(2);
    cache.set(fakeEntry('p1'));
    cache.set(fakeEntry('p2'));

    // Touch p1 so p2 becomes least recently used
    expect(cache.get('p1')?.key).toBe('p1');

    cache.set(fakeEntry('p3'));
    expect(cache.size).toBe(2);
    expect(cache.has('p1')).toBe(true);
    expect(cache.has('p2')).toBe(false);
    expect(cache.has('p3')).toBe(true);
  });

  it('clears all entries', () => {
    const cache = new LruPageCache(3);
    cache.set(fakeEntry('p1'));
    cache.set(fakeEntry('p2'));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('p1')).toBeUndefined();
  });
});
