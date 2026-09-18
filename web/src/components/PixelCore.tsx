import { useEffect, useRef } from "react";
import { BAYER4, clamp } from "../pixel";

/**
 * PixelCore — 原创像素化核心体。
 * canvas 上以 4×4 Bayer 有序抖动渲染一颗"呼吸的球体"：
 * 亮度 = 球面着色 × 呼吸脉冲 × 缓动噪声，阈值化为三级像素（全亮/暗亮/熄灭）。
 * progress (0..1) 由滚动驱动：控制半径、分裂与消散。
 */
export default function PixelCore({
  size = 520, progress = 0, animate = true, className = "",
}: { size?: number; progress?: number; animate?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const prog = useRef(progress);
  prog.current = progress;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    ctx.scale(dpr, dpr);

    const CELL = 7;
    const N = Math.floor(size / CELL);
    const cx = size / 2, cy = size / 2;

    let raf = 0;
    const draw = (t: number) => {
      const p = prog.current;                       // 滚动进度
      const R = size * 0.40 * (1 - p * 0.45);       // 渐缩
      const breathe = 1 + 0.035 * Math.sin(t / 1400);
      const drift = Math.sin(t / 2600) * size * 0.02 * (0.3 + p);
      ctx.clearRect(0, 0, size, size);
      const fade = clamp(1 - p * 0.9, 0.08, 1);

      for (let gy = 0; gy < N; gy++) {
        for (let gx = 0; gx < N; gx++) {
          const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
          const dx = x - cx - drift, dy = y - cy;
          const dist = Math.hypot(dx, dy);
          if (dist > R) continue;
          // 球面法线 → 光照
          const nz = Math.sqrt(Math.max(0, 1 - (dist / R) ** 2));
          const light = clamp(nz * 0.9 + 0.12 + 0.08 * Math.sin(t / 900 + gx * 0.35 + gy * 0.2), 0, 1);
          const level = light * breathe * fade;
          const b = BAYER4[gy & 3][gx & 3] / 16;
          const s = CELL - 1.5;
          if (level > b + 0.52) {
            ctx.fillStyle = `rgba(255,255,255,${0.92 * fade + 0.08})`;
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          } else if (level > b * 0.62) {
            ctx.fillStyle = `rgba(255,255,255,${0.34 * fade})`;
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          } else if (level > b * 0.34 && (gx + gy) % 2 === 0) {
            ctx.fillStyle = `rgba(255,255,255,${0.13 * fade})`;
            ctx.fillRect(x - s / 2, y - s / 2, s * 0.6, s * 0.6);
          }
        }
      }
      if (animate) raf = requestAnimationFrame(draw);
    };

    if (animate) raf = requestAnimationFrame(draw);
    else draw(0);
    return () => cancelAnimationFrame(raf);
  }, [size, animate]);

  return <canvas ref={ref} className={className} style={{ width: size, height: size }} aria-hidden="true" />;
}
