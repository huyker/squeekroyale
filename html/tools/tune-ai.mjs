#!/usr/bin/env node
// Reward-driven AI tuning. Reward = the match score every hamster plays for:
//   live points (1/s, x2 with the Crown) + K x kill points (crown kills x2).
//
// A candidate rule set is only "better" if hamsters using it out-score hamsters using
// the current one *in the same match* (half the bots each, groups swapped seed by seed so
// bot ids/spawns cancel out). With one shared rule set the field's total is fixed, so a
// head-to-head is the only honest test. Coordinate ascent over the AI knobs; a change is
// kept only when its gain is positive and beyond 2 standard errors across seeds.
//
//   node tools/tune-ai.mjs [--seeds 8] [--bots 100] [--rounds 2] [--preset standard]
// Prints the winning ai block; copy the changed numbers into src/core/ruleset.js.
import { buildManifest } from '../src/core/manifest.js';
import { Sim } from '../src/core/simulator.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SEEDS = Array.from({ length: Number(arg('seeds', 8)) }, (_, k) => `tune${k}`);
const BOTS = Number(arg('bots', 100));
const ROUNDS = Number(arg('rounds', 2));
const PRESET = arg('preset', 'standard');

/** Knobs and the values tried for each (the current value is always the reference). */
export const SPACE = {
  evWeight: [10, 20, 30, 45, 60],
  lifeValuePermille: [250, 350, 450, 600, 800],
  contactBonus: [10, 20, 30, 45],
  ksBonus: [20, 45, 70],
  leaderBonus: [10, 35, 60],
  fleeVsChaserPermille: [400, 460, 520, 600],
  fleeHpPermille: [480, 560, 620, 720],
  preyWinProbPermille: [560, 620, 700],
  engageRange: [330, 430, 530],
  lootPhaseAttackPenalty: [0, 20, 40, 60],
  stickiness: [25, 40, 55],
  kiteFirePermille: [760, 860, 940],
  kiteRetreatPermille: [880, 960, 1000],
};

/** Mean score of each group in one match: group 0 plays `cand`, group 1 plays `base`. */
export function headToHead(seed, base, cand, swap, presetId = PRESET, bots = BOTS) {
  const { manifest, ruleset } = buildManifest({ seed, botCount: bots, presetId });
  const sim = new Sim(manifest, ruleset);
  sim.aiSets = [cand, base];
  sim.aiGroup = new Int8Array(sim.N);
  for (let i = 0; i < sim.N; i++) sim.aiGroup[i] = (i + (swap ? 1 : 0)) & 1;
  const limit = ruleset.zone.hardLimitTicks + 200;
  while (!sim.ended && sim.tick < limit) sim.step();
  const sum = [0, 0], cnt = [0, 0];
  for (let i = 0; i < sim.N; i++) { const g = sim.aiGroup[i]; sum[g] += sim.scoreOf(i).score; cnt[g]++; }
  return { cand: sum[0] / cnt[0], base: sum[1] / cnt[1] };
}

/** Relative gain of cand over base: mean and standard error of per-match (cand-base)/base. */
export function evaluate(base, cand, seeds = SEEDS) {
  const d = [];
  seeds.forEach((seed, k) => { const r = headToHead(seed, base, cand, k & 1); d.push((r.cand - r.base) / Math.max(1, r.base)); });
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, d.length - 1));
  return { gain: m, se: sd / Math.sqrt(d.length) };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/tune-ai.mjs');
if (isMain) {
  const { ruleset } = buildManifest({ seed: 'x', botCount: BOTS, presetId: PRESET });
  let best = { ...ruleset.ai };
  const start = { ...best };
  const t0 = Date.now();
  console.log(`tuning ${Object.keys(SPACE).length} knobs · ${SEEDS.length} head-to-head matches per trial · ${BOTS} bots · ${PRESET}\n`);
  for (let round = 1; round <= ROUNDS; round++) {
    let changed = 0;
    for (const [key, values] of Object.entries(SPACE)) {
      let pick = null;
      for (const v of values) {
        if (v === best[key]) continue;
        const cand = { ...best, [key]: v };
        const e = evaluate(best, cand);
        const ok = e.gain > 0 && e.gain > 2 * e.se;
        console.log(`  r${round} ${key.padEnd(24)} ${String(best[key]).padStart(5)} -> ${String(v).padStart(5)}  gain ${(e.gain * 100).toFixed(1).padStart(6)}% ± ${(e.se * 100).toFixed(1)}%${ok ? '  *' : ''}`);
        if (ok && (!pick || e.gain > pick.gain)) pick = { v, gain: e.gain };
      }
      if (pick) { best = { ...best, [key]: pick.v }; changed++; console.log(`     => ${key} = ${pick.v}`); }
    }
    console.log(`round ${round}: ${changed} change(s)\n`);
    if (!changed) break;
  }
  const final = evaluate(start, best, SEEDS.map((s) => s + 'v'));
  console.log(`tuned vs start on fresh seeds: ${(final.gain * 100).toFixed(1)}% ± ${(final.se * 100).toFixed(1)}%  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log('changed knobs:');
  for (const k of Object.keys(SPACE)) if (best[k] !== start[k]) console.log(`  ${k}: ${start[k]} -> ${best[k]}`);
}
