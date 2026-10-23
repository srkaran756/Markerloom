import { describe, it, expect, vi } from 'vitest';
import {
  normalizePoint,
  denormalizePoint,
  denormalizePoints,
  getFreehandOptions,
  drawSmoothOutline,
  drawSinglePointDot,
  renderStroke,
  renderActiveStroke,
  distanceToSegment,
  isStrokeHitByEraser,
  screenToWorld,
  worldToScreen,
  zoomAroundPivot,
  getNextStepZoom,
  isStrokeNormalized,
  getViewportWorldBounds,
} from './draw-stroke';
import { isValidStroke, isValidStrokePoint } from './types';
import type { Stroke } from './types';

describe('Coordinate Conversion', () => {
  it('correctly normalizes logical coordinates to [0, 1]', () => {
    const pt = normalizePoint(400, 300, 800, 600, 0.75, 12345);
    expect(pt.x).toBeCloseTo(0.5);
    expect(pt.y).toBeCloseTo(0.5);
    expect(pt.pressure).toBeCloseTo(0.75);
    expect(pt.time).toBe(12345);
  });

  it('clamps pressure to [0, 1] and handles zero width/height safely', () => {
    const ptHigh = normalizePoint(10, 10, 0, 0, 1.5);
    expect(ptHigh.pressure).toBe(1);

    const ptLow = normalizePoint(10, 10, 100, 100, -0.5);
    expect(ptLow.pressure).toBe(0);

    const ptNan = normalizePoint(10, 10, 100, 100, NaN);
    expect(ptNan.pressure).toBe(0.5);
  });

  it('denormalizes coordinates accurately', () => {
    const norm = { x: 0.25, y: 0.5, pressure: 0.8 };
    const [x, y, p] = denormalizePoint(norm, 800, 600);
    expect(x).toBe(200);
    expect(y).toBe(300);
    expect(p).toBe(0.8);
  });

  it('denormalizes an array of points in batch', () => {
    const pts = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 1, y: 1, pressure: 1.0 },
    ];
    const denorm = denormalizePoints(pts, 1000, 500);
    expect(denorm).toEqual([
      [0, 0, 0.5],
      [1000, 500, 1.0],
    ]);
  });
});

describe('Stroke and Point Validation', () => {
  it('validates correct stroke points', () => {
    expect(isValidStrokePoint({ x: 0.5, y: 0.5, pressure: 0.5 })).toBe(true);
    expect(isValidStrokePoint({ x: 0, y: 1, pressure: 1, time: 1000 })).toBe(true);
  });

  it('rejects invalid stroke points with non-finite values or missing fields', () => {
    expect(isValidStrokePoint(null)).toBe(false);
    expect(isValidStrokePoint({ x: NaN, y: 0.5, pressure: 0.5 })).toBe(false);
    expect(isValidStrokePoint({ x: 0.5, y: Infinity, pressure: 0.5 })).toBe(false);
    expect(isValidStrokePoint({ x: 0.5, y: 0.5, pressure: -0.1 })).toBe(false);
    expect(isValidStrokePoint({ x: 0.5, y: 0.5, pressure: 1.1 })).toBe(false);
    expect(isValidStrokePoint({ x: 0.5, y: 0.5, pressure: 0.5, time: NaN })).toBe(false);
  });

  it('validates a well-formed stroke', () => {
    const validStroke: Stroke = {
      id: 'stroke-1',
      tool: 'pen',
      color: '#253481',
      size: 4,
      points: [{ x: 0.1, y: 0.2, pressure: 0.5 }],
      createdAt: Date.now(),
    };
    expect(isValidStroke(validStroke)).toBe(true);
  });

  it('rejects malformed stroke records', () => {
    expect(isValidStroke(null)).toBe(false);
    expect(isValidStroke({})).toBe(false);
    expect(isValidStroke({ id: '', tool: 'pen', color: '#000', size: 4, points: [] })).toBe(false);
    expect(
      isValidStroke({
        id: '1',
        tool: 'invalid-tool' as unknown,
        color: '#000',
        size: 4,
        points: [{ x: 0, y: 0, pressure: 0.5 }],
      })
    ).toBe(false);
    expect(
      isValidStroke({
        id: '1',
        tool: 'pen',
        color: '',
        size: 4,
        points: [{ x: 0, y: 0, pressure: 0.5 }],
      })
    ).toBe(false);
    expect(
      isValidStroke({
        id: '1',
        tool: 'pen',
        color: '#000',
        size: -5,
        points: [{ x: 0, y: 0, pressure: 0.5 }],
      })
    ).toBe(false);
    expect(
      isValidStroke({
        id: '1',
        tool: 'pen',
        color: '#000',
        size: 5000,
        points: [{ x: 0, y: 0, pressure: 0.5 }],
      })
    ).toBe(false);
    expect(
      isValidStroke({
        id: '1',
        tool: 'pen',
        color: '#000',
        size: 4,
        points: [], // empty points rejected
      })
    ).toBe(false);
    expect(
      isValidStroke({
        id: '1',
        tool: 'pen',
        color: '#000',
        size: 4,
        points: [{ x: NaN, y: 0, pressure: 0.5 }],
      })
    ).toBe(false);
  });
});

