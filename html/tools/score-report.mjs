#!/usr/bin/env node
// Score calibration: how much is one kill point worth in live points (K = killValueLP)?
// For each candidate K the AI also plays by that K (it drives the fight/flee trade-off),
// so every row is a real population of hamsters optimising that score.
//
//   node tools/score-report.mjs [--seeds 12] [--bots 100] [--k 0,30,60,90,120,180]
import { buildManifest } from '../src/core/manifest.js';
import { simulate } from '../src/core/simulator.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const seeds = Array.from({ length: Number(arg('seeds', 12)) }, (_, k) => (k === 0 ? '20261105' : `score${k}`));
const bots = Number(arg('bots', 100));
const ks = arg('k', '0,30,60,90,120,180').split(',').map(Number);

/** Spearman rank correlation of two equal-length arrays. */
function spearman(a, b) {
  const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const ra = rank(a), rb = rank(b), n = a.length, ma = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - ma); da += (ra[i] - ma) ** 2; db += (rb[i] - ma) ** 2; }
  return num / Math.sqrt(da * db);
}

console.log(`${seeds.length} seeds x ${bots} bots per K\n`);
console.log('    K | match s | LP total | KP total | balance K* | kill share | winner=top score | top score: kills / alive s | corr(score,survival) | corr(score,kills)');
for (const K of ks) {
  let dur = 0, lp = 0, kp = 0, winTop = 0, topKills = 0, topAlive = 0, cs = 0, ck = 0;
  for (const seed of seeds) {
    const { manifest, ruleset } = buildManifest({ seed, botCount: bots });
    ruleset.score = { ...ruleset.score, killValueLP: K };
    const r = simulate(manifest, ruleset);
    const st = r.result.standings;
    dur += r.result.endTick / 20;
    for (const s of st) { lp += s.livePoints; kp += s.killPoints; }
    const score = (s) => s.livePoints + K * s.killPoints;
    const top = [...st].sort((a, b) => score(b) - score(a) || a.botId - b.botId)[0];
    if (top.botId === r.result.winnerId) winTop++;
    topKills += top.kills;
    topAlive += (top.deathTick >= 0 ? top.deathTick : r.result.endTick) / 20;
    const survival = st.map((s) => (s.deathTick >= 0 ? s.deathTick : r.result.endTick));
    cs += spearman(st.map(score), survival);
    ck += spearman(st.map(score), st.map((s) => s.kills));
  }
  const n = seeds.length;
  const share = (K * kp) / Math.max(1, lp + K * kp);
  console.log(`${String(K).padStart(5)} | ${(dur / n).toFixed(0).padStart(7)} | ${(lp / n).toFixed(0).padStart(8)} | ${(kp / n).toFixed(0).padStart(8)} | ${(lp / Math.max(1, kp)).toFixed(0).padStart(10)} | ${(share * 100).toFixed(0).padStart(9)}% | ${((winTop * 100) / n).toFixed(0).padStart(15)}% | ${(topKills / n).toFixed(1).padStart(10)} / ${(topAlive / n).toFixed(0).padStart(4)} | ${(cs / n).toFixed(2).padStart(20)} | ${(ck / n).toFixed(2).padStart(17)}`);
}
console.log('\nbalance K* = total live points / total kill points: the K at which the whole field earns as');
console.log('much from kills as from staying alive.');
