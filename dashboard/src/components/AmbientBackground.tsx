import { useEffect, useRef } from 'react';
import { BG_PATTERNS, CANVAS_PATTERNS, EFFECT_RUNNERS, type BgPattern } from '../utils/ambientBackground';
import './AmbientBackground.css';

export { BG_PATTERNS };
export type { BgPattern };

interface AmbientBackgroundProps {
  pattern: BgPattern;
  intensity: number; // 0..1
}

// Fixed full-viewport layer sitting behind the sidebar/main-content (Layout.css puts them above it).
// 'none' renders nothing; 'dots' is a static CSS tile; everything else runs a canvas + RAF loop from
// utils/ambientBackground.ts. The whole layer's opacity is the single intensity knob — simpler than
// wiring per-effect intensity handling, and it works identically for the static dots tile too.
export function AmbientBackground({ pattern, intensity }: AmbientBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);

  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  useEffect(() => {
    if (!CANVAS_PATTERNS.has(pattern)) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const runner = EFFECT_RUNNERS[pattern];
    if (!runner) return;

    let cancelled = false;
    const getColor = () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#25d366';

    runner({ canvas, ctx, getColor, getIntensity: () => intensityRef.current, isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [pattern]);

  if (pattern === 'none') return null;

  return (
    <div className={`ambient-bg ${pattern === 'dots' ? 'ambient-bg-dots' : ''}`} style={{ opacity: intensity }} aria-hidden="true">
      {CANVAS_PATTERNS.has(pattern) && <canvas ref={canvasRef} />}
    </div>
  );
}
