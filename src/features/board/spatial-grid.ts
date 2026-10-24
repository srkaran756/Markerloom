import type { Stroke, BoundingBox } from './types';
import { isStrokeNormalized } from './draw-stroke';

export const CELL_SIZE = 512; // 512 world pixels per spatial bucket

/**
 * Computes axis-aligned bounding box for a stroke in world coordinates.
 * Handles both normalized coordinates and absolute world coordinates.
 */
export function getStrokeBounds(
  stroke: Stroke,
  canvasWidth?: number,
  canvasHeight?: number
): BoundingBox {
  const pts = stroke.points;
  if (pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  const isNormalized =
    canvasWidth !== undefined &&
    canvasHeight !== undefined &&
    canvasWidth > 0 &&
    canvasHeight > 0 &&
    isStrokeNormalized(stroke);

  const scaleX = isNormalized ? canvasWidth : 1;
  const scaleY = isNormalized ? canvasHeight : 1;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < pts.length; i++) {
    const x = pts[i].x * scaleX;
    const y = pts[i].y * scaleY;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const padding =
    (stroke.tool === 'highlighter' ? stroke.size * 2.2 : stroke.size) / 2 +
    2 +
    (stroke.shape === 'arrow' ? Math.max(10, stroke.size * 3) : 0);
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

/**
 * Checks whether two bounding boxes intersect.
 */
export function doBoxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/**
 * High-performance spatial grid for O(1) viewport culling and spatial queries on an infinite canvas.
 */
export class SpatialGrid {
  private cellSize: number;
  private cells: Map<string, Set<Stroke>>;
  private strokeBoundsCache: Map<string, BoundingBox>;

  constructor(cellSize: number = CELL_SIZE) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.strokeBoundsCache = new Map();
  }

  private cellKey(cellX: number, cellY: number): string {
    return `${cellX}:${cellY}`;
  }

  /**
   * Clears the entire spatial grid.
   */
  clear(): void {
    this.cells.clear();
    this.strokeBoundsCache.clear();
  }

  /**
   * Inserts a stroke into the spatial grid.
   */
  insert(stroke: Stroke, canvasWidth?: number, canvasHeight?: number): void {
    const bounds = getStrokeBounds(stroke, canvasWidth, canvasHeight);
    this.strokeBoundsCache.set(stroke.id, bounds);

    const minCellX = Math.floor(bounds.minX / this.cellSize);
    const maxCellX = Math.floor(bounds.maxX / this.cellSize);
    const minCellY = Math.floor(bounds.minY / this.cellSize);
    const maxCellY = Math.floor(bounds.maxY / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = this.cellKey(cx, cy);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Set();
          this.cells.set(key, cell);
        }
        cell.add(stroke);
      }
    }
  }

  /**
   * Bulk loads a list of strokes.
   */
  load(strokes: Stroke[], canvasWidth?: number, canvasHeight?: number): void {
    this.clear();
    for (let i = 0; i < strokes.length; i++) {
      this.insert(strokes[i], canvasWidth, canvasHeight);
    }
  }

  /**
   * Returns all candidate strokes intersecting the given world bounding box.
   */
  query(queryBox: BoundingBox): Stroke[] {
    const minCellX = Math.floor(queryBox.minX / this.cellSize);
    const maxCellX = Math.floor(queryBox.maxX / this.cellSize);
    const minCellY = Math.floor(queryBox.minY / this.cellSize);
    const maxCellY = Math.floor(queryBox.maxY / this.cellSize);

    const candidates = new Set<Stroke>();

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = this.cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (cell) {
          for (const stroke of cell) {
            candidates.add(stroke);
          }
        }
      }
    }

    // Filter using accurate individual bounding boxes
    const result: Stroke[] = [];
    for (const stroke of candidates) {
      const bounds = this.strokeBoundsCache.get(stroke.id);
      if (bounds && doBoxesIntersect(queryBox, bounds)) {
        result.push(stroke);
      }
    }

    return result;
  }
}
