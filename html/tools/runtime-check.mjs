#!/usr/bin/env node
// Runtime liveness check: steps real matches tick by tick and flags every hamster that
// stops making progress while alive. Used by tests/run-tests.mjs and runnable alone:
//   node tools/runtime-check.mjs [--seeds 40] [--bots 2,3,8,30,100,200] [--presets standard,brawler,sniper] [--verbose]
//
// A "stall" = an alive, un-stunned bot that for STALL_TICKS in a row
//   - stays within STALL_RADIUS of where the window started, AND
//   - starts no attack, picks nothing up, opens no crate and drinks nothing.
// Standing still while legitimately busy (winding up, swinging, opening a crate) is not a stall.
import { pathToFileURL } from 'node:url';
import { buildManifest } from '../src/core/manifest.js';
import { Sim } from '../src/core/simulator.js';
import { EV, FP, ACTIONS } from '../src/core/constants.js';

export const STALL_TICKS = 60;      // 3 s at 20 Hz
export const STALL_RADIUS = 14;     // world units

const ACTIVE_EVENTS = new Set([EV.ATTACK, EV.PICKUP, EV.SUPPLY_OPEN, EV.HEAL ?? -1, EV.CONSUMABLE_PICKUP ?? -1, EV.CHEST_OPEN ?? -1]);

/**
 * Run one match with liveness instrumentation. Returns
 * { ended, endReason, endTick, winnerId, stalls: [...], stallTicks, aliveTicks, error }.
 */
