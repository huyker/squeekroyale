#!/usr/bin/env node
// Separates (a) pure simulator time from (b) replay size, per whitepaper §9.
import { buildManifest } from '../src/core/manifest.js';
import { simulate } from '../src/core/simulator.js';

const counts = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = counts.length ? counts : [50, 100, 200, 500, 1000];
const seeds = ['20261105', 'alpha', 'bravo'];

console.log('bots   seeds  sim avg     sim max     match avg   events avg  snapshots  replay MB');
for (const botCount of sizes) {
  const times = [], durations = [], events = [], snaps = [], bytes = [];
  for (const seed of seeds) {
    const { manifest, ruleset } = buildManifest({ seed, botCount, recordDecisions: botCount <= 200 });
    const t0 = process.hrtime.bigint();
    const r = simulate(manifest, ruleset);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    durations.push(r.result.durationSeconds);
    events.push(r.events.length);
    snaps.push(r.snapshots.length);
    let b = r.snapshots.reduce((s, x) => s + x.byteLength, 0)
          + r.projFrames.reduce((s, x) => s + x.byteLength, 0)
          + [...new Set(r.lootFrames)].reduce((s, x) => s + x.byteLength, 0)   // unchanged frames are shared
          + (r.decisions ? r.decisions.byteLength : 0)
          + r.events.length * 56;
    bytes.push(b);
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(
    String(botCount).padEnd(6),
    String(seeds.length).padEnd(6),
    (avg(times).toFixed(0) + ' ms').padEnd(11),
    (Math.max(...times).toFixed(0) + ' ms').padEnd(11),
    (avg(durations).toFixed(0) + ' s').padEnd(11),
    String(Math.round(avg(events))).padEnd(11),
    String(Math.round(avg(snaps))).padEnd(10),
    (avg(bytes) / 1048576).toFixed(1));
}
console.log('\nMeasured on this machine only — these are observations, not performance commitments.');
