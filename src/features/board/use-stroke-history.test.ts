import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStrokeHistory } from './use-stroke-history';
import type { Stroke } from './types';

const createMockStroke = (id: string, color = '#253481'): Stroke => ({
  id,
  tool: 'pen',
  color,
  size: 4,
  points: [{ x: 0.1, y: 0.1, pressure: 0.5 }],
});

describe('useStrokeHistory', () => {
  it('initializes with default empty state and reports correct undo/redo availability', () => {
    const { result } = renderHook(() => useStrokeHistory());
    expect(result.current.strokes).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it('initializes with supplied initial strokes', () => {
    const initial = [createMockStroke('s1')];
    const { result } = renderHook(() => useStrokeHistory({ initialStrokes: initial }));
    expect(result.current.strokes).toEqual(initial);
    expect(result.current.canUndo).toBe(false);
  });

  it('adds strokes atomically and enables undo', () => {
    const onStrokesChange = vi.fn();
    const { result } = renderHook(() => useStrokeHistory({ onStrokesChange }));

    const s1 = createMockStroke('s1');
    act(() => {
      result.current.addStroke(s1);
    });

    expect(result.current.strokes).toEqual([s1]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
    expect(onStrokesChange).toHaveBeenCalledWith([s1]);
  });

  it('supports undo and redo cycles', () => {
    const { result } = renderHook(() => useStrokeHistory());

    const s1 = createMockStroke('s1');
    const s2 = createMockStroke('s2');

    act(() => {
      result.current.addStroke(s1);
      result.current.addStroke(s2);
    });

    expect(result.current.strokes).toEqual([s1, s2]);

    // Undo s2
    let didUndo = false;
    act(() => {
      didUndo = result.current.undo();
    });
    expect(didUndo).toBe(true);
    expect(result.current.strokes).toEqual([s1]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    // Undo s1
    act(() => {
      result.current.undo();
    });
    expect(result.current.strokes).toEqual([]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    // Redo s1
    let didRedo = false;
    act(() => {
      didRedo = result.current.redo();
    });
    expect(didRedo).toBe(true);
    expect(result.current.strokes).toEqual([s1]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    // Redo s2
    act(() => {
      result.current.redo();
    });
    expect(result.current.strokes).toEqual([s1, s2]);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it('invalidates redo stack when a new operation is performed after undo', () => {
    const { result } = renderHook(() => useStrokeHistory());

    const s1 = createMockStroke('s1');
    const s2 = createMockStroke('s2');
    const s3 = createMockStroke('s3');

    act(() => {
      result.current.addStroke(s1);
      result.current.addStroke(s2);
    });

    // Undo s2
    act(() => {
      result.current.undo();
    });
    expect(result.current.canRedo).toBe(true);

    // Add s3 -> clears redo stack!
    act(() => {
      result.current.addStroke(s3);
    });

    expect(result.current.strokes).toEqual([s1, s3]);
    expect(result.current.canRedo).toBe(false);

    // Redo returns false
    let redid = false;
    act(() => {
      redid = result.current.redo();
    });
    expect(redid).toBe(false);
  });

  it('handles stroke erasing and restores erased strokes on undo', () => {
    const { result } = renderHook(() => useStrokeHistory());

    const s1 = createMockStroke('s1');
    const s2 = createMockStroke('s2');
    const s3 = createMockStroke('s3');

    act(() => {
      result.current.addStroke(s1);
      result.current.addStroke(s2);
      result.current.addStroke(s3);
    });

    // Erase s2
    act(() => {
      result.current.eraseStrokes(new Set(['s2']));
    });

    expect(result.current.strokes).toEqual([s1, s3]);

    // Undo restore s2
    act(() => {
      result.current.undo();
    });

    expect(result.current.strokes).toEqual([s1, s2, s3]);
  });

  it('handles clear and restores previous strokes on undo', () => {
    const { result } = renderHook(() => useStrokeHistory());

    const s1 = createMockStroke('s1');
    const s2 = createMockStroke('s2');

    act(() => {
      result.current.addStroke(s1);
      result.current.addStroke(s2);
    });

    act(() => {
      result.current.clear();
    });
    expect(result.current.strokes).toEqual([]);

    act(() => {
      result.current.undo();
    });
    expect(result.current.strokes).toEqual([s1, s2]);
  });

  it('handles rapid successive strokes without losing updates', () => {
    const { result } = renderHook(() => useStrokeHistory());

    act(() => {
      for (let i = 0; i < 20; i++) {
        result.current.addStroke(createMockStroke(`rapid-${i}`));
      }
    });

    expect(result.current.strokes.length).toBe(20);
    expect(result.current.strokes[19].id).toBe('rapid-19');

    // Undo 5 times
    act(() => {
      for (let i = 0; i < 5; i++) {
        result.current.undo();
      }
    });

    expect(result.current.strokes.length).toBe(15);
  });
});
