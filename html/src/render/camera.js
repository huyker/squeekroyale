// Camera Director. Reads the already-computed replay ahead of the playhead (legal:
// the match is finished) and frames the hottest cluster. It can never alter events.
import { EV } from '../core/constants.js';

export const CAM_AUTO = 'auto', CAM_FOLLOW = 'follow', CAM_FREE = 'free';

const EVENT_WEIGHT = {
  [EV.KILL]: 50,
  [EV.CROWN_TRANSFER]: 100,
  [EV.CROWN_PICKUP]: 90,
  [EV.CROWN_DROP]: 80,
  [EV.CROWN_CREATE]: 85,
  [EV.SUPPLY_OPEN]: 25,
  [EV.SUPPLY_SPAWN]: 20,
  [EV.HIT]: 6,
  [EV.ATTACK]: 3,
  [EV.DEATH]: 18,
};

export class CameraDirector {
  constructor(reader, ruleset) {
    this.reader = reader;
    this.world = reader.replay.initial.world;
    this.mode = CAM_AUTO;
    this.x = this.world.width / 2;
    this.y = this.world.height / 2;
    this.zoom = 0.3;
    this.targetX = this.x; this.targetY = this.y; this.targetZoom = this.zoom;
    this.followId = -1;
    this.shotUntilTick = -1;
    this.lookaheadTicks = 120;        // 6 s at 20 Hz
    this.minShotTicks = 36;           // 1.8 s
    this.lastPick = null;
    this.missedHighlights = 0;
  }

  /** `followZoom`: how close Follow frames its hamster (0.95; the Hub's "follow yourself" goes closer). */
  setMode(mode, followId = -1, followZoom = 0.95) {
    this.mode = mode;
    this.followId = followId;
    this.followZoom = followZoom;
    this.shotUntilTick = -1;
  }

  /** Called once per rendered frame. `dt` is wall-clock seconds — view smoothing only. */
  update(tick, state, viewW, viewH, dt) {
    if (this.mode === CAM_FOLLOW && this.followId >= 0) {
      const b = state.bots[this.followId];
      this.targetX = b.x; this.targetY = b.y;
      this.targetZoom = b.alive ? (this.followZoom || 0.95) : 0.6;
    } else if (this.mode === CAM_AUTO) {
      if (tick >= this.shotUntilTick) this._pickShot(tick, state);
      if (this.lastPick) {
        this.targetX = this.lastPick.x; this.targetY = this.lastPick.y; this.targetZoom = this.lastPick.zoom;
      }
    }
    const k = Math.min(1, dt * (this.mode === CAM_FREE ? 20 : 3.2));
    this.x += (this.targetX - this.x) * k;
    this.y += (this.targetY - this.y) * k;
    this.zoom += (this.targetZoom - this.zoom) * Math.min(1, dt * 2.2);
    this._clamp(viewW, viewH);
  }

  /**
   * Drag the view by (dx, dy) screen pixels. Moves the camera itself (no smoothing lag:
   * the map sticks to the pointer) and keeps the target on the same clamped spot, so
   * dragging past an edge never leaves the target running away off the map.
   */
  panBy(dx, dy, viewW, viewH) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this._clamp(viewW, viewH);
    this.targetX = this.x; this.targetY = this.y;
  }

  _clamp(viewW, viewH) {
    const halfW = viewW / (2 * this.zoom), halfH = viewH / (2 * this.zoom);
    const W = this.world.width, H = this.world.height;
    this.x = halfW * 2 >= W ? W / 2 : Math.max(halfW, Math.min(W - halfW, this.x));
    this.y = halfH * 2 >= H ? H / 2 : Math.max(halfH, Math.min(H - halfH, this.y));
  }

  _pickShot(tick, state) {
    const ahead = this.reader.eventsAhead(tick, this.lookaheadTicks);
    const clusters = [];
    const CELL = 420;
    const add = (x, y, score, label) => {
      for (const c of clusters) {
        if (Math.abs(c.x - x) < CELL && Math.abs(c.y - y) < CELL) {
          c.score += score; c.n++;
          c.x = (c.x * (c.n - 1) + x) / c.n; c.y = (c.y * (c.n - 1) + y) / c.n;
          if (score > c.topScore) { c.topScore = score; c.label = label; }
          return;
        }
      }
      clusters.push({ x, y, score, n: 1, topScore: score, label });
    };

    for (const ev of ahead) {
      const w = EVENT_WEIGHT[ev.type];
      if (!w) continue;
      let bot = ev.a;
      if (ev.type === EV.CROWN_TRANSFER) bot = ev.b;
      const pos = this.reader.botPosAt(ev.t, Math.max(0, bot));
      let score = w;
      if (ev.type === EV.ATTACK && state.crownHolder >= 0 && ev.b === state.crownHolder) score = 65; // attack on the King
      add(pos.x, pos.y, score, this.reader.eventName(ev.type));
    }

    // Live crowd pressure: wherever many living bots are packed right now.
    const alive = [];
    for (const b of state.bots) if (b.alive) alive.push(b);
    for (const b of alive) {
      let near = 0;
      for (const o of alive) {
        if (o === b) continue;
        if (Math.abs(o.x - b.x) < 320 && Math.abs(o.y - b.y) < 320) near++;
      }
      if (near >= 1) add(b.x, b.y, near >= 4 ? 40 : near >= 1 ? 10 : 0, 'brawl');
    }
    if (alive.length > 0 && alive.length <= 3) {
      const cx = alive.reduce((s, b) => s + b.x, 0) / alive.length;
      const cy = alive.reduce((s, b) => s + b.y, 0) / alive.length;
      add(cx, cy, 100, 'final');
    }
    if (state.crownHolder >= 0) {
      const k = state.bots[state.crownHolder];
      if (k && k.alive) add(k.x, k.y, 30, 'king');
    }

    if (clusters.length === 0) {
      this.lastPick = { x: state.zone.cx, y: state.zone.cy, zoom: 0.32, label: 'overview' };
    } else {
      clusters.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
      const best = clusters[0];
      let zoom = 0.78;
      if (best.label === 'final') zoom = 1.05;
      else if (best.n >= 5) zoom = 0.55;
      else if (best.score < 20) zoom = 0.42;
      this.lastPick = { x: best.x, y: best.y, zoom, label: best.label };
      if (clusters.length > 1 && clusters[1].score >= best.score * 0.9) this.missedHighlights++;
    }
    this.shotUntilTick = tick + this.minShotTicks;
  }

  worldToScreen(wx, wy, viewW, viewH) {
    return [(wx - this.x) * this.zoom + viewW / 2, (wy - this.y) * this.zoom + viewH / 2];
  }
  screenToWorld(sx, sy, viewW, viewH) {
    return [(sx - viewW / 2) / this.zoom + this.x, (sy - viewH / 2) / this.zoom + this.y];
  }
}
