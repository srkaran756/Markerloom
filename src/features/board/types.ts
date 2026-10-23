/**
 * Tool types supported by Markerloom board engine.
 * 'hand' is a panning navigation tool.
 */
export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'hand';

/**
 * Camera / Viewport state for infinite canvas navigation.
 */
export interface Camera {
  x: number; // Pan offset X in screen/viewport pixels
  y: number; // Pan offset Y in screen/viewport pixels
  zoom: number; // Zoom scale factor (e.g. 1.0 = 100%, range [0.1, 10.0])
}

/**
 * Axis-aligned 2D bounding box.
 */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Point sample stored within a Stroke.
 * In infinite canvas mode, coordinates (x, y) represent continuous world coordinates.
 * `pressure` is normalized to [0, 1].
 */
export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  time?: number;
}

/**
 * Unnormalized point sample in logical (CSS) pixels.
 */
export interface RawPoint {
  x: number;
  y: number;
  pressure: number;
  time?: number;
}

/**
 * Serializable stroke representation.
 */
export interface Stroke {
  id: string;
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  size: number; // Logical brush size in world units
  points: StrokePoint[];
  createdAt?: number;
}

/**
 * Fine-tuning configuration for stroke generation.
 */
export interface StrokeConfig {
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  simulatePressure?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

/**
 * Public React component properties for DrawingCanvas.
 */
export interface DrawingCanvasProps {
  /** Optional fixed or CSS width. Defaults to 100% of container. */
  width?: number | string;
  /** Optional fixed or CSS height. Defaults to 100% of container. */
  height?: number | string;
  /** Active drawing or interaction tool. Default: 'pen' */
  tool?: ToolType;
  /** Stroke color for pen / highlighter (CSS string). Default: '#253481' */
  color?: string;
  /** Brush diameter in logical CSS pixels. Default: 4 */
  brushSize?: number;
  /** Controlled strokes array. If supplied, DrawingCanvas reflects this state. */
  strokes?: Stroke[];
  /** Initial strokes for uncontrolled mode. */
  initialStrokes?: Stroke[];
  /** Controlled camera state for infinite canvas pan & zoom. */
  camera?: Camera;
  /** Callback fired when camera pan or zoom changes. */
  onCameraChange?: (camera: Camera) => void;
  /** Callback fired whenever a stroke is completed and committed. */
  onStrokeComplete?: (stroke: Stroke) => void;
  /** Callback fired whenever the committed strokes change (drawing, erasing, undo, redo). */
  onStrokesChange?: (strokes: Stroke[]) => void;
  /** If true, pointer events are ignored and canvas is display-only. */
  readOnly?: boolean;
  /** Optional CSS class for container wrapper. */
  className?: string;
  /** Optional override for stroke geometry parameters. */
  strokeConfig?: Partial<StrokeConfig>;
}

/**
 * Validates a single StrokePoint record.
 * Must have finite numbers for x, y, pressure.
 */
export function isValidStrokePoint(point: unknown): point is StrokePoint {
  if (typeof point !== 'object' || point === null) {
    return false;
  }
  const p = point as Record<string, unknown>;
  if (typeof p.x !== 'number' || !Number.isFinite(p.x)) {
    return false;
  }
  if (typeof p.y !== 'number' || !Number.isFinite(p.y)) {
    return false;
  }
  if (typeof p.pressure !== 'number' || !Number.isFinite(p.pressure) || p.pressure < 0 || p.pressure > 1) {
    return false;
  }
  if (p.time !== undefined && (typeof p.time !== 'number' || !Number.isFinite(p.time))) {
    return false;
  }
  return true;
}

/**
 * Validates a Stroke record to prevent malformed or untrusted input from crashing the engine.
 */
export function isValidStroke(stroke: unknown): stroke is Stroke {
  if (typeof stroke !== 'object' || stroke === null) {
    return false;
  }
  const s = stroke as Record<string, unknown>;
  if (typeof s.id !== 'string' || s.id.trim().length === 0) {
    return false;
  }
  if (s.tool !== 'pen' && s.tool !== 'highlighter' && s.tool !== 'eraser') {
    return false;
  }
  if (typeof s.color !== 'string' || s.color.trim().length === 0) {
    return false;
  }
  if (typeof s.size !== 'number' || !Number.isFinite(s.size) || s.size <= 0 || s.size > 1000) {
    return false;
  }
  if (!Array.isArray(s.points) || s.points.length === 0) {
    return false;
  }
  for (let i = 0; i < s.points.length; i++) {
    if (!isValidStrokePoint(s.points[i])) {
      return false;
    }
  }
  if (s.createdAt !== undefined && (typeof s.createdAt !== 'number' || !Number.isFinite(s.createdAt))) {
    return false;
  }
  return true;
}
