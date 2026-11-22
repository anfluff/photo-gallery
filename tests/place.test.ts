import { describe, expect, it } from 'vitest';
import { formatPlace, parsePlace } from '../src/place.ts';

describe('formatPlace', () => {
  it('writes the two numbers with at most two decimals', () => {
    expect(formatPlace({ x: 12.3456, y: -4.2 })).toBe('12.35,-4.2');
    expect(formatPlace({ x: 3, y: 0 })).toBe('3,0');
  });

  it('writes a number that rounds to zero without a minus sign', () => {
    expect(formatPlace({ x: -0.001, y: -0 })).toBe('0,0');
  });
});

describe('parsePlace', () => {
  it('reads back what formatPlace wrote, with or without the #', () => {
    expect(parsePlace('#12.35,-4.2')).toEqual({ x: 12.35, y: -4.2 });
    expect(parsePlace(formatPlace({ x: -7.5, y: 120 }))).toEqual({ x: -7.5, y: 120 });
  });

  it('gives null for anything else', () => {
    for (const hash of ['', '#', '#about', '#1,2,3', '#1;2', '#1e5,2', '#NaN,1', '#1,', '# 1,2']) {
      expect(parsePlace(hash)).toBeNull();
    }
  });
});
