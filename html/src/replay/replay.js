// Immutable replay reader. Interpolates for display only — it never recomputes HP,
// hits, ownership or the winner. Nothing here may write back into replay data.
import { SNAP_STRIDE, S_X, S_Y, S_HP, S_FLAGS, S_WEAPON, S_ANIM,
         F_ALIVE, F_FACE_LEFT, F_CROWN, F_DASH, F_STUN, F_ATTACK,
         F_CONSUMING, F_SLOWED, F_HOT, F_HASTE, F_BAG_SHIFT, F_BAG_MASK,
         EV, EV_NAME, TICK_HZ, HP_SCALE } from '../core/constants.js';
import { Recorder } from '../core/recorder.js';
import { DEC_STRIDE } from '../core/recorder.js';

export { SNAP_STRIDE, S_X, S_Y, S_HP, S_FLAGS, S_WEAPON, S_ANIM,
         F_ALIVE, F_FACE_LEFT, F_CROWN, F_DASH, F_STUN, F_ATTACK };

/** Recompute the stream hash and re-check the hard invariants. Throws on tamper. */
export function validateReplay(replay) {
  const problems = [];
  const rec = new Recorder(replay.manifest.config.botCount, true);
  rec.snapshotTicks = Array.from(replay.snapshotTicks);
  rec.snapshots = replay.snapshots;
  rec.zoneFrames = replay.zoneFrames;
  rec.projFrames = replay.projFrames;
  rec.lootFrames = replay.lootFrames;
  rec.crownFrames = replay.crownFrames;
  rec.events = replay.events;
  const hash = rec.hash();
  if (hash !== replay.replayHash) problems.push(`replayHash mismatch: ${hash} != ${replay.replayHash}`);

  const N = replay.manifest.config.botCount;
  const last = replay.snapshots[replay.snapshots.length - 1];
  let alive = 0, aliveId = -1;
  for (let i = 0; i < N; i++) {
    if (last[i * SNAP_STRIDE + S_FLAGS] & F_ALIVE) { alive++; aliveId = i; }
    const hp = last[i * SNAP_STRIDE + S_HP];
    if (hp > replay.initial.bots[i].maxHp) problems.push(`bot ${i} hp above maxHp`);
    if (hp < 0) problems.push(`bot ${i} negative hp`);
  }
  if (alive !== 1) problems.push(`final aliveCount = ${alive}, expected exactly 1`);
  if (aliveId !== replay.result.winnerId) problems.push(`last survivor ${aliveId} != winnerId ${replay.result.winnerId}`);

  // Crown can never have two holders at once.
  for (let s = 0; s < replay.snapshots.length; s++) {
    const f = replay.snapshots[s];
    let holders = 0;
    for (let i = 0; i < N; i++) if (f[i * SNAP_STRIDE + S_FLAGS] & F_CROWN) holders++;
    if (holders > 1) { problems.push(`two Crown holders at snapshot ${s}`); break; }
  }

  // No dead bot acts after its death tick.
  const deathTick = new Map();
  for (const ev of replay.events) if (ev.type === EV.DEATH) deathTick.set(ev.a, ev.t);
  for (const ev of replay.events) {
    if (ev.type !== EV.ATTACK && ev.type !== EV.PICKUP && ev.type !== EV.DASH &&
        ev.type !== EV.CONSUMABLE_PICKUP && ev.type !== EV.CONSUME && ev.type !== EV.CHEST_OPEN) continue;
    const d = deathTick.get(ev.a);
    if (d !== undefined && ev.t > d) { problems.push(`bot ${ev.a} acted at tick ${ev.t} after dying at ${d}`); break; }
  }

  // Every item is picked up at most once.
  const pickedItems = new Set();
  for (const ev of replay.events) {
    if (ev.type !== EV.PICKUP && ev.type !== EV.CONSUMABLE_PICKUP) continue;
    if (pickedItems.has(ev.b)) { problems.push(`item ${ev.b} picked up twice`); break; }
    pickedItems.add(ev.b);
  }

  // Every treasure chest opens at most once; nobody acts before touching down.
  const openedChests = new Set();
  for (const ev of replay.events) {
    if (ev.type !== EV.CHEST_OPEN) continue;
    if (openedChests.has(ev.b)) { problems.push(`chest ${ev.b} opened twice`); break; }
    openedChests.add(ev.b);
  }
  const bots = (replay.initial && replay.initial.bots) || [];
  for (const ev of replay.events) {
    if (ev.type !== EV.ATTACK && ev.type !== EV.PICKUP && ev.type !== EV.DASH) continue;
    const b = bots[ev.a];
    if (b && b.landTick !== undefined && ev.t < b.landTick) { problems.push(`bot ${ev.a} acted at tick ${ev.t} before landing at ${b.landTick}`); break; }
  }

  // v1.3 match plan: every hamster touches down exactly on its planned drop point, at its
  // planned tick, and every supply crate falls exactly where and when the plan says.
  for (const ev of replay.events) {
    if (ev.type !== EV.LAND) continue;
    const b = bots[ev.a];
    if (b && (ev.b !== b.spawnX || ev.c !== b.spawnY || ev.t !== b.landTick)) { problems.push(`bot ${ev.a} landed at ${ev.b},${ev.c} t${ev.t}, planned ${b.spawnX},${b.spawnY} t${b.landTick}`); break; }
  }
  const plannedSupply = replay.initial && replay.initial.supplyPlan;
  if (plannedSupply) {
    const seen = replay.events.filter((e) => e.type === EV.SUPPLY_SPAWN);
    for (const ev of seen) {
      const c = plannedSupply[ev.a];
      if (!c || c.tick !== ev.t || c.x !== ev.b || c.y !== ev.c || c.weapon !== ev.d || c.cons !== ev.e) { problems.push(`supply ${ev.a} off plan`); break; }
    }
    const due = plannedSupply.filter((c) => c.tick <= replay.result.endTick).length;
    if (seen.length !== due) problems.push(`${seen.length} supply drops, plan has ${due} due`);
  }

  return { ok: problems.length === 0, problems, hash };
}

