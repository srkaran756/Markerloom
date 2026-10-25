'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from 'react';
import type {
  DrawingCanvasProps,
  Stroke,
  RawPoint,
  StrokePoint,
  Camera,
  ShapeType,
  ToolType,
} from './types';
import { isValidStroke } from './types';
import {
  renderStroke,
  renderStrokeWorld,
  renderActiveStroke,
  isStrokeHitByEraser,
  isStrokeNormalized,
  screenToWorld,
  worldToScreen,
  zoomAroundPivot,
  getNextStepZoom,
  getViewportWorldBounds,
} from './draw-stroke';
import { SpatialGrid } from './spatial-grid';
import { useStrokeHistory } from './use-stroke-history';
import { detectShape } from './shape-detector';
import {
  getCombinedBounds,
  getSelectionHandles,
  hitTestHandle,
  hitTestStroke,
  translateStrokes,
  scaleStrokes,
  rotateStrokes,
} from './selection-utils';
import type { HandleType, SelectionBounds } from './selection-utils';

export interface DrawingCanvasHandle {
  undo: () => boolean;
  redo: () => boolean;
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  getStrokes: () => Stroke[];
  getCamera: () => Camera;
  setCamera: (camera: Camera) => void;
  zoomIn: (factor?: number) => void;
  zoomOut: (factor?: number) => void;
  resetZoom: () => void;
  zoomTo: (zoom: number, pivotX?: number, pivotY?: number) => void;
  zoomToFit: () => void;
  panBy: (dx: number, dy: number) => void;
  getSelectedIds: () => string[];
  setSelectedIds: (ids: string[]) => void;
  getSelectedStrokes: () => Stroke[];
  deleteSelected: () => void;
  duplicateSelected: () => void;
  updateSelectedStyle: (updates: { color?: string; size?: number; fillColor?: string }) => void;
  convertSelectedToText: () => Promise<void>;
  openGroqSettings: () => void;
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1.0 };

function getShapeForTool(tool: ToolType): ShapeType | undefined {
  return tool === 'rectangle' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'triangle'
    ? tool
    : undefined;
}

/**
 * Excalidraw-style Infinite Canvas with:
 * - Trackpad 2-finger pan & pinch-to-zoom gestures
 * - Hand tool & Spacebar panning
 * - Tiled spatial indexing & viewport culling
 * - Sub-pixel high-DPI dual-canvas architecture
 * - Scribble-to-shape auto detection
 * - Figma-style selection, handles, resize, rotate & translation
 * - Groq AI Handwriting-to-Text conversion
 */
