/* 像素工具：Bayer 4×4 有序抖动 */

export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** 亮度 (0..1) + 抖动 → 是否点亮（两级：全亮 / 暗亮） */
export function dither(level: number, x: number, y: number): 0 | 1 | 2 {
  const t = BAYER4[y & 3][x & 3] / 16;
  if (level > t + 0.5) return 1;        // 全亮
  if (level > t * 0.55) return 2;       // 暗亮（半调）
  return 0;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
