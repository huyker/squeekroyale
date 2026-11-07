#!/usr/bin/env node
// Combat engagement check: finds "passive contacts" — two living hamsters standing or
// walking within touching distance of each other for 1s+ while neither of them fights
// anybody (no attack started, no hit taken).
// That is the "full-HP heroes walk through each other without a fight" symptom.
//
//   node tools/combat-check.mjs [--seeds 6] [--bots 100] [--presets standard,brawler,sniper] [--verbose]
import { buildManifest } from '../src/core/manifest.js';
import { Sim } from '../src/core/simulator.js';
import { EV, FP, ACTIONS, ACT_ATTACK, ACT_HUNT } from '../src/core/constants.js';

export const CONTACT_RANGE = 110;   // u, a little under two sprite widths
export const CONTACT_TICKS = 20;    // 1 s in contact without a single swing or shot

/**
 * Run one match and classify every contact episode. Returns totals plus a few samples.
 * Engaged = either side started an ATTACK on the other, or hit the other, during the episode.
 */
export function checkCombat({ seed, botCount = 100, presetId = 'standard', samples = 6 }) {
  const { manifest, ruleset } = buildManifest({ seed: String(seed), botCount, presetId });
  if (manifest.config.botCount !== botCount) manifest.config = { ...manifest.config, botCount };
  const sim = new Sim(manifest, ruleset);
  const N = sim.N;
  const open = new Map();          // key i*N+j (i<j) -> { start, engaged, a0, b0 }
  const out = { contacts: 0, passive: 0, passiveArmed: 0, passiveOneArmed: 0, passiveEarly: 0, attacks: 0, kills: 0, samples: [],
                escorts: 0, escortSamples: [], maxChasers: 0, crownChaserTicks: 0, crownTicks: 0 };
  const isChase = (a) => a === ACT_ATTACK || a === ACT_HUNT;
  let evCursor = 0;
  const limit = ruleset.zone.hardLimitTicks + 200;
  // Last tick each bot fought (started an attack, or was hit): a pair that walks side by
  // side while both are busy with somebody else is not passive.
  const fought = new Int32Array(N).fill(-1);
  const close = (key, ep, t) => {
    const len = t - ep.start;
    if (len < CONTACT_TICKS) return;
    out.contacts++;
    // Escort: walking side by side for 1s+, both going for the same third hamster, never
    // fighting each other. (Counted even if they fight that third one.)
    if (!ep.engaged && ep.escortTicks >= CONTACT_TICKS) {
      out.escorts++;
      if (out.escortSamples.length < samples) out.escortSamples.push({ tick: ep.start, ticks: len, a: ep.i, b: ep.j, target: ep.escortTarget, crown: ep.escortCrown });
    }
    if (ep.engaged || fought[ep.i] >= ep.start || fought[ep.j] >= ep.start) return;
    out.passive++;
    if (ep.armed) out.passiveArmed++;
    else if (ep.oneArmed) out.passiveOneArmed++;
    if (ep.start < ruleset.ai.lootPhaseTicks) out.passiveEarly++;
    if (out.samples.length < samples) out.samples.push({ tick: ep.start, ticks: len, a: ep.i, b: ep.j, actA: ep.actA, actB: ep.actB, armed: ep.armed });
  };
  while (!sim.ended && sim.tick < limit) {
    sim.step();
    const t = sim.tick - 1;
    const evs = sim.recorder.events;
    for (; evCursor < evs.length; evCursor++) {
      const e = evs[evCursor];
      if (e.type === EV.ATTACK) out.attacks++;
      if (e.type === EV.KILL) out.kills++;
      if ((e.type === EV.ATTACK || e.type === EV.HIT) && e.a >= 0 && e.a < N) fought[e.a] = t;
      if (e.type === EV.HIT && e.b >= 0 && e.b < N) fought[e.b] = t;
      if ((e.type === EV.ATTACK || e.type === EV.HIT) && e.a >= 0 && e.b >= 0) {
        const i = Math.min(e.a, e.b), j = Math.max(e.a, e.b);
        const ep = open.get(i * N + j);
        if (ep) ep.engaged = true;
      }
    }
    const seen = new Set();
    for (let i = 0; i < N; i++) {
      if (!sim.alive[i]) continue;
      const xi = sim.px[i] / FP | 0, yi = sim.py[i] / FP | 0;
      sim.forEachNear(xi, yi, CONTACT_RANGE, (j) => {
        if (j <= i || !sim.alive[j]) return;
        const dx = (sim.px[j] / FP | 0) - xi, dy = (sim.py[j] / FP | 0) - yi;
        if (dx * dx + dy * dy > CONTACT_RANGE * CONTACT_RANGE) return;
        const key = i * N + j;
        seen.add(key);
        if (!open.has(key)) open.set(key, { i, j, start: t, engaged: false, escortTicks: 0, escortTarget: -1, escortCrown: false,
          armed: sim.weapon[i] >= 0 && sim.weapon[j] >= 0, oneArmed: (sim.weapon[i] >= 0) !== (sim.weapon[j] >= 0), actA: ACTIONS[sim.action[i]], actB: ACTIONS[sim.action[j]] });
        const ep = open.get(key);
        const ti = sim.target[i];
        if (ti >= 0 && ti === sim.target[j] && isChase(sim.action[i]) && isChase(sim.action[j])) {
          ep.escortTicks++; ep.escortTarget = ti; if (ti === sim.crownHolder) ep.escortCrown = true;
        }
      });
    }
    // How many hamsters chase one target at once (crown holder tracked separately).
    const chasers = new Map();
    for (let i = 0; i < N; i++) if (sim.alive[i] && isChase(sim.action[i]) && sim.target[i] >= 0) chasers.set(sim.target[i], (chasers.get(sim.target[i]) || 0) + 1);
    for (const v of chasers.values()) if (v > out.maxChasers) out.maxChasers = v;
    if (sim.crownHolder >= 0) { out.crownTicks++; out.crownChaserTicks += chasers.get(sim.crownHolder) || 0; }
    for (const [key, ep] of open) if (!seen.has(key)) { close(key, ep, t); open.delete(key); }
  }
  for (const [key, ep] of open) close(key, ep, sim.tick);
  out.endTick = sim.tick;
  out.winnerId = sim.winnerId;
  return out;
}

