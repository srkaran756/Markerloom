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
} from './types';
import { isValidStroke } from './types';
import {
  renderStroke,
  renderActiveStroke,
  isStrokeHitByEraser,
  screenToWorld,
  zoomAroundPivot,
  getNextStepZoom,
  getViewportWorldBounds,
} from './draw-stroke';
import { SpatialGrid } from './spatial-grid';
import { useStrokeHistory } from './use-stroke-history';

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
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1.0 };

/**
 * Excalidraw-style Infinite Canvas with:
 * - Trackpad 2-finger pan & pinch-to-zoom gestures
 * - Hand tool & Spacebar panning
 * - Tiled spatial indexing & viewport culling
 * - Sub-pixel high-DPI dual-canvas architecture
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
      onStrokeComplete,
      onStrokesChange,
      onCameraChange,
      isControlled,
    });
    propsRef.current = {
      tool,
      color,
      brushSize,
      readOnly,
      strokeConfig,
      onStrokeComplete,
      onStrokesChange,
      onCameraChange,
      isControlled,
    };

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

    // Redraw committed canvas when activeStrokes or camera change
    useEffect(() => {
      redrawCommittedCanvas();
    }, [activeStrokes, camera, redrawCommittedCanvas]);

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
     * Renders in-progress active stroke on RAF.
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

      const pts = activePointsRef.current;
      if (pts.length === 0) return;

      const currentTool = propsRef.current.tool;

      // Transform active overlay context to match world camera
      ctx.setTransform(
        dpr * cam.zoom,
        0,
        0,
        dpr * cam.zoom,
        cam.x * dpr,
        cam.y * dpr
      );

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
        isPenPointerRef.current
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

      // Query only strokes near the eraser path using spatial grid
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
          // Trackpad pinch-to-zoom or Ctrl+Wheel
          const factor = Math.pow(0.992, e.deltaY);
          const nextZoom = cameraRef.current.zoom * factor;
          updateCamera(zoomAroundPivot(cameraRef.current, pivotScreenX, pivotScreenY, nextZoom));
        } else {
          // 2-Finger trackpad pan or mouse wheel
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

    // Keyboard Shortcuts: Space for pan, Ctrl+Z, Ctrl+Y, 0, +, -
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return;
        }

        if (e.code === 'Space' && !e.repeat) {
          setIsSpacePressed(true);
        }

        // Figma-style Scrubby Zoom shortcut (holding Z key)
        if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.repeat) {
          setIsZKeyPressed(true);
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

        // Zoom In: + or = (follows 10+10+ rule)
        if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          const { width: w, height: h } = dimensionsRef.current;
          const nextZoom = getNextStepZoom(cameraRef.current.zoom, 'in');
          updateCamera(zoomAroundPivot(cameraRef.current, w / 2, h / 2, nextZoom));
        }

        // Zoom Out: - (follows 10+10+ rule)
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
    }, [internalHistory, updateCamera]);

    // Pointer Event Handlers
    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (propsRef.current.readOnly) return;
        if (!e.isPrimary) return;

        const isHandMode = propsRef.current.tool === 'hand' || isSpacePressed || e.button === 1;
        const isZoomScrubMode = isZKeyPressed || (isSpacePressed && (e.ctrlKey || e.metaKey));

        if (isZoomScrubMode) {
          // Figma-style Scrubby Zoom (vertical drag zoom)
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
          // Hand / Pan navigation start
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

        // Ignore non-primary mouse clicks for drawing
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (activePointerIdRef.current !== null) return;

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

        const coord = getPointerCoordinates(e);
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
      [getPointerCoordinates, isSpacePressed, isZKeyPressed, processEraserSamples, scheduleRenderActive]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return;

        // Zoom scrubbing active (Figma-style vertical drag zoom)
        if (isZoomScrubbingRef.current) {
          const rect = activeCanvasRef.current?.getBoundingClientRect();
          const currentY = rect ? e.clientY - rect.top : e.clientY;
          const dy = zoomScrubStartRef.current.screenY - currentY; // Dragging UP zooms IN
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
          const coord = getPointerCoordinates(evt);
          let pressure = 0.5;

          if (isPen && typeof evt.pressure === 'number' && evt.pressure > 0) {
            pressure = evt.pressure;
          } else if (typeof evt.pressure === 'number' && evt.pressure > 0 && evt.pressure !== 0.5) {
            pressure = evt.pressure;
          }

          const pt: RawPoint = {
            x: coord.worldX,
            y: coord.worldY,
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
          const points: StrokePoint[] = rawPoints.map((p) => ({
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
      [clearActiveCanvas, getPointerCoordinates, internalHistory, processEraserSamples]
    );

    const cancelStroke = useCallback(
      (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (activePointerIdRef.current !== e.pointerId) return;

        isPanningRef.current = false;
        isZoomScrubbingRef.current = false;

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
      isPanningRef.current = false;
      isZoomScrubbingRef.current = false;
      if (activePointerIdRef.current !== null) {
        // If stroke was in progress with active points, commit it so strokes are never deleted!
        const rawPoints = activePointsRef.current;
        const currentTool = propsRef.current.tool;
        if (
          (currentTool === 'pen' || currentTool === 'highlighter') &&
          rawPoints.length > 0
        ) {
          const points: StrokePoint[] = rawPoints.map((p) => ({
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

        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        activePointerIdRef.current = null;
        activePointsRef.current = [];
        erasedIdsRef.current.clear();
        clearActiveCanvas();
      }
    }, [clearActiveCanvas, internalHistory]);

    // Cleanup RAF and state on unmount
    useEffect(() => {
      return () => {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, []);

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
      }),
      [internalHistory, updateCamera]
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
      </div>
    );
  }
);
