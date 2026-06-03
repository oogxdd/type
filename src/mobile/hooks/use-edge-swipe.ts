import { useCallback, useRef } from "react";

export function useEdgeSwipe(
  enabled: boolean,
  onSwipeBack: () => void
) {
  const edgeSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const edgeSwipeTriggered = useRef(false);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) {
        return;
      }
      if (event.clientX > 24) {
        edgeSwipeStart.current = null;
        return;
      }
      edgeSwipeTriggered.current = false;
      edgeSwipeStart.current = { x: event.clientX, y: event.clientY };
    },
    [enabled]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) {
        return;
      }
      const start = edgeSwipeStart.current;
      if (!start || edgeSwipeTriggered.current) {
        return;
      }
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (dx > 84 && Math.abs(dy) < 42) {
        edgeSwipeTriggered.current = true;
        onSwipeBack();
      }
    },
    [enabled, onSwipeBack]
  );

  const handlePointerEnd = useCallback(() => {
    edgeSwipeStart.current = null;
    edgeSwipeTriggered.current = false;
  }, []);

  return {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
  };
}
