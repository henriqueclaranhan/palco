import { describe, expect, it } from 'vitest';
import { parseIceServers, parsePositiveInt } from '../env';

describe('env config parsers', () => {
  it('parses comma-separated STUN URLs and falls back when empty', () => {
    expect(parseIceServers(undefined).length).toBeGreaterThan(0);
    expect(parseIceServers('  ').length).toBeGreaterThan(0);

    expect(parseIceServers('stun:a.example:3478, stun:b.example:19302')).toEqual([
      { urls: 'stun:a.example:3478' },
      { urls: 'stun:b.example:19302' },
    ]);
  });

  it('parses JSON RTCIceServer arrays and rejects malformed JSON safely', () => {
    const json = JSON.stringify([
      { urls: 'stun:s.example:3478' },
      { urls: 'turn:t.example:3478', username: 'u', credential: 'p' },
    ]);

    expect(parseIceServers(json)).toEqual([
      { urls: 'stun:s.example:3478' },
      { urls: 'turn:t.example:3478', username: 'u', credential: 'p' },
    ]);

    expect(parseIceServers('[invalid-json')).toEqual(parseIceServers(undefined));
  });

  it('parses positive integers with fallback', () => {
    expect(parsePositiveInt('50', 100)).toBe(50);
    expect(parsePositiveInt('0', 100)).toBe(100);
    expect(parsePositiveInt('-5', 100)).toBe(100);
    expect(parsePositiveInt('abc', 100)).toBe(100);
    expect(parsePositiveInt(undefined, 100)).toBe(100);
  });
});
