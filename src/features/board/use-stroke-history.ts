import { useState, useCallback, useRef } from 'react';
import type { Stroke } from './types';

export interface UseStrokeHistoryOptions {
  initialStrokes?: Stroke[];
  onStrokesChange?: (strokes: Stroke[]) => void;
}

export interface UseStrokeHistoryReturn {
  strokes: Stroke[];
  canUndo: boolean;
  canRedo: boolean;
  addStroke: (stroke: Stroke) => void;
  eraseStrokes: (strokeIdsToErase: Set<string> | string[]) => void;
  setStrokes: (newStrokes: Stroke[]) => void;
  undo: () => boolean;
  redo: () => boolean;
  clear: () => void;
  reset: (strokes?: Stroke[]) => void;
}

/**
 * Custom hook providing robust, immutable undo/redo history for canvas strokes.
 * Pure state updates ensure no setState-during-render side-effects occur.
 */
export function useStrokeHistory(options: UseStrokeHistoryOptions = {}): UseStrokeHistoryReturn {
  const { initialStrokes = [], onStrokesChange } = options;

  const [state, setState] = useState<{
    strokes: Stroke[];
    undoStack: Stroke[][];
    redoStack: Stroke[][];
  }>({
    strokes: initialStrokes,
    undoStack: [],
    redoStack: [],
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const onStrokesChangeRef = useRef(onStrokesChange);
  onStrokesChangeRef.current = onStrokesChange;

  const notifyChange = useCallback((nextStrokes: Stroke[]) => {
    onStrokesChangeRef.current?.(nextStrokes);
  }, []);

  const addStroke = useCallback(
    (newStroke: Stroke) => {
      const prev = stateRef.current;
      const nextStrokes = [...prev.strokes, newStroke];
      const nextState = {
        strokes: nextStrokes,
        undoStack: [...prev.undoStack, prev.strokes],
        redoStack: [], // Invalidate redo stack on new operation
      };
      stateRef.current = nextState;
      setState(nextState);
      notifyChange(nextStrokes);
    },
    [notifyChange]
  );

  const eraseStrokes = useCallback(
    (strokeIdsToErase: Set<string> | string[]) => {
      const idSet =
        strokeIdsToErase instanceof Set ? strokeIdsToErase : new Set(strokeIdsToErase);
      if (idSet.size === 0) return;

      const prev = stateRef.current;
      const nextStrokes = prev.strokes.filter((s) => !idSet.has(s.id));
      if (nextStrokes.length === prev.strokes.length) {
        return;
      }
      const nextState = {
        strokes: nextStrokes,
        undoStack: [...prev.undoStack, prev.strokes],
        redoStack: [],
      };
      stateRef.current = nextState;
      setState(nextState);
      notifyChange(nextStrokes);
    },
    [notifyChange]
  );

  const setStrokes = useCallback(
    (newStrokes: Stroke[]) => {
      const prev = stateRef.current;
      const nextState = {
        strokes: newStrokes,
        undoStack: [...prev.undoStack, prev.strokes],
        redoStack: [],
      };
      stateRef.current = nextState;
      setState(nextState);
      notifyChange(newStrokes);
    },
    [notifyChange]
  );

  const undo = useCallback((): boolean => {
    const prev = stateRef.current;
    if (prev.undoStack.length === 0) {
      return false;
    }
    const previousStrokes = prev.undoStack[prev.undoStack.length - 1];
    const nextUndoStack = prev.undoStack.slice(0, prev.undoStack.length - 1);
    const nextRedoStack = [prev.strokes, ...prev.redoStack];

    const nextState = {
      strokes: previousStrokes,
      undoStack: nextUndoStack,
      redoStack: nextRedoStack,
    };
    stateRef.current = nextState;
    setState(nextState);
    notifyChange(previousStrokes);
    return true;
  }, [notifyChange]);

  const redo = useCallback((): boolean => {
    const prev = stateRef.current;
    if (prev.redoStack.length === 0) {
      return false;
    }
    const nextStrokes = prev.redoStack[0];
    const nextRedoStack = prev.redoStack.slice(1);
    const nextUndoStack = [...prev.undoStack, prev.strokes];

    const nextState = {
      strokes: nextStrokes,
      undoStack: nextUndoStack,
      redoStack: nextRedoStack,
    };
    stateRef.current = nextState;
    setState(nextState);
    notifyChange(nextStrokes);
    return true;
  }, [notifyChange]);

  const clear = useCallback(() => {
    const prev = stateRef.current;
    if (prev.strokes.length === 0) return;
    const nextState = {
      strokes: [],
      undoStack: [...prev.undoStack, prev.strokes],
      redoStack: [],
    };
    stateRef.current = nextState;
    setState(nextState);
    notifyChange([]);
  }, [notifyChange]);

  const reset = useCallback(
    (resetStrokes: Stroke[] = []) => {
      const nextState = {
        strokes: resetStrokes,
        undoStack: [],
        redoStack: [],
      };
      stateRef.current = nextState;
      setState(nextState);
      notifyChange(resetStrokes);
    },
    [notifyChange]
  );

  return {
    strokes: state.strokes,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    addStroke,
    eraseStrokes,
    setStrokes,
    undo,
    redo,
    clear,
    reset,
  };
}
