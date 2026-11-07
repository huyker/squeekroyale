// xoshiro128** — 32-bit-only state and arithmetic, so it is bit-identical in any
// JS engine. Versioned as RNG_ALGORITHM_VERSION; changing it changes the MatchKey.
import { RNG_ALGORITHM_VERSION } from './constants.js';
export { RNG_ALGORITHM_VERSION };

const rotl = (x, k) => (((x << k) | (x >>> (32 - k))) >>> 0);

/** splitmix32 — used only to expand a seed into the four state words. */
function splitmix32(a) {
  return function () {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** FNV-1a over UTF-16 code units — used for domain separation of substreams. */
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed32) {
    const sm = splitmix32(seed32 >>> 0);
    this.s0 = sm(); this.s1 = sm(); this.s2 = sm(); this.s3 = sm();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Next uniform uint32. */
  u32() {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7) >>> 0, 9) >>> 0);
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform integer in [0, n) — rejection sampled, so it is bias-free and stable. */
  below(n) {
    if (n <= 1) return 0;
    const limit = (0x100000000 - (0x100000000 % n)) >>> 0;
    let x = this.u32();
    while (x >= limit && limit !== 0) x = this.u32();
    return x % n;
  }

  /** Uniform integer in [lo, hi] inclusive. */
  range(lo, hi) { return hi <= lo ? lo : lo + this.below(hi - lo + 1); }

  /** True with probability permille/1000. */
  chance(permille) { return this.below(1000) < permille; }

  /** Uniform integer in [lo, hi] with a mild central bias (two draws averaged). */
  rangeMid(lo, hi) {
    if (hi <= lo) return lo;
    const a = this.range(lo, hi), b = this.range(lo, hi);
    return (a + b) >> 1;
  }

  /** Pick an element from a non-empty array. */
  pick(arr) { return arr[this.below(arr.length)]; }
}

/**
 * Independent substream per gameplay domain. A change in one domain (e.g. cosmetics)
 * can never shift the draw sequence of another (combat, loot, ...).
 */
export function substream(seed32, domain) {
  return new Rng((((seed32 >>> 0) ^ fnv1a32('squeek/' + domain)) >>> 0));
}

/** Canonicalise an arbitrary user seed (string or number) to a uint32. */
export function canonicalSeed(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return (input >>> 0);
  const s = String(input == null ? '' : input).trim();
  if (/^\d+$/.test(s)) return (Number(s) >>> 0);
  return fnv1a32(s);
}

/** Frozen test vectors — tests/run-tests.mjs asserts these never drift. */
export const RNG_TEST_VECTORS = {
  seed: 20261105,
  first8: [3820647951, 1285820154, 948867208, 4095131873, 3581117476, 3746497966, 238851704, 139245049],
};
