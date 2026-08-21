// Slow-drifting dust behind the emblem card — same technique as the
// starfield note in the knowledge base (3-Resources/starfield-header/
// technique.md, cloned from ai.manz.dev): typed arrays for particle state,
// weighted size/color pools instead of per-particle randomness, wrap-around
// edges, one rAF loop. Adapted here to: fill a resizable container instead
// of a fixed-height header, use fillRect alpha instead of a flat color list
// (softer, since this sits behind a chrome badge rather than plain text),
// and run far slower — this is ambient dust, not a hyperspace effect.
import { useEffect, useRef } from "react";
import { PARTICLE_PALETTE } from "@/theme";

const PALETTE = PARTICLE_PALETTE.dust;
const COLOR_WEIGHTS = [0.3, 0.4, 0.3];
const SIZE_WEIGHTS = [0.62, 0.24, 0.09, 0.05]; // fraction of particles at each size below
const SIZES = [1, 1.6, 2.3, 3];
const SIZE_ALPHA = [0.4, 0.65, 0.85, 0.95];

export function EmblemStarfield({ total = 70 }: { total?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const starSize = new Uint8Array(total);
    const starColor = new Uint8Array(total);
    const pos = new Float32Array(total * 2);
    const vel = new Float32Array(total * 2);

    let width = 0;
    let height = 0;

    function assignFromWeights(weights: number[], out: Uint8Array) {
      let i = 0;
      weights.forEach((frac, idx) => {
        const count = idx === weights.length - 1 ? total - i : Math.round(total * frac);
        for (let n = 0; n < count && i < total; n++) out[i++] = idx;
      });
    }

    function seed() {
      assignFromWeights(SIZE_WEIGHTS, starSize);
      assignFromWeights(COLOR_WEIGHTS, starColor);
      for (let i = 0; i < total; i++) {
        const k = i * 2;
        pos[k] = Math.random() * width;
        pos[k + 1] = Math.random() * height;
        // Slow ambient dust, not a hyperspace field: 0.02-0.06 px/frame
        // drifting left, with a much smaller vertical wobble.
        const speed = 0.02 + Math.random() * 0.04;
        vel[k] = -speed;
        vel[k + 1] = (Math.random() - 0.4) * 0.012;
      }
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas!.width = width * dpr;
      canvas!.height = height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    seed();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    function draw() {
      const g = ctx!.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, PARTICLE_PALETTE.backgroundGradient[0]);
      g.addColorStop(1, PARTICLE_PALETTE.backgroundGradient[1]);
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, width, height);

      for (let i = 0; i < total; i++) {
        const k = i * 2;
        const size = SIZES[starSize[i]];
        ctx!.globalAlpha = SIZE_ALPHA[starSize[i]];
        ctx!.fillStyle = PALETTE[starColor[i]];
        ctx!.fillRect(pos[k], pos[k + 1], size, size);
      }
      ctx!.globalAlpha = 1;
    }

    function tick() {
      for (let i = 0; i < total; i++) {
        const k = i * 2;
        pos[k] += vel[k];
        pos[k + 1] += vel[k + 1];
        if (pos[k] < -3) pos[k] = width + 3;
        else if (pos[k] > width + 3) pos[k] = -3;
        if (pos[k + 1] < -3) pos[k + 1] = height + 3;
        else if (pos[k + 1] > height + 3) pos[k + 1] = -3;
      }
      draw();
      if (!reduced) raf = requestAnimationFrame(tick);
    }

    tick(); // draws one frame even when reduced-motion stops the loop after

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [total]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
