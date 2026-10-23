import { getStroke } from 'perfect-freehand';
import type { StrokeOptions } from 'perfect-freehand';
import type {
  Stroke,
  StrokePoint,
  RawPoint,
  ToolType,
  StrokeConfig,
  Camera,
  BoundingBox,
} from './types';

/**
 * Transforms screen coordinates to world coordinates.
 */
export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera
): { x: number; y: number } {
  const zoom = camera.zoom || 1;
  return {
    x: (screenX - camera.x) / zoom,
    y: (screenY - camera.y) / zoom,
  };
}

/**
 * Transforms world coordinates to screen coordinates.
 */
export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: Camera
): { x: number; y: number } {
  const zoom = camera.zoom || 1;
  return {
    x: worldX * zoom + camera.x,
    y: worldY * zoom + camera.y,
  };
}

/**
 * Calculates updated camera position when zooming around a fixed screen pivot point
 * (such as cursor location during trackpad pinch or mouse wheel zoom).
 */
export function zoomAroundPivot(
  oldCamera: Camera,
  pivotScreenX: number,
  pivotScreenY: number,
  newZoom: number
): Camera {
  const clampedZoom = Math.max(0.1, Math.min(10.0, newZoom));
  const worldPoint = screenToWorld(pivotScreenX, pivotScreenY, oldCamera);
  return {
    zoom: clampedZoom,
    x: pivotScreenX - worldPoint.x * clampedZoom,
    y: pivotScreenY - worldPoint.y * clampedZoom,
  };
}

/**
 * Computes the next zoom factor following the 10% step rule (e.g. 20% -> 30%, 30% -> 20%).
 * Snaps to the nearest clean 10% increment.
 */
export function getNextStepZoom(
  currentZoom: number,
  direction: 'in' | 'out',
  stepPct: number = 10
): number {
  const currentPct = Math.round(currentZoom * 100);
  let nextPct: number;
  if (direction === 'in') {
    nextPct = Math.min(1000, Math.floor(currentPct / stepPct + 1) * stepPct);
  } else {
    nextPct = Math.max(10, Math.ceil(currentPct / stepPct - 1) * stepPct);
  }
  return Number((nextPct / 100).toFixed(2));
}

/**
 * Computes the visible bounding box in world coordinates for the given screen viewport.
 */
export function getViewportWorldBounds(
  screenWidth: number,
  screenHeight: number,
  camera: Camera,
  margin = 50
): BoundingBox {
  const topLeft = screenToWorld(0, 0, camera);
  const bottomRight = screenToWorld(screenWidth, screenHeight, camera);

  return {
    minX: Math.min(topLeft.x, bottomRight.x) - margin,
    minY: Math.min(topLeft.y, bottomRight.y) - margin,
    maxX: Math.max(topLeft.x, bottomRight.x) + margin,
    maxY: Math.max(topLeft.y, bottomRight.y) + margin,
  };
}

/**
 * Normalizes logical (CSS) coordinates to [0, 1] relative to logical canvas bounds.
 */
export function normalizePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  pressure: number = 0.5,
  time?: number
): StrokePoint {
  const safeWidth = width > 0 ? width : 1;
  const safeHeight = height > 0 ? height : 1;
  return {
    x: x / safeWidth,
    y: y / safeHeight,
    pressure: Math.max(0, Math.min(1, Number.isFinite(pressure) ? pressure : 0.5)),
    ...(time !== undefined ? { time } : {}),
  };
}

/**
 * Denormalizes a StrokePoint back to logical (CSS) coordinates [x, y, pressure].
 */
export function denormalizePoint(
  point: StrokePoint,
  width: number,
  height: number
): [number, number, number] {
  return [point.x * width, point.y * height, point.pressure];
}

/**
 * Denormalizes an array of StrokePoints.
 */
export function denormalizePoints(
  points: StrokePoint[],
  width: number,
  height: number
): [number, number, number][] {
  const len = points.length;
  const result = new Array<[number, number, number]>(len);
  for (let i = 0; i < len; i++) {
    result[i] = denormalizePoint(points[i], width, height);
  }
  return result;
}

/**
 * Builds perfect-freehand StrokeOptions based on tool and configuration.
 */
export function getFreehandOptions(
  tool: ToolType,
  brushSize: number,
  config?: Partial<StrokeConfig>,
  isPenPointer: boolean = false
): StrokeOptions {
  if (tool === 'highlighter') {
    return {
      size: Math.max(8, brushSize * 2.2),
      thinning: 0,
      smoothing: config?.smoothing ?? 0.6,
      streamline: config?.streamline ?? 0.6,
      simulatePressure: false,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
      last: true,
    };
  }

  // Pen tool
  const simulate = config?.simulatePressure ?? !isPenPointer;
  return {
    size: Math.max(1, brushSize),
    thinning: config?.thinning ?? 0.5,
    smoothing: config?.smoothing ?? 0.5,
    streamline: config?.streamline ?? 0.5,
    simulatePressure: simulate,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last: true,
  };
}

