// Match plan (v1.3): everything about a match that is fixed *before* the first tick.
//
//   planMatch(manifest, ruleset) is a pure function of (seed, entrants, ruleset). It lays
//   out the map (props, chests, ground weapons and healing items), every hamster's drop
//   point and touch-down tick, the Cat Storm schedule and every supply drop (when, where,
//   what). The simulator only *reads* the plan: a hamster lands exactly on its planned
//   drop point, a crate falls exactly where the plan says. planHash commits to all of it,
//   so anyone holding the seed and the entrant list can rebuild and check the arena
//   before watching a single frame.
//
// Drop points (v1.4): ALWAYS random. Every hamster — demo bot or NFT entrant alike —
// lands on a point drawn from the seed by the spawn sampler ('world/spawn' stream): inside
// the drop circle, clear of props, at least spawnMinGap apart. Nobody can choose or move a
// drop point, and since the seed only exists after entries close, nobody knows them early.
import { FP, HP_SCALE } from './constants.js';
import { generateObstacles, generateChests, generateGroundLoot, generateGroundConsumables, generateSpawns, weightedPick, PERSONALITIES, pickPersonality } from './world.js';
import { buildZoneSchedule, zoneAt } from './zone.js';
import { substream } from './rng.js';
import { flen, clamp, trunc } from './fixed.js';
import { hashObject } from './hash.js';
import { demoDna, traitsOf, dnaName, appearanceOfTraits, combatParams, temperamentOf } from './hamster.js';

export const PLAN_VERSION = 2;          // v2 (v1.4): drop points are always drawn from the seed

/** The radius drop points are drawn inside (centred on the map). */
export const dropRadiusOf = (ruleset) => ruleset.world.spawnRingOuter;

/** Touch-down tick of bot i: a fixed per-id stagger (Knuth hash), no RNG draw. */
export function landTickOf(ruleset, i) {
  const st = ruleset.start || { landBaseTicks: 0, landSpreadTicks: 0 };
  return st.landBaseTicks + (st.landSpreadTicks > 0 ? (Math.imul(i + 1, 2654435761) >>> 0) % st.landSpreadTicks : 0);
}

/** Push a point out of every prop it overlaps (props in index order). */
function pushOut(ruleset, obstacles, x, y, margin) {
  const W = ruleset.world.width, H = ruleset.world.height;
  x = clamp(x, 60, W - 60); y = clamp(y, 60, H - 60);
  for (const o of obstacles) {
    const dx = x - o.x, dy = y - o.y, minD = o.r + margin;
    if (dx * dx + dy * dy >= minD * minD) continue;
    if (dx === 0 && dy === 0) { x = o.x + minD; continue; }
    const dd = flen(dx, dy);
    x = o.x + trunc((dx * minD) / Math.max(1, dd));
    y = o.y + trunc((dy * minD) / Math.max(1, dd));
  }
  return [clamp(x, 60, W - 60), clamp(y, 60, H - 60)];
}

/** Every supply crate of the match: tick, point and contents, drawn up front from 'supply'. */
export function planSupplies(seed, ruleset, zoneSchedule, obstacles) {
  const rng = substream(seed, 'supply');
  const rs = ruleset, list = [];
  for (const t of rs.loot.supplyTicks) {
    const z = zoneAt(zoneSchedule, rs, t + 200);
    for (let n = 0; n < rs.loot.supplyPerDrop; n++) {
      let x = 0, y = 0, ok = false;
      for (let a = 0; a < 200 && !ok; a++) {
        x = z.cx + rng.range(-z.r + 120, z.r - 120);
        y = z.cy + rng.range(-z.r + 120, z.r - 120);
        const dx = x - z.cx, dy = y - z.cy;
        if (dx * dx + dy * dy > (z.r - 100) * (z.r - 100)) continue;
        if (x < 180 || y < 180 || x > rs.world.width - 180 || y > rs.world.height - 180) continue;
        ok = true;
        for (const prev of list) {
          const px2 = prev.x - x, py2 = prev.y - y;
          if (px2 * px2 + py2 * py2 < rs.loot.supplyMinGap * rs.loot.supplyMinGap) { ok = false; break; }
        }
        if (!ok) continue;
        for (const o of obstacles) {
          const ox = o.x - x, oy = o.y - y;
          if (ox * ox + oy * oy < (o.r + 50) * (o.r + 50)) { ok = false; break; }
        }
      }
      if (!ok) { x = z.cx; y = z.cy; }
      [x, y] = pushOut(rs, obstacles, x, y, 6);
      const weapon = weightedPick(rng, rs.loot.supplyTierWeights);
      const cons = rs.loot.supplyConsumableWeights ? weightedPick(rng, rs.loot.supplyConsumableWeights) : -1;
      list.push({ id: list.length, tick: t, x, y, weapon, cons, heal: rs.loot.supplyHeal });
    }
  }
  return list;
}

