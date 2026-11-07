// Deterministic world generation: obstacles, ground loot, spawn points.
import { FP, HP_SCALE } from './constants.js';
import { substream } from './rng.js';
import { flen2 } from './fixed.js';

/** Weighted pick over an integer weight table using one RNG draw. */
export function weightedPick(rng, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return 0;
  let r = rng.below(total);
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
}

/**
 * Obstacle kinds. Every obstacle is a solid circle (x, y, r) to the core; kind and the
 * variant v only pick the art. 0..3 are the small props, 5..6 the big landmarks.
 * Kind 4 (wall) is reserved: the AGY map pack dropped the wall set, so none are generated.
 */
export const OBSTACLE_KIND = { rock: 0, crate: 1, bush: 2, stump: 3, wall: 4, tree: 5, building: 6 };
export const SMALL_KINDS = 4;      // rock, crate, bush, stump
export const PROP_VARIANTS = 10;   // rock_01..10, crate_01..10, ...
export const TREE_VARIANTS = 4;    // green large, autumn large, green medium, autumn medium
export const BUILDING_VARIANTS = 2; // cheese windmill, hamster cottage
export const GROUND_VARIANTS = 10;  // map/ground_*.png, one per match

/**
 * Uniform bucket grid over circles/points: a query only visits nearby cells instead of
 * every obstacle. Pure acceleration — every caller asks the same yes/no question as a
 * full scan would, so generation results are bit-identical.
 */
const BUCKET = 300;
class Buckets {
  constructor() { this.m = new Map(); }
  add(o) {
    const r = o.r || 0;
    const c0 = Math.floor((o.x - r) / BUCKET), c1 = Math.floor((o.x + r) / BUCKET);
    const r0 = Math.floor((o.y - r) / BUCKET), r1 = Math.floor((o.y + r) / BUCKET);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const k = cy * 4096 + cx;
      let a = this.m.get(k);
      if (!a) { a = []; this.m.set(k, a); }
      a.push(o);
    }
    return this;
  }
  /** true if pred(o) holds for any entry whose cells overlap the box (x, y) ± reach. */
  any(x, y, reach, pred) {
    const c0 = Math.floor((x - reach) / BUCKET), c1 = Math.floor((x + reach) / BUCKET);
    const r0 = Math.floor((y - reach) / BUCKET), r1 = Math.floor((y + reach) / BUCKET);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const a = this.m.get(cy * 4096 + cx);
      if (a) for (let i = 0; i < a.length; i++) if (pred(a[i])) return true;
    }
    return false;
  }
}
const bucketsOf = (list) => { const b = new Buckets(); for (const o of list) b.add(o); return b; };
/** Same test as clearOf(list, x, y, r, gap) for a pre-bucketed list. */
/** Inside the round arena (the zone's first circle, minus a margin)? Corners are Cat Storm. */
const inArena = (ruleset, x, y) => {
  const R = ruleset.zone.lootRadius || ruleset.zone.startRadius || 1e9;
  const dx = x - (ruleset.world.width >> 1), dy = y - (ruleset.world.height >> 1);
  return dx * dx + dy * dy <= R * R;
};
const clearOfB = (b, x, y, r, gap) => !b.any(x, y, r + gap, (o) => {
  const dx = o.x - x, dy = o.y - y, m = o.r + r + gap;
  return dx * dx + dy * dy < m * m;
});

function clearOf(list, x, y, r, gap) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    const dx = o.x - x, dy = o.y - y, m = o.r + r + gap;
    if (dx * dx + dy * dy < m * m) return false;
  }
  return true;
}

/**
 * Big landmarks: buildings first (they need the most room), then trees. A tree's circle
 * is its trunk; the canopy is art only. Own RNG stream, generated before the small props.
 */
export function generateLandmarks(seed, ruleset) {
  const L = ruleset.world.landmarks;
  if (!L) return [];
  const rng = substream(seed, 'world/landmarks');
  const { width, height, obstacleMinGap } = ruleset.world;
  const list = [];
  const place = (count, minR, maxR, kind, variants, margin) => {
    let placed = 0, guard = 0;
    while (placed < count && guard++ < count * 300) {
      const x = rng.range(margin, width - margin);
      const y = rng.range(margin, height - margin);
      const r = rng.rangeMid(minR, maxR);
      const v = rng.below(variants);
      if (!clearOf(list, x, y, r, Math.max(obstacleMinGap, L.minGap))) continue;
      list.push({ id: list.length, x, y, r, kind, v });
      placed++;
    }
  };
  place(L.buildings, L.buildingMinR, L.buildingMaxR, OBSTACLE_KIND.building, BUILDING_VARIANTS, 400);
  place(L.trees, L.treeMinR, L.treeMaxR, OBSTACLE_KIND.tree, TREE_VARIANTS, 250);
  return list;
}

