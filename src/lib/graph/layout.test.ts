import { describe, expect, it } from 'vitest';
import { computePortAnchor, linkPath } from './layout';

describe('SVG layout helpers', () => {
  it('anchors inputs on the left and outputs on the right', () => {
    const port = { left: 120, right: 160, top: 80, height: 20 };
    const canvas = { left: 100, top: 50 };
    expect(computePortAnchor(port, canvas, 'input')).toEqual({ x: 20, y: 40 });
    expect(computePortAnchor(port, canvas, 'output')).toEqual({ x: 60, y: 40 });
  });

  it('keeps forward and reverse curves monotonic without overshooting short gaps', () => {
    expect(linkPath({ x: 10, y: 20 }, { x: 210, y: 80 })).toBe('M 10 20 C 110 20, 110 80, 210 80');
    expect(linkPath({ x: 210, y: 20 }, { x: 10, y: 80 })).toBe('M 210 20 C 110 20, 110 80, 10 80');
    expect(linkPath({ x: 10, y: 20 }, { x: 70, y: 80 })).toBe('M 10 20 C 40 20, 40 80, 70 80');
    expect(linkPath({ x: 70, y: 20 }, { x: 10, y: 80 })).toBe('M 70 20 C 40 20, 40 80, 10 80');
  });
});
