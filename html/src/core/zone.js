// Safe-zone schedule. Every phase (centre + radius + dps) is computed up front from
// the seed, so zone state at any tick is a pure function of (seed, ruleset, tick).
import { substream } from './rng.js';
import { ilerp, flen } from './fixed.js';

export function buildZoneSchedule(seed, ruleset) {
  const rng = substream(seed, 'zone/schedule');
  const { width, height } = ruleset.world;
  const phases = [];
  let cx = width >> 1, cy = height >> 1;
  let r = ruleset.zone.startRadius;
  for (let i = 0; i < ruleset.zone.phases.length; i++) {
    const p = ruleset.zone.phases[i];
    // The next centre must keep the new circle inside the previous one.
    const slack = Math.max(0, r - p.radius);
    const jitter = Math.max(0, (slack * 72) / 100) | 0;
    const nx = cx + (jitter > 0 ? rng.range(-jitter, jitter) : 0);
    const ny = cy + (jitter > 0 ? rng.range(-jitter, jitter) : 0);
    phases.push({
      index: i, start: p.start, end: p.end, dps: p.dps,
      fromCx: cx, fromCy: cy, fromR: r,
      toCx: nx, toCy: ny, toR: p.radius,
    });
    cx = nx; cy = ny; r = p.radius;
  }
  return { phases, finalCx: cx, finalCy: cy, finalR: r };
}

/** Zone centre/radius/dps at a tick. Pure, O(phases). */
export function zoneAt(schedule, ruleset, tick) {
  const ph = schedule.phases;
  const last = ph[ph.length - 1];
  if (tick >= last.end) {
    let r = last.toR, dps = last.dps;
    const sd = ruleset.zone.suddenDeathStart;
    if (tick >= sd) {
      const steps = ((tick - sd) / 100) | 0;
      dps = last.dps + steps * ruleset.zone.suddenDeathDpsStep;
      r = Math.max(ruleset.zone.suddenDeathRadius, last.toR - steps * 24);
    }
    return { cx: last.toCx, cy: last.toCy, r, dps, phase: ph.length - 1, shrinking: tick >= sd };
  }
  for (let i = 0; i < ph.length; i++) {
    const p = ph[i];
    if (tick < p.end) {
      const hold = ruleset.zone.holdPermille ?? 350;
      const shrinkStart = p.start + (((p.end - p.start) * hold) / 1000) | 0;
      if (tick <= shrinkStart) {
        return { cx: p.fromCx, cy: p.fromCy, r: p.fromR, dps: i === 0 ? 0 : ph[i - 1].dps, phase: i, shrinking: false };
      }
      const den = p.end - shrinkStart;
      const t = tick - shrinkStart;
      return {
        cx: ilerp(p.fromCx, p.toCx, t, den),
        cy: ilerp(p.fromCy, p.toCy, t, den),
        r: ilerp(p.fromR, p.toR, t, den),
        dps: p.dps, phase: i, shrinking: true,
      };
    }
  }
  return { cx: last.toCx, cy: last.toCy, r: last.toR, dps: last.dps, phase: ph.length - 1, shrinking: false };
}

/** Where the zone will be in `aheadTicks` — AI uses this so bots move early. */
export function zoneLookahead(schedule, ruleset, tick, aheadTicks) {
  return zoneAt(schedule, ruleset, tick + aheadTicks);
}

/** Distance outside the safe circle, in world units (0 if inside). */
export function outsideBy(zone, xu, yu) {
  const d = flen(xu - zone.cx, yu - zone.cy);
  return d > zone.r ? d - zone.r : 0;
}