/** Small props (rock, crate, bush, stump, wall), kept clear of the landmarks and of each other. */
export function generateObstacles(seed, ruleset, landmarks = generateLandmarks(seed, ruleset)) {
  const rng = substream(seed, 'world/obstacles');
  const { width, height, obstacleCount, obstacleMinR, obstacleMaxR, obstacleMinGap } = ruleset.world;
  const list = landmarks.map((o) => ({ ...o }));
  const target = list.length + obstacleCount;
  const margin = 170;
  let guard = 0;
  while (list.length < target && guard++ < obstacleCount * 220) {
    const x = rng.range(margin, width - margin);
    const y = rng.range(margin, height - margin);
    const r = rng.rangeMid(obstacleMinR, obstacleMaxR);
    const kind = rng.below(SMALL_KINDS);
    const v = rng.below(PROP_VARIANTS);
    if (clearOf(list, x, y, r, obstacleMinGap)) list.push({ id: list.length, x, y, r, kind, v });
  }
  return list;
}

/**
 * Walk-through ground decoration: shallow ponds (with water lilies, some with a wooden
 * bridge) and flower patches. Cosmetic only — never read by the simulation, own stream,
 * so it can change freely without moving anything that matters.
 */
export const DECOR = { ponds: 22, pondMinR: 120, pondMaxR: 200, flowers: 300 };
export function generateDecor(seed, ruleset, obstacles) {
  const rng = substream(seed, 'world/decor');
  const { width, height } = ruleset.world;
  const ground = rng.below(GROUND_VARIANTS);           // which ground texture this match uses
  const ponds = [];
  let guard = 0;
  while (ponds.length < DECOR.ponds && guard++ < DECOR.ponds * 300) {
    const rx = rng.rangeMid(DECOR.pondMinR, DECOR.pondMaxR);
    const ry = (rx * rng.range(48, 66) / 100) | 0;
    const x = rng.range(400, width - 400), y = rng.range(400, height - 400);
    const lilies = [];
    const nl = 2 + rng.below(3);
    for (let k = 0; k < nl; k++) lilies.push({ dx: rng.range(-60, 60) * rx / 100 | 0, dy: rng.range(-45, 45) * ry / 100 | 0, s: rng.range(60, 85) });
    const bridge = rng.below(100) < 45;
    if (!clearOf(obstacles, x, y, rx, 40) || !clearOf(ponds.map((p) => ({ x: p.x, y: p.y, r: p.rx })), x, y, rx, 300)) continue;
    ponds.push({ x, y, rx, ry, lilies, bridge });
  }
  const flowers = [];
  const obsB = bucketsOf(obstacles);
  guard = 0;
  while (flowers.length < DECOR.flowers && guard++ < DECOR.flowers * 50) {
    const x = rng.range(150, width - 150), y = rng.range(150, height - 150);
    const s = rng.range(55, 80);
    if (!clearOfB(obsB, x, y, 30, 10)) continue;
    let wet = false;
    for (const p of ponds) {
      const dx = (x - p.x) / (p.rx + 40), dy = (y - p.y) / (p.ry + 40);
      if (dx * dx + dy * dy < 1) { wet = true; break; }
    }
    if (!wet) flowers.push({ x, y, s });
  }
  return { ground, ponds, flowers };
}

export function generateGroundLoot(seed, ruleset, obstacles, spawns = []) {
  const rng = substream(seed, 'world/loot');
  const { width, height } = ruleset.world;
  const n = ruleset.loot.groundWeapons;
  const items = [];
  const obsB = bucketsOf(obstacles), spawnB = bucketsOf(spawns);
  const clearR = Math.max(ruleset.bot.pickupRadius + 36, ruleset.loot.spawnClearRadius || 0);
  let guard = 0;
  while (items.length < n && guard++ < n * 220) {
    const x = rng.range(200, width - 200);
    const y = rng.range(200, height - 200);
    if (!inArena(ruleset, x, y) || !clearOfB(obsB, x, y, 38, 0)) continue;
    let ok = true;
    // Keep loot clear of spawn points: every bot must start the match empty-handed.
    if (spawnB.any(x, y, clearR, (p) => { const dx = p.x - x, dy = p.y - y; return dx * dx + dy * dy < clearR * clearR; })) continue;
    const w = weightedPick(rng, ruleset.loot.tierWeights);
    items.push({ id: items.length, weapon: w, cons: -1, x, y, taken: false, fromSupply: false });
  }
  return items;
}

