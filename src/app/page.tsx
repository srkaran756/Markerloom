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
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
  const [isMoreToolsOpen, setIsMoreToolsOpen] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1.0 });

  const canvasRef = useRef<DrawingCanvasHandle | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);

  const activateTool = useCallback((nextTool: ToolType) => {
    const isSameTool = tool === nextTool;
    setTool(nextTool);
    setIsToolbarExpanded((expanded) => isSameTool ? !expanded : true);
    setIsMoreToolsOpen(false);
  }, [tool]);

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

  useEffect(() => {
    if (!isMoreToolsOpen && !isToolbarExpanded) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setIsMoreToolsOpen(false);
        setIsToolbarExpanded(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreToolsOpen(false);
        setIsToolbarExpanded(false);
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMoreToolsOpen, isToolbarExpanded]);

  // Keyboard tool switching: 1 / P for pen, 2 / H for highlighter, 3 / E for eraser, 4 / V for hand
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === '1' || e.key.toLowerCase() === 'p') activateTool('pen');
      if (e.key === '2' || e.key.toLowerCase() === 'h') activateTool('highlighter');
      if (e.key === '3' || e.key.toLowerCase() === 'e') activateTool('eraser');
      if (e.key === '4' || e.key.toLowerCase() === 'v') activateTool('hand');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activateTool]);

  const zoomPercent = Math.round(camera.zoom * 100);
  const toolbarTools = [
    {
      type: 'hand' as const,
      label: 'Hand',
      shortcut: 'Space or 4',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
          <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
          <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      ),
    },
    {
      type: 'pen' as const,
      label: 'Pen',
      shortcut: '1 or P',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m12 19 7-7 3 3-7 7-3-3z" />
          <path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <path d="m2 2 7.586 7.586" />
          <circle cx="11" cy="11" r="2" />
        </svg>
      ),
    },
    {
      type: 'highlighter' as const,
      label: 'Highlighter',
      shortcut: '2 or H',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m9 11-6 6v3h3l6-6" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      ),
    },
    {
      type: 'eraser' as const,
      label: 'Eraser',
      shortcut: '3 or E',
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </svg>
      ),
    },
  ];

  return (
    <main
      className="whiteboard-app"
      style={{
        position: 'relative',
        width: '100%',
        height: '100dvh',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* Top Header Navigation */}
      <header
        className="app-header"
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
        className="zoom-controls"
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
            className="zoom-menu"
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
          className="zoom-pill"
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
          className="canvas-empty-state"
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
              className="empty-state-caption"
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
            className="empty-state-shortcuts"
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

      {/* Horizontal drawing toolbar with dedicated additional-tools menu */}
      <nav
        className={`whiteboard-toolbar${isToolbarExpanded ? ' toolbar-expanded' : ''}${isMoreToolsOpen ? ' toolbar-more-open' : ''}`}
        aria-label="Whiteboard Toolbar"
        ref={toolbarRef}
      >
        <div className="toolbar-tools" role="group" aria-label="Drawing tools">
          {toolbarTools.map(({ type, label, shortcut, icon }) => (
            <button
              key={type}
              type="button"
              aria-label={`${label} tool`}
              aria-pressed={tool === type}
              className="toolbar-tool"
              title={`${label} (${shortcut})`}
              onClick={() => activateTool(type)}
            >
              {icon}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`toolbar-more-button${['rectangle', 'ellipse', 'line', 'arrow', 'bucket'].includes(tool) ? ' active' : ''}`}
          aria-label="More drawing tools"
          aria-expanded={isMoreToolsOpen}
          aria-controls="toolbar-more-menu"
          title="More tools: shapes and bucket fill"
          onClick={() => {
            setIsToolbarExpanded(false);
            setIsMoreToolsOpen((open) => !open);
          }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="4" width="7" height="7" rx="1" />
            <circle cx="16.5" cy="7.5" r="3.5" />
            <path d="M4 16h7v5H4z" />
            <path d="M15 15h5M17.5 12.5v5" />
          </svg>
          <span>More</span>
        </button>

        <div className="toolbar-divider" aria-hidden="true" />

        <button
          type="button"
          className="toolbar-disclosure"
          aria-label="Toggle drawing controls"
          aria-expanded={isToolbarExpanded}
          aria-controls="toolbar-controls"
          title={isToolbarExpanded ? 'Hide drawing controls' : 'Show drawing controls'}
          onClick={() => {
            setIsMoreToolsOpen(false);
            setIsToolbarExpanded((expanded) => !expanded);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d={isToolbarExpanded ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6'} />
          </svg>
        </button>

        <div className="toolbar-history" role="group" aria-label="History actions">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl Z)"
            disabled={!canUndo}
            onClick={handleUndo}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>

          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl Y)"
            disabled={!canRedo}
            onClick={handleRedo}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
            </svg>
          </button>

          <button
            type="button"
            className="toolbar-clear"
            aria-label="Clear board"
            title="Clear board"
            onClick={handleClear}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="m19 6-1 14H6L5 6" />
              <path d="M10 11v5M14 11v5" />
            </svg>
          </button>
        </div>

        <section id="toolbar-controls" className="toolbar-popover" aria-label="Drawing controls">
          <div className="toolbar-popover-heading">
            <span>{toolbarTools.find((item) => item.type === tool)?.label}</span>
            <span>
              {tool === 'hand' ? 'Navigation' : tool === 'bucket' ? 'Fill settings' : 'Stroke settings'}
            </span>
          </div>

          {tool !== 'hand' && (
            <>
              {tool !== 'eraser' && (
                <div className="toolbar-color-section">
                  <span className="toolbar-section-label">Color</span>
                  <div className="toolbar-palette">
                    {EDUCATIONAL_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        className={`toolbar-color-swatch${color === c.value ? ' selected' : ''}`}
                        aria-label={`Set color ${c.name}`}
                        aria-pressed={color === c.value}
                        title={c.name}
                        onClick={() => setColor(c.value)}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                    <label className="toolbar-custom-color" title="Choose a custom color">
                      <input
                        type="color"
                        aria-label="Choose a custom color"
                        value={color}
                        onChange={(event) => setColor(event.target.value)}
                      />
                      <span aria-hidden="true">+</span>
                    </label>
                  </div>
                </div>
              )}

              {tool !== 'bucket' && (
                <>
                  <label className="toolbar-brush-size">
                    <span className="toolbar-size-label">
                      Stroke width <strong>{brushSize}px</strong>
                    </span>
                    <input
                      type="range"
                      min="1"
                      max="32"
                      value={brushSize}
                      aria-label="Stroke width"
                      onChange={(event) => setBrushSize(Number(event.target.value))}
                    />
                  </label>
                  <div className="toolbar-size-presets" aria-label="Stroke width presets">
                    {[2, 4, 8, 16].map((size) => (
                      <button
                        key={size}
                        type="button"
                        aria-label={`${size} pixel stroke`}
                        aria-pressed={brushSize === size}
                        onClick={() => setBrushSize(size)}
                      >
                        <span style={{ width: Math.max(3, size), height: Math.max(3, size) }} />
                        {size}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {isMoreToolsOpen && (
          <section id="toolbar-more-menu" className="toolbar-more-menu" aria-label="More drawing tools">
            <div className="toolbar-more-heading">
              <strong>More tools</strong>
              <span>Shapes and fill</span>
            </div>
            <div className="toolbar-shape-grid">
              {[
                { type: 'rectangle' as const, label: 'Rectangle', icon: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1" /></svg> },
                { type: 'ellipse' as const, label: 'Ellipse', icon: <svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="8" ry="6" /></svg> },
                { type: 'line' as const, label: 'Line', icon: <svg viewBox="0 0 24 24"><path d="M5 19 19 5" /></svg> },
                { type: 'arrow' as const, label: 'Arrow', icon: <svg viewBox="0 0 24 24"><path d="M5 19 19 5M9 5h10v10" /></svg> },
                { type: 'bucket' as const, label: 'Bucket fill', icon: <svg viewBox="0 0 24 24"><path d="m5 12 7-8 7 8-7 8z" /><path d="M18 17c0-1 1-2 1-2s1 1 1 2a1 1 0 0 1-2 0Z" /><path d="M4 21h16" /></svg> },
              ].map(({ type, label, icon }) => (
                <button
                  key={type}
                  type="button"
                  className={tool === type ? 'selected' : ''}
                  aria-label={label}
                  aria-pressed={tool === type}
                  onClick={() => {
                    activateTool(type);
                  }}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="toolbar-more-colors">
              <span>Fill color</span>
              <div className="toolbar-palette">
                {EDUCATIONAL_COLORS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={`toolbar-color-swatch${color === item.value ? ' selected' : ''}`}
                    aria-label={`Set fill color ${item.name}`}
                    aria-pressed={color === item.value}
                    title={item.name}
                    onClick={() => setColor(item.value)}
                    style={{ backgroundColor: item.value }}
                  />
                ))}
                <label className="toolbar-custom-color" title="Choose a custom fill color">
                  <input
                    type="color"
                    aria-label="Choose a custom fill color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                  />
                  <span aria-hidden="true">+</span>
                </label>
              </div>
              <span className="toolbar-fill-hint">Draw a rectangle or ellipse, then choose Bucket fill and click inside.</span>
            </div>
          </section>
        )}
      </nav>
    </main>
  );
}