export class ReplayReader {
  constructor(replay) {
    this.replay = replay;
    this.N = replay.manifest.config.botCount;
    this.tickHz = replay.initial.tickHz || TICK_HZ;
    this.snapshotEvery = replay.initial.snapshotEvery || 2;
    this.endTick = replay.result.endTick;
    this.durationSeconds = replay.result.durationSeconds;
    this.snapCount = replay.snapshots.length;

    // Event index by tick for seeking without rescanning.
    this.eventsByTick = new Map();
    for (let i = 0; i < replay.events.length; i++) {
      const ev = replay.events[i];
      let a = this.eventsByTick.get(ev.t);
      if (!a) { a = []; this.eventsByTick.set(ev.t, a); }
      a.push(ev);
    }
    this.killEvents = replay.events.filter((e) => e.type === EV.KILL);
    this.crownEvents = replay.events.filter((e) =>
      e.type === EV.CROWN_CREATE || e.type === EV.CROWN_TRANSFER || e.type === EV.CROWN_DROP || e.type === EV.CROWN_PICKUP);

    // Decision trace index: botId -> array of record offsets.
    this.decisionsByBot = new Map();
    const dec = replay.decisions;
    if (dec && dec.length) {
      for (let o = 0; o < dec.length; o += DEC_STRIDE) {
        const bot = dec[o + 1];
        let arr = this.decisionsByBot.get(bot);
        if (!arr) { arr = []; this.decisionsByBot.set(bot, arr); }
        arr.push(o);
      }
    }
    this.state = this._allocState();
  }

  _allocState() {
    return {
      tick: 0,
      bots: Array.from({ length: this.N }, (_, i) => ({
        id: i, x: 0, y: 0, hp: 0, alive: false, faceLeft: false, crown: false,
        dashing: false, stunned: false, attacking: false, weapon: -1, anim: 0,
        consuming: false, slowed: false, hot: false, haste: false, bag: 0,
      })),
      zone: { cx: 0, cy: 0, r: 0, dps: 0 },
      projectiles: [],
      loot: [],
      crownHolder: -1, crownGroundX: -1, crownGroundY: -1,
      aliveCount: 0,
    };
  }

  snapshotIndexFor(tick) {
    const idx = Math.floor(tick / this.snapshotEvery);
    return Math.max(0, Math.min(this.snapCount - 1, idx));
  }