const isMain = import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href ||
               process.argv[1]?.endsWith('combat-check.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const seeds = Array.from({ length: Number(arg('seeds', 6)) }, (_, k) => (k === 0 ? '20261105' : `combat${k}`));
  const bots = Number(arg('bots', 100));
  const presets = arg('presets', 'standard,brawler,sniper').split(',');
  const verbose = argv.includes('--verbose');
  const tot = { contacts: 0, passive: 0, passiveArmed: 0, passiveOneArmed: 0, passiveEarly: 0, attacks: 0, kills: 0, ticks: 0,
                escorts: 0, crownTicks: 0, crownChaserTicks: 0 };
  let maxChasers = 0;
  for (const presetId of presets) {
    for (const seed of seeds) {
      const r = checkCombat({ seed, botCount: bots, presetId });
      for (const k of Object.keys(tot)) tot[k] += k === 'ticks' ? r.endTick : r[k];
      const pct = r.contacts ? ((r.passive * 100) / r.contacts).toFixed(1) : '0.0';
      if (r.maxChasers > maxChasers) maxChasers = r.maxChasers;
      console.log(`${presetId.padEnd(8)} ${String(seed).padEnd(10)} contacts ${String(r.contacts).padStart(4)}  passive ${String(r.passive).padStart(4)} (${pct}%)  escorts ${String(r.escorts).padStart(4)}  max chasers ${String(r.maxChasers).padStart(2)}  crown chasers avg ${(r.crownChaserTicks / Math.max(1, r.crownTicks)).toFixed(1)}  end ${r.endTick}`);
      if (verbose) for (const s of [...r.samples, ...r.escortSamples]) console.log('    ', JSON.stringify(s));
    }
  }
  const pct = tot.contacts ? ((tot.passive * 100) / tot.contacts).toFixed(1) : '0.0';
  console.log(`\ncontacts ${tot.contacts} · passive ${tot.passive} (${pct}%) · both armed ${tot.passiveArmed} · one armed ${tot.passiveOneArmed} · in loot phase ${tot.passiveEarly} · attacks/min ${(tot.attacks / (tot.ticks / 1200)).toFixed(0)}`);
  console.log(`escort pairs (side by side 1s+, same target, never fighting each other) ${tot.escorts} - max chasers on one target ${maxChasers} - avg chasers on the crown holder ${(tot.crownChaserTicks / Math.max(1, tot.crownTicks)).toFixed(2)}`);
}
