"use client";

// Ambient dust behind the hero's 3D emblem — ported from the desktop app's
// EmblemStarfield.tsx (apps/desktop/src/components/EmblemStarfield.tsx),
// "bare" tone only: transparent canvas, dots only, no background fill —
// the header's own dark gradient shows through underneath.
import { useEffect, useRef } from "react";
import { EMBLEM_ROTATE_SPEED, PARTICLE_PALETTE_BARE } from "@/lib/rendering";

const TOTAL = 70;
const COLOR_WEIGHTS = [0.3, 0.4, 0.3];
const SIZE_WEIGHTS = [0.62, 0.24, 0.09, 0.05];
const SIZES = [1, 1.6, 2.3, 3];
const SIZE_ALPHA = [0.3, 0.5, 0.68, 0.8];

// Drift speed is derived from `pace`, not its own independent constant.
// Factors (not 1:1 with the rotation) tuned by eye at the default pace
// (EMBLEM_ROTATE_SPEED) — bumped twice from the original 0.02-0.06
// "ambient dust" range, which read as too slow next to the emblem's own
// rotation (2026-08-31 feedback, x2). Retune the emblem's rotation and the
// dust still scales with it, instead of drifting out of sync with a
// separately-tuned number.
const DRIFT_MIN_FACTOR = 0.225;
const DRIFT_RANGE_FACTOR = 0.45;

export function EmblemDust({ className, pace = EMBLEM_ROTATE_SPEED }: { className?: string; pace?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = PARTICLE_PALETTE_BARE.dust;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const starSize = new Uint8Array(TOTAL);
    const starColor = new Uint8Array(TOTAL);
    const pos = new Float32Array(TOTAL * 2);
    const vel = new Float32Array(TOTAL * 2);

    let width = 0;
    let height = 0;

    function assignFromWeights(weights: number[], out: Uint8Array) {
      let i = 0;
      weights.forEach((frac, idx) => {
        const count = idx === weights.length - 1 ? TOTAL - i : Math.round(TOTAL * frac);
        for (let n = 0; n < count && i < TOTAL; n++) out[i++] = idx;
      });
    }

    function seed() {
      assignFromWeights(SIZE_WEIGHTS, starSize);
      assignFromWeights(COLOR_WEIGHTS, starColor);
      for (let i = 0; i < TOTAL; i++) {
        const k = i * 2;
        pos[k] = Math.random() * width;
        pos[k + 1] = Math.random() * height;
        const speed = pace * DRIFT_MIN_FACTOR + Math.random() * pace * DRIFT_RANGE_FACTOR;
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
      ctx!.clearRect(0, 0, width, height);
      for (let i = 0; i < TOTAL; i++) {
        const k = i * 2;
        const size = SIZES[starSize[i]!]!;
        ctx!.globalAlpha = SIZE_ALPHA[starSize[i]!]!;
        ctx!.fillStyle = palette[starColor[i]!]!;
        // Round dots, not squares — matches the design's own emblem-scene.js
        // dust (ctx.arc), not EmblemStarfield.tsx's square fillRect this was
        // otherwise ported from.
        ctx!.beginPath();
        ctx!.arc(pos[k]!, pos[k + 1]!, size / 2, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    function tick() {
      for (let i = 0; i < TOTAL; i++) {
        const k = i * 2;
        pos[k]! += vel[k]!;
        pos[k + 1]! += vel[k + 1]!;
        if (pos[k]! < -3) pos[k] = width + 3;
        else if (pos[k]! > width + 3) pos[k] = -3;
        if (pos[k + 1]! < -3) pos[k + 1] = height + 3;
        else if (pos[k + 1]! > height + 3) pos[k + 1] = -3;
      }
      draw();
      if (!reduced) raf = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [pace]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