/** One hamster: genome -> look, stats, match parameters. */
function botOf(ruleset, i, entrant, drop) {
  const t = traitsOf(entrant.dna);
  const p = combatParams(t.stats);
  const temper = temperamentOf(t.dna, ruleset);
  return {
    id: i,
    tokenId: entrant.tokenId ?? null,
    dna: t.dna,
    name: dnaName(t.dna),
    appearance: appearanceOfTraits(t, i),
    equipment: { body: t.body, head: t.head, back: t.back },
    stats: t.stats,
    x: drop[0] * FP, y: drop[1] * FP,
    maxHp: p.maxHpUnits * HP_SCALE,
    moveSpeed: p.moveSpeed, aimSkill: p.aimSkill, dodgeSkill: p.dodgeSkill, awareness: p.awareness,
    armor: p.armor, atkCdMul: p.atkCdMul, strMul: p.strMul,
    ...temper,
    personality: pickPersonality(temper.aggression, temper.caution, temper.lootingBias),
  };
}

/** Build the whole pre-match plan. Pure and deterministic. */
export function planMatch(manifest, ruleset) {
  const seed = manifest.seed, N = manifest.config.botCount;
  const entrants = manifest.entrants
    || Array.from({ length: N }, (_, i) => ({ dna: demoDna(seed, i), tokenId: null }));

  const obstacles = generateObstacles(seed, ruleset);
  // Drop points: entrant i lands on the i-th point of the seeded spawn sampler. Random,
  // unknown until the seed exists, identical for everyone who re-runs the match.
  const drops = generateSpawns(seed, ruleset, N, obstacles).map((p) => [p.x, p.y]);
  const landTicks = entrants.map((_, i) => landTickOf(ruleset, i));
  const bots = entrants.map((e, i) => botOf(ruleset, i, e, drops[i]));

  const spawnPts = drops.map(([x, y]) => ({ x, y }));
  const items = generateGroundLoot(seed, ruleset, obstacles, spawnPts);
  for (const c of generateGroundConsumables(seed, ruleset, obstacles, items.length)) items.push(c);
  const chests = generateChests(seed, ruleset, obstacles);
  const zoneSchedule = buildZoneSchedule(seed, ruleset);
  const supplies = planSupplies(seed, ruleset, zoneSchedule, obstacles);

  const plan = {
    planVersion: PLAN_VERSION,
    obstacles, drops, landTicks, bots, items, chests, zoneSchedule, supplies,
  };
  plan.planHash = hashObject({
    v: PLAN_VERSION,
    obstacles: obstacles.map((o) => [o.x, o.y, o.r, o.kind, o.v ?? 0]),
    drops, landTicks,
    bots: bots.map((b) => [b.dna, b.tokenId, b.maxHp, b.moveSpeed, b.strMul, b.armor, b.aimSkill, b.dodgeSkill, b.awareness, b.atkCdMul, b.aggression, b.caution, b.lootingBias]),
    items: items.map((it) => [it.id, it.weapon, it.cons, it.x, it.y]),
    chests: chests.map((c) => [c.id, c.x, c.y]),
    supplies: supplies.map((c) => [c.id, c.tick, c.x, c.y, c.weapon, c.cons]),
    zone: zoneSchedule,
  });
  return plan;
}

export { PERSONALITIES };
