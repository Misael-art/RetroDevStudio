import { useEffect, useRef } from "react";

/**
 * Hook que dispara callbacks de frame em intervalos baseados em FPS.
 * Usa requestAnimationFrame para sincronizar com o refresh da tela.
 *
 * @param playing - Se true, o loop roda
 * @param fps - Frames por segundo
 * @param frames - Array de índices de frames (células do grid)
 * @param loop - Se true, reinicia ao chegar ao fim
 * @param onFrame - Chamado a cada frame com o índice da célula (grid) ou -1 quando parado
 */
export function useSpriteAnimator(
  playing: boolean,
  fps: number,
  frames: number[],
  loop: boolean,
  onFrame: (cellIndex: number) => void
): void {
  const frameIndexRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!playing || frames.length === 0) {
      if (!playing) {
        onFrameRef.current(-1);
      }
      lastTimeRef.current = null;
      return;
    }

    frameIndexRef.current = 0;
    accumulatedRef.current = 0;
    lastTimeRef.current = null;
    const intervalMs = 1000 / Math.max(1, fps);

    function tick(now: number) {
      if (!lastTimeRef.current) {
        lastTimeRef.current = now;
      }
      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;
      accumulatedRef.current += delta;

      while (accumulatedRef.current >= intervalMs) {
        accumulatedRef.current -= intervalMs;
        frameIndexRef.current += 1;
        if (frameIndexRef.current >= frames.length) {
          if (loop) {
            frameIndexRef.current = 0;
          } else {
            frameIndexRef.current = frames.length - 1;
            return;
          }
        }
      }

      const cellIndex = frames[frameIndexRef.current];
      onFrameRef.current(cellIndex);
    }

    let rafId: number;
    function loopFn(now: number) {
      tick(now);
      rafId = requestAnimationFrame(loopFn);
    }
    rafId = requestAnimationFrame(loopFn);

    return () => cancelAnimationFrame(rafId);
  }, [playing, fps, frames, loop]);
}
