import { describe, it, expect } from 'vitest';
import { detectShape } from './shape-detector';
import type { StrokePoint } from './types';

describe('Auto Shape Detector', () => {
  it('detects a straight horizontal line', () => {
    const points: StrokePoint[] = [];
    for (let x = 100; x <= 300; x += 10) {
      points.push({ x, y: 200 + (Math.random() - 0.5) * 2, pressure: 0.5 });
    }
    const detected = detectShape(points);
    expect(detected).not.toBeNull();
    expect(detected?.shape).toBe('line');
  });

  it('detects an ellipse / circle', () => {
    const points: StrokePoint[] = [];
    const cx = 200;
    const cy = 200;
    const r = 80;
    for (let a = 0; a <= Math.PI * 2; a += 0.2) {
      points.push({
        x: cx + r * Math.cos(a) + (Math.random() - 0.5) * 3,
        y: cy + r * Math.sin(a) + (Math.random() - 0.5) * 3,
        pressure: 0.5,
      });
    }
    const detected = detectShape(points);
    expect(detected).not.toBeNull();
    expect(detected?.shape).toBe('ellipse');
  });

  it('detects a rectangle', () => {
    const points: StrokePoint[] = [];
    // Top
    for (let x = 50; x <= 200; x += 15) points.push({ x, y: 50, pressure: 0.5 });
    // Right
    for (let y = 50; y <= 150; y += 15) points.push({ x: 200, y, pressure: 0.5 });
    // Bottom
    for (let x = 200; x >= 50; x -= 15) points.push({ x, y: 150, pressure: 0.5 });
    // Left back to start
    for (let y = 150; y >= 50; y -= 15) points.push({ x: 50, y, pressure: 0.5 });

    const detected = detectShape(points);
    expect(detected).not.toBeNull();
    expect(detected?.shape).toBe('rectangle');
  });

  it('detects a triangle', () => {
    const points: StrokePoint[] = [];
    // Side 1: (100, 200) -> (200, 50)
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      points.push({ x: 100 + t * 100, y: 200 - t * 150, pressure: 0.5 });
    }
    // Side 2: (200, 50) -> (300, 200)
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      points.push({ x: 200 + t * 100, y: 50 + t * 150, pressure: 0.5 });
    }
    // Side 3: (300, 200) -> (100, 200)
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      points.push({ x: 300 - t * 200, y: 200, pressure: 0.5 });
    }

    const detected = detectShape(points);
    expect(detected).not.toBeNull();
    expect(detected?.shape).toBe('triangle');
  });

  it('rejects short or open squiggly handwriting lines', () => {
    const points: StrokePoint[] = [
      { x: 10, y: 10, pressure: 0.5 },
      { x: 12, y: 15, pressure: 0.5 },
      { x: 14, y: 8, pressure: 0.5 },
    ];
    const detected = detectShape(points);
    expect(detected).toBeNull();
  });
});
