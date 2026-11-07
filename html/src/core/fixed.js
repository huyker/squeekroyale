// Integer / fixed-point math. Every operation here is exact in IEEE-754 doubles
// (all intermediates stay below 2^53) and therefore bit-identical across engines.
// The core never calls Math.sin/cos/atan2/random — directions are normalised
// integer vectors, so no trig lookup table is needed.
import { FP } from './constants.js';

/** Literal (authoring-time) number -> fixed point. Only used on ruleset constants. */
export const fp = (n) => Math.round(n * FP) | 0;

/** Truncate toward zero — one rounding rule for the whole core. */
export const trunc = (x) => (x < 0 ? -Math.floor(-x) : Math.floor(x));

/** a * b where both are fixed point. */
export function fmul(a, b) { return trunc((a * b) / FP); }

/** a / b where both are fixed point. */
export function fdiv(a, b) { return b === 0 ? 0 : trunc((a * FP) / b); }

/** Integer square root, exact for n < 2^52. */
export function isqrt(n) {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  // Correct the one-ulp cases so the result never depends on sqrt rounding.
  while (r > 0 && r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Length of a fixed-point vector, in fixed point. */
export function flen(dx, dy) { return isqrt(dx * dx + dy * dy); }

/** Squared length (fixed^2) — compare distances without a sqrt. */
export function flen2(dx, dy) { return dx * dx + dy * dy; }

/**
 * Normalise (dx,dy) to a vector of length `scale` (fixed point).
 * The length is computed at 16x precision first: isqrt() floors, and on a short
 * vector that floor would otherwise stretch the result well past `scale`.
 * Returns [x, y]; the zero vector maps to [0, 0].
 */
export function fnorm(dx, dy, scale) {
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return [0, 0];
  const l16 = isqrt(l2 * 256);          // = length * 16
  if (l16 === 0) return [0, 0];
  return [trunc((dx * scale * 16) / l16), trunc((dy * scale * 16) / l16)];
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Linear interpolation on integers, t in [0, den]. */
export function ilerp(a, b, t, den) {
  if (den <= 0) return b;
  const tt = clamp(t, 0, den);
  return a + trunc(((b - a) * tt) / den);
}

/** Dot product of two fixed-point vectors, in fixed point. */
export function fdot(ax, ay, bx, by) { return trunc((ax * bx + ay * by) / FP); }
