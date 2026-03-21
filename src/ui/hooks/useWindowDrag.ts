import { useRef, useCallback } from 'react';
import type { HeaderPosition } from '../types';

interface DragState {
  initialMouseX: number;
  initialMouseY: number;
  initialWindowX: number;
  initialWindowY: number;
  moved: boolean;
}

export function useWindowDrag() {
  const dragStateRef = useRef<DragState | null>(null);
  const wasJustDraggedRef = useRef(false);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragStateRef.current) return;

    const deltaX = Math.abs(e.screenX - dragStateRef.current.initialMouseX);
    const deltaY = Math.abs(e.screenY - dragStateRef.current.initialMouseY);

    if (deltaX > 3 || deltaY > 3) {
      dragStateRef.current.moved = true;
    }

    const newWindowX = dragStateRef.current.initialWindowX + (e.screenX - dragStateRef.current.initialMouseX);
    const newWindowY = dragStateRef.current.initialWindowY + (e.screenY - dragStateRef.current.initialMouseY);

    window.api.mainHeader.moveHeaderTo(newWindowX, newWindowY);
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!dragStateRef.current) return;

    const wasDragged = dragStateRef.current.moved;

    window.removeEventListener('mousemove', handleMouseMove, { capture: true } as any);
    dragStateRef.current = null;

    if (wasDragged) {
      wasJustDraggedRef.current = true;
      setTimeout(() => {
        wasJustDraggedRef.current = false;
      }, 0);
    }
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // Ignore mousedown originating from interactive controls
    const target = e.target as HTMLElement;
    const interactiveSelector = '.icon-btn, .rail-button, button, input, select, a, svg';
    
    if (target.closest(interactiveSelector) || ['BUTTON', 'INPUT', 'SELECT', 'A', 'SVG'].includes(target.tagName)) {
      return;
    }

    e.preventDefault();

    const initialPosition: HeaderPosition = await window.api.mainHeader.getHeaderPosition();

    dragStateRef.current = {
      initialMouseX: e.screenX,
      initialMouseY: e.screenY,
      initialWindowX: initialPosition.x,
      initialWindowY: initialPosition.y,
      moved: false,
    };

    window.addEventListener('mousemove', handleMouseMove, { capture: true } as any);
    window.addEventListener('mouseup', handleMouseUp, { once: true, capture: true } as any);
  }, [handleMouseMove, handleMouseUp]);

  return {
    handleMouseDown,
    wasJustDragged: wasJustDraggedRef.current,
  };
}