describe('Tool Options and Semantics', () => {
  it('configures pen tool with variable thinning and pressure simulation fallback', () => {
    const mouseOpts = getFreehandOptions('pen', 6, undefined, false);
    expect(mouseOpts.size).toBe(6);
    expect(mouseOpts.thinning).toBe(0.5);
    expect(mouseOpts.simulatePressure).toBe(true);

    const penOpts = getFreehandOptions('pen', 6, undefined, true);
    expect(penOpts.simulatePressure).toBe(false);
  });

  it('configures highlighter with zero thinning and broader stroke', () => {
    const hlOpts = getFreehandOptions('highlighter', 6);
    expect(hlOpts.thinning).toBe(0);
    expect(hlOpts.simulatePressure).toBe(false);
    expect(hlOpts.size).toBeGreaterThanOrEqual(12);
  });
});

describe('Rendering Helpers', () => {
  it('renders single-point taps as filled dots', () => {
    const mockCtx = {
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawSinglePointDot(mockCtx, 100, 150, 8, 0.5, 'pen');
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.arc).toHaveBeenCalledWith(100, 150, 2, 0, Math.PI * 2);
    expect(mockCtx.fill).toHaveBeenCalled();
  });

  it('renders smooth outlines with quadratic curves', () => {
    const mockCtx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    const outlinePoints: [number, number][] = [
      [10, 10],
      [20, 20],
      [30, 20],
      [20, 10],
    ];

    drawSmoothOutline(mockCtx, outlinePoints);
    expect(mockCtx.beginPath).toHaveBeenCalled();
    expect(mockCtx.moveTo).toHaveBeenCalledWith(10, 10);
    expect(mockCtx.quadraticCurveTo).toHaveBeenCalled();
    expect(mockCtx.closePath).toHaveBeenCalled();
    expect(mockCtx.fill).toHaveBeenCalled();
  });

  it('handles empty outline gracefully', () => {
    const mockCtx = {
      beginPath: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawSmoothOutline(mockCtx, []);
    expect(mockCtx.beginPath).not.toHaveBeenCalled();
  });

  it('applies correct compositing and alpha for pen vs highlighter in renderStroke', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      globalAlpha: 1.0,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    const penStroke: Stroke = {
      id: 'p1',
      tool: 'pen',
      color: '#ff0000',
      size: 4,
      points: [{ x: 0.5, y: 0.5, pressure: 0.5 }],
    };

    renderStroke(mockCtx, penStroke, 800, 600);
    expect(mockCtx.globalAlpha).toBe(1.0);
    expect(mockCtx.globalCompositeOperation).toBe('source-over');
    expect(mockCtx.fillStyle).toBe('#ff0000');

    const highlighterStroke: Stroke = {
      id: 'h1',
      tool: 'highlighter',
      color: '#ffff00',
      size: 10,
      points: [{ x: 0.5, y: 0.5, pressure: 0.5 }],
    };

    renderStroke(mockCtx, highlighterStroke, 800, 600);
    expect(mockCtx.globalAlpha).toBe(0.35);
    expect(mockCtx.globalCompositeOperation).toBe('multiply');
    expect(mockCtx.fillStyle).toBe('#ffff00');
  });

  it('renders active stroke safely with single point and multiple points', () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      globalAlpha: 1.0,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;

    renderActiveStroke(mockCtx, [], 'pen', '#000', 4);
    expect(mockCtx.save).not.toHaveBeenCalled();

    renderActiveStroke(mockCtx, [{ x: 50, y: 50, pressure: 0.5 }], 'pen', '#000', 4);
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.arc).toHaveBeenCalled();

    vi.clearAllMocks();
    renderActiveStroke(
      mockCtx,
      [
        { x: 50, y: 50, pressure: 0.5 },
        { x: 60, y: 60, pressure: 0.5 },
        { x: 70, y: 70, pressure: 0.5 },
      ],
      'pen',
      '#000',
      4
    );
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.fill).toHaveBeenCalled();
  });
});

