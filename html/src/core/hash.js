// Canonical serialisation + FNV-1a 64 over 32-bit lanes. Used for rulesetHash,
// manifest hash, resultHash and replayHash.

const OFF_HI = 0xcbf29ce4, OFF_LO = 0x84222325;
const PRIME_HI = 0x00000100, PRIME_LO = 0x000001b3;

function mulStep(hi, lo) {
  // (hi:lo) * (PRIME_HI:PRIME_LO) mod 2^64, with exact 16-bit limb carries.
  const l0 = lo & 0xffff, l1 = lo >>> 16;
  const p0 = PRIME_LO & 0xffff, p1 = PRIME_LO >>> 16;
  let c = l0 * p0;
  const r0 = c & 0xffff; c = (c >>> 16) + l0 * p1;
  let r1 = c & 0xffff; let carry = Math.floor(c / 0x10000);
  c = r1 + l1 * p0; r1 = c & 0xffff; carry += Math.floor(c / 0x10000);
  const newLo = ((r1 << 16) | r0) >>> 0;
  const hiFromLo = (carry + l1 * p1) >>> 0;
  const newHi = (Math.imul(hi, PRIME_LO) + Math.imul(lo, PRIME_HI) + hiFromLo) >>> 0;
  return [newHi, newLo];
}

export class Fnv64 {
  constructor() { this.hi = OFF_HI; this.lo = OFF_LO; }
  byte(b) {
    this.lo = (this.lo ^ (b & 0xff)) >>> 0;
    const [h, l] = mulStep(this.hi, this.lo);
    this.hi = h; this.lo = l;
    return this;
  }
  str(s) { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); this.byte(c & 0xff); this.byte(c >>> 8); } return this; }
  int32(v) { this.byte(v & 0xff).byte((v >>> 8) & 0xff).byte((v >>> 16) & 0xff).byte((v >>> 24) & 0xff); return this; }
  i32array(a) { for (let i = 0; i < a.length; i++) this.int32(a[i] | 0); return this; }
  hex() { return (this.hi >>> 0).toString(16).padStart(8, '0') + (this.lo >>> 0).toString(16).padStart(8, '0'); }
}

export function hashString(s) { return new Fnv64().str(s).hex(); }

/** Deterministic JSON: object keys sorted, no whitespace, integers only for core data. */
export function canonicalJson(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: non-finite number');
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

export function hashObject(obj) { return hashString(canonicalJson(obj)); }