/**
 * Draws a filled smooth path using quadratic bezier curves through outline midpoints.
 */
export function drawSmoothOutline(
  ctx: CanvasRenderingContext2D,
  outlinePoints: [number, number][]
): void {
  if (outlinePoints.length === 0) return;

  ctx.beginPath();
  const [firstX, firstY] = outlinePoints[0];
  ctx.moveTo(firstX, firstY);

  for (let i = 1; i < outlinePoints.length; i++) {
    const [x0, y0] = outlinePoints[i - 1];
    const [x1, y1] = outlinePoints[i];
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    ctx.quadraticCurveTo(x0, y0, midX, midY);
  }

  ctx.closePath();
  ctx.fill();
}

/**
 * Renders a single-point tap as a round dot.
 */
export function drawSinglePointDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pressure: number,
  tool: ToolType
): void {
  const p = Math.max(0.2, Math.min(1, pressure || 0.5));
  const effectiveSize = tool === 'highlighter' ? size * 2.2 : size * p;
  const radius = Math.max(1, effectiveSize / 2);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Renders a stroke directly using world coordinates onto a transformed canvas context.
 */
export function renderStrokeWorld(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  config?: Partial<StrokeConfig>
): void {
  if (stroke.points.length === 0) return;

  ctx.save();

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = stroke.color;
  } else {
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = stroke.color;
  }

  const worldPoints: [number, number, number][] = stroke.points.map((p) => [
    p.x,
    p.y,
    p.pressure,
  ]);

  if (worldPoints.length === 1) {
    const [x, y, pressure] = worldPoints[0];
    drawSinglePointDot(ctx, x, y, stroke.size, pressure, stroke.tool);
    ctx.restore();
    return;
  }

  // Check if all points are essentially a stationary tap
  let isStationary = true;
  const [firstX, firstY] = worldPoints[0];
  for (let i = 1; i < worldPoints.length; i++) {
    const dx = worldPoints[i][0] - firstX;
    const dy = worldPoints[i][1] - firstY;
    if (dx * dx + dy * dy > 1.0) {
      isStationary = false;
      break;
    }
  }

  if (isStationary) {
    drawSinglePointDot(ctx, firstX, firstY, stroke.size, worldPoints[0][2], stroke.tool);
    ctx.restore();
    return;
  }

  const options = getFreehandOptions(stroke.tool, stroke.size, config, false);
  const outline = getStroke(worldPoints, options) as [number, number][];

  drawSmoothOutline(ctx, outline);
  ctx.restore();
}

/**
 * Checks if a stroke was created with normalized coordinates [0, 1].
 * A stroke is considered normalized ONLY if all points lie strictly within [0, 1].
 */
export function isStrokeNormalized(stroke: Stroke): boolean {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return false;
  const tagged = (stroke as unknown as { normalized?: boolean }).normalized;
  if (tagged === false) return false;
  if (tagged === true) return true;

  for (let i = 0; i < pts.length; i++) {
    if (pts[i].x < 0 || pts[i].x > 1.0 || pts[i].y < 0 || pts[i].y > 1.0) {
      return false;
    }
  }
  return true;
}

/**
 * Renders a committed Stroke onto the given 2D context at specified canvas dimensions.
 * Seamlessly handles normalized coordinates or direct world coordinates.
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  canvasWidth?: number,
  canvasHeight?: number,
  config?: Partial<StrokeConfig>
): void {
  if (stroke.points.length === 0) return;

  // Determine whether stroke points are normalized [0, 1]
  const isNormalized =
    canvasWidth !== undefined &&
    canvasHeight !== undefined &&
    canvasWidth > 0 &&
    canvasHeight > 0 &&
    isStrokeNormalized(stroke);

  if (!isNormalized) {
    renderStrokeWorld(ctx, stroke, config);
    return;
  }

  ctx.save();

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = stroke.color;
  } else {
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = stroke.color;
  }

  const logicalPoints = denormalizePoints(stroke.points, canvasWidth, canvasHeight);

  // Single-point tap handling
  if (logicalPoints.length === 1) {
    const [x, y, pressure] = logicalPoints[0];
    drawSinglePointDot(ctx, x, y, stroke.size, pressure, stroke.tool);
    ctx.restore();
    return;
  }

  let isStationary = true;
  const [firstX, firstY] = logicalPoints[0];
  for (let i = 1; i < logicalPoints.length; i++) {
    const dx = logicalPoints[i][0] - firstX;
    const dy = logicalPoints[i][1] - firstY;
    if (dx * dx + dy * dy > 1.0) {
      isStationary = false;
      break;
    }
  }

  if (isStationary) {
    drawSinglePointDot(ctx, firstX, firstY, stroke.size, logicalPoints[0][2], stroke.tool);
    ctx.restore();
    return;
  }

  const options = getFreehandOptions(stroke.tool, stroke.size, config, false);
  const outline = getStroke(logicalPoints, options) as [number, number][];

  drawSmoothOutline(ctx, outline);
  ctx.restore();
}

/**
 * Renders an active in-progress stroke directly from raw logical samples.
 */