export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas(props, ref) {
    const {
      width,
      height,
      tool = 'pen',
      color = '#253481',
      brushSize = 4,
      strokes: controlledStrokes,
      initialStrokes,
      camera: controlledCamera,
      onCameraChange,
      onStrokeComplete,
      onStrokesChange,
      readOnly = false,
      className = '',
      strokeConfig,
      autoShapeDetection = true,
      onSelectionChange,
      onOpenSettings,
      onTranscribingChange,
    } = props;

    const isControlled = controlledStrokes !== undefined;

    // History hook manages strokes and undo/redo in uncontrolled mode
    const internalHistory = useStrokeHistory({
      initialStrokes: initialStrokes || [],
      onStrokesChange,
    });

    const activeStrokes = isControlled ? controlledStrokes : internalHistory.strokes;

    // Camera state (uncontrolled fallback)
    const [internalCamera, setInternalCamera] = useState<Camera>(
      controlledCamera || DEFAULT_CAMERA
    );
    const camera = controlledCamera || internalCamera;

    const cameraRef = useRef<Camera>(camera);
    cameraRef.current = camera;

    // Spatial grid for viewport culling
    const spatialGridRef = useRef<SpatialGrid>(new SpatialGrid());

    // Keep an up-to-date ref of strokes for event handlers
    const strokesRef = useRef<Stroke[]>(activeStrokes);
    strokesRef.current = activeStrokes;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const committedCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);

    // Dimensions ref in logical CSS pixels
    const dimensionsRef = useRef<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });

    // Interaction state refs
    const activePointerIdRef = useRef<number | null>(null);
    const activePointsRef = useRef<RawPoint[]>([]);
    const erasedIdsRef = useRef<Set<string>>(new Set());
    const isPenPointerRef = useRef<boolean>(false);
    const rafIdRef = useRef<number | null>(null);

    // Selection & Transform states
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const selectedIdsRef = useRef<string[]>(selectedIds);
    selectedIdsRef.current = selectedIds;

    const transformModeRef = useRef<'none' | 'marquee' | 'translate' | 'resize' | 'rotate'>('none');
    const activeHandleRef = useRef<HandleType | null>(null);
    const transformStartRef = useRef<{
      wx: number;
      wy: number;
      bounds: SelectionBounds;
      initialStrokes: Stroke[];
    } | null>(null);
    const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
    const marqueeCurrentRef = useRef<{ x: number; y: number } | null>(null);
    const tempTransformedStrokesRef = useRef<Stroke[] | null>(null);
    const [isTransforming, setIsTransforming] = useState<boolean>(false);

    // Groq AI Handwriting Recognition States
    const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
    const [showGroqModal, setShowGroqModal] = useState<boolean>(false);
    const [groqKeyInput, setGroqKeyInput] = useState<string>('');

    // Pan state refs
    const isPanningRef = useRef<boolean>(false);
    const panStartRef = useRef<{ x: number; y: number; cameraX: number; cameraY: number }>({
      x: 0,
      y: 0,
      cameraX: 0,
      cameraY: 0,
    });
    const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);

    // Zoom scrub state refs (Figma-style vertical drag zoom)
    const [isZKeyPressed, setIsZKeyPressed] = useState<boolean>(false);
    const isZoomScrubbingRef = useRef<boolean>(false);
    const zoomScrubStartRef = useRef<{
      screenX: number;
      screenY: number;
      startZoom: number;
    }>({ screenX: 0, screenY: 0, startZoom: 1.0 });

    // Stable options refs
    const propsRef = useRef({
      tool,
      color,
      brushSize,
      readOnly,
      strokeConfig,
      autoShapeDetection,
      onStrokeComplete,
      onStrokesChange,
      onCameraChange,
      onSelectionChange,
      onOpenSettings,
      onTranscribingChange,
      isControlled,
    });
    propsRef.current = {
      tool,
      color,
      brushSize,
      readOnly,
      strokeConfig,
      autoShapeDetection,
      onStrokeComplete,
      onStrokesChange,
      onCameraChange,
      onSelectionChange,
      onOpenSettings,
      onTranscribingChange,
      isControlled,
    };

    const updateSelectedIds = useCallback((nextIds: string[]) => {
      setSelectedIds(nextIds);
      selectedIdsRef.current = nextIds;
      propsRef.current.onSelectionChange?.(nextIds);
    }, []);

    /**
     * Updates camera and notifies parent listeners.
     */
    const updateCamera = useCallback(
      (newCamera: Camera | ((prev: Camera) => Camera)) => {
        const nextCam =
          typeof newCamera === 'function' ? newCamera(cameraRef.current) : newCamera;
        cameraRef.current = nextCam;
        setInternalCamera(nextCam);
        propsRef.current.onCameraChange?.(nextCam);
      },
      []
    );

    /**
     * Rebuilds spatial grid when active strokes change.
     */
    useEffect(() => {
      spatialGridRef.current.load(
        activeStrokes,
        dimensionsRef.current.width,
        dimensionsRef.current.height
      );
    }, [activeStrokes]);

    /**
     * Redraws all visible committed strokes onto the committed canvas using viewport culling.
     */
    const redrawCommittedCanvas = useCallback(() => {
      const canvas = committedCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { width: w, height: h } = dimensionsRef.current;
      if (w <= 0 || h <= 0) return;

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const cam = cameraRef.current;

      // Reset transform and clear backing store
      ctx.resetTransform?.();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply camera transformation: scale and pan
      ctx.setTransform(
        dpr * cam.zoom,
        0,
        0,
        dpr * cam.zoom,
        cam.x * dpr,
        cam.y * dpr
      );

      // Viewport culling: only query strokes intersecting the current world view
      const viewportBounds = getViewportWorldBounds(w, h, cam, 100);
      const visibleStrokes = spatialGridRef.current.query(viewportBounds);

      for (let i = 0; i < visibleStrokes.length; i++) {
        const s = visibleStrokes[i];
        if (isValidStroke(s)) {
          renderStroke(ctx, s, w, h, propsRef.current.strokeConfig);
        }
      }

      // Draw Figma-Style Selection Bounding Box & Handles when not actively transforming
      if (selectedIdsRef.current.length > 0 && transformModeRef.current === 'none') {
        const selectedStrokes = strokesRef.current.filter((s) =>
          selectedIdsRef.current.includes(s.id)
        );
        const bounds = getCombinedBounds(selectedStrokes, 6);
        if (bounds) {
          ctx.save();
          // Bounding Box Rectangle
          ctx.strokeStyle = '#253481';
          ctx.lineWidth = 1.5 / cam.zoom;
          ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
          ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
          ctx.setLineDash([]);

          // Rotation stem
          const stemLength = 24 / cam.zoom;
          ctx.beginPath();
          ctx.moveTo(bounds.centerX, bounds.minY);
          ctx.lineTo(bounds.centerX, bounds.minY - stemLength);
          ctx.stroke();

          // Rotation handle
          ctx.beginPath();
          ctx.arc(bounds.centerX, bounds.minY - stemLength, 4.5 / cam.zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.stroke();

          // 8 Resize handles
          const handles = getSelectionHandles(bounds, cam.zoom);
          const handleSize = 7.5 / cam.zoom;
          for (const hInfo of handles) {
            if (hInfo.type === 'rot') continue;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#253481';
            ctx.lineWidth = 1.5 / cam.zoom;
            ctx.fillRect(
              hInfo.x - handleSize / 2,
              hInfo.y - handleSize / 2,
              handleSize,
              handleSize
            );
            ctx.strokeRect(
              hInfo.x - handleSize / 2,
              hInfo.y - handleSize / 2,
              handleSize,
              handleSize
            );
          }
          ctx.restore();
        }
      }
    }, []);

    /**
     * Sets up canvas backing-store dimensions according to devicePixelRatio.
     */
    const syncCanvasResolution = useCallback(
      (cssWidth: number, cssHeight: number) => {
        if (cssWidth <= 0 || cssHeight <= 0) return;

        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        dimensionsRef.current = { width: cssWidth, height: cssHeight };

        const canvases = [committedCanvasRef.current, activeCanvasRef.current];
        for (const canvas of canvases) {
          if (!canvas) continue;
          const targetW = Math.round(cssWidth * dpr);
          const targetH = Math.round(cssHeight * dpr);

          if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
          }

          canvas.style.width = `${cssWidth}px`;
          canvas.style.height = `${cssHeight}px`;
        }

        spatialGridRef.current.load(strokesRef.current, cssWidth, cssHeight);
        redrawCommittedCanvas();
      },
      [redrawCommittedCanvas]
    );

    // ResizeObserver setup for container
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const updateSize = () => {
        const rect = container.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        if (w > 0 && h > 0) {
          syncCanvasResolution(w, h);
        }
      };

      updateSize();

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const cr = entry.contentRect;
            const w = Math.floor(cr.width);
            const h = Math.floor(cr.height);
            if (w > 0 && h > 0) {
              syncCanvasResolution(w, h);
            }
          }
        });
        resizeObserver.observe(container);
      }

      const handleWindowResize = () => {
        updateSize();
      };
      window.addEventListener('resize', handleWindowResize);

      return () => {
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        window.removeEventListener('resize', handleWindowResize);
      };
    }, [syncCanvasResolution]);

    // Redraw committed canvas when activeStrokes, selectedIds, or camera change
    useEffect(() => {
      redrawCommittedCanvas();
    }, [activeStrokes, camera, selectedIds, redrawCommittedCanvas]);

    /**
     * Clears the active overlay canvas.
     */
    const clearActiveCanvas = useCallback(() => {
      const canvas = activeCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.resetTransform?.();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, []);

    /**
     * Renders in-progress active stroke or active transform/marquee overlay on RAF.
     */
    const renderActive = useCallback(() => {
      rafIdRef.current = null;
      const canvas = activeCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const cam = cameraRef.current;

      ctx.resetTransform?.();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Transform active overlay context to match world camera
      ctx.setTransform(
        dpr * cam.zoom,
        0,
        0,
        dpr * cam.zoom,
        cam.x * dpr,
        cam.y * dpr
      );

      // Marquee selection rectangle rendering
      if (transformModeRef.current === 'marquee' && marqueeStartRef.current && marqueeCurrentRef.current) {
        const mStart = marqueeStartRef.current;
        const mCur = marqueeCurrentRef.current;
        const left = Math.min(mStart.x, mCur.x);
        const top = Math.min(mStart.y, mCur.y);
        const width = Math.abs(mCur.x - mStart.x);
        const height = Math.abs(mCur.y - mStart.y);

        ctx.save();
        ctx.fillStyle = 'rgba(37, 52, 129, 0.08)';
        ctx.fillRect(left, top, width, height);
        ctx.strokeStyle = '#253481';
        ctx.lineWidth = 1.2 / cam.zoom;
        ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
        ctx.strokeRect(left, top, width, height);
        ctx.restore();
        return;
      }

      // Active live transform rendering (translate, scale, rotate)
      if (
        (transformModeRef.current === 'translate' ||
          transformModeRef.current === 'resize' ||
          transformModeRef.current === 'rotate') &&
        tempTransformedStrokesRef.current
      ) {
        const strokes = tempTransformedStrokesRef.current;
        for (let i = 0; i < strokes.length; i++) {
          renderStrokeWorld(ctx, strokes[i], propsRef.current.strokeConfig);
        }

        const b = getCombinedBounds(strokes, 6);
        if (b) {
          ctx.save();
          ctx.strokeStyle = '#253481';
          ctx.lineWidth = 1.5 / cam.zoom;
          ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
          ctx.strokeRect(b.minX, b.minY, b.width, b.height);
          ctx.setLineDash([]);

          const handles = getSelectionHandles(b, cam.zoom);
          const handleSize = 7.5 / cam.zoom;
          for (const hInfo of handles) {
            if (hInfo.type === 'rot') continue;
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = '#253481';
            ctx.lineWidth = 1.5 / cam.zoom;
            ctx.fillRect(
              hInfo.x - handleSize / 2,
              hInfo.y - handleSize / 2,
              handleSize,
              handleSize
            );
            ctx.strokeRect(
              hInfo.x - handleSize / 2,
              hInfo.y - handleSize / 2,
              handleSize,
              handleSize
            );
          }
          ctx.restore();
        }
        return;
      }

      const pts = activePointsRef.current;
      if (pts.length === 0) return;

      const currentTool = propsRef.current.tool;

      if (currentTool === 'eraser') {
        // Draw visual eraser cursor indicator in world units
        const lastPt = pts[pts.length - 1];
        const eraserRadius = Math.max(8, propsRef.current.brushSize * 2.5) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, eraserRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5 / cam.zoom;
        ctx.fillStyle = 'rgba(203, 213, 225, 0.3)';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        return;
      }

      renderActiveStroke(
        ctx,
        pts,
        currentTool,
        propsRef.current.color,
        propsRef.current.brushSize,
        propsRef.current.strokeConfig,
        isPenPointerRef.current,
        getShapeForTool(currentTool)
      );
    }, []);

    const scheduleRenderActive = useCallback(() => {
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(renderActive);
      }
    }, [renderActive]);

    /**
     * Converts a pointer event to world coordinates.
     */
    const getPointerCoordinates = useCallback(
      (
        e: React.PointerEvent<HTMLCanvasElement> | { clientX: number; clientY: number; pressure?: number; pointerType?: string }
      ): { worldX: number; worldY: number; screenX: number; screenY: number; pressure: number } => {
        const canvas = activeCanvasRef.current;
        if (!canvas) return { worldX: 0, worldY: 0, screenX: 0, screenY: 0, pressure: 0.5 };
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        const world = screenToWorld(screenX, screenY, cameraRef.current);

        const isPen = e.pointerType === 'pen';
        let pressure = 0.5;

        if (isPen && typeof e.pressure === 'number' && e.pressure > 0) {
          pressure = e.pressure;
        } else if (typeof e.pressure === 'number' && e.pressure > 0 && e.pressure !== 0.5) {
          pressure = e.pressure;
        }

        return { worldX: world.x, worldY: world.y, screenX, screenY, pressure };
      },
      []
    );

    /**
     * Performs eraser hit-testing against spatial index.
     */
    const processEraserSamples = useCallback((newSamples: RawPoint[]) => {
      const { width: w, height: h } = dimensionsRef.current;
      if (w <= 0 || h <= 0) return;

      const eraserRadius = Math.max(8, propsRef.current.brushSize * 2.5) / 2;
      const newlyHit: string[] = [];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const s of newSamples) {
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.x > maxX) maxX = s.x;
        if (s.y > maxY) maxY = s.y;
      }

      const queryBox = {
        minX: minX - eraserRadius,
        minY: minY - eraserRadius,
        maxX: maxX + eraserRadius,
        maxY: maxY + eraserRadius,
      };

      const candidateStrokes = spatialGridRef.current.query(queryBox);

      for (let i = 0; i < candidateStrokes.length; i++) {
        const s = candidateStrokes[i];
        if (erasedIdsRef.current.has(s.id)) continue;

        if (isStrokeHitByEraser(s, newSamples, eraserRadius, w, h)) {
          erasedIdsRef.current.add(s.id);
          newlyHit.push(s.id);
        }
      }

      if (newlyHit.length > 0) {
        if (propsRef.current.isControlled) {
          const next = strokesRef.current.filter((s) => !erasedIdsRef.current.has(s.id));
          propsRef.current.onStrokesChange?.(next);
        } else {
          internalHistory.eraseStrokes(erasedIdsRef.current);
        }
      }
    }, [internalHistory]);

    const applyBucketFill = useCallback((x: number, y: number) => {
      const { width, height } = dimensionsRef.current;
      const candidates = spatialGridRef.current.query({
        minX: x - 1,
        minY: y - 1,
        maxX: x + 1,
        maxY: y + 1,
      });
      const order = new Map(strokesRef.current.map((stroke, index) => [stroke.id, index]));
      candidates.sort((a, b) => (order.get(b.id) ?? -1) - (order.get(a.id) ?? -1));

      const target = candidates.find((stroke) => {
        if (stroke.shape !== 'rectangle' && stroke.shape !== 'ellipse' && stroke.shape !== 'triangle') return false;
        if (stroke.points.length !== 2) return false;
        const normalized =
          width > 0 && height > 0 && isStrokeNormalized(stroke);
        const scaleX = normalized ? width : 1;
        const scaleY = normalized ? height : 1;
        const [first, second] = stroke.points;
        const left = Math.min(first.x * scaleX, second.x * scaleX);
        const right = Math.max(first.x * scaleX, second.x * scaleX);
        const top = Math.min(first.y * scaleY, second.y * scaleY);
        const bottom = Math.max(first.y * scaleY, second.y * scaleY);
        if (x < left || x > right || y < top || y > bottom) return false;
        if (stroke.shape === 'rectangle' || stroke.shape === 'triangle') return true;
        const radiusX = (right - left) / 2;
        const radiusY = (bottom - top) / 2;
        if (radiusX === 0 || radiusY === 0) return false;
        const dx = (x - (left + right) / 2) / radiusX;
        const dy = (y - (top + bottom) / 2) / radiusY;
        return dx * dx + dy * dy <= 1;
      });

      if (!target || target.fillColor === propsRef.current.color) return;
      const nextStrokes = strokesRef.current.map((stroke) =>
        stroke.id === target.id ? { ...stroke, fillColor: propsRef.current.color } : stroke
      );
      if (propsRef.current.isControlled) {
        propsRef.current.onStrokesChange?.(nextStrokes);
      } else {
        internalHistory.setStrokes(nextStrokes);
      }
    }, [internalHistory]);

    // Trackpad Pinch-to-Zoom & Pan non-passive Wheel handler
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();

        const rect = container.getBoundingClientRect();
        const pivotScreenX = e.clientX - rect.left;
        const pivotScreenY = e.clientY - rect.top;

        if (e.ctrlKey) {
          const factor = Math.pow(0.992, e.deltaY);
          const nextZoom = cameraRef.current.zoom * factor;
          updateCamera(zoomAroundPivot(cameraRef.current, pivotScreenX, pivotScreenY, nextZoom));
        } else {
          updateCamera((prev) => ({
            ...prev,
            x: prev.x - e.deltaX,
            y: prev.y - e.deltaY,
          }));
        }
      };

      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        container.removeEventListener('wheel', handleWheel);
      };
    }, [updateCamera]);

    // Keyboard Shortcuts: Space for pan, Ctrl+Z, Ctrl+Y, Delete/Backspace for selection, Escape
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return;
        }

        if (e.code === 'Space' && !e.repeat) {
          setIsSpacePressed(true);
        }

        if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.repeat) {
          setIsZKeyPressed(true);
        }

        // Delete / Backspace: delete selected strokes
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdsRef.current.length > 0) {
          e.preventDefault();
          const toDelete = new Set(selectedIdsRef.current);
          const next = strokesRef.current.filter((s) => !toDelete.has(s.id));
          if (propsRef.current.isControlled) {
            propsRef.current.onStrokesChange?.(next);
          } else {
            internalHistory.eraseStrokes(toDelete);
          }
          updateSelectedIds([]);
          return;
        }

        // Ctrl+D: duplicate selected strokes
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedIdsRef.current.length > 0) {
          e.preventDefault();
          const selectedStrokes = strokesRef.current.filter((s) => selectedIdsRef.current.includes(s.id));
          const duplicates: Stroke[] = selectedStrokes.map((s) => ({
            ...s,
            id: `dup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            points: s.points.map((p) => ({ ...p, x: p.x + 20, y: p.y + 20 })),
          }));
          const next = [...strokesRef.current, ...duplicates];
          if (propsRef.current.isControlled) {
            propsRef.current.onStrokesChange?.(next);
          } else {
            internalHistory.setStrokes(next);
          }
          updateSelectedIds(duplicates.map((d) => d.id));
          return;
        }

        // Escape: deselect all
        if (e.key === 'Escape' && selectedIdsRef.current.length > 0) {
          updateSelectedIds([]);
          return;
        }

        // Undo: Ctrl+Z (or Cmd+Z)
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          internalHistory.undo();
        }

        // Redo: Ctrl+Y or Ctrl+Shift+Z
        if (
          ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
        ) {
          e.preventDefault();
          internalHistory.redo();
        }

        // Reset Zoom: Ctrl+0
        if ((e.ctrlKey || e.metaKey) && e.key === '0') {
          e.preventDefault();
          const { width: w, height: h } = dimensionsRef.current;
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, 1.0));
        }

        // Zoom In: + or =
        if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          const { width: w, height: h } = dimensionsRef.current;
          const nextZoom = getNextStepZoom(cameraRef.current.zoom, 'in');
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, nextZoom));
        }

        // Zoom Out: -
        if ((e.ctrlKey || e.metaKey) && e.key === '-') {
          e.preventDefault();
          const { width: w, height: h } = dimensionsRef.current;
          const nextZoom = getNextStepZoom(cameraRef.current.zoom, 'out');
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, nextZoom));
        }
      };

      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
          setIsSpacePressed(false);
        }
        if (e.code === 'KeyZ') {
          setIsZKeyPressed(false);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }, [internalHistory, updateCamera, updateSelectedIds]);

    // Pointer Event Handlers
    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (propsRef.current.readOnly) return;
        if (!e.isPrimary) return;

        const isHandMode = propsRef.current.tool === 'hand' || isSpacePressed || e.button === 1;
        const isZoomScrubMode = isZKeyPressed || (isSpacePressed && (e.ctrlKey || e.metaKey));

        if (isZoomScrubMode) {
          isZoomScrubbingRef.current = true;
          const rect = activeCanvasRef.current?.getBoundingClientRect();
          const screenX = rect ? e.clientX - rect.left : e.clientX;
          const screenY = rect ? e.clientY - rect.top : e.clientY;
          zoomScrubStartRef.current = {
            screenX,
            screenY,
            startZoom: cameraRef.current.zoom,
          };
          try {
            activeCanvasRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // Ignore capture error
          }
          activePointerIdRef.current = e.pointerId;
          return;
        }

        if (isHandMode) {
          isPanningRef.current = true;
          panStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            cameraX: cameraRef.current.x,
            cameraY: cameraRef.current.y,
          };
          try {
            activeCanvasRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // Ignore capture error
          }
          activePointerIdRef.current = e.pointerId;
          return;
        }

        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (activePointerIdRef.current !== null) return;

        const coord = getPointerCoordinates(e);

        if (propsRef.current.tool === 'bucket') {
          applyBucketFill(coord.worldX, coord.worldY);
          return;
        }

        // Selection & Transform Tool Handling
        if (propsRef.current.tool === 'select' || propsRef.current.tool === 'ai-lasso') {
          const selectedStrokes = strokesRef.current.filter((s) =>
            selectedIdsRef.current.includes(s.id)
          );
          const currentBounds = getCombinedBounds(selectedStrokes, 6);

          if (currentBounds) {
            // Check if clicking a resize/rotate handle
            const handle = hitTestHandle(
              coord.worldX,
              coord.worldY,
              currentBounds,
              cameraRef.current.zoom,
              10
            );
            if (handle) {
              activePointerIdRef.current = e.pointerId;
              try {
                activeCanvasRef.current?.setPointerCapture(e.pointerId);
              } catch {
                // Ignore capture error
              }
              transformModeRef.current = handle.type === 'rot' ? 'rotate' : 'resize';
              activeHandleRef.current = handle.type;
              transformStartRef.current = {
                wx: coord.worldX,
                wy: coord.worldY,
                bounds: currentBounds,
                initialStrokes: selectedStrokes,
              };
              setIsTransforming(true);
              return;
            }

            // Check if clicking inside current selection bounding box to move
            if (
              coord.worldX >= currentBounds.minX &&
              coord.worldX <= currentBounds.maxX &&
              coord.worldY >= currentBounds.minY &&
              coord.worldY <= currentBounds.maxY
            ) {
              activePointerIdRef.current = e.pointerId;
              try {
                activeCanvasRef.current?.setPointerCapture(e.pointerId);
              } catch {
                // Ignore capture error
              }
              transformModeRef.current = 'translate';
              transformStartRef.current = {
                wx: coord.worldX,
                wy: coord.worldY,
                bounds: currentBounds,
                initialStrokes: selectedStrokes,
              };
              setIsTransforming(true);
              return;
            }
          }

          // Check if clicking on an unselected stroke
          const allStrokes = strokesRef.current;
          let clickedStroke: Stroke | null = null;
          for (let i = allStrokes.length - 1; i >= 0; i--) {
            if (hitTestStroke(coord.worldX, coord.worldY, allStrokes[i], 8 / cameraRef.current.zoom)) {
              clickedStroke = allStrokes[i];
              break;
            }
          }

          if (clickedStroke) {
            let nextIds: string[];
            if (e.shiftKey) {
              nextIds = selectedIdsRef.current.includes(clickedStroke.id)
                ? selectedIdsRef.current.filter((id) => id !== clickedStroke.id)
                : [...selectedIdsRef.current, clickedStroke.id];
            } else {
              nextIds = [clickedStroke.id];
            }
            updateSelectedIds(nextIds);

            const newlySelectedStrokes = allStrokes.filter((s) => nextIds.includes(s.id));
            const newBounds = getCombinedBounds(newlySelectedStrokes, 6);
            if (newBounds) {
              activePointerIdRef.current = e.pointerId;
              try {
                activeCanvasRef.current?.setPointerCapture(e.pointerId);
              } catch {
                // Ignore capture error
              }
              transformModeRef.current = 'translate';
              transformStartRef.current = {
                wx: coord.worldX,
                wy: coord.worldY,
                bounds: newBounds,
                initialStrokes: newlySelectedStrokes,
              };
              setIsTransforming(true);
            }
            return;
          }

          // Clicking blank canvas starts marquee selection box
          updateSelectedIds([]);
          activePointerIdRef.current = e.pointerId;
          try {
            activeCanvasRef.current?.setPointerCapture(e.pointerId);
          } catch {
            // Ignore capture error
          }
          transformModeRef.current = 'marquee';
          marqueeStartRef.current = { x: coord.worldX, y: coord.worldY };
          marqueeCurrentRef.current = { x: coord.worldX, y: coord.worldY };
          setIsTransforming(true);
          scheduleRenderActive();
          return;
        }

        const canvas = activeCanvasRef.current;
        if (!canvas) return;

        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // Fallback if environment doesn't support pointer capture
        }

        activePointerIdRef.current = e.pointerId;
        isPenPointerRef.current = e.pointerType === 'pen';
        erasedIdsRef.current.clear();

        const rawPoint: RawPoint = {
          x: coord.worldX,
          y: coord.worldY,
          pressure: coord.pressure,
          time: Date.now(),
        };

        activePointsRef.current = [rawPoint];

        if (propsRef.current.tool === 'eraser') {
          processEraserSamples([rawPoint]);
        }

        scheduleRenderActive();
      },
      [
        applyBucketFill,
        getPointerCoordinates,
        isSpacePressed,
        isZKeyPressed,
        processEraserSamples,
        scheduleRenderActive,
        updateSelectedIds,
      ]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) {
          // Handle mouse hover cursor for selection handles
          if ((propsRef.current.tool === 'select' || propsRef.current.tool === 'ai-lasso') && activeCanvasRef.current) {
            const coord = getPointerCoordinates(e);
            const selectedStrokes = strokesRef.current.filter((s) =>
              selectedIdsRef.current.includes(s.id)
            );
            const currentBounds = getCombinedBounds(selectedStrokes, 6);
            if (currentBounds) {
              const handle = hitTestHandle(
                coord.worldX,
                coord.worldY,
                currentBounds,
                cameraRef.current.zoom,
                10
              );
              if (handle) {
                activeCanvasRef.current.style.cursor = handle.cursor;
                return;
              }
              if (
                coord.worldX >= currentBounds.minX &&
                coord.worldX <= currentBounds.maxX &&
                coord.worldY >= currentBounds.minY &&
                coord.worldY <= currentBounds.maxY
              ) {
                activeCanvasRef.current.style.cursor = 'move';
                return;
              }
            }

            // Check if hovering over any stroke
            const anyHit = strokesRef.current.some((s) =>
              hitTestStroke(coord.worldX, coord.worldY, s, 6 / cameraRef.current.zoom)
            );
            activeCanvasRef.current.style.cursor = anyHit ? 'pointer' : 'default';
          }
          return;
        }

        // Zoom scrubbing active (Figma-style vertical drag zoom)
        if (isZoomScrubbingRef.current) {
          const rect = activeCanvasRef.current?.getBoundingClientRect();
          const currentY = rect ? e.clientY - rect.top : e.clientY;
          const dy = zoomScrubStartRef.current.screenY - currentY;
          const factor = Math.pow(1.008, dy);
          const nextZoom = Math.max(0.1, Math.min(10.0, zoomScrubStartRef.current.startZoom * factor));
          updateCamera(
            zoomAroundPivot(
              cameraRef.current,
              zoomScrubStartRef.current.screenX,
              zoomScrubStartRef.current.screenY,
              nextZoom
            )
          );
          return;
        }

        // Panning active
        if (isPanningRef.current) {
          const dx = e.clientX - panStartRef.current.x;
          const dy = e.clientY - panStartRef.current.y;
          updateCamera({
            ...cameraRef.current,
            x: panStartRef.current.cameraX + dx,
            y: panStartRef.current.cameraY + dy,
          });
          return;
        }

        const coord = getPointerCoordinates(e);

        // Selection transform active
        if (transformModeRef.current !== 'none') {
          if (transformModeRef.current === 'marquee') {
            marqueeCurrentRef.current = { x: coord.worldX, y: coord.worldY };
            scheduleRenderActive();
            return;
          }

          if (transformStartRef.current) {
            const { wx: startWx, wy: startWy, bounds: origBounds, initialStrokes } =
              transformStartRef.current;

            if (transformModeRef.current === 'translate') {
              const dx = coord.worldX - startWx;
              const dy = coord.worldY - startWy;
              tempTransformedStrokesRef.current = translateStrokes(initialStrokes, dx, dy);
              scheduleRenderActive();
              return;
            }

            if (transformModeRef.current === 'resize' && activeHandleRef.current) {
              const h = activeHandleRef.current;
              // Anchor is opposite corner/edge
              let anchorX = origBounds.centerX;
              let anchorY = origBounds.centerY;

              if (h === 'nw') {
                anchorX = origBounds.maxX;
                anchorY = origBounds.maxY;
              } else if (h === 'ne') {
                anchorX = origBounds.minX;
                anchorY = origBounds.maxY;
              } else if (h === 'se') {
                anchorX = origBounds.minX;
                anchorY = origBounds.minY;
              } else if (h === 'sw') {
                anchorX = origBounds.maxX;
                anchorY = origBounds.minY;
              } else if (h === 'n') {
                anchorY = origBounds.maxY;
              } else if (h === 's') {
                anchorY = origBounds.minY;
              } else if (h === 'w') {
                anchorX = origBounds.maxX;
              } else if (h === 'e') {
                anchorX = origBounds.minX;
              }

              const initialDistX = Math.abs(startWx - anchorX) || 1;
              const initialDistY = Math.abs(startWy - anchorY) || 1;
              const curDistX = Math.abs(coord.worldX - anchorX);
              const curDistY = Math.abs(coord.worldY - anchorY);

              let sx = curDistX / initialDistX;
              let sy = curDistY / initialDistY;

              if (h === 'n' || h === 's') sx = 1.0;
              if (h === 'e' || h === 'w') sy = 1.0;

              tempTransformedStrokesRef.current = scaleStrokes(initialStrokes, anchorX, anchorY, sx, sy);
              scheduleRenderActive();
              return;
            }

            if (transformModeRef.current === 'rotate') {
              const angleCurrent = Math.atan2(coord.worldY - origBounds.centerY, coord.worldX - origBounds.centerX);
              const angleStart = Math.atan2(startWy - origBounds.centerY, startWx - origBounds.centerX);
              const deltaAngle = angleCurrent - angleStart;

              tempTransformedStrokesRef.current = rotateStrokes(
                initialStrokes,
                origBounds.centerX,
                origBounds.centerY,
                deltaAngle
              );
              scheduleRenderActive();
              return;
            }
          }
          return;
        }

        // Drawing active: process coalesced events from native PointerEvent
        const nativeEvt = e.nativeEvent as PointerEvent;
        const coalesced =
          typeof nativeEvt?.getCoalescedEvents === 'function'
            ? nativeEvt.getCoalescedEvents()
            : [];
        const rawEvents: Array<{ clientX: number; clientY: number; pressure?: number }> =
          coalesced.length > 0 ? coalesced : [e];

        const newSamples: RawPoint[] = [];
        const isPen = isPenPointerRef.current;

        for (let i = 0; i < rawEvents.length; i++) {
          const evt = rawEvents[i];
          const ptCoord = getPointerCoordinates(evt);
          let pressure = 0.5;

          if (isPen && typeof evt.pressure === 'number' && evt.pressure > 0) {
            pressure = evt.pressure;
          } else if (typeof evt.pressure === 'number' && evt.pressure > 0 && evt.pressure !== 0.5) {
            pressure = evt.pressure;
          }

          const pt: RawPoint = {
            x: ptCoord.worldX,
            y: ptCoord.worldY,
            pressure,
            time: Date.now(),
          };
          newSamples.push(pt);
          activePointsRef.current.push(pt);
        }

        if (propsRef.current.tool === 'eraser') {
          processEraserSamples(newSamples);
        }

        scheduleRenderActive();
      },
      [getPointerCoordinates, processEraserSamples, scheduleRenderActive, updateCamera]
    );

    const finishStroke = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return;

        if (isZoomScrubbingRef.current) {
          isZoomScrubbingRef.current = false;
          activePointerIdRef.current = null;
          const canvas = activeCanvasRef.current;
          if (canvas && typeof canvas.releasePointerCapture === 'function') {
            try {
              if (
                typeof canvas.hasPointerCapture !== 'function' ||
                canvas.hasPointerCapture(e.pointerId)
              ) {
                canvas.releasePointerCapture(e.pointerId);
              }
            } catch {
              // Ignore capture release error
            }
          }
          return;
        }

        if (isPanningRef.current) {
          isPanningRef.current = false;
          activePointerIdRef.current = null;
          const canvas = activeCanvasRef.current;
          if (canvas && typeof canvas.releasePointerCapture === 'function') {
            try {
              if (
                typeof canvas.hasPointerCapture !== 'function' ||
                canvas.hasPointerCapture(e.pointerId)
              ) {
                canvas.releasePointerCapture(e.pointerId);
              }
            } catch {
              // Ignore capture release error
            }
          }
          return;
        }

        // Commit active transform if transforming
        if (transformModeRef.current !== 'none') {
          if (transformModeRef.current === 'marquee') {
            if (marqueeStartRef.current && marqueeCurrentRef.current) {
              const mStart = marqueeStartRef.current;
              const mCur = marqueeCurrentRef.current;
              const minX = Math.min(mStart.x, mCur.x);
              const maxX = Math.max(mStart.x, mCur.x);
              const minY = Math.min(mStart.y, mCur.y);
              const maxY = Math.max(mStart.y, mCur.y);

              if (maxX - minX > 5 || maxY - minY > 5) {
                const queryBox = { minX, minY, maxX, maxY };
                const candidates = spatialGridRef.current.query(queryBox);
                const selected = candidates.filter((s) => {
                  const b = getCombinedBounds([s], 0);
                  return (
                    b &&
                    !(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY)
                  );
                });
                updateSelectedIds(selected.map((s) => s.id));
              }
            }
            marqueeStartRef.current = null;
            marqueeCurrentRef.current = null;
          } else if (tempTransformedStrokesRef.current) {
            const transformed = tempTransformedStrokesRef.current;
            const transformedMap = new Map(transformed.map((s) => [s.id, s]));
            const nextStrokes = strokesRef.current.map((s) =>
              transformedMap.has(s.id) ? transformedMap.get(s.id)! : s
            );
            if (propsRef.current.isControlled) {
              propsRef.current.onStrokesChange?.(nextStrokes);
            } else {
              internalHistory.setStrokes(nextStrokes);
            }
            tempTransformedStrokesRef.current = null;
          }

          transformModeRef.current = 'none';
          activeHandleRef.current = null;
          transformStartRef.current = null;
          setIsTransforming(false);
          activePointerIdRef.current = null;
          clearActiveCanvas();
          redrawCommittedCanvas();
          return;
        }

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const canvas = activeCanvasRef.current;
        if (canvas && typeof canvas.releasePointerCapture === 'function') {
          try {
            if (
              typeof canvas.hasPointerCapture !== 'function' ||
              canvas.hasPointerCapture(e.pointerId)
            ) {
              canvas.releasePointerCapture(e.pointerId);
            }
          } catch {
            // Ignore capture release error
          }
        }

        activePointerIdRef.current = null;

        // Flush final sample
        const coord = getPointerCoordinates(e);
        const finalPt: RawPoint = {
          x: coord.worldX,
          y: coord.worldY,
          pressure: coord.pressure,
          time: Date.now(),
        };
        activePointsRef.current.push(finalPt);

        const currentTool = propsRef.current.tool;
        const { width: w, height: h } = dimensionsRef.current;

        if (currentTool === 'eraser') {
          processEraserSamples([finalPt]);
          activePointsRef.current = [];
          erasedIdsRef.current.clear();
          clearActiveCanvas();
          return;
        }

        // Pen or Highlighter stroke commit: store pure world coordinates
        const rawPoints = activePointsRef.current;
        if (rawPoints.length > 0 && w > 0 && h > 0) {
          let shape = getShapeForTool(currentTool);
          let committedPoints: RawPoint[] = rawPoints;

          if (shape) {
            committedPoints = [rawPoints[0], rawPoints[rawPoints.length - 1]];
          } else if (currentTool === 'pen' && (propsRef.current.autoShapeDetection ?? true)) {
            // Automatic scribble-to-shape detection
            const detected = detectShape(
              rawPoints.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure }))
            );
            if (detected) {
              shape = detected.shape;
              committedPoints = [
                { x: detected.points[0].x, y: detected.points[0].y, pressure: 0.5 },
                { x: detected.points[1].x, y: detected.points[1].y, pressure: 0.5 },
              ];
            }
          }

          const points: StrokePoint[] = committedPoints.map((p) => ({
            x: p.x,
            y: p.y,
            pressure: p.pressure,
            ...(p.time !== undefined ? { time: p.time } : {}),
          }));

          const newStroke: Stroke = {
            id:
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            tool: currentTool === 'highlighter' ? 'highlighter' : 'pen',
            color: propsRef.current.color,
            size: propsRef.current.brushSize,
            points,
            ...(shape ? { shape } : {}),
            createdAt: Date.now(),
          };
          (newStroke as unknown as { normalized: boolean }).normalized = false;

          if (isValidStroke(newStroke)) {
            if (propsRef.current.isControlled) {
              const next = [...strokesRef.current, newStroke];
              propsRef.current.onStrokeComplete?.(newStroke);
              propsRef.current.onStrokesChange?.(next);
            } else {
              propsRef.current.onStrokeComplete?.(newStroke);
              internalHistory.addStroke(newStroke);
            }
          }
        }

        activePointsRef.current = [];
        clearActiveCanvas();
      },
      [
        clearActiveCanvas,
        getPointerCoordinates,
        internalHistory,
        processEraserSamples,
        redrawCommittedCanvas,
        updateSelectedIds,
      ]
    );

    const cancelStroke = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return;

        isPanningRef.current = false;
        isZoomScrubbingRef.current = false;
        transformModeRef.current = 'none';
        setIsTransforming(false);

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }

        const canvas = activeCanvasRef.current;
        if (canvas && typeof canvas.releasePointerCapture === 'function') {
          try {
            if (
              typeof canvas.hasPointerCapture !== 'function' ||
              canvas.hasPointerCapture(e.pointerId)
            ) {
              canvas.releasePointerCapture(e.pointerId);
            }
          } catch {
            // Ignore capture release error
          }
        }

        activePointerIdRef.current = null;
        activePointsRef.current = [];
        erasedIdsRef.current.clear();
        clearActiveCanvas();
      },
      [clearActiveCanvas]
    );

    const handleLostPointerCapture = useCallback(() => {
      if (activePointerIdRef.current !== null) {
        isPanningRef.current = false;
        isZoomScrubbingRef.current = false;
        transformModeRef.current = 'none';
        setIsTransforming(false);

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        activePointerIdRef.current = null;
        activePointsRef.current = [];
        erasedIdsRef.current.clear();
        clearActiveCanvas();
      }
    }, [clearActiveCanvas]);

    // Cleanup RAF and state on unmount
    useEffect(() => {
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, []);

    // Groq AI Transcription Handler
    const handleGroqConvert = useCallback(
      async (overrideApiKey?: string) => {
        let currentSelectedStrokes = strokesRef.current.filter((s) =>
          selectedIdsRef.current.includes(s.id)
        );

        // Auto-select recent handwriting strokes if nothing is manually selected
        if (currentSelectedStrokes.length === 0) {
          const nonTextStrokes = strokesRef.current.filter((s) => !s.text);
          if (nonTextStrokes.length > 0) {
            const last = nonTextStrokes[nonTextStrokes.length - 1];
            const recent = nonTextStrokes.filter(
              (s) => Math.abs((s.createdAt || 0) - (last.createdAt || 0)) < 4500
            );
            currentSelectedStrokes = recent.length > 0 ? recent : [last];
            updateSelectedIds(currentSelectedStrokes.map((s) => s.id));
          }
        }

        if (currentSelectedStrokes.length === 0) {
          alert('No handwriting found to convert. Draw on the whiteboard first, or select strokes using the Select (V) or AI Convert (A) tool.');
          return;
        }

        const bounds = getCombinedBounds(currentSelectedStrokes, 16);
        if (!bounds) return;

        setIsTranscribing(true);
        propsRef.current.onTranscribingChange?.(true);

        try {
          // Offscreen high-contrast rasterization
          const offscreen = document.createElement('canvas');
          const scale = 2;
          offscreen.width = Math.ceil(bounds.width * scale);
          offscreen.height = Math.ceil(bounds.height * scale);
          const octx = offscreen.getContext('2d');
          if (!octx) throw new Error('Cannot get 2d context for transcription.');

          octx.fillStyle = '#ffffff';
          octx.fillRect(0, 0, offscreen.width, offscreen.height);
          octx.scale(scale, scale);
          octx.translate(-bounds.minX, -bounds.minY);

          for (const s of currentSelectedStrokes) {
            renderStrokeWorld(octx, { ...s, color: '#0d1c2e' });
          }

          const dataUrl = offscreen.toDataURL('image/png');
          const storedKey =
            typeof window !== 'undefined'
              ? localStorage.getItem('groq_api_key') || ''
              : '';
          const keyToUse = overrideApiKey || storedKey;
          const storedModelRaw =
            typeof window !== 'undefined'
              ? localStorage.getItem('groq_model') || 'qwen/qwen3.8-27b'
              : 'qwen/qwen3.8-27b';
          const storedModel =
            storedModelRaw.includes('llama-3.2-11b') || storedModelRaw.includes('llama-3.2-90b')
              ? 'qwen/qwen3.8-27b'
              : storedModelRaw;
          const storedFont =
            typeof window !== 'undefined'
              ? localStorage.getItem('groq_font') || "'Caveat', 'Patrick Hand', cursive, sans-serif"
              : "'Caveat', 'Patrick Hand', cursive, sans-serif";

          const res = await fetch('/api/ai/handwriting-to-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: dataUrl,
              apiKey: keyToUse,
              model: storedModel,
            }),
          });

          const data = await res.json();
          if (!res.ok) {
            if (data.error === 'MISSING_API_KEY') {
              if (propsRef.current.onOpenSettings) {
                propsRef.current.onOpenSettings();
              } else {
                setShowGroqModal(true);
              }
              return;
            }
            throw new Error(data.message || 'Transcription failed.');
          }

          const transcribed = data.text;
          if (!transcribed || typeof transcribed !== 'string') {
            throw new Error('No readable text returned.');
          }

          // Replace selected strokes with handwritten styled Text stroke
          const primaryColor = currentSelectedStrokes[0]?.color || '#253481';
          const lineCount = Math.max(1, transcribed.split('\n').length);
          const calcFontSize = Math.max(
            20,
            Math.min(44, Math.round(bounds.height / (lineCount * 1.35)))
          );

          const textStroke: Stroke = {
            id: `text_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            tool: 'pen',
            color: primaryColor,
            size: 4,
            text: transcribed,
            fontSize: calcFontSize,
            fontFamily: storedFont,
            points: [{ x: bounds.minX + 6, y: bounds.minY + 6, pressure: 1 }],
            createdAt: Date.now(),
          };

          const selectedSet = new Set(currentSelectedStrokes.map((s) => s.id));
          const nextStrokes = strokesRef.current
            .filter((s) => !selectedSet.has(s.id))
            .concat(textStroke);

          if (propsRef.current.isControlled) {
            propsRef.current.onStrokesChange?.(nextStrokes);
          } else {
            internalHistory.setStrokes(nextStrokes);
          }

          updateSelectedIds([textStroke.id]);
        } catch (err: unknown) {
          alert(err instanceof Error ? err.message : 'Transcription failed.');
        } finally {
          setIsTranscribing(false);
          propsRef.current.onTranscribingChange?.(false);
        }
      },
      [internalHistory, updateSelectedIds]
    );

    // Imperative ref handle
    useImperativeHandle(
      ref,
      () => ({
        undo: () => internalHistory.undo(),
        redo: () => internalHistory.redo(),
        clear: () => internalHistory.clear(),
        canUndo: internalHistory.canUndo,
        canRedo: internalHistory.canRedo,
        getStrokes: () => strokesRef.current,
        getCamera: () => cameraRef.current,
        setCamera: (c: Camera) => updateCamera(c),
        zoomIn: (factor?: number) => {
          const { width: w, height: h } = dimensionsRef.current;
          let nextZoom: number;
          if (typeof factor === 'number' && factor > 1.0) {
            nextZoom = Number((cameraRef.current.zoom * factor).toFixed(2));
          } else {
            nextZoom = getNextStepZoom(cameraRef.current.zoom, 'in');
          }
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, nextZoom));
        },
        zoomOut: (factor?: number) => {
          const { width: w, height: h } = dimensionsRef.current;
          let nextZoom: number;
          if (typeof factor === 'number' && factor < 1.0 && factor > 0) {
            nextZoom = Number((cameraRef.current.zoom * factor).toFixed(2));
          } else {
            nextZoom = getNextStepZoom(cameraRef.current.zoom, 'out');
          }
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, nextZoom));
        },
        resetZoom: () => {
          const { width: w, height: h } = dimensionsRef.current;
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, 1.0));
        },
        zoomTo: (zoom: number, pivotX?: number, pivotY?: number) => {
          const { width: w, height: h } = dimensionsRef.current;
          const px = pivotX !== undefined ? pivotX : w / 2;
          const py = pivotY !== undefined ? pivotY : h / 2;
          const clamped = Math.max(0.1, Math.min(10.0, zoom));
          updateCamera(zoomAroundPivot(cameraRef.current, px, py, clamped));
        },
        zoomToFit: () => {
          const strokes = strokesRef.current;
          const { width: w, height: h } = dimensionsRef.current;
          if (w <= 0 || h <= 0) return;
          if (strokes.length === 0) {
            updateCamera({ x: 0, y: 0, zoom: 1.0 });
            return;
          }
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const s of strokes) {
            for (const p of s.points) {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            }
          }
          const strokeWidth = maxX - minX || 100;
          const strokeHeight = maxY - minY || 100;
          const margin = 80;
          const scaleX = (w - margin * 2) / strokeWidth;
          const scaleY = (h - margin * 2) / strokeHeight;
          const targetZoom = Math.max(0.1, Math.min(2.0, Math.min(scaleX, scaleY)));
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          updateCamera({
            zoom: targetZoom,
            x: w / 2 - centerX * targetZoom,
            y: h / 2 - centerY * targetZoom,
          });
        },
        panBy: (dx: number, dy: number) => {
          updateCamera((prev) => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy,
          }));
        },
        getSelectedIds: () => selectedIdsRef.current,
        setSelectedIds: (ids: string[]) => updateSelectedIds(ids),
        getSelectedStrokes: () =>
          strokesRef.current.filter((s) => selectedIdsRef.current.includes(s.id)),
        deleteSelected: () => {
          if (selectedIdsRef.current.length === 0) return;
          const toDelete = new Set(selectedIdsRef.current);
          const next = strokesRef.current.filter((s) => !toDelete.has(s.id));
          if (propsRef.current.isControlled) {
            propsRef.current.onStrokesChange?.(next);
          } else {
            internalHistory.eraseStrokes(toDelete);
          }
          updateSelectedIds([]);
        },
        duplicateSelected: () => {
          if (selectedIdsRef.current.length === 0) return;
          const selected = strokesRef.current.filter((s) =>
            selectedIdsRef.current.includes(s.id)
          );
          const duplicates = selected.map((s) => ({
            ...s,
            id: `dup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            points: s.points.map((p) => ({ ...p, x: p.x + 20, y: p.y + 20 })),
          }));
          const next = [...strokesRef.current, ...duplicates];
          if (propsRef.current.isControlled) {
            propsRef.current.onStrokesChange?.(next);
          } else {
            internalHistory.setStrokes(next);
          }
          updateSelectedIds(duplicates.map((d) => d.id));
        },
        updateSelectedStyle: (updates: { color?: string; size?: number; fillColor?: string }) => {
          if (selectedIdsRef.current.length === 0) return;
          const selectedSet = new Set(selectedIdsRef.current);
          const next = strokesRef.current.map((s) => {
            if (!selectedSet.has(s.id)) return s;
            return {
              ...s,
              ...(updates.color ? { color: updates.color } : {}),
              ...(updates.size ? { size: updates.size } : {}),
              ...(updates.fillColor !== undefined ? { fillColor: updates.fillColor } : {}),
            };
          });
          if (propsRef.current.isControlled) {
            propsRef.current.onStrokesChange?.(next);
          } else {
            internalHistory.setStrokes(next);
          }
        },
        convertSelectedToText: () => handleGroqConvert(),
        openGroqSettings: () => {
          if (propsRef.current.onOpenSettings) {
            propsRef.current.onOpenSettings();
          } else {
            setShowGroqModal(true);
          }
        },
      }),
      [handleGroqConvert, internalHistory, updateCamera, updateSelectedIds]
    );

    const isHandMode = tool === 'hand' || isSpacePressed;

    const containerStyle: React.CSSProperties = {
      position: 'relative',
      width: width !== undefined ? width : '100%',
      height: height !== undefined ? height : '100%',
      overflow: 'hidden',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      cursor: isZoomScrubbingRef.current || isZKeyPressed
        ? 'ns-resize'
        : isHandMode
        ? 'grab'
        : tool === 'select'
        ? 'default'
        : 'crosshair',
    };

    const canvasStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      touchAction: readOnly ? 'auto' : 'none',
      display: 'block',
    };

    // Calculate background grid pattern offset & size based on camera
    const gridSpacing = 24 * camera.zoom;
    const gridOffsetX = (camera.x % gridSpacing + gridSpacing) % gridSpacing;
    const gridOffsetY = (camera.y % gridSpacing + gridSpacing) % gridSpacing;

    // Selection floating context position
    const selectedStrokes = strokesRef.current.filter((s) => selectedIds.includes(s.id));
    const selectionBounds = selectedStrokes.length > 0 ? getCombinedBounds(selectedStrokes, 6) : null;
    const floatingPos = selectionBounds
      ? worldToScreen(selectionBounds.centerX, selectionBounds.minY, camera)
      : null;

    return (
      <div
        ref={containerRef}
        data-testid="drawing-canvas-container"
        className={`markerloom-canvas-container ${className}`}
        style={{
          ...containerStyle,
          backgroundImage:
            'radial-gradient(#d1d5db 1.2px, transparent 1.2px)',
          backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        }}
      >
        {/* Layer 1: Committed strokes canvas */}
        <canvas
          ref={committedCanvasRef}
          data-testid="committed-canvas"
          style={canvasStyle}
        />
        {/* Layer 2: Active drawing overlay canvas */}
        <canvas
          ref={activeCanvasRef}
          data-testid="active-canvas"
          style={canvasStyle}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={cancelStroke}
          onLostPointerCapture={handleLostPointerCapture}
        />

        {/* Floating Figma-Style Selection Action Bar */}
        {selectionBounds && floatingPos && tool === 'select' && !isTransforming && (
          <div
            className="selection-floating-bar"
            style={{
              position: 'absolute',
              left: Math.max(130, Math.min(dimensionsRef.current.width - 130, floatingPos.x)),
              top: Math.max(16, floatingPos.y - 50),
              transform: 'translateX(-50%)',
              zIndex: 35,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              backdropFilter: 'blur(8px)',
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              boxShadow: '0 8px 24px -4px rgba(15, 23, 42, 0.16), 0 2px 6px -1px rgba(15, 23, 42, 0.08)',
              animation: 'fadeIn 0.15s ease-out',
            }}
          >
            {/* Convert Handwriting to Text via Groq AI */}
            <button
              type="button"
              title="Convert raw handwriting to actual text with Groq Vision AI"
              onClick={() => handleGroqConvert()}
              disabled={isTranscribing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                backgroundColor: '#253481',
                color: '#ffffff',
                border: 'none',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                cursor: isTranscribing ? 'wait' : 'pointer',
                boxShadow: '0 2px 4px rgba(37, 52, 129, 0.2)',
              }}
            >
              <span>✨</span>
              <span>{isTranscribing ? 'Transcribing...' : 'Convert to Text (Groq)'}</span>
            </button>

            <div style={{ width: 1, height: 16, backgroundColor: '#e2e8f0', margin: '0 2px' }} />

            {/* Quick Color Swatches */}
            {['#253481', '#0d1c2e', '#005e4b', '#ba1a1a', '#eab308'].map((c) => (
              <button
                key={c}
                type="button"
                title={`Change color to ${c}`}
                onClick={() => {
                  const toChange = new Set(selectedIdsRef.current);
                  const next = strokesRef.current.map((s) =>
                    toChange.has(s.id) ? { ...s, color: c } : s
                  );
                  if (propsRef.current.isControlled) {
                    propsRef.current.onStrokesChange?.(next);
                  } else {
                    internalHistory.setStrokes(next);
                  }
                }}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  backgroundColor: c,
                  border: '1px solid rgba(0,0,0,0.15)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              />
            ))}

            <div style={{ width: 1, height: 16, backgroundColor: '#e2e8f0', margin: '0 2px' }} />

            {/* Duplicate */}
            <button
              type="button"
              title="Duplicate (Ctrl D)"
              onClick={() => {
                const selected = strokesRef.current.filter((s) => selectedIds.includes(s.id));
                const duplicates = selected.map((s) => ({
                  ...s,
                  id: `dup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  points: s.points.map((p) => ({ ...p, x: p.x + 20, y: p.y + 20 })),
                }));
                const next = [...strokesRef.current, ...duplicates];
                if (propsRef.current.isControlled) {
                  propsRef.current.onStrokesChange?.(next);
                } else {
                  internalHistory.setStrokes(next);
                }
                updateSelectedIds(duplicates.map((d) => d.id));
              }}
              style={{
                padding: '4px 7px',
                border: 'none',
                borderRadius: 6,
                backgroundColor: 'transparent',
                color: '#515e7c',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Duplicate
            </button>

            {/* Delete */}
            <button
              type="button"
              title="Delete (Backspace or Delete)"
              onClick={() => {
                const toDel = new Set(selectedIds);
                const next = strokesRef.current.filter((s) => !toDel.has(s.id));
                if (propsRef.current.isControlled) {
                  propsRef.current.onStrokesChange?.(next);
                } else {
                  internalHistory.eraseStrokes(toDel);
                }
                updateSelectedIds([]);
              }}
              style={{
                padding: '4px 7px',
                border: 'none',
                borderRadius: 6,
                backgroundColor: 'transparent',
                color: '#ba1a1a',
                fontSize: 12,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Delete
            </button>
          </div>
        )}

        {/* Modal: Groq Cloud API Key Input */}
        {showGroqModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 100,
              backgroundColor: 'rgba(13, 28, 46, 0.45)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: 420,
                backgroundColor: '#ffffff',
                borderRadius: 16,
                padding: 24,
                boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.25)',
                border: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>✨</span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0d1c2e' }}>
                    Groq Vision API Key
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGroqModal(false)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    fontSize: 18,
                    cursor: 'pointer',
                    color: '#64748b',
                  }}
                >
                  ✕
                </button>
              </div>

              <p style={{ margin: 0, fontSize: 13, color: '#515e7c', lineHeight: 1.5 }}>
                Markerloom uses <strong>Groq Llama 3.2 Vision</strong> for ultra-fast handwriting & math recognition.
                Enter your Groq API key below (saved securely in your browser):
              </p>

              <input
                type="password"
                placeholder="gsk_..."
                value={groqKeyInput}
                onChange={(e) => setGroqKeyInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />

              <div style={{ fontSize: 11, color: '#64748b' }}>
                Don&apos;t have a key? Get one for free at{' '}
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#253481', fontWeight: 600, textDecoration: 'underline' }}
                >
                  console.groq.com/keys
                </a>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setShowGroqModal(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    color: '#515e7c',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (groqKeyInput.trim()) {
                      localStorage.setItem('groq_api_key', groqKeyInput.trim());
                      setShowGroqModal(false);
                      handleGroqConvert(groqKeyInput.trim());
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: '#253481',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save & Transcribe
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);