export function checkMatch({ seed, botCount, presetId = 'standard', maxStallsKept = 20 }) {
  // Off-menu bot counts (2, 3, 8 ...) are not selectable in the UI, but the endgame logic
  // must survive them, so the manifest is built at 100 and the count overridden.
  const { manifest, ruleset } = buildManifest({ seed: String(seed), botCount, presetId });
  if (manifest.config.botCount !== botCount) manifest.config = { ...manifest.config, botCount };
  const sim = new Sim(manifest, ruleset);
  const N = sim.N;
  const ax = new Int32Array(N), ay = new Int32Array(N), at = new Int32Array(N);
  for (let i = 0; i < N; i++) { ax[i] = sim.px[i] / FP | 0; ay[i] = sim.py[i] / FP | 0; at[i] = 0; }
  const stalls = [];
  let stallCount = 0, stallTicks = 0, aliveTicks = 0, evCursor = sim.recorder.events.length;
  const limit = ruleset.zone.hardLimitTicks + 200;
  const r2 = STALL_RADIUS * STALL_RADIUS;
  let error = null;
  try {
    while (!sim.ended && sim.tick < limit) {
      sim.step();
      const t = sim.tick - 1;
      const evs = sim.recorder.events;
      for (; evCursor < evs.length; evCursor++) {
        const ev = evs[evCursor];
        if (ACTIVE_EVENTS.has(ev.type) && ev.a >= 0 && ev.a < N) at[ev.a] = t;
      }
      for (let i = 0; i < N; i++) {
        if (!sim.alive[i]) continue;
        aliveTicks++;
        const x = sim.px[i] / FP | 0, y = sim.py[i] / FP | 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bot ${i} has non-finite position at tick ${t}`);
        const busy = sim.stun[i] > 0 || sim.windup[i] > 0 || sim.openingSupply[i] >= 0 || t < sim.landTick[i];
        const dx = x - ax[i], dy = y - ay[i];
        if (busy || dx * dx + dy * dy > r2) { ax[i] = x; ay[i] = y; at[i] = t; continue; }
        if (t - at[i] >= STALL_TICKS) {
          stallCount++;
          stallTicks += STALL_TICKS;
          if (stalls.length < maxStallsKept) stalls.push(describe(sim, i, t));
          at[i] = t; ax[i] = x; ay[i] = y;
        }
      }
    }
  } catch (e) { error = e.message || String(e); }
  return {
    seed: String(seed), botCount, presetId,
    ended: sim.ended, endReason: sim.endReason, endTick: sim.endTick ?? sim.tick, winnerId: sim.winnerId,
    stallCount, stalls, stallTicks, aliveTicks, error,
  };
}

function describe(sim, i, t) {
  const x = sim.px[i] / FP | 0, y = sim.py[i] / FP | 0;
  let nearObs = null, nd = Infinity;
  for (const o of sim.obstacles) {
    const d = Math.hypot(o.x - x, o.y - y) - o.r;
    if (d < nd) { nd = d; nearObs = o; }
  }
  const a = sim.action[i];
  let goal = null;
  if (a === 3 && sim.lootTarget[i] >= 0) { const it = sim.items[sim.lootTarget[i]]; goal = { x: it.x, y: it.y }; }
  else if (a === 4 && sim.supplyTarget[i] >= 0) { const s = sim.supplies[sim.supplyTarget[i]]; goal = { x: s.x, y: s.y }; }
  else if (sim.target[i] >= 0) goal = { x: sim.px[sim.target[i]] / FP | 0, y: sim.py[sim.target[i]] / FP | 0, bot: sim.target[i] };
  else if (a === 0) goal = { x: sim.zoneSoon.cx, y: sim.zoneSoon.cy, zone: true };
  else if (a === 6) goal = { x: sim.roamX[i], y: sim.roamY[i] };
  return {
    tick: t, bot: i, action: ACTIONS[a], x, y, hp: sim.hp[i], weapon: sim.weapon[i],
    goal, goalDist: goal ? Math.round(Math.hypot(goal.x - x, goal.y - y)) : null,
    obstacleGap: Math.round(nd), obstacle: nearObs ? { x: nearObs.x, y: nearObs.y, r: nearObs.r } : null,
    alive: sim.aliveCount,
  };
}

/** The full matrix used by `npm run runtime` and the test-suite. */
export function runMatrix({ seeds, botCounts, presets, onResult }) {
  const out = [];
  for (const presetId of presets) {
    for (const botCount of botCounts) {
      for (const seed of seeds) {
        const r = checkMatch({ seed, botCount, presetId });
        out.push(r);
        if (onResult) onResult(r);
      }
    }
  }
  return out;
}

export function defaultSeeds(n) {
  const named = ['20261105', 'alpha', 'bravo', 'charlie', '42', '777', '9001', 'squeek', 'hamster', 'crown', '0', '4294967295'];
  const out = named.slice(0, n);
  for (let k = out.length; k < n; k++) out.push(`rt-${k * 7919}`);
  return out;
}

// ------------------------------------------------------------------ CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const argv = process.argv.slice(2);
  const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const seeds = defaultSeeds(Number(arg('seeds', '12')));
  const botCounts = arg('bots', '2,3,8,30,100,200').split(',').map(Number);
  const presets = arg('presets', 'standard,brawler,sniper').split(',');
  const verbose = argv.includes('--verbose');
  const t0 = Date.now();
  let matches = 0, bad = 0, totalStalls = 0, totalStallTicks = 0, totalAlive = 0;
  const byAction = {};
  const worst = [];
  runMatrix({ seeds, botCounts, presets, onResult: (r) => {
    matches++;
    totalStalls += r.stallCount; totalStallTicks += r.stallTicks; totalAlive += r.aliveTicks;
    for (const s of r.stalls) byAction[s.action] = (byAction[s.action] || 0) + 1;
    const ok = r.ended && !r.error && r.winnerId >= 0 && r.stallCount === 0;
    if (!ok) { bad++; worst.push(r); }
    if (verbose || !ok) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.presetId.padEnd(8)} bots ${String(r.botCount).padStart(3)} seed ${r.seed.padEnd(12)} ` +
        `end ${String(r.endTick).padStart(5)} ${r.endReason.padEnd(26)} stalls ${r.stallCount}${r.error ? ' ERROR ' + r.error : ''}`);
      if (!ok && verbose) for (const s of r.stalls.slice(0, 3)) console.log('       ', JSON.stringify(s));
    }
  } });
  console.log('');
  console.log(`matches ${matches} · failing ${bad} · stall incidents ${totalStalls} · stalled share ${(100 * totalStallTicks / Math.max(1, totalAlive)).toFixed(3)}% of alive bot-ticks · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (Object.keys(byAction).length) console.log('stalls by action (sampled):', JSON.stringify(byAction));
  process.exit(bad === 0 ? 0 : 1);
}