/**
 * Healing consumables on the ground. Separate RNG stream ('world/consumables') so adding
 * them never moves a weapon. Appended after the weapons, continuing the item id sequence.
 */
export function generateGroundConsumables(seed, ruleset, obstacles, firstId) {
  const rng = substream(seed, 'world/consumables');
  const { width, height } = ruleset.world;
  const n = ruleset.loot.groundConsumables || 0;
  const items = [];
  const obsB = bucketsOf(obstacles);
  let guard = 0;
  while (items.length < n && guard++ < n * 220) {
    const x = rng.range(200, width - 200);
    const y = rng.range(200, height - 200);
    if (!inArena(ruleset, x, y) || !clearOfB(obsB, x, y, 38, 0)) continue;
    let ok = true;
    const c = weightedPick(rng, ruleset.loot.consumableWeights);
    items.push({ id: firstId + items.length, weapon: -1, cons: c, x, y, taken: false, fromSupply: false });
  }
  return items;
}

/** Treasure chests (cheese inside). Clear of props and of each other. */
export function generateChests(seed, ruleset, obstacles) {
  const rng = substream(seed, 'world/chests');
  const { width, height } = ruleset.world;
  const n = ruleset.loot.chests || 0;
  const list = [];
  const obsB = bucketsOf(obstacles);
  let guard = 0;
  while (list.length < n && guard++ < n * 300) {
    const x = rng.range(300, width - 300), y = rng.range(300, height - 300);
    if (!inArena(ruleset, x, y) || !clearOfB(obsB, x, y, 30, 40)) continue;
    if (!clearOf(list.map((c) => ({ x: c.x, y: c.y, r: 0 })), x, y, 0, 500)) continue;
    list.push({ id: list.length, x, y, opened: false });
  }
  return list;
}

export function generateSpawns(seed, ruleset, botCount, obstacles) {
  const rng = substream(seed, 'world/spawn');
  const { width, height, spawnRingInner, spawnRingOuter, spawnMinGap } = ruleset.world;
  const cx = width >> 1, cy = height >> 1;
  const pts = [];
  const obsB = bucketsOf(obstacles), ptsB = new Buckets();
  let guard = 0;
  while (pts.length < botCount && guard++ < botCount * 500) {
    // Rejection sampling inside an annulus — no trig, fully integral.
    const x = cx + rng.range(-spawnRingOuter, spawnRingOuter);
    const y = cy + rng.range(-spawnRingOuter, spawnRingOuter);
    const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d2 < spawnRingInner * spawnRingInner || d2 > spawnRingOuter * spawnRingOuter) continue;
    if (x < 120 || y < 120 || x > width - 120 || y > height - 120) continue;
    if (!clearOfB(obsB, x, y, 34, 0)) continue;
    if (ptsB.any(x, y, spawnMinGap, (p) => flen2(p.x - x, p.y - y) < spawnMinGap * spawnMinGap)) continue;
    const p = { x, y };
    pts.push(p);
    ptsB.add(p);
  }
  // Deterministic fallback grid if rejection sampling ran out of attempts.
  let k = 0;
  while (pts.length < botCount) {
    const col = k % 40, row = (k / 40) | 0;
    pts.push({ x: cx - 1000 + col * 50, y: cy - 1000 + row * 50 });
    k++;
  }
  return pts;
}

const PERSONALITIES = ['Berserker', 'Hunter', 'Scavenger', 'Tactician', 'Survivor'];
export function pickPersonality(aggression, caution, lootingBias) {
  if (aggression > 760) return PERSONALITIES[0];
  if (aggression > 560 && caution < 520) return PERSONALITIES[1];
  if (lootingBias > 720) return PERSONALITIES[2];
  if (caution > 680) return PERSONALITIES[4];
  return PERSONALITIES[3];
}
export { PERSONALITIES };
