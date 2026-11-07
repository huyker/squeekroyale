// Recorder: snapshots (10 Hz), full event log, compact decision trace, result.
// Everything is integer data so the replay hash is byte-stable.
import { SNAP_STRIDE, EV_NAME } from './constants.js';
import { Fnv64 } from './hash.js';

export const DEC_STRIDE = 11; // tick, botId, action, target, 7 utility scores

export class Recorder {
  constructor(botCount, recordDecisions) {
    this.botCount = botCount;
    this.recordDecisions = recordDecisions;
    this.snapshotTicks = [];
    this.snapshots = [];      // Int32Array(botCount * SNAP_STRIDE) per entry
    this.zoneFrames = [];     // [cx, cy, r, dps] per snapshot
    this.projFrames = [];     // Int32Array, [x, y, vx, vy, weapon, owner] * n
    this.lootFrames = [];     // Int32Array, [x, y, weapon, kind] * n   (kind: 0 ground, 1 supply)
    this.crownFrames = [];    // [holderId, groundX, groundY] per snapshot (holder -1 = none)
    this.events = [];
    this._dec = [];
    this._decCount = 0;
  }

  event(t, type, a = 0, b = 0, c = 0, d = 0, e = 0) {
    this.events.push({ t, type, a, b, c, d, e });
  }

  decision(tick, botId, action, target, scores) {
    if (!this.recordDecisions) return;
    this._dec.push(tick, botId, action, target,
      scores[0], scores[1], scores[2], scores[3], scores[4], scores[5], scores[6]);
    this._decCount++;
  }

  snapshot(tick, botFrame, zone, projFrame, lootFrame, crownFrame) {
    this.snapshotTicks.push(tick);
    this.snapshots.push(botFrame);
    this.zoneFrames.push(zone);
    this.projFrames.push(projFrame);
    this.lootFrames.push(lootFrame);
    this.crownFrames.push(crownFrame);
  }

  finalise() {
    this.decisions = Int32Array.from(this._dec);
    this._dec = null;
    this.snapshotTickArray = Int32Array.from(this.snapshotTicks);
    return this;
  }

  /** Byte-stable hash over the whole recorded stream. */
  hash() {
    const h = new Fnv64();
    h.str('squeek/replay/v3');
    h.int32(this.botCount);
    h.int32(this.snapshots.length);
    for (let s = 0; s < this.snapshots.length; s++) {
      h.int32(this.snapshotTicks[s]);
      h.i32array(this.snapshots[s]);
      const z = this.zoneFrames[s];
      h.int32(z[0]).int32(z[1]).int32(z[2]).int32(z[3]);
      h.i32array(this.projFrames[s]);
      h.i32array(this.lootFrames[s]);
      const c = this.crownFrames[s];
      h.int32(c[0]).int32(c[1]).int32(c[2]);
    }
    h.int32(this.events.length);
    for (let i = 0; i < this.events.length; i++) {
      const ev = this.events[i];
      h.int32(ev.t).int32(ev.type).int32(ev.a).int32(ev.b).int32(ev.c).int32(ev.d).int32(ev.e);
    }
    return h.hex();
  }

  eventName(type) { return EV_NAME[type] || String(type); }
}

export { SNAP_STRIDE };
