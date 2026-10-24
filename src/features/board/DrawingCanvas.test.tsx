import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { DrawingCanvas } from './DrawingCanvas';
import type { DrawingCanvasHandle } from './DrawingCanvas';
import type { Stroke } from './types';

describe('DrawingCanvas Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default bounding client rect for test canvases
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      bottom: 600,
      left: 0,
      right: 800,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders dual canvas architecture with touch-action none', () => {
    const { getByTestId } = render(<DrawingCanvas width={800} height={600} />);

    const committedCanvas = getByTestId('committed-canvas');
    const activeCanvas = getByTestId('active-canvas');

    expect(committedCanvas).toBeInTheDocument();
    expect(activeCanvas).toBeInTheDocument();
    expect(activeCanvas).toHaveStyle({ touchAction: 'none' });
  });

  it('sets touch-action to auto in readOnly mode', () => {
    const { getByTestId } = render(<DrawingCanvas width={800} height={600} readOnly />);
    const activeCanvas = getByTestId('active-canvas');
    expect(activeCanvas).toHaveStyle({ touchAction: 'auto' });
  });

  it('configures high-DPI backing-store dimensions according to devicePixelRatio', () => {
    window.devicePixelRatio = 2;
    const { getByTestId } = render(<DrawingCanvas width={800} height={600} />);

    const committedCanvas = getByTestId('committed-canvas') as HTMLCanvasElement;
    const activeCanvas = getByTestId('active-canvas') as HTMLCanvasElement;

    // Backing store should be 800 * 2 = 1600, 600 * 2 = 1200
    expect(committedCanvas.width).toBe(1600);
    expect(committedCanvas.height).toBe(1200);
    expect(committedCanvas.style.width).toBe('800px');
    expect(committedCanvas.style.height).toBe('600px');

    expect(activeCanvas.width).toBe(1600);
    expect(activeCanvas.height).toBe(1200);
    window.devicePixelRatio = 1;
  });

  it('handles pointer down, movement, and completion lifecycle', () => {
    const onStrokeComplete = vi.fn();
    const onStrokesChange = vi.fn();

    const { getByTestId } = render(
      <DrawingCanvas
        width={800}
        height={600}
        tool="pen"
        color="#253481"
        brushSize={4}
        onStrokeComplete={onStrokeComplete}
        onStrokesChange={onStrokesChange}
      />
    );

    const activeCanvas = getByTestId('active-canvas');

    // Pointer down
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: 100,
        clientY: 100,
        pressure: 0.5,
      });
    });

    // Pointer move
    act(() => {
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 150,
        clientY: 150,
        pressure: 0.6,
      });
    });

    // Pointer up
    act(() => {
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 200,
        clientY: 200,
        pressure: 0.7,
      });
    });

    expect(onStrokeComplete).toHaveBeenCalledTimes(1);
    const completedStroke: Stroke = onStrokeComplete.mock.calls[0][0];

    expect(completedStroke.tool).toBe('pen');
    expect(completedStroke.color).toBe('#253481');
    expect(completedStroke.size).toBe(4);
    expect(completedStroke.points.length).toBeGreaterThanOrEqual(3);

    // Verify coordinates are preserved in world units
    expect(completedStroke.points[0].x).toBeCloseTo(100);
    expect(completedStroke.points[0].y).toBeCloseTo(100);

    expect(onStrokesChange).toHaveBeenCalledTimes(1);
    expect(onStrokesChange.mock.calls[0][0]).toEqual([completedStroke]);
  });

  it('creates a rectangle shape from drag start and end points', () => {
    const onStrokeComplete = vi.fn();
    const { getByTestId } = render(
      <DrawingCanvas width={800} height={600} tool="rectangle" onStrokeComplete={onStrokeComplete} />
    );
    const activeCanvas = getByTestId('active-canvas');

    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 11,
        isPrimary: true,
        button: 0,
        clientX: 100,
        clientY: 120,
      });
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 11,
        isPrimary: true,
        clientX: 240,
        clientY: 220,
      });
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 11,
        isPrimary: true,
        clientX: 240,
        clientY: 220,
      });
    });

    expect(onStrokeComplete).toHaveBeenCalledTimes(1);
    expect(onStrokeComplete.mock.calls[0][0]).toMatchObject({
      tool: 'pen',
      shape: 'rectangle',
      points: [
        { x: 100, y: 120 },
        { x: 240, y: 220 },
      ],
    });
  });

  it('fills the topmost closed shape under the bucket with the selected color', () => {
    const shape: Stroke = {
      id: 'rectangle',
      tool: 'pen',
      shape: 'rectangle',
      color: '#253481',
      size: 4,
      points: [
        { x: 100, y: 100, pressure: 0.5 },
        { x: 200, y: 200, pressure: 0.5 },
      ],
    };
    const onStrokesChange = vi.fn();
    const { getByTestId } = render(
      <DrawingCanvas
        width={800}
        height={600}
        tool="bucket"
        color="#ba1a1a"
        initialStrokes={[shape]}
        onStrokesChange={onStrokesChange}
      />
    );
    const activeCanvas = getByTestId('active-canvas');

    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 12,
        isPrimary: true,
        button: 0,
        clientX: 150,
        clientY: 150,
      });
    });

    expect(onStrokesChange).toHaveBeenCalledTimes(1);
    expect(onStrokesChange.mock.calls[0][0][0]).toMatchObject({
      id: 'rectangle',
      fillColor: '#ba1a1a',
    });
  });

  it('captures pointer on pointerDown and safely falls back for coalesced events', () => {
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn().mockReturnValue(true);

    const { getByTestId } = render(<DrawingCanvas width={800} height={600} />);
    const activeCanvas = getByTestId('active-canvas');
    activeCanvas.setPointerCapture = setPointerCapture;
    activeCanvas.releasePointerCapture = releasePointerCapture;
    activeCanvas.hasPointerCapture = hasPointerCapture;

    // Simulate pointer down
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 42,
        isPrimary: true,
        button: 0,
        clientX: 50,
        clientY: 50,
      });
    });
    expect(setPointerCapture).toHaveBeenCalledWith(42);

    // Simulate pointer move with getCoalescedEvents returning undefined (fallback path)
    act(() => {
      const event = new MouseEvent('pointermove', {
        clientX: 60,
        clientY: 60,
      }) as unknown as PointerEvent;
      Object.defineProperty(event, 'pointerId', { value: 42 });
      Object.defineProperty(event, 'isPrimary', { value: true });
      fireEvent(activeCanvas, event);
    });

    // Simulate pointer up
    act(() => {
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 42,
        isPrimary: true,
        clientX: 70,
        clientY: 70,
      });
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(42);
  });

  it('safely discards incomplete stroke on pointercancel without corrupting state', () => {
    const onStrokeComplete = vi.fn();
    const { getByTestId } = render(
      <DrawingCanvas width={800} height={600} onStrokeComplete={onStrokeComplete} />
    );
    const activeCanvas = getByTestId('active-canvas');

    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 2,
        isPrimary: true,
        button: 0,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 2,
        isPrimary: true,
        clientX: 120,
        clientY: 120,
      });
      fireEvent.pointerCancel(activeCanvas, {
        pointerId: 2,
        isPrimary: true,
      });
    });

    expect(onStrokeComplete).not.toHaveBeenCalled();
  });

  it('ignores secondary mouse button clicks and secondary multi-touch touches', () => {
    const onStrokeComplete = vi.fn();
    const { getByTestId } = render(
      <DrawingCanvas width={800} height={600} onStrokeComplete={onStrokeComplete} />
    );
    const activeCanvas = getByTestId('active-canvas');

    // Right-click (button 2)
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 2,
        isPrimary: true,
        clientX: 50,
        clientY: 50,
      });
    });

    // Secondary touch (isPrimary = false)
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 2,
        pointerType: 'touch',
        isPrimary: false,
        clientX: 80,
        clientY: 80,
      });
    });

    act(() => {
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 50,
        clientY: 50,
      });
    });

    expect(onStrokeComplete).not.toHaveBeenCalled();
  });

  it('preserves committed strokes after container resize', () => {
    const committedStroke: Stroke = {
      id: 'stroke-1',
      tool: 'pen',
      color: '#253481',
      size: 4,
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.9, y: 0.9, pressure: 0.5 },
      ],
    };

    const ref = createRef<DrawingCanvasHandle>();
    const { getByTestId } = render(
      <DrawingCanvas
        ref={ref}
        width={800}
        height={600}
        initialStrokes={[committedStroke]}
      />
    );

    const committedCanvas = getByTestId('committed-canvas') as HTMLCanvasElement;
    expect(ref.current?.getStrokes()).toEqual([committedStroke]);

    // Simulate container resize to 1200x900
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 1200,
      height: 900,
      top: 0,
      bottom: 900,
      left: 0,
      right: 1200,
      toJSON: () => ({}),
    });

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    // Backing store canvas resized
    expect(committedCanvas.width).toBe(1200);
    expect(committedCanvas.height).toBe(900);
    // Strokes retained intact
    expect(ref.current?.getStrokes()).toEqual([committedStroke]);
  });

  it('supports undo, redo, and redo-stack invalidation via imperative ref', () => {
    const ref = createRef<DrawingCanvasHandle>();
    const onStrokesChange = vi.fn();

    const { getByTestId } = render(
      <DrawingCanvas
        ref={ref}
        width={800}
        height={600}
        onStrokesChange={onStrokesChange}
      />
    );

    const activeCanvas = getByTestId('active-canvas');

    // Draw stroke 1
    act(() => {
      fireEvent.pointerDown(activeCanvas, { pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerUp(activeCanvas, { pointerId: 1, isPrimary: true, clientX: 20, clientY: 20 });
    });

    // Draw stroke 2
    act(() => {
      fireEvent.pointerDown(activeCanvas, { pointerId: 2, isPrimary: true, button: 0, clientX: 30, clientY: 30 });
      fireEvent.pointerUp(activeCanvas, { pointerId: 2, isPrimary: true, clientX: 40, clientY: 40 });
    });

    expect(ref.current?.getStrokes().length).toBe(2);
    expect(ref.current?.canUndo).toBe(true);
    expect(ref.current?.canRedo).toBe(false);

    // Undo
    act(() => {
      ref.current?.undo();
    });
    expect(ref.current?.getStrokes().length).toBe(1);
    expect(ref.current?.canRedo).toBe(true);

    // Redo
    act(() => {
      ref.current?.redo();
    });
    expect(ref.current?.getStrokes().length).toBe(2);
    expect(ref.current?.canRedo).toBe(false);

    // Undo again, then draw stroke 3 -> redo stack invalidated
    act(() => {
      ref.current?.undo();
    });
    expect(ref.current?.getStrokes().length).toBe(1);

    act(() => {
      fireEvent.pointerDown(activeCanvas, { pointerId: 3, isPrimary: true, button: 0, clientX: 50, clientY: 50 });
      fireEvent.pointerUp(activeCanvas, { pointerId: 3, isPrimary: true, clientX: 60, clientY: 60 });
    });

    expect(ref.current?.getStrokes().length).toBe(2);
    expect(ref.current?.canRedo).toBe(false);
  });

  it('performs geometric erasing and supports restoration via undo', () => {
    const existingStroke: Stroke = {
      id: 'target-stroke',
      tool: 'pen',
      color: '#000',
      size: 4,
      points: [
        { x: 0.5, y: 0.1, pressure: 0.5 },
        { x: 0.5, y: 0.9, pressure: 0.5 },
      ],
    };

    const ref = createRef<DrawingCanvasHandle>();
    const onStrokesChange = vi.fn();

    const { getByTestId } = render(
      <DrawingCanvas
        ref={ref}
        width={800}
        height={600}
        tool="eraser"
        brushSize={10}
        initialStrokes={[existingStroke]}
        onStrokesChange={onStrokesChange}
      />
    );

    const activeCanvas = getByTestId('active-canvas');

    // Drag eraser through the line (x = 400 on 800px width)
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: 395,
        clientY: 300,
      });
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 405,
        clientY: 300,
      });
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 410,
        clientY: 300,
      });
    });

    // Target stroke erased
    expect(ref.current?.getStrokes().length).toBe(0);

    // Undo restores erased stroke
    act(() => {
      ref.current?.undo();
    });

    expect(ref.current?.getStrokes().length).toBe(1);
    expect(ref.current?.getStrokes()[0].id).toBe('target-stroke');
  });

  it('handles rapid successive strokes without lost updates', () => {
    const ref = createRef<DrawingCanvasHandle>();
    const { getByTestId } = render(
      <DrawingCanvas ref={ref} width={800} height={600} />
    );
    const activeCanvas = getByTestId('active-canvas');

    act(() => {
      for (let i = 0; i < 15; i++) {
        fireEvent.pointerDown(activeCanvas, {
          pointerId: i + 1,
          isPrimary: true,
          button: 0,
          clientX: i * 10,
          clientY: i * 10,
        });
        fireEvent.pointerUp(activeCanvas, {
          pointerId: i + 1,
          isPrimary: true,
          clientX: i * 10 + 5,
          clientY: i * 10 + 5,
        });
      }
    });

    expect(ref.current?.getStrokes().length).toBe(15);
  });

  it('cleans up observers, listeners, and animation frames on unmount', () => {
    const disconnectSpy = vi.fn();
    window.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnectSpy;
    } as unknown as typeof ResizeObserver;

    const cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame');

    const { getByTestId, unmount } = render(<DrawingCanvas width={800} height={600} />);
    const activeCanvas = getByTestId('active-canvas');

    // Start a pointer down to schedule an animation frame
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      });
    });

    unmount();

    expect(disconnectSpy).toHaveBeenCalled();
    expect(cancelAnimationFrameSpy).toHaveBeenCalled();
  });

  it('supports infinite canvas camera methods (zoomIn, zoomOut, resetZoom, panBy)', () => {
    const ref = createRef<DrawingCanvasHandle>();
    render(<DrawingCanvas ref={ref} width={800} height={600} />);

    expect(ref.current?.getCamera().zoom).toBe(1.0);

    act(() => {
      ref.current?.zoomIn(2.0);
    });
    expect(ref.current?.getCamera().zoom).toBe(2.0);

    act(() => {
      ref.current?.zoomOut(0.5);
    });
    expect(ref.current?.getCamera().zoom).toBe(1.0);

    act(() => {
      ref.current?.panBy(100, -50);
    });
    expect(ref.current?.getCamera().x).toBe(100);
    expect(ref.current?.getCamera().y).toBe(-50);

    act(() => {
      ref.current?.resetZoom();
    });
    expect(ref.current?.getCamera().zoom).toBe(1.0);
  });

  it('pans the canvas when using the hand tool', () => {
    const ref = createRef<DrawingCanvasHandle>();
    const { getByTestId } = render(
      <DrawingCanvas ref={ref} width={800} height={600} tool="hand" />
    );
    const activeCanvas = getByTestId('active-canvas');

    const initialCamera = ref.current?.getCamera();
    expect(initialCamera?.x).toBe(0);
    expect(initialCamera?.y).toBe(0);

    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 250,
        clientY: 200,
      });
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 250,
        clientY: 200,
      });
    });

    const updatedCamera = ref.current?.getCamera();
    expect(updatedCamera?.x).toBe(150);
    expect(updatedCamera?.y).toBe(100);
  });

  it('handles trackpad 2-finger wheel pan and pinch zoom', () => {
    const ref = createRef<DrawingCanvasHandle>();
    const { getByTestId } = render(
      <DrawingCanvas ref={ref} width={800} height={600} />
    );
    const container = getByTestId('drawing-canvas-container');

    // Trackpad 2-finger pan (deltaX: 40, deltaY: 20)
    act(() => {
      fireEvent.wheel(container, {
        deltaX: 40,
        deltaY: 20,
        ctrlKey: false,
        clientX: 400,
        clientY: 300,
      });
    });

    expect(ref.current?.getCamera().x).toBe(-40);
    expect(ref.current?.getCamera().y).toBe(-20);

    // Trackpad pinch-to-zoom (ctrlKey: true)
    act(() => {
      fireEvent.wheel(container, {
        deltaX: 0,
        deltaY: -50,
        ctrlKey: true,
        clientX: 400,
        clientY: 300,
      });
    });

    expect(ref.current?.getCamera().zoom).toBeGreaterThan(1.0);
  });

  it('preserves strokes drawn in extended world coordinates (> 800px) without deleting or corrupting', () => {
    const onStrokeComplete = vi.fn();
    const { getByTestId } = render(
      <DrawingCanvas width={800} height={600} onStrokeComplete={onStrokeComplete} />
    );
    const activeCanvas = getByTestId('active-canvas');

    // Draw in an outer canvas region: clientX: 1200, clientY: 900
    act(() => {
      fireEvent.pointerDown(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 1200,
        clientY: 900,
        pressure: 0.5,
      });
      fireEvent.pointerMove(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 1250,
        clientY: 950,
        pressure: 0.5,
      });
      fireEvent.pointerUp(activeCanvas, {
        pointerId: 1,
        isPrimary: true,
        clientX: 1300,
        clientY: 1000,
        pressure: 0.5,
      });
    });

    expect(onStrokeComplete).toHaveBeenCalledTimes(1);
    const stroke: Stroke = onStrokeComplete.mock.calls[0][0];
    expect(stroke.points[0].x).toBe(1200);
    expect(stroke.points[0].y).toBe(900);
    expect(stroke.points[stroke.points.length - 1].x).toBe(1300);
    expect(stroke.points[stroke.points.length - 1].y).toBe(1000);
  });

  it('steps zoom by 10% according to the 10+10+ rule on zoomIn and zoomOut', () => {
    const ref = createRef<DrawingCanvasHandle>();
    render(<DrawingCanvas ref={ref} width={800} height={600} />);

    // Start at 20%
    act(() => {
      ref.current?.zoomTo(0.20);
    });
    expect(ref.current?.getCamera().zoom).toBe(0.20);

    // Zoom in from 20% -> 30%
    act(() => {
      ref.current?.zoomIn();
    });
    expect(ref.current?.getCamera().zoom).toBe(0.30);

    // Zoom out from 30% -> 20%
    act(() => {
      ref.current?.zoomOut();
    });
    expect(ref.current?.getCamera().zoom).toBe(0.20);

    // Set to 100% and zoom in -> 110%
    act(() => {
      ref.current?.resetZoom();
    });
    expect(ref.current?.getCamera().zoom).toBe(1.0);

    act(() => {
      ref.current?.zoomIn();
    });
    expect(ref.current?.getCamera().zoom).toBe(1.10);

    act(() => {
      ref.current?.zoomOut();
    });
    expect(ref.current?.getCamera().zoom).toBe(1.0);
  });

  it('supports zoomTo and zoomToFit on imperative handle', () => {
    const ref = createRef<DrawingCanvasHandle>();
    const initialStrokes: Stroke[] = [
      {
        id: 's1',
        tool: 'pen',
        color: '#253481',
        size: 4,
        points: [
          { x: 100, y: 100, pressure: 0.5 },
          { x: 500, y: 500, pressure: 0.5 },
        ],
      },
    ];

    render(
      <DrawingCanvas ref={ref} width={800} height={600} initialStrokes={initialStrokes} />
    );

    act(() => {
      ref.current?.zoomTo(2.5);
    });
    expect(ref.current?.getCamera().zoom).toBe(2.5);

    act(() => {
      ref.current?.zoomToFit();
    });
    expect(ref.current?.getCamera().zoom).toBeGreaterThan(0);
  });
});