  /** Sample the world at a fractional tick. Interpolation is cosmetic only. */
  sampleAt(tickFloat) {
    const r = this.replay, st = this.state;
    const i0 = this.snapshotIndexFor(tickFloat);
    const i1 = Math.min(this.snapCount - 1, i0 + 1);
    const t0 = r.snapshotTicks[i0], t1 = r.snapshotTicks[i1];
    const alpha = t1 > t0 ? Math.max(0, Math.min(1, (tickFloat - t0) / (t1 - t0))) : 0;
    const f0 = r.snapshots[i0], f1 = r.snapshots[i1];
    st.tick = tickFloat;
    let alive = 0;
    for (let i = 0; i < this.N; i++) {
      const o = i * SNAP_STRIDE;
      const b = st.bots[i];
      const flags = f0[o + S_FLAGS];
      const aliveNow = (flags & F_ALIVE) !== 0;
      const aliveNext = (f1[o + S_FLAGS] & F_ALIVE) !== 0;
      // Freeze a dying bot at its last live position rather than sliding it.
      const blend = aliveNow && aliveNext ? alpha : 0;
      b.x = f0[o + S_X] + (f1[o + S_X] - f0[o + S_X]) * blend;
      b.y = f0[o + S_Y] + (f1[o + S_Y] - f0[o + S_Y]) * blend;
      b.hp = f0[o + S_HP] / HP_SCALE;
      b.alive = aliveNow;
      b.faceLeft = (flags & F_FACE_LEFT) !== 0;
      b.crown = (flags & F_CROWN) !== 0;
      b.dashing = (flags & F_DASH) !== 0;
      b.stunned = (flags & F_STUN) !== 0;
      b.attacking = (flags & F_ATTACK) !== 0;
      b.consuming = (flags & F_CONSUMING) !== 0;
      b.slowed = (flags & F_SLOWED) !== 0;
      b.hot = (flags & F_HOT) !== 0;
      b.haste = (flags & F_HASTE) !== 0;
      b.bag = (flags >> F_BAG_SHIFT) & F_BAG_MASK;
      b.weapon = f0[o + S_WEAPON];
      b.anim = f0[o + S_ANIM];
      if (aliveNow) alive++;
    }
    st.aliveCount = alive;
    const z0 = r.zoneFrames[i0], z1 = r.zoneFrames[i1];
    st.zone.cx = z0[0] + (z1[0] - z0[0]) * alpha;
    st.zone.cy = z0[1] + (z1[1] - z0[1]) * alpha;
    st.zone.r = z0[2] + (z1[2] - z0[2]) * alpha;
    st.zone.dps = z0[3];
    const pf = r.projFrames[i0];
    st.projectiles.length = 0;
    for (let k = 0; k < pf.length; k += 6) {
      st.projectiles.push({ x: pf[k] + (pf[k + 2] / 256) * alpha * this.snapshotEvery,
                            y: pf[k + 1] + (pf[k + 3] / 256) * alpha * this.snapshotEvery,
                            vx: pf[k + 2], vy: pf[k + 3], weapon: pf[k + 4], owner: pf[k + 5] });
    }
    const lf = r.lootFrames[i0];
    st.loot.length = 0;
    for (let k = 0; k < lf.length; k += 4) st.loot.push({ x: lf[k], y: lf[k + 1], weapon: lf[k + 2], kind: lf[k + 3] });
    const cf = r.crownFrames[i0];
    st.crownHolder = cf[0]; st.crownGroundX = cf[1]; st.crownGroundY = cf[2];
    return st;
  }

  /** Raw position of a bot at the snapshot covering `tick`. No interpolation. */
  botPosAt(tick, botId) {
    const i = this.snapshotIndexFor(tick);
    const f = this.replay.snapshots[i];
    const o = botId * SNAP_STRIDE;
    return { x: f[o + S_X], y: f[o + S_Y], alive: (f[o + S_FLAGS] & F_ALIVE) !== 0 };
  }

  eventsBetween(fromTickExclusive, toTickInclusive) {
    const out = [];
    const a = Math.max(0, Math.floor(fromTickExclusive) + 1);
    const b = Math.floor(toTickInclusive);
    if (b - a > 4000) return out;                       // huge seek: skip the burst
    for (let t = a; t <= b; t++) {
      const list = this.eventsByTick.get(t);
      if (list) for (const e of list) out.push(e);
    }
    return out;
  }

  /** Future events used by the camera director (allowed: the match is already computed). */
  eventsAhead(tick, aheadTicks) {
    return this.eventsBetween(tick, tick + aheadTicks);
  }

  nextKillAfter(tick) {
    for (const e of this.killEvents) if (e.t > tick) return e.t;
    return null;
  }

  decisionAt(botId, tick) {
    const arr = this.decisionsByBot.get(botId);
    if (!arr || !arr.length) return null;
    const dec = this.replay.decisions;
    let best = null;
    for (let k = 0; k < arr.length; k++) {
      const o = arr[k];
      if (dec[o] > tick) break;
      best = o;
    }
    if (best === null) return null;
    return {
      tick: dec[best], botId: dec[best + 1], action: dec[best + 2], target: dec[best + 3],
      scores: [dec[best + 4], dec[best + 5], dec[best + 6], dec[best + 7], dec[best + 8], dec[best + 9], dec[best + 10]],
    };
  }

  eventName(type) { return EV_NAME[type] || String(type); }
}
