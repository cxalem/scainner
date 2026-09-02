import { useEffect, useRef } from "react";
import { PARTICLE_PALETTE, PARTICLE_PALETTE_LIGHT } from "@/theme";

const COLOR_WEIGHTS = [0.3, 0.4, 0.3];
const SIZE_WEIGHTS = [0.62, 0.24, 0.09, 0.05];
const SIZES = [1, 1.6, 2.3, 3];
const SIZE_ALPHA_DARK = [0.4, 0.65, 0.85, 0.95];
const SIZE_ALPHA_LIGHT = [0.25, 0.4, 0.55, 0.7];

export function EmblemStarfield({
  total = 70,
  tone = "dark",
  fill = true,
}: {
  total?: number;
  tone?: "dark" | "light";
  fill?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const palette = tone === "light" ? PARTICLE_PALETTE_LIGHT : PARTICLE_PALETTE;
    const PALETTE = palette.dust;
    const SIZE_ALPHA = tone === "light" ? SIZE_ALPHA_LIGHT : SIZE_ALPHA_DARK;

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
      if (fill) {
        const g = ctx!.createLinearGradient(0, 0, width, height);
        g.addColorStop(0, palette.backgroundGradient[0]);
        g.addColorStop(1, palette.backgroundGradient[1]);
        ctx!.fillStyle = g;
        ctx!.fillRect(0, 0, width, height);
      } else {
        ctx!.clearRect(0, 0, width, height);
      }

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

    tick();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [total, tone, fill]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