export function renderActiveStroke(
  ctx: CanvasRenderingContext2D,
  rawPoints: RawPoint[],
  tool: ToolType,
  color: string,
  brushSize: number,
  config?: Partial<StrokeConfig>,
  isPenPointer: boolean = false
): void {
  if (rawPoints.length === 0) return;

  ctx.save();

  if (tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
  } else {
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
  }

  if (rawPoints.length === 1) {
    const pt = rawPoints[0];
    drawSinglePointDot(ctx, pt.x, pt.y, brushSize, pt.pressure, tool);
    ctx.restore();
    return;
  }

  const strokeInput: [number, number, number][] = rawPoints.map((p) => [p.x, p.y, p.pressure]);
  const options = getFreehandOptions(tool, brushSize, config, isPenPointer);
  const outline = getStroke(strokeInput, options) as [number, number][];

  drawSmoothOutline(ctx, outline);
  ctx.restore();
}

/**
 * Minimum Euclidean distance from point P to line segment AB.
 */
export function distanceToSegment(
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

  if (lenSq === 0) {
    const diffX = px - ax;
    const diffY = py - ay;
    return Math.sqrt(diffX * diffX + diffY * diffY);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const diffX = px - projX;
  const diffY = py - projY;
  return Math.sqrt(diffX * diffX + diffY * diffY);
}

/**
 * Geometric hit-testing for object eraser.
 * Accurately tests if an eraser circular path intersects any line segment of the stroke.
 */
export function isStrokeHitByEraser(
  stroke: Stroke,
  eraserSamples: RawPoint[],
  eraserRadius: number,
  canvasWidth?: number,
  canvasHeight?: number
): boolean {
  if (stroke.points.length === 0 || eraserSamples.length === 0) {
    return false;
  }

  const isNormalized =
    canvasWidth !== undefined &&
    canvasHeight !== undefined &&
    canvasWidth > 0 &&
    canvasHeight > 0 &&
    isStrokeNormalized(stroke);

  const points: [number, number][] = isNormalized
    ? denormalizePoints(stroke.points, canvasWidth, canvasHeight).map(([x, y]) => [x, y])
    : stroke.points.map((p) => [p.x, p.y]);

  const strokeMargin = (stroke.tool === 'highlighter' ? stroke.size * 2.2 : stroke.size) / 2;
  const hitThreshold = strokeMargin + eraserRadius;

  // 1. Compute Stroke AABB
  let minSX = Infinity;
  let minSY = Infinity;
  let maxSX = -Infinity;
  let maxSY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    if (x < minSX) minSX = x;
    if (y < minSY) minSY = y;
    if (x > maxSX) maxSX = x;
    if (y > maxSY) maxSY = y;
  }

  minSX -= strokeMargin;
  minSY -= strokeMargin;
  maxSX += strokeMargin;
  maxSY += strokeMargin;

  // 2. Compute Eraser AABB
  let minEX = Infinity;
  let minEY = Infinity;
  let maxEX = -Infinity;
  let maxEY = -Infinity;

  for (let i = 0; i < eraserSamples.length; i++) {
    const { x, y } = eraserSamples[i];
    if (x < minEX) minEX = x;
    if (y < minEY) minEY = y;
    if (x > maxEX) maxEX = x;
    if (y > maxEY) maxEY = y;
  }

  minEX -= eraserRadius;
  minEY -= eraserRadius;
  maxEX += eraserRadius;
  maxEY += eraserRadius;

  // Fast AABB intersection rejection
  if (maxSX < minEX || minSX > maxEX || maxSY < minEY || minSY > maxEY) {
    return false;
  }

  // 3. Exact geometric distance test
  if (points.length === 1) {
    const [sx, sy] = points[0];
    for (let j = 0; j < eraserSamples.length; j++) {
      const { x: ex, y: ey } = eraserSamples[j];
      const dx = sx - ex;
      const dy = sy - ey;
      if (Math.sqrt(dx * dx + dy * dy) <= hitThreshold) {
        return true;
      }
    }
    return false;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];

    for (let j = 0; j < eraserSamples.length; j++) {
      const { x: ex, y: ey } = eraserSamples[j];
      const dist = distanceToSegment(ex, ey, ax, ay, bx, by);
      if (dist <= hitThreshold) {
        return true;
      }
    }
  }

  return false;
}
