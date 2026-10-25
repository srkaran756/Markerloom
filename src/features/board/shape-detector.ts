import type { ShapeType, StrokePoint } from './types';

export interface DetectedShape {
  shape: ShapeType;
  points: [StrokePoint, StrokePoint];
  confidence: number;
}

/**
 * Calculates Euclidean distance between two 2D points.
 */
function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Perpendicular distance from point P to line segment AB.
 */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return dist(px, py, projX, projY);
}

/**
 * Ramer-Douglas-Peucker (RDP) polyline simplification algorithm.
 */
function rdp(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = pointToSegmentDistance(
      points[i].x,
      points[i].y,
      points[0].x,
      points[0].y,
      points[end].x,
      points[end].y
    );
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = rdp(points.slice(0, index + 1), epsilon);
    const rec2 = rdp(points.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  }

  return [points[0], points[end]];
}

/**
 * Detects if a handwritten raw stroke resembles a geometric shape (line, arrow, rectangle, ellipse/circle, triangle).
 * Returns DetectedShape if confidence exceeds threshold, or null if it's natural handwriting.
 */
export function detectShape(points: StrokePoint[]): DetectedShape | null {
  if (!points || points.length < 6) return null;

  // Compute total path length
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    totalLength += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }

  if (totalLength < 25) return null; // Too small to reliably detect shape

  const start = points[0];
  const end = points[points.length - 1];
  const startEndDist = dist(start.x, start.y, end.x, end.y);
  const straightness = startEndDist / totalLength;

  // Bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const maxDim = Math.max(width, height);
  if (maxDim < 15) return null;

  // -------------------------------------------------------------
  // 1. Straight Line or Arrow Check
  // -------------------------------------------------------------
  if (straightness >= 0.88) {
    // Check max chord deviation
    let maxDev = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const dev = pointToSegmentDistance(
        points[i].x,
        points[i].y,
        start.x,
        start.y,
        end.x,
        end.y
      );
      if (dev > maxDev) maxDev = dev;
    }

    if (maxDev / totalLength < 0.12) {
      return {
        shape: 'line',
        points: [
          { x: start.x, y: start.y, pressure: start.pressure || 0.5 },
          { x: end.x, y: end.y, pressure: end.pressure || 0.5 },
        ],
        confidence: straightness,
      };
    }
  }

  // Check for Arrow (line body + arrowhead at end)
  if (points.length >= 12 && straightness < 0.88 && straightness > 0.45) {
    // Check if first ~70% is very straight and last ~30% forms a tip
    const splitIdx = Math.floor(points.length * 0.72);
    const bodyStart = points[0];
    const bodyEnd = points[splitIdx];
    let bodyLen = 0;
    for (let i = 1; i <= splitIdx; i++) {
      bodyLen += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    }
    const bodyChord = dist(bodyStart.x, bodyStart.y, bodyEnd.x, bodyEnd.y);
    if (bodyChord / bodyLen > 0.90 && bodyLen > 30) {
      return {
        shape: 'arrow',
        points: [
          { x: bodyStart.x, y: bodyStart.y, pressure: bodyStart.pressure || 0.5 },
          { x: bodyEnd.x, y: bodyEnd.y, pressure: bodyEnd.pressure || 0.5 },
        ],
        confidence: 0.85,
      };
    }
  }

  // -------------------------------------------------------------
  // 2. Closed Shapes (Circle, Ellipse, Rectangle, Triangle)
  // -------------------------------------------------------------
  const closedRatio = startEndDist / totalLength;
  if (closedRatio < 0.35) {
    const bboxArea = width * height;
    if (bboxArea <= 0) return null;

    // Shoelace formula area
    let shoelaceSum = 0;
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      shoelaceSum += points[i].x * points[next].y - points[next].x * points[i].y;
    }
    const polyArea = Math.abs(shoelaceSum) / 2;
    const fillRatio = polyArea / bboxArea;

    // Polygon Corner Analysis using RDP
    const epsilon = maxDim * 0.055;
    const simplified = rdp(points.map((p) => ({ x: p.x, y: p.y })), epsilon);
    const cleanVerts =
      simplified.length > 2 &&
      dist(
        simplified[0].x,
        simplified[0].y,
        simplified[simplified.length - 1].x,
        simplified[simplified.length - 1].y
      ) < maxDim * 0.25
        ? simplified.slice(0, simplified.length - 1)
        : simplified;

    const cornerCount = cleanVerts.length;

    // Rectangle check: fillRatio >= 0.84, with corners or box shape
    if (fillRatio >= 0.84 && (cornerCount === 4 || cornerCount === 5 || cornerCount >= 4)) {
      return {
        shape: 'rectangle',
        points: [
          { x: minX, y: minY, pressure: 0.5 },
          { x: maxX, y: maxY, pressure: 0.5 },
        ],
        confidence: fillRatio,
      };
    }

    // Triangle check: 3 vertices and fillRatio typically between 0.35 and 0.65
    if (cornerCount === 3 || (cornerCount <= 4 && fillRatio >= 0.35 && fillRatio <= 0.65)) {
      return {
        shape: 'triangle',
        points: [
          { x: minX, y: minY, pressure: 0.5 },
          { x: maxX, y: maxY, pressure: 0.5 },
        ],
        confidence: 0.88,
      };
    }

    // Centroid for Ellipse / Circle
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rx = width / 2;
    const ry = height / 2;

    if (rx > 5 && ry > 5 && fillRatio >= 0.65 && fillRatio <= 0.88) {
      let sumNormDist = 0;
      let sumNormDistSq = 0;
      for (let i = 0; i < points.length; i++) {
        const ndx = (points[i].x - cx) / rx;
        const ndy = (points[i].y - cy) / ry;
        const nd = Math.sqrt(ndx * ndx + ndy * ndy);
        sumNormDist += nd;
        sumNormDistSq += nd * nd;
      }
      const meanNorm = sumNormDist / points.length;
      const variance = sumNormDistSq / points.length - meanNorm * meanNorm;
      const stdDev = Math.sqrt(Math.max(0, variance));

      if (stdDev < 0.22 && Math.abs(meanNorm - 1.0) < 0.25) {
        return {
          shape: 'ellipse',
          points: [
            { x: minX, y: minY, pressure: 0.5 },
            { x: maxX, y: maxY, pressure: 0.5 },
          ],
          confidence: 1 - stdDev,
        };
      }
    }
  }

  return null;
}
