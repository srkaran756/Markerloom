'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import logoPic from '../../public/logo.png';
import { DrawingCanvas } from '@/features/board';
import type { DrawingCanvasHandle, ToolType, Stroke, Camera } from '@/features/board';

const EDUCATIONAL_COLORS = [
  { name: 'Primary Indigo', value: '#253481' },
  { name: 'Charcoal Black', value: '#0d1c2e' },
  { name: 'Emerald Green', value: '#005e4b' },
  { name: 'Cardinal Red', value: '#ba1a1a' },
  { name: 'Slate Neutral', value: '#515e7c' },
  { name: 'Highlighter Yellow', value: '#eab308' },
];

export default function WhiteboardPage() {
  const [tool, setTool] = useState<ToolType>('pen');
  const [color, setColor] = useState('#253481');
  const [brushSize, setBrushSize] = useState(4);
  const [strokeCount, setStrokeCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1.0 });

  const canvasRef = useRef<DrawingCanvasHandle | null>(null);

  const handleStrokesChange = useCallback((strokes: Stroke[]) => {
    setStrokeCount(strokes.length);
    if (canvasRef.current) {
      setCanUndo(canvasRef.current.canUndo);
      setCanRedo(canvasRef.current.canRedo);
    }
  }, []);

  const handleUndo = () => {
    if (canvasRef.current) {
      canvasRef.current.undo();
      setCanUndo(canvasRef.current.canUndo);
      setCanRedo(canvasRef.current.canRedo);
    }
  };

  const handleRedo = () => {
    if (canvasRef.current) {
      canvasRef.current.redo();
      setCanUndo(canvasRef.current.canUndo);
      setCanRedo(canvasRef.current.canRedo);
    }
  };

  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [isScrubbingZoom, setIsScrubbingZoom] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clear();
      setCanUndo(canvasRef.current.canUndo);
      setCanRedo(canvasRef.current.canRedo);
    }
  };

  const handleZoomIn = () => {
    canvasRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    canvasRef.current?.zoomOut();
  };

  const handleResetZoom = () => {
    canvasRef.current?.resetZoom();
    setIsZoomMenuOpen(false);
  };

  const handleZoomToFit = () => {
    canvasRef.current?.zoomToFit();
    setIsZoomMenuOpen(false);
  };

  const handleSetZoom = (newZoom: number) => {
    canvasRef.current?.zoomTo(newZoom);
    setIsZoomMenuOpen(false);
  };

  // Figma-style vertical scrub zoom on badge
  const handleZoomBadgePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const startY = e.clientY;
    const startZoom = camera.zoom;
    let didDrag = false;

    const onPointerMove = (ev: PointerEvent) => {
      const dy = startY - ev.clientY; // Dragging UP zooms in
      if (Math.abs(dy) > 2) {
        didDrag = true;
        setIsScrubbingZoom(true);
      }
      if (didDrag) {
        const factor = Math.pow(1.008, dy);
        const nextZoom = Math.max(0.1, Math.min(10.0, Number((startZoom * factor).toFixed(3))));
        canvasRef.current?.zoomTo(nextZoom);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setIsScrubbingZoom(false);
      if (!didDrag) {
        setIsZoomMenuOpen((prev) => !prev);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Close zoom menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setIsZoomMenuOpen(false);
      }
    };
    if (isZoomMenuOpen) {
      window.addEventListener('mousedown', handleOutsideClick);
    }
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [isZoomMenuOpen]);

  // Keyboard tool switching: 1 / P for pen, 2 / H for highlighter, 3 / E for eraser, 4 / V for hand
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === '1' || e.key.toLowerCase() === 'p') setTool('pen');
      if (e.key === '2' || e.key.toLowerCase() === 'h') setTool('highlighter');
      if (e.key === '3' || e.key.toLowerCase() === 'e') setTool('eraser');
      if (e.key === '4' || e.key.toLowerCase() === 'v') setTool('hand');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const zoomPercent = Math.round(camera.zoom * 100);

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* Top Header Navigation */}
      <header
        style={{
          position: 'absolute',
          top: 16,
          left: 20,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(8px)',
          borderRadius: 14,
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 12px -2px rgba(15, 23, 42, 0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Image
            src={logoPic}
            alt="Markerloom Logo"
            width={28}
            height={28}
            priority
            style={{
              width: 28,
              height: 28,
              filter: 'drop-shadow(0 2px 4px rgba(37, 52, 129, 0.2))',
              display: 'block',
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 15, color: '#0d1c2e' }}>
            Markerloom
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              backgroundColor: '#eff4ff',
              color: '#253481',
              borderRadius: 9999,
              fontWeight: 600,
            }}
          >
            Infinite Canvas
          </span>
        </div>
        <div style={{ width: 1, height: 16, backgroundColor: '#e2e8f0' }} />
        <span style={{ fontSize: 12, color: '#515e7c' }}>
          {strokeCount} {strokeCount === 1 ? 'stroke' : 'strokes'}
        </span>
      </header>

      {/* Floating Bottom Left: Zoom & Vertical Control Tools */}
      <div
        ref={zoomMenuRef}
        style={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        {/* Figma-Style Vertical Zoom Menu Popover */}
        {isZoomMenuOpen && (
          <div
            style={{
              padding: 12,
              backgroundColor: '#ffffff',
              borderRadius: 14,
              border: '1px solid #e2e8f0',
              boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 4px 6px -2px rgba(15, 23, 42, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minWidth: 170,
              animation: 'fadeIn 0.15s ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#0d1c2e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Zoom Control
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#253481' }}>
                {zoomPercent}%
              </span>
            </div>

            {/* Vertical Slider Scrub Track */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 2px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 100, justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>500%</span>
                <input
                  type="range"
                  min="10"
                  max="500"
                  step="5"
                  value={zoomPercent}
                  onChange={(e) => handleSetZoom(Number(e.target.value) / 100)}
                  style={{
                    width: 70,
                    height: 20,
                    transform: 'rotate(-90deg)',
                    cursor: 'ns-resize',
                    accentColor: '#253481',
                    margin: '25px -25px',
                  }}
                  title="Vertical Zoom Slider (Drag up/down)"
                />
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>10%</span>
              </div>

              {/* Preset Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                <button
                  type="button"
                  onClick={handleZoomToFit}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    color: '#0d1c2e',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  Fit to Screen
                </button>
                {[50, 100, 200, 300].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => (preset === 100 ? handleResetZoom() : handleSetZoom(preset / 100))}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: 'none',
                      backgroundColor: zoomPercent === preset ? '#eff4ff' : 'transparent',
                      color: zoomPercent === preset ? '#253481' : '#515e7c',
                      fontSize: 11,
                      fontWeight: zoomPercent === preset ? 700 : 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {preset}% {preset === 100 && '(Ctrl 0)'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 6 }}>
              <span style={{ fontSize: 10, color: '#64748b', lineHeight: 1.3, display: 'block' }}>
                Tip: Hold <strong>Z</strong> + Drag up/down on canvas, or scrub percentage badge vertically.
              </span>
            </div>
          </div>
        )}

        {/* Floating Bottom Left Pill Bar */}
        <div
          aria-label="Zoom Controls"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 6px',
            backgroundColor: '#ffffff',
            borderRadius: 9999,
            border: isScrubbingZoom ? '1px solid #253481' : '1px solid #e2e8f0',
            boxShadow: isScrubbingZoom
              ? '0 0 0 3px rgba(37, 52, 129, 0.15), 0 4px 12px -2px rgba(15, 23, 42, 0.08)'
              : '0 4px 12px -2px rgba(15, 23, 42, 0.08)',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
        >
          <button
            type="button"
            title="Zoom Out 10% (Ctrl -)"
            onClick={handleZoomOut}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#515e7c',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            −
          </button>

          {/* Interactive Vertical Scrub Badge */}
          <button
            type="button"
            title="Drag up/down to zoom vertically (Figma style) • Click for menu"
            onPointerDown={handleZoomBadgePointerDown}
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: isScrubbingZoom ? '#eff4ff' : 'transparent',
              color: isScrubbingZoom ? '#253481' : '#0d1c2e',
              cursor: 'ns-resize',
              fontSize: 12,
              fontWeight: 600,
              minWidth: 54,
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: 10, color: '#94a3b8' }}>↕</span>
            {zoomPercent}%
          </button>

          <button
            type="button"
            title="Zoom In 10% (Ctrl +)"
            onClick={handleZoomIn}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#515e7c',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            +
          </button>

          <div style={{ width: 1, height: 16, backgroundColor: '#e2e8f0', margin: '0 2px' }} />

          {/* Vertical Control Menu Toggle */}
          <button
            type="button"
            title="Open Vertical Zoom Controls & Presets"
            onClick={() => setIsZoomMenuOpen((prev) => !prev)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              border: 'none',
              backgroundColor: isZoomMenuOpen ? '#eff4ff' : 'transparent',
              color: isZoomMenuOpen ? '#253481' : '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ⋮
          </button>
        </div>
      </div>

      {/* Drawing Canvas */}
      <DrawingCanvas
        ref={canvasRef}
        tool={tool}
        color={color}
        brushSize={brushSize}
        camera={camera}
        onCameraChange={setCamera}
        onStrokesChange={handleStrokesChange}
        className="w-full h-full"
      />

      {/* Canvas Center Branding Watermark (Empty State) */}
      {strokeCount === 0 && (
        <div
          data-testid="canvas-empty-state"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            userSelect: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            opacity: 0.85,
            transition: 'opacity 0.25s ease',
            zIndex: 10,
          }}
        >
          <Image
            src={logoPic}
            alt="Markerloom Logo"
            width={68}
            height={68}
            priority
            style={{
              width: 68,
              height: 68,
              filter: 'drop-shadow(0 8px 24px rgba(37, 52, 129, 0.18))',
              display: 'block',
            }}
          />
          <div style={{ textAlign: 'center' }}>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: '#0d1c2e',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              Markerloom
            </h2>
            <p
              style={{
                fontSize: 13,
                color: '#515e7c',
                margin: '4px 0 0',
                fontWeight: 500,
              }}
            >
              Infinite Canvas • Draw, annotate, or ideate freely
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 4,
              padding: '6px 14px',
              borderRadius: 9999,
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(8px)',
              border: '1px solid #e2e8f0',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
              fontSize: 11,
              color: '#515e7c',
            }}
          >
            <span>
              <strong style={{ color: '#0d1c2e', fontWeight: 600 }}>Space + Drag</strong> to pan
            </span>
            <span>•</span>
            <span>
              <strong style={{ color: '#0d1c2e', fontWeight: 600 }}>Scroll / Z + Drag</strong> to zoom
            </span>
          </div>
        </div>
      )}

      {/* Floating Center Dock: Tools, Palettes, History */}
      <nav
        aria-label="Whiteboard Toolbar"
        style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          backgroundColor: '#ffffff',
          borderRadius: 9999,
          border: '1px solid #e2e8f0',
          boxShadow:
            '0 4px 18px -2px rgba(15, 23, 42, 0.12), 0 2px 6px -1px rgba(15, 23, 42, 0.04)',
        }}
      >
        {/* Navigation & Drawing Tool Group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Hand Tool */}
          <button
            type="button"
            title="Hand / Pan Tool (Space or 4)"
            onClick={() => setTool('hand')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9999,
              border: 'none',
              backgroundColor: tool === 'hand' ? '#253481' : 'transparent',
              color: tool === 'hand' ? '#ffffff' : '#515e7c',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
              <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
              <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
              <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
            </svg>
            Hand
          </button>

          {/* Pen Tool */}
          <button
            type="button"
            title="Pen (1 or P)"
            onClick={() => setTool('pen')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9999,
              border: 'none',
              backgroundColor: tool === 'pen' ? '#253481' : 'transparent',
              color: tool === 'pen' ? '#ffffff' : '#515e7c',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
            Pen
          </button>

          {/* Highlighter Tool */}
          <button
            type="button"
            title="Highlighter (2 or H)"
            onClick={() => setTool('highlighter')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9999,
              border: 'none',
              backgroundColor: tool === 'highlighter' ? '#253481' : 'transparent',
              color: tool === 'highlighter' ? '#ffffff' : '#515e7c',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m9 11-6 6v3h3l6-6" />
              <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
            </svg>
            Highlighter
          </button>

          {/* Eraser Tool */}
          <button
            type="button"
            title="Eraser (3 or E)"
            onClick={() => setTool('eraser')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 9999,
              border: 'none',
              backgroundColor: tool === 'eraser' ? '#253481' : 'transparent',
              color: tool === 'eraser' ? '#ffffff' : '#515e7c',
              fontWeight: 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
            Eraser
          </button>
        </div>

        <div style={{ width: 1, height: 20, backgroundColor: '#e2e8f0' }} />

        {/* Color swatches */}
        {tool !== 'eraser' && tool !== 'hand' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {EDUCATIONAL_COLORS.map((c) => {
                const isSelected = color === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    title={c.name}
                    onClick={() => setColor(c.value)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      backgroundColor: c.value,
                      border: isSelected ? '2px solid #ffffff' : '1px solid rgba(0,0,0,0.1)',
                      outline: isSelected ? '2px solid #253481' : 'none',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'transform 100ms ease',
                      transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                    }}
                  />
                );
              })}
            </div>
            <div style={{ width: 1, height: 20, backgroundColor: '#e2e8f0' }} />
          </>
        )}

        {/* Thickness slider */}
        {tool !== 'hand' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#515e7c', minWidth: 26 }}>
                {brushSize}px
              </span>
              <input
                type="range"
                min="1"
                max="32"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                style={{
                  width: 60,
                  cursor: 'pointer',
                  accentColor: '#253481',
                }}
              />
            </div>
            <div style={{ width: 1, height: 20, backgroundColor: '#e2e8f0' }} />
          </>
        )}

        {/* History actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            title="Undo (Ctrl Z)"
            disabled={!canUndo}
            onClick={handleUndo}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#0d1c2e',
              cursor: canUndo ? 'pointer' : 'not-allowed',
              opacity: canUndo ? 1 : 0.35,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>

          <button
            type="button"
            title="Redo (Ctrl Y)"
            disabled={!canRedo}
            onClick={handleRedo}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#0d1c2e',
              cursor: canRedo ? 'pointer' : 'not-allowed',
              opacity: canRedo ? 1 : 0.35,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
            </svg>
          </button>

          <button
            type="button"
            title="Clear board"
            onClick={handleClear}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 10px',
              borderRadius: 9999,
              border: '1px solid #e2e8f0',
              backgroundColor: 'transparent',
              color: '#ba1a1a',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              marginLeft: 4,
            }}
          >
            Clear
          </button>
        </div>
      </nav>
    </main>
  );
}
