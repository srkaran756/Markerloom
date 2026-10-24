import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock Pointer Capture API if missing
if (typeof Element !== "undefined") {
  const capturedPointers = new Set<number>();
  Element.prototype.setPointerCapture = vi.fn((pointerId: number) => {
    capturedPointers.add(pointerId);
  });
  Element.prototype.releasePointerCapture = vi.fn((pointerId: number) => {
    capturedPointers.delete(pointerId);
  });
  Element.prototype.hasPointerCapture = vi.fn((pointerId: number) => {
    return capturedPointers.has(pointerId);
  });
}

// Mock ResizeObserver
if (typeof window !== "undefined" && !window.ResizeObserver) {
  class MockResizeObserver {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe = vi.fn((target: Element) => {
      // Simulate an initial resize observation callback
      const entry: ResizeObserverEntry = {
        target,
        contentRect: target.getBoundingClientRect() || {
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          top: 0,
          bottom: 600,
          left: 0,
          right: 800,
          toJSON: () => ({}),
        },
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };
      this.callback([entry], this as unknown as ResizeObserver);
    });
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

// Mock HTMLCanvasElement.prototype.getContext('2d')
if (typeof HTMLCanvasElement !== "undefined") {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    contextId: string,
    options?: unknown
  ) {
    if (contextId === "2d") {
      if (!(this as unknown as { _mockCtx2d?: CanvasRenderingContext2D })._mockCtx2d) {
        const mockCtx: Partial<CanvasRenderingContext2D> = {
          canvas: this,
          fillStyle: "#000000",
          strokeStyle: "#000000",
          lineWidth: 1,
          lineCap: "round",
          lineJoin: "round",
          globalAlpha: 1.0,
          globalCompositeOperation: "source-over",
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          rect: vi.fn(),
          beginPath: vi.fn(),
          closePath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          quadraticCurveTo: vi.fn(),
          bezierCurveTo: vi.fn(),
          arc: vi.fn(),
          ellipse: vi.fn(),
          fill: vi.fn(),
          stroke: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
          translate: vi.fn(),
          rotate: vi.fn(),
          setTransform: vi.fn(),
          resetTransform: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(4),
            width: 1,
            height: 1,
          }),
          putImageData: vi.fn(),
          createImageData: vi.fn(),
          measureText: vi.fn().mockReturnValue({ width: 0 }),
        };
        (this as unknown as { _mockCtx2d?: CanvasRenderingContext2D })._mockCtx2d =
          mockCtx as CanvasRenderingContext2D;
      }
      return (this as unknown as { _mockCtx2d?: CanvasRenderingContext2D })._mockCtx2d;
    }
    return originalGetContext.call(this, contextId, options);
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