describe('Geometric Distance and Eraser Hit-Testing', () => {
  it('calculates point to segment distance correctly', () => {
    // Segment from (0, 0) to (10, 0)
    // Point at (5, 5) -> perpendicular distance is 5
    const distMid = distanceToSegment(5, 5, 0, 0, 10, 0);
    expect(distMid).toBeCloseTo(5);

    // Point before start: (-5, 0) -> distance to (0, 0) is 5
    const distBefore = distanceToSegment(-5, 0, 0, 0, 10, 0);
    expect(distBefore).toBeCloseTo(5);

    // Point after end: (15, 0) -> distance to (10, 0) is 5
    const distAfter = distanceToSegment(15, 0, 0, 0, 10, 0);
    expect(distAfter).toBeCloseTo(5);
  });

  it('hits a stroke when eraser passes through its segment', () => {
    const stroke: Stroke = {
      id: 'stroke-line',
      tool: 'pen',
      color: '#000',
      size: 4,
      points: [
        { x: 0.1, y: 0.5, pressure: 0.5 },
        { x: 0.9, y: 0.5, pressure: 0.5 },
      ],
    };

    // Canvas size 1000x1000 -> line runs from (100, 500) to (900, 500)
    // Eraser sample at (500, 505) with radius 10
    const hit = isStrokeHitByEraser(stroke, [{ x: 500, y: 505, pressure: 0.5 }], 10, 1000, 1000);
    expect(hit).toBe(true);
  });

  it('does NOT hit a stroke when eraser is far away, even if bounding boxes are close', () => {
    const stroke: Stroke = {
      id: 'stroke-diag',
      tool: 'pen',
      color: '#000',
      size: 4,
      // Diagonal line from (100, 100) to (900, 900)
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.9, y: 0.9, pressure: 0.5 },
      ],
    };

    // Point at (150, 850) is inside the bounding box of the stroke!
    // But distance from (150, 850) to the line y = x is ~494px, so geometric hit should be FALSE!
    const hit = isStrokeHitByEraser(stroke, [{ x: 150, y: 850, pressure: 0.5 }], 10, 1000, 1000);
    expect(hit).toBe(false);
  });

  it('hits a single-point dot stroke when eraser overlaps it', () => {
    const dotStroke: Stroke = {
      id: 'dot-1',
      tool: 'pen',
      color: '#000',
      size: 8,
      points: [{ x: 0.5, y: 0.5, pressure: 0.5 }],
    };

    // (500, 500) on 1000x1000
    const hit = isStrokeHitByEraser(dotStroke, [{ x: 504, y: 504, pressure: 0.5 }], 10, 1000, 1000);
    expect(hit).toBe(true);

    const miss = isStrokeHitByEraser(
      dotStroke,
      [{ x: 600, y: 600, pressure: 0.5 }],
      10,
      1000,
      1000
    );
    expect(miss).toBe(false);
  });
});

