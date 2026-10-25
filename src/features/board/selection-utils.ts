import type { Stroke, BoundingBox } from './types';
import { distanceToSegment } from './draw-stroke';
import { getStrokeBounds } from './spatial-grid';

export type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

export interface SelectionBounds extends BoundingBox {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface HandleInfo {
  type: HandleType;
  x: number;
  y: number;
  cursor: string;
}

/**
 * Computes unified bounding box around multiple strokes in world coordinates.
 */
export function getCombinedBounds(strokes: Stroke[], padding: number = 6): SelectionBounds | null {
  if (strokes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < strokes.length; i++) {
    const b = getStrokeBounds(strokes[i]);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  const width = Math.max(8, maxX - minX + padding * 2);
  const height = Math.max(8, maxY - minY + padding * 2);

  const boundedMinX = minX - padding;
  const boundedMinY = minY - padding;
  const boundedMaxX = boundedMinX + width;
  const boundedMaxY = boundedMinY + height;

  return {
    minX: boundedMinX,
    minY: boundedMinY,
    maxX: boundedMaxX,
    maxY: boundedMaxY,
    width,
    height,
    centerX: boundedMinX + width / 2,
    centerY: boundedMinY + height / 2,
  };
}

/**
 * Gets coordinates and cursor styles for Figma-style selection handles in world coordinates.
 */
export function getSelectionHandles(bounds: SelectionBounds, zoom: number = 1.0): HandleInfo[] {
  const { minX, minY, maxX, maxY, centerX, centerY } = bounds;
  const stemLength = 24 / zoom;

  return [
    { type: 'nw', x: minX, y: minY, cursor: 'nwse-resize' },
    { type: 'n', x: centerX, y: minY, cursor: 'ns-resize' },
    { type: 'ne', x: maxX, y: minY, cursor: 'nesw-resize' },
    { type: 'e', x: maxX, y: centerY, cursor: 'ew-resize' },
    { type: 'se', x: maxX, y: maxY, cursor: 'nwse-resize' },
    { type: 's', x: centerX, y: maxY, cursor: 'ns-resize' },
    { type: 'sw', x: minX, y: maxY, cursor: 'nesw-resize' },
    { type: 'w', x: minX, y: centerY, cursor: 'ew-resize' },
    { type: 'rot', x: centerX, y: minY - stemLength, cursor: 'grab' },
  ];
}

/**
 * Checks if point is over any selection handle within hitRadius.
 */
export function hitTestHandle(
  px: number,
  py: number,
  bounds: SelectionBounds,
  zoom: number = 1.0,
  hitRadius: number = 8
): HandleInfo | null {
  const handles = getSelectionHandles(bounds, zoom);
  const worldHitRadius = hitRadius / zoom;

  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    const dx = px - h.x;
    const dy = py - h.y;
    if (dx * dx + dy * dy <= worldHitRadius * worldHitRadius) {
      return h;
    }
  }
  return null;
}

/**
 * Checks if a world coordinate (px, py) intersects a stroke.
 */
export function hitTestStroke(px: number, py: number, stroke: Stroke, tolerance: number = 8): boolean {
  const bounds = getStrokeBounds(stroke);
  const effTolerance = Math.max(tolerance, stroke.size / 2 + 4);

  // Fast AABB rejection
  if (
    px < bounds.minX - effTolerance ||
    px > bounds.maxX + effTolerance ||
    py < bounds.minY - effTolerance ||
    py > bounds.maxY + effTolerance
  ) {
    return false;
  }

  // Text hit test
  if (stroke.text) {
    return px >= bounds.minX && px <= bounds.maxX && py >= bounds.minY && py <= bounds.maxY;
  }

  // Geometric shapes
  if (stroke.shape) {
    if (stroke.points.length < 2) return false;
    const [start, end] = stroke.points;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);

    if (stroke.shape === 'rectangle') {
      // Hit on border or if filled, hit inside
      const inside = px >= left && px <= right && py >= top && py <= bottom;
      if (stroke.fillColor) return inside;
      const onEdge =
        Math.abs(px - left) <= effTolerance ||
        Math.abs(px - right) <= effTolerance ||
        Math.abs(py - top) <= effTolerance ||
        Math.abs(py - bottom) <= effTolerance;
      return inside && onEdge;
    }

    if (stroke.shape === 'ellipse') {
      const rx = (right - left) / 2;
      const ry = (bottom - top) / 2;
      if (rx <= 0 || ry <= 0) return false;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const d = Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2);
      if (stroke.fillColor) return d <= 1.0;
      return Math.abs(Math.sqrt(d) - 1.0) * Math.min(rx, ry) <= effTolerance;
    }

    if (stroke.shape === 'line' || stroke.shape === 'arrow') {
      return distanceToSegment(px, py, start.x, start.y, end.x, end.y) <= effTolerance;
    }

    if (stroke.shape === 'triangle') {
      return px >= left && px <= right && py >= top && py <= bottom;
    }
  }

  // Freehand path: point-to-segment distance
  const pts = stroke.points;
  for (let i = 1; i < pts.length; i++) {
    if (distanceToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= effTolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Translates a set of strokes by (dx, dy).
 */
export function translateStrokes(strokes: Stroke[], dx: number, dy: number): Stroke[] {
  return strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({
      ...p,
      x: p.x + dx,
      y: p.y + dy,
    })),
  }));
}

/**
 * Scales a set of strokes relative to origin (originX, originY).
 */
export function scaleStrokes(
  strokes: Stroke[],
  originX: number,
  originY: number,
  scaleX: number,
  scaleY: number
): Stroke[] {
  const safeScaleX = Number.isFinite(scaleX) ? scaleX : 1;
  const safeScaleY = Number.isFinite(scaleY) ? scaleY : 1;

  return strokes.map((s) => ({
    ...s,
    size: Math.max(1, s.size * Math.sqrt(Math.abs(safeScaleX * safeScaleY))),
    ...(s.fontSize ? { fontSize: Math.max(8, s.fontSize * Math.abs(safeScaleY)) } : {}),
    points: s.points.map((p) => ({
      ...p,
      x: originX + (p.x - originX) * safeScaleX,
      y: originY + (p.y - originY) * safeScaleY,
    })),
  }));
}

/**
 * Rotates a set of strokes around center (cx, cy) by radians.
 */
export function rotateStrokes(strokes: Stroke[], cx: number, cy: number, radians: number): Stroke[] {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return strokes.map((s) => ({
    ...s,
    points: s.points.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      return {
        ...p,
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos,
      };
    }),
  }));
}
