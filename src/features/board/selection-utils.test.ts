import { describe, it, expect } from 'vitest';
import {
  getCombinedBounds,
  getSelectionHandles,
  hitTestHandle,
  hitTestStroke,
  translateStrokes,
  scaleStrokes,
  rotateStrokes,
} from './selection-utils';
import type { Stroke } from './types';

describe('Selection & Transform Utilities', () => {
  const sampleStroke: Stroke = {
    id: 's-1',
    tool: 'pen',
    color: '#000',
    size: 4,
    points: [
      { x: 10, y: 10, pressure: 0.5 },
      { x: 50, y: 50, pressure: 0.5 },
    ],
  };

  it('calculates combined bounds accurately', () => {
    const bounds = getCombinedBounds([sampleStroke], 0);
    expect(bounds).not.toBeNull();
    expect(bounds?.minX).toBeLessThanOrEqual(10);
    expect(bounds?.maxX).toBeGreaterThanOrEqual(50);
  });

  it('generates 9 selection handles (8 resize + 1 rotation)', () => {
    const bounds = getCombinedBounds([sampleStroke])!;
    const handles = getSelectionHandles(bounds);
    expect(handles.length).toBe(9);
    expect(handles.some((h) => h.type === 'rot')).toBe(true);
  });

  it('hit tests selection handles correctly', () => {
    const bounds = getCombinedBounds([sampleStroke])!;
    const handles = getSelectionHandles(bounds);
    const nw = handles.find((h) => h.type === 'nw')!;

    const hit = hitTestHandle(nw.x, nw.y, bounds, 1.0, 10);
    expect(hit?.type).toBe('nw');
  });

  it('translates strokes without mutating originals', () => {
    const moved = translateStrokes([sampleStroke], 20, 30);
    expect(moved[0].points[0].x).toBe(30);
    expect(moved[0].points[0].y).toBe(40);
    expect(sampleStroke.points[0].x).toBe(10);
  });

  it('scales strokes accurately relative to origin', () => {
    const scaled = scaleStrokes([sampleStroke], 0, 0, 2, 2);
    expect(scaled[0].points[0].x).toBe(20);
    expect(scaled[0].points[0].y).toBe(20);
    expect(scaled[0].points[1].x).toBe(100);
  });

  it('rotates strokes accurately 90 degrees around center', () => {
    const singlePtStroke: Stroke = {
      id: 'pt',
      tool: 'pen',
      color: '#000',
      size: 4,
      points: [{ x: 10, y: 0, pressure: 0.5 }],
    };
    const rotated = rotateStrokes([singlePtStroke], 0, 0, Math.PI / 2);
    expect(rotated[0].points[0].x).toBeCloseTo(0);
    expect(rotated[0].points[0].y).toBeCloseTo(10);
  });

  it('hit tests strokes correctly', () => {
    expect(hitTestStroke(25, 25, sampleStroke, 8)).toBe(true);
    expect(hitTestStroke(500, 500, sampleStroke, 8)).toBe(false);
  });
});