describe('Infinite Canvas Camera Transformations', () => {
  it('converts screen to world coordinates and back accurately', () => {
    const camera = { x: 100, y: 50, zoom: 2.0 };
    const screenX = 300;
    const screenY = 250;

    const { x: wx, y: wy } = screenToWorld(screenX, screenY, camera);
    expect(wx).toBe((300 - 100) / 2); // 100
    expect(wy).toBe((250 - 50) / 2); // 100

    const { x: sx, y: sy } = worldToScreen(wx, wy, camera);
    expect(sx).toBe(screenX);
    expect(sy).toBe(screenY);
  });

  it('keeps world point directly beneath the cursor stationary during zoomAroundPivot', () => {
    const camera = { x: 0, y: 0, zoom: 1.0 };
    const cursorScreenX = 400;
    const cursorScreenY = 300;

    // Zoom from 1.0x to 2.0x anchored at (400, 300)
    const newCamera = zoomAroundPivot(camera, cursorScreenX, cursorScreenY, 2.0);
    expect(newCamera.zoom).toBe(2.0);

    // World point under cursor before zoom
    const worldBefore = screenToWorld(cursorScreenX, cursorScreenY, camera);
    // World point under cursor after zoom
    const worldAfter = screenToWorld(cursorScreenX, cursorScreenY, newCamera);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('calculates the visible world bounding box for current viewport', () => {
    const camera = { x: 0, y: 0, zoom: 1.0 };
    const bounds = getViewportWorldBounds(800, 600, camera, 0);

    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(800);
    expect(bounds.maxY).toBe(600);
  });

  describe('10+10+ Zoom Rule and Normalization Detection', () => {
    it('accurately follows the 10+10+ rule for zoomIn and zoomOut', () => {
      // 20% to 30%, 30% to 20%
      expect(getNextStepZoom(0.20, 'in')).toBe(0.30);
      expect(getNextStepZoom(0.30, 'out')).toBe(0.20);

      // Snap odd pinch zoom (e.g. 23%) to clean 10% steps
      expect(getNextStepZoom(0.23, 'in')).toBe(0.30);
      expect(getNextStepZoom(0.23, 'out')).toBe(0.20);

      // 100% to 110%, 100% to 90%
      expect(getNextStepZoom(1.00, 'in')).toBe(1.10);
      expect(getNextStepZoom(1.00, 'out')).toBe(0.90);

      // Limits: min 10%, max 1000%
      expect(getNextStepZoom(0.10, 'out')).toBe(0.10);
      expect(getNextStepZoom(10.0, 'in')).toBe(10.0);
    });

    it('identifies whether a stroke is normalized or world coordinates', () => {
      const worldStroke: Stroke = {
        id: 's1',
        tool: 'pen',
        color: '#253481',
        size: 4,
        points: [{ x: 1200, y: 800, pressure: 0.5 }],
      };
      expect(isStrokeNormalized(worldStroke)).toBe(false);

      const negativeStroke: Stroke = {
        id: 's2',
        tool: 'pen',
        color: '#253481',
        size: 4,
        points: [{ x: -50, y: 100, pressure: 0.5 }],
      };
      expect(isStrokeNormalized(negativeStroke)).toBe(false);

      const normalizedStroke: Stroke = {
        id: 's3',
        tool: 'pen',
        color: '#253481',
        size: 4,
        points: [
          { x: 0.2, y: 0.3, pressure: 0.5 },
          { x: 0.5, y: 0.7, pressure: 0.6 },
        ],
      };
      expect(isStrokeNormalized(normalizedStroke)).toBe(true);
    });
  });
});

