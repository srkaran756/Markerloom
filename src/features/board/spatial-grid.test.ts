import { describe, it, expect } from 'vitest';
import { SpatialGrid, getStrokeBounds, doBoxesIntersect } from './spatial-grid';
import type { Stroke } from './types';

const createStroke = (id: string, x: number, y: number, length = 100): Stroke => ({
  id,
  tool: 'pen',
  color: '#253481',
  size: 4,
  points: [
    { x, y, pressure: 0.5 },
    { x: x + length, y: y + length, pressure: 0.5 },
  ],
});

describe('SpatialGrid & BoundingBox', () => {
  it('computes accurate stroke bounding boxes with padding', () => {
    const stroke = createStroke('s1', 100, 200, 50);
    const bounds = getStrokeBounds(stroke);

    // Padding = 4/2 + 2 = 4
    expect(bounds.minX).toBe(96);
    expect(bounds.minY).toBe(196);
    expect(bounds.maxX).toBe(154);
    expect(bounds.maxY).toBe(254);
  });

  it('checks box intersections correctly', () => {
    const a = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const b = { minX: 50, minY: 50, maxX: 150, maxY: 150 };
    const c = { minX: 200, minY: 200, maxX: 300, maxY: 300 };

    expect(doBoxesIntersect(a, b)).toBe(true);
    expect(doBoxesIntersect(a, c)).toBe(false);
  });

  it('inserts and queries strokes accurately with spatial cell partitioning', () => {
    const grid = new SpatialGrid(512);

    const s1 = createStroke('s1', 100, 100, 50); // In cell (0, 0)
    const s2 = createStroke('s2', 2000, 2000, 50); // Far away in cell (3, 3)

    grid.insert(s1);
    grid.insert(s2);

    // Query viewport around s1: [0, 0, 500, 500]
    const viewNearS1 = { minX: 0, minY: 0, maxX: 500, maxY: 500 };
    const resultsNearS1 = grid.query(viewNearS1);
    expect(resultsNearS1.map((s) => s.id)).toEqual(['s1']);

    // Query viewport around s2: [1800, 1800, 2200, 2200]
    const viewNearS2 = { minX: 1800, minY: 1800, maxX: 2200, maxY: 2200 };
    const resultsNearS2 = grid.query(viewNearS2);
    expect(resultsNearS2.map((s) => s.id)).toEqual(['s2']);

    // Query empty area
    const viewEmpty = { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 };
    expect(grid.query(viewEmpty)).toEqual([]);
  });

  it('handles clearing and reloading strokes', () => {
    const grid = new SpatialGrid(512);
    const s1 = createStroke('s1', 0, 0);
    grid.load([s1]);

    expect(grid.query({ minX: -50, minY: -50, maxX: 150, maxY: 150 })).toHaveLength(1);

    grid.clear();
    expect(grid.query({ minX: -50, minY: -50, maxX: 150, maxY: 150 })).toHaveLength(0);
  });
});
