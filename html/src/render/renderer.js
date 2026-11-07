// Canvas 2D renderer for the immutable replay. Draws the AGY modular hamster sprites,
// the arena, the Cat Storm ring, loot, projectiles, VFX and the HUD overlay.
// Render-only: no RNG that feeds the core, no hit detection, no state writes.
import { EV, ANIM } from '../core/constants.js';
import { SPRITE_PX, SPRITE_WORLD } from './assets.js';
import { WEAPONS, CONSUMABLE_INDEX } from '../core/ruleset.js';

/** Loot glow by weapon tier (1..6), read at a glance like rarity colours. */
const TIER_GLOW = ['#9aa0a6', '#9aa0a6', '#5fcf6b', '#4aa8f0', '#b46cf0', '#f0a23a', '#f0503c'];

const PALETTE = {
  grass: '#7d9150', grassDark: '#6c8046', grassLight: '#8ea05c',
  outline: '#3a2a1c', rock: '#9a9aa6', rockDark: '#6f6f7d',
  crate: '#c08a4e', crateDark: '#8d6235', bush: '#4f7a44', bushDark: '#3d6135',
  stump: '#8a6239', stumpDark: '#5f4427',
  stormEdge: '#e0459b', stormFog: '#6d3f72', stormCloud: '#a06cb4',
  catEye: '#f8c84d', catPupil: '#2a1420', catTail: '#8d5fa5',
  gold: '#f8c84d', hp: '#4cd97b', hpLow: '#e03e52', text: '#f8eadb',
};

const PIVOT_X = 0.5, PIVOT_Y = 0.84375;   // from the AGY manifest

/**
 * How each obstacle kind's art sits on its collision circle (radius r):
 *   w     on-screen width of the opaque art, in multiples of r
 *   base  where the art's bottom edge lands, in r below the circle centre
 *   sx/sy shadow ellipse radii in r
 * Trees: r is the trunk, so the canopy is ~6.5 r wide and fades when a bot walks behind it.
 */
const OBS_ART = [
  { w: 2.3, base: 0.6,  sx: 1.05, sy: 0.42 },   // rock
  { w: 2.1, base: 0.7,  sx: 1.0,  sy: 0.4 },    // crate / barrel / hay
  { w: 2.5, base: 0.6,  sx: 1.1,  sy: 0.42 },   // bush
  { w: 2.4, base: 0.6,  sx: 1.05, sy: 0.4 },    // stump / log / fence
  { w: 2.4, base: 0.65, sx: 1.1,  sy: 0.4 },    // wall (reserved)
  { w: 6.5, base: 0.8,  sx: 2.2,  sy: 0.8, tall: true },   // tree
  { w: 2.8, base: 0.85, sx: 1.25, sy: 0.5, tall: true },   // building
];
/**
 * Make a repeating tile seam-free: cross-fade it with a copy shifted by half a tile, using
 * the original in the middle and the shifted copy (whose middle is the original's seam
 * lines) near the edges. Returns a canvas; falls back to the image if pixels are unreadable.
 */
function seamBlendTile(img, band = 40) {
  try {
    const w = img.width, h = img.height;
    const read = (dx, dy) => {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const c = cv.getContext('2d', { willReadFrequently: true });
      for (const ox of [dx - w, dx]) for (const oy of [dy - h, dy]) c.drawImage(img, ox, oy);
      return { cv, c, data: c.getImageData(0, 0, w, h) };
    };
    const a = read(0, 0), b = read(w >> 1, h >> 1);
    const A = a.data.data, B = b.data.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.min(x, w - 1 - x, y, h - 1 - y);
        let m = Math.min(1, d / band); m = m * m * (3 - 2 * m);
        const k = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) A[k + ch] = A[k + ch] * m + B[k + ch] * (1 - m);
      }
    }
    a.c.putImageData(a.data, 0, 0);
    return a.cv;
  } catch (_) { return img; }
}

const OVERVIEW_PX = 2048;     // baked whole-map image, used when zoomed far out and for the minimap
const OVERVIEW_ZOOM = 0.2;    // below this zoom the baked map replaces per-prop drawing

/** The viewer's own hamsters in the Arena Hub: dark red, impossible to miss. */
const MINE = '#b3001b';

export class Renderer {
  constructor(canvas, reader, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reader = reader;
    this.assets = assets;
    this.world = reader.replay.initial.world;
    this.obstacles = reader.replay.initial.obstacles;
    this.bots = reader.replay.initial.bots;
    this.effects = [];
    this.killFeed = [];
    this.lastEventTick = -1;
    this.showLabels = true;
    this.showHpBars = true;
    this.showVfx = true;
    this.selectedId = -1;
    // The viewer's own hamsters (Arena Hub): dark-red ring, bold dark-red name, shown at any zoom.
    this.highlightIds = new Set();
    this.groundPattern = null;
    // Death ticks, so corpses can fade out instead of piling up for the whole match.
    this.deathTick = new Int32Array(reader.N).fill(-1);
    for (const ev of reader.replay.events) {
      if (ev.type === EV.DEATH && this.deathTick[ev.a] < 0) this.deathTick[ev.a] = ev.t;
    }
    // Which consumable each bot started most recently, for the over-head icon.
    this.consumeStarts = new Map();
    for (const ev of reader.replay.events) {
      if (ev.type !== EV.CONSUME || ev.d !== 0) continue;
      let a = this.consumeStarts.get(ev.a);
      if (!a) { a = []; this.consumeStarts.set(ev.a, a); }
      a.push(ev.t, ev.b);
    }
    this.corpseFadeStart = 90;   // ticks after death before a body starts fading
    this.corpseFadeTicks = 110;  // and how long the fade takes
    this.decor = reader.replay.initial.decor || { ponds: [], flowers: [] };
    // Opened supply chests linger (as the open-chest art) for a few seconds.
    const supplyPos = new Map();
    this.chestOpens = [];
    for (const ev of reader.replay.events) {
      if (ev.type === EV.SUPPLY_SPAWN) supplyPos.set(ev.a, { x: ev.b, y: ev.c });
      else if (ev.type === EV.SUPPLY_OPEN && supplyPos.has(ev.b)) this.chestOpens.push({ t: ev.t, ...supplyPos.get(ev.b) });
    }
    this.chestOpenTicks = 110;
    // Map treasure chests: closed until a hurt hamster touches one, then the open chest
    // (cheese inside) lingers a few seconds.
    this.chests = reader.replay.initial.chests || [];
    this.chestOpenAt = new Map();
    for (const ev of reader.replay.events) if (ev.type === EV.CHEST_OPEN) this.chestOpenAt.set(ev.b, ev.t);
    this.treasureOpenTicks = 120;
    this.zoneDmgShownAt = new Map();
    this.parachuteHeight = 620;     // world units above the landing spot at tick 0
    this.overview = null;
    this._buildGround();
  }

  /** Whole map (grass, ponds, flowers, props) baked once into one image. */
  _bakeOverview() {
    if (this.overview) return this.overview;
    const cv = document.createElement('canvas');
    cv.width = OVERVIEW_PX; cv.height = OVERVIEW_PX;
    const c = cv.getContext('2d');
    const k = OVERVIEW_PX / Math.max(this.world.width, this.world.height);
    c.save(); c.scale(k, k);
    c.fillStyle = this.groundPattern || PALETTE.grass;
    c.fillRect(0, 0, this.world.width, this.world.height);
    c.restore();
    const to = (v) => v * k;
    this._drawDecor(c, to, to, k, -Infinity, Infinity, -Infinity, Infinity);
    const sorted = [...this.obstacles].sort((a, b) => a.y - b.y || a.id - b.id);
    for (const o of sorted) this._drawObstacle(c, o, to(o.x), to(o.y), k, 1);
    this.overview = cv;
    return cv;
  }

  _buildGround() {
    // The match's AGY ground tile (decor.ground), 256 world units per tile.
    const grounds = this.assets.map && this.assets.map.grounds;
    const g = grounds && grounds[(this.decor && this.decor.ground) | 0];
    if (g) {
      const gi = (this.decor && this.decor.ground) | 0;
      this.groundImage = this.assets.map.groundSeamBlend && this.assets.map.groundSeamBlend[gi] ? seamBlendTile(g) : g;
      this.groundTileWorld = 256;
      this.groundPattern = this.ctx.createPattern(this.groundImage, 'repeat');
      return;
    }
    const tile = document.createElement('canvas');
    tile.width = 192; tile.height = 192;
    const c = tile.getContext('2d');
    c.fillStyle = PALETTE.grass;
    c.fillRect(0, 0, 192, 192);
    // Deterministic-looking speckle (renderer-local; never feeds the core).
    let h = 0x9e3779b9;
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 192, y = rnd() * 192, r = 2 + rnd() * 7;
      c.fillStyle = rnd() > 0.5 ? PALETTE.grassDark : PALETTE.grassLight;
      c.globalAlpha = 0.35 + rnd() * 0.3;
      c.beginPath(); c.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    this.groundImage = tile; this.groundTileWorld = 192;
    this.groundPattern = this.ctx.createPattern(tile, 'repeat');
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(320, Math.round(r.width * dpr));
    this.canvas.height = Math.max(240, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.viewW = this.canvas.width / dpr;
    this.viewH = this.canvas.height / dpr;
  }

  /** Spawn render-side VFX for events crossed since the previous frame. */
  ingestEvents(fromTick, toTick) {
    if (toTick < fromTick) { this.effects.length = 0; this.killFeed.length = 0; }
    const evs = this.reader.eventsBetween(fromTick, toTick);
    for (const ev of evs) {
      if (ev.type === EV.KILL) {
        this.killFeed.unshift({ tick: ev.t, killer: ev.a, victim: ev.b, weapon: ev.d });
        if (this.killFeed.length > 7) this.killFeed.pop();
      }
      if (!this.showVfx) continue;
      switch (ev.type) {
        case EV.ATTACK: {
          const a = this.reader.botPosAt(ev.t, ev.a), b = this.reader.botPosAt(ev.t, ev.b);
          const dx = b.x - a.x, dy = b.y - a.y;
          const ang = Math.atan2(dy, dx);
          const dist = Math.hypot(dx, dy) || 1;
          const nx = dx / dist, ny = dy / dist;

          if (ev.c < 0) {
            // Unarmed Bare Paws: 3-claw swipe flurry + wind puff
            const mx = a.x + nx * 20, my = a.y + ny * 20 - 14;
            this.effects.push({ fx: 'paw_swipe', x: mx, y: my, ang, t: 0, life: 0.22, r: 26 });
            this.effects.push({ fx: 'weapon_slash', x: mx, y: my, t: 0, life: 0.16, scale: 0.42, flip: b.x < a.x });
            break;
          }

          const spec = WEAPONS[ev.c];
          if (!spec) break;
          if (spec.type !== 'melee') {
            // Ranged wind-up / bow draw flash on the attacker
            this.effects.push({
              fx: 'ranged_charge',
              weaponId: spec.id,
              x: a.x + nx * 16,
              y: a.y + ny * 12 - 15,
              ang,
              t: 0,
              life: 0.22,
            });
            break;
          }

          const pat = spec.pattern || 'straight';
          if (pat === 'cone') {
            // Sword vs Axe: distinct crescent cleave wave + weapon sprite slash + arc sparks
            const isAxe = spec.id === 'axe';
            const reach = spec.range || 46;
            const halfCone = ((spec.coneAngle || 333) * Math.PI) / 2000;
            this.effects.push({
              fx: 'cleave_arc',
              isAxe,
              x: a.x,
              y: a.y - 14,
              ang,
              reach: reach + 8,
              spread: halfCone,
              t: 0,
              life: isAxe ? 0.34 : 0.26,
            });
            this.effects.push({
              fx: 'weapon_slash',
              x: a.x + nx * (reach * 0.55),
              y: a.y + ny * (reach * 0.55) - 14,
              t: 0,
              life: isAxe ? 0.30 : 0.24,
              scale: isAxe ? 0.95 : 0.80,
              flip: b.x < a.x,
            });
            if (isAxe) {
              // Brutal axe ground tremor & flame sparks at the cleave edge
              this.effects.push({
                fx: 'burst_sparks',
                x: a.x + nx * (reach * 0.78),
                y: a.y + ny * (reach * 0.78) - 10,
                ang,
                spread: 1.4,
                count: 9,
                speed: 145,
                color: '#ff5e36',
                subColor: '#ffe066',
                t: 0,
                life: 0.28,
              });
            } else {
              // Sword glint motes along the blade arc
              this.effects.push({
                fx: 'burst_sparks',
                x: a.x + nx * (reach * 0.72),
                y: a.y + ny * (reach * 0.72) - 14,
                ang,
                spread: 1.2,
                count: 6,
                speed: 115,
                color: '#6be8f5',
                subColor: '#ffffff',
                t: 0,
                life: 0.22,
              });
            }
          } else if (pat === 'circle') {
            // Hammer: seismic ground-pound with cracks, shockwave rings, lightning pillar & flying rocks
            const reach = spec.range || 50;
            const impD = Math.min(dist, reach + 15);
            const impX = a.x + nx * impD, impY = a.y + ny * impD;
            const aoeR = spec.aoeRadius || 55;
            this.effects.push({ fx: 'hammer_slam', x: impX, y: impY, r: aoeR, seed: (ev.t * 31 + ev.a) & 255, t: 0, life: 0.52 });
            this.effects.push({ fx: 'ring', x: impX, y: impY, t: 0, life: 0.42, r: aoeR * 1.12, color: '#ffbe3d' });
            this.effects.push({ fx: 'crown_pulse', x: impX, y: impY - 10, t: 0, life: 0.32, scale: 0.96 });
            this.effects.push({ fx: 'dash_dust', x: impX, y: impY + 4, t: 0, life: 0.34, scale: 0.88 });
          } else if (pat === 'line') {
            // Spear: high-velocity piercing lance beam with sonic rings along the 85u shaft
            const reach = (spec.range || 85) + 12;
            this.effects.push({
              fx: 'spear_thrust',
              x: a.x,
              y: a.y - 14,
              ang,
              reach,
              width: (spec.lineWidth || 18) * 1.15,
              t: 0,
              life: 0.26,
            });
            this.effects.push({
              fx: 'weapon_slash',
              x: a.x + nx * (reach * 0.52),
              y: a.y + ny * (reach * 0.52) - 14,
              t: 0,
              life: 0.2,
              scale: 0.58,
              flip: b.x < a.x,
            });
          } else {
            // Dagger: rapid twin cross-slash + lethal glint
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 14;
            this.effects.push({ fx: 'dagger_cross', x: mx, y: my, ang, t: 0, life: 0.22, r: 28 });
            this.effects.push({ fx: 'weapon_slash', x: mx, y: my, t: 0, life: 0.18, scale: 0.56, flip: b.x < a.x });
          }
          break;
        }
        case EV.PROJECTILE_SPAWN: {
          const spec = WEAPONS[ev.c];
          if (!spec) break;
          const b = this.reader.botPosAt(ev.t, ev.b);
          const ang = Math.atan2(b.y - ev.e, b.x - ev.d);
          this.effects.push({
            fx: 'muzzle_flash',
            weaponId: spec.id,
            x: ev.d + Math.cos(ang) * 18,
            y: ev.e - 12 + Math.sin(ang) * 14,
            ang,
            t: 0,
            life: spec.id === 'magic_staff' ? 0.32 : 0.22,
          });
          break;
        }
        case EV.HIT: {
          const p = this.reader.botPosAt(ev.t, ev.b);
          const att = ev.a >= 0 ? this.reader.botPosAt(ev.t, ev.a) : p;
          const ang = Math.atan2(p.y - att.y, p.x - att.x);
          const spec = ev.c >= 0 ? WEAPONS[ev.c] : null;
          const wid = spec ? spec.id : 'unarmed';
          this.effects.push({ fx: 'hit_sparks', x: p.x, y: p.y - 16, t: 0, life: 0.22, scale: spec && spec.tier >= 5 ? 0.82 : 0.64 });
          this.effects.push({
            fx: 'hit_impact',
            weaponId: wid,
            x: p.x,
            y: p.y - 16,
            ang,
            seed: (ev.t * 17 + ev.b) & 255,
            t: 0,
            life: 0.28,
          });
          break;
        }
        case EV.DAMAGE: {
          if (ev.a < 0) break;                        // zone damage is handled in EV.ZONE_DAMAGE
          const dmg = Math.max(1, Math.round(ev.c / 100));
          const p = this.reader.botPosAt(ev.t, ev.b);
          const heavy = dmg >= 30;
          const med = dmg >= 18;
          const jx = (((ev.t * 13 + ev.b * 7) % 19) - 9);
          this.effects.push({
            fx: 'dmg_text',
            x: p.x + jx,
            y: p.y - 46,
            t: 0,
            life: heavy ? 0.82 : 0.68,
            text: '-' + dmg + (heavy ? '!' : ''),
            color: heavy ? '#ff4757' : med ? '#ffbe3d' : '#fff3d6',
            scale: heavy ? 1.28 : med ? 1.08 : 0.94,
          });
          break;
        }
        case EV.MISS: {
          if (ev.e === 0 || ev.e === 3) {
            // Target dodged melee (0) or projectile (3)
            if (ev.b >= 0) {
              const p = this.reader.botPosAt(ev.t, ev.b);
              this.effects.push({ fx: 'dodge_flash', x: p.x, y: p.y - 18, t: 0, life: 0.35 });
              this.effects.push({ fx: 'text', x: p.x, y: p.y - 52, t: 0, life: 0.55, text: 'DODGE', color: '#5ce0e6' });
            }
          }
          break;
        }
        case EV.STUN: {
          const p = this.reader.botPosAt(ev.t, ev.b);
          this.effects.push({ fx: 'ring', x: p.x, y: p.y - 14, t: 0, life: 0.38, r: 36, color: '#ffe066' });
          this.effects.push({ fx: 'text', x: p.x, y: p.y - 62, t: 0, life: 0.75, text: '⚡ STUN!', color: '#ffe066' });
          break;
        }
        case EV.DASH:
          this.effects.push({ fx: 'dash_dust', x: ev.b, y: ev.c, t: 0, life: 0.28, scale: 0.68 });
          this.effects.push({ fx: 'ring', x: ev.b, y: ev.c, t: 0, life: 0.22, r: 26, color: '#5ce0e6' });
          break;
        case EV.HEAL: {
          if (ev.c < 300) break;                      // skip tiny heal ticks (< 3 HP)
          const p = this.reader.botPosAt(ev.t, ev.a);
          this.effects.push({ fx: 'text', x: p.x, y: p.y - 58, t: 0, life: 0.9,
                              text: '+' + Math.round(ev.c / 100), color: ev.b === -4 ? '#f6c945' : '#5ee08a' });
          break;
        }
        case EV.ZONE_DAMAGE: {                       // caught in the Cat Storm: purple -N, ~1/s per bot
          if ((this.zoneDmgShownAt.get(ev.a) ?? -99) > ev.t - 20) break;
          this.zoneDmgShownAt.set(ev.a, ev.t);
          const p = this.reader.botPosAt(ev.t, ev.a);
          this.effects.push({ fx: 'text', x: p.x, y: p.y - 58, t: 0, life: 0.8,
                              text: '-' + Math.max(1, Math.round((ev.b * 5) / 100)), color: '#c58cf5' });
          break;
        }
        case EV.CHEST_OPEN: {
          const img = this.assets.consumableIcon(CONSUMABLE_INDEX.cheese_wedge);
          if (img) this.effects.push({ fx: 'icon', img, x: ev.d, y: ev.e - 30, t: 0, life: 0.9, size: 44 });
          this.effects.push({ fx: 'ring', x: ev.d, y: ev.e, t: 0, life: 0.4, r: 48, color: '#f6c945' });
          break;
        }
        case EV.CROWN_CREATE: case EV.CROWN_TRANSFER: case EV.CROWN_PICKUP: {
          const who = ev.type === EV.CROWN_TRANSFER ? ev.b : ev.a;
          const p = this.reader.botPosAt(ev.t, who);
          this.effects.push({ fx: 'crown_pulse', x: p.x, y: p.y - 22, t: 0, life: 0.3, scale: 1.1 });
          break;
        }
        case EV.DEATH: {
          const p = this.reader.botPosAt(ev.t, ev.a);
          this.effects.push({ fx: 'hit_sparks', x: p.x, y: p.y - 14, t: 0, life: 0.26, scale: 1.15 });
          this.effects.push({ fx: 'ring', x: p.x, y: p.y - 10, t: 0, life: 0.42, r: 46, color: '#ff4757' });
          this.effects.push({
            fx: 'burst_sparks',
            x: p.x,
            y: p.y - 14,
            ang: 0,
            spread: Math.PI * 2,
            count: 12,
            speed: 155,
            color: '#ff4757',
            subColor: '#f8c84d',
            t: 0,
            life: 0.38,
          });
          break;
        }
        default: break;
      }
    }
  }

  draw(state, cam, dt, hud) {
    const ctx = this.ctx;
    const W = this.viewW, H = this.viewH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const zoom = cam.zoom;
    const ox = W / 2 - cam.x * zoom, oy = H / 2 - cam.y * zoom;
    const toX = (wx) => wx * zoom + ox, toY = (wy) => wy * zoom + oy;
    const visL = cam.x - W / (2 * zoom) - 120, visR = cam.x + W / (2 * zoom) + 120;
    const visT = cam.y - H / (2 * zoom) - 160, visB = cam.y + H / (2 * zoom) + 160;

    const overview = zoom < OVERVIEW_ZOOM;
    this._drawGround(ctx, toX, toY, zoom, W, H, overview);
    if (overview) {
      ctx.drawImage(this._bakeOverview(), toX(0), toY(0), this.world.width * zoom, this.world.height * zoom);
    } else {
      this._drawDecor(ctx, toX, toY, zoom, visL - 200, visR + 200, visT - 200, visB + 200);
    }
    this._drawLoot(ctx, state, toX, toY, zoom, visL, visR, visT, visB);
    this._drawCrownOnGround(ctx, state, toX, toY, zoom);
    this._drawBots(ctx, state, toX, toY, zoom, visL, visR, visT, visB, !overview);
    this._drawProjectiles(ctx, state, toX, toY, zoom);
    this._drawEffects(ctx, toX, toY, zoom, dt);
    this._drawStorm(ctx, state, toX, toY, zoom, W, H);
    this._drawMinimap(ctx, state, W, H);
  }

  /**
   * Ground pattern for the current zoom. Tiles are pre-scaled to power-of-two sizes
   * (mip levels, built once each) and the pattern's own transform supplies the exact
   * remaining scale (0.71-1.41) and the map-origin offset. So the ground stays locked to
   * the world while zooming (no rounding drift, no per-zoom rebuild) and is never heavily
   * minified — filling with the full 256px tile scaled down over the whole map cost ~20 ms
   * a frame.
   */
  _groundPattern(tilePx) {
    this.groundMips = this.groundMips || new Map();
    let p = this.groundMips.get(tilePx);
    if (!p) {
      const cv = document.createElement('canvas');
      cv.width = tilePx; cv.height = tilePx;
      const c = cv.getContext('2d');
      c.imageSmoothingQuality = 'high';
      // Draw the tile with its 8 neighbours around it, so the resampling filter wraps
      // across the edges instead of blending them with transparency (a faint grid).
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c.drawImage(this.groundImage, dx * tilePx, dy * tilePx, tilePx, tilePx);
      p = this.ctx.createPattern(cv, 'repeat');
      this.groundMips.set(tilePx, p);
    }
    return p;
  }

  _drawGround(ctx, toX, toY, zoom, W, H, baked = false) {
    const w = this.world.width, h = this.world.height;
    ctx.fillStyle = '#2a2033';
    ctx.fillRect(0, 0, W, H);
    // Only the visible part of the map, in device pixels.
    const d = this.dpr || 1;
    const ox = toX(0) * d, oy = toY(0) * d;
    const x0 = Math.max(0, ox), y0 = Math.max(0, oy);
    const x1 = Math.min(W * d, toX(w) * d), y1 = Math.min(H * d, toY(h) * d);
    if (!baked && x1 > x0 && y1 > y0 && this.groundImage) {        // baked: the overview image has the ground
      const target = this.groundTileWorld * zoom * d;                  // exact on-screen tile size
      const tilePx = Math.min(1024, Math.max(8, 2 ** Math.round(Math.log2(target))));
      const pat = this._groundPattern(tilePx);
      const k = target / tilePx;
      pat.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));              // anchored at the map origin
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = pat;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = Math.max(1, 8 * zoom);
    ctx.strokeRect(toX(0), toY(0), w * zoom, h * zoom);
    ctx.restore();
  }

  /** Walk-through ground art: shallow ponds with lilies (some with a bridge) and flowers. */
  _drawDecor(ctx, toX, toY, zoom, l, r, t, b) {
    const A = this.assets.map || {};
    const art = (a, cx, cy, w) => {          // art a with its opaque box centred on (cx, cy), w wide
      if (!a) return;
      const h = (a.box.h / a.box.w) * w;
      ctx.drawImage(a.img, a.box.x, a.box.y, a.box.w, a.box.h, cx - w / 2, cy - h / 2, w, h);
    };
    for (const p of this.decor.ponds) {
      if (p.x + p.rx < l || p.x - p.rx > r || p.y + p.ry < t || p.y - p.ry > b) continue;
      const x = toX(p.x), y = toY(p.y), rx = p.rx * zoom, ry = p.ry * zoom;
      ctx.save();
      ctx.fillStyle = '#cdb27a';
      ctx.beginPath(); ctx.ellipse(x, y, rx + 16 * zoom, ry + 12 * zoom, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2d6878';
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4fb3c8';
      ctx.beginPath(); ctx.ellipse(x, y + 3 * zoom, Math.max(1, rx - 8 * zoom), Math.max(1, ry - 8 * zoom), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.ellipse(x - rx * 0.28, y - ry * 0.3, rx * 0.34, ry * 0.16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      for (const lp of p.lilies) this._lilyPad(ctx, toX(p.x + lp.dx), toY(p.y + lp.dy), lp.s * 0.42 * zoom);
      if (p.bridge) art(A.bridge, x, y - ry * 0.1, p.rx * 2.2 * zoom);
    }
    if (A.daisy) {
      for (const f of this.decor.flowers) {
        if (f.x < l || f.x > r || f.y < t || f.y > b) continue;
        art(A.daisy, toX(f.x), toY(f.y), f.s * zoom);
      }
    }
  }

  /** A water-lily pad with a pink bloom (vector: the AGY pack has no lily sprite any more). */
  _lilyPad(ctx, x, y, r) {
    if (r < 1.5) return;
    ctx.save();
    ctx.fillStyle = '#4f9a45'; ctx.strokeStyle = '#2f5f2a'; ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.ellipse(x, y, r, r * 0.62, 0, 0.35, Math.PI * 2 - 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f39ac0';
    ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.15, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe07a';
    ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.15, r * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** World-space rectangle covered by an obstacle's art (see-through check for tall props). */
  _obstacleRect(o) {
    const m = OBS_ART[o.kind] || OBS_ART[0];
    const a = this.assets.obstacleArt(o.kind, o.v);
    const w = o.r * m.w;
    const h = a ? (a.box.h / a.box.w) * w : o.r * 2;
    const bottom = o.y + o.r * m.base;
    return { l: o.x - w / 2, r: o.x + w / 2, t: bottom - h, b: bottom };
  }

  _drawObstacle(ctx, o, x, y, zoom, alpha) {
    const m = OBS_ART[o.kind] || OBS_ART[0];
    const rad = o.r * zoom;
    ctx.save();
    ctx.globalAlpha = 0.28 * alpha;
    ctx.fillStyle = '#2d2418';
    ctx.beginPath(); ctx.ellipse(x, y + rad * 0.4, rad * m.sx, rad * m.sy, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
    const a = this.assets.obstacleArt(o.kind, o.v);
    if (a) {
      const w = rad * m.w, h = (a.box.h / a.box.w) * w;
      ctx.drawImage(a.img, a.box.x, a.box.y, a.box.w, a.box.h, x - w / 2, y + rad * m.base - h, w, h);
    } else {
      // Vector fallback if the art is missing.
      ctx.lineWidth = Math.max(1, 3 * zoom);
      ctx.strokeStyle = PALETTE.outline;
      ctx.fillStyle = [PALETTE.rock, PALETTE.crate, PALETTE.bush, PALETTE.stump, PALETTE.rockDark, PALETTE.bushDark, PALETTE.crateDark][o.kind] || PALETTE.rock;
      ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.86, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  _drawLoot(ctx, state, toX, toY, zoom, l, r, t, b) {
    const bob = Math.sin(performance.now() / 420) * 2;
    const open = this.assets.map && this.assets.map.chestOpen;
    const closed = this.assets.map && this.assets.map.chestClosed;
    for (const c of this.chests) {
      if (c.x < l || c.x > r || c.y < t || c.y > b) continue;
      const at = this.chestOpenAt.get(c.id);
      if (at === undefined || state.tick < at) { this._drawChest(ctx, closed, toX(c.x), toY(c.y), zoom, 1, false, 0.8); continue; }
      const age = state.tick - at;
      if (age > this.treasureOpenTicks) continue;
      this._drawChest(ctx, open, toX(c.x), toY(c.y), zoom, Math.min(1, (this.treasureOpenTicks - age) / 30), false, 0.8);
    }
    for (const c of this.chestOpens) {
      const age = state.tick - c.t;
      if (age < 0 || age > this.chestOpenTicks || c.x < l || c.x > r || c.y < t || c.y > b) continue;
      const fade = Math.min(1, (this.chestOpenTicks - age) / 30);
      this._drawChest(ctx, open, toX(c.x), toY(c.y), zoom, fade, false);
    }
    for (const it of state.loot) {
      if (it.x < l || it.x > r || it.y < t || it.y > b) continue;
      const x = toX(it.x), y = toY(it.y);
      if (it.kind === 1) {                       // supply drop: the paw chest
        this._drawChest(ctx, this.assets.map && this.assets.map.chestClosed, x, y, zoom, 1, true);
        continue;
      }
      const healing = it.kind === 2;
      const icon = healing ? this.assets.consumableIcon(it.weapon) : this.assets.weaponIcon(it.weapon);
      const s = (healing ? 24 : 30) * zoom;
      ctx.save();
      // rarity glow: tier colour for weapons, soft green for healing items
      const glow = healing ? '#5ee08a' : TIER_GLOW[Math.max(0, Math.min(6, (WEAPONS[it.weapon] || {}).tier || 0))];
      ctx.globalAlpha = 0.35; ctx.fillStyle = glow;
      ctx.beginPath(); ctx.ellipse(x, y + s * 0.38, s * 0.62, s * 0.26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      if (icon && zoom > 0.22) ctx.drawImage(icon, x - s / 2, y - s / 2 + bob * zoom, s, s);
      else { ctx.fillStyle = PALETTE.gold; ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, s * 0.22), 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
  }

  _drawChest(ctx, a, x, y, zoom, alpha, glow, scale = 1) {
    const w = 74 * zoom * scale;
    ctx.save();
    ctx.globalAlpha = 0.32 * alpha; ctx.fillStyle = '#2d2418';
    ctx.beginPath(); ctx.ellipse(x, y + 10 * zoom, w * 0.55, w * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    if (glow) {
      ctx.globalAlpha = 0.3 + Math.sin(performance.now() / 260) * 0.12;
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath(); ctx.ellipse(x, y + 10 * zoom, w * 0.75, w * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = alpha;
    if (a) {
      const h = (a.box.h / a.box.w) * w;
      ctx.drawImage(a.img, a.box.x, a.box.y, a.box.w, a.box.h, x - w / 2, y + 14 * zoom - h, w, h);
    } else {
      ctx.fillStyle = '#d8a04f';
      ctx.fillRect(x - w * 0.4, y - w * 0.5, w * 0.8, w * 0.6);
    }
    ctx.restore();
  }

  _drawCrownOnGround(ctx, state, toX, toY, zoom) {
    if (state.crownGroundX < 0) return;
    const x = toX(state.crownGroundX), y = toY(state.crownGroundY);
    const pulse = 1 + Math.sin(performance.now() / 180) * 0.12;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = PALETTE.gold;
    ctx.beginPath(); ctx.arc(x, y, 26 * zoom * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const img = this.assets.images.get('src/assets/agy/hamster/accessories/crown_king_right.png');
    const s = 70 * zoom;
    if (img) ctx.drawImage(img, x - s / 2, y - s * 0.62, s, s);
    ctx.restore();
  }

  _drawBots(ctx, state, toX, toY, zoom, l, r, t, b, withProps) {
    const lod = zoom < 0.24;
    const now = performance.now();
    const corpses = [], alive = [];
    for (let i = 0; i < state.bots.length; i++) {
      const bt = state.bots[i];
      if (bt.x < l || bt.x > r || bt.y < t || bt.y > b) continue;
      (bt.alive ? alive : corpses).push(bt);
    }
    // Corpses lie on the ground, under every prop and living hamster.
    corpses.sort((p, q) => p.y - q.y || p.id - q.id);
    for (const bt of corpses) this._drawBotBody(ctx, state, bt, toX, toY, zoom, lod, now);

    // Props and living hamsters share one painter's pass (sorted by feet y), so a hamster
    // behind a tree or a wall is hidden by it and one in front stands over it.
    const scene = [];
    if (withProps) {
      const pad = 400;   // big enough for a tree canopy or a building
      for (const o of this.obstacles) {
        if (o.x < l - pad || o.x > r + pad || o.y < t - 120 || o.y > b + pad) continue;
        scene.push({ y: o.y, o });
      }
    }
    for (const bt of alive) scene.push({ y: bt.y, bt });
    scene.sort((p, q) => p.y - q.y || (p.o ? -1 : 0) - (q.o ? -1 : 0) || (p.o ? p.o.id : p.bt.id) - (q.o ? q.o.id : q.bt.id));
    for (const e of scene) {
      if (e.o) {
        const o = e.o;
        let alpha = 1;
        if ((OBS_ART[o.kind] || OBS_ART[0]).tall) {
          // See-through when a hamster (or the selected one) stands behind the art.
          const rc = this._obstacleRect(o);
          for (const bt of alive) {
            if (bt.y < o.y && bt.x > rc.l + 10 && bt.x < rc.r - 10 && bt.y > rc.t + 10) { alpha = 0.45; break; }
          }
        }
        this._drawObstacle(ctx, o, toX(o.x), toY(o.y), zoom, alpha);
      } else {
        this._drawBotBody(ctx, state, e.bt, toX, toY, zoom, lod, now);
      }
    }
    if (lod) return;
    for (const bt of alive) this._drawBotOverlay(ctx, state, bt, toX, toY, zoom, now);
  }

  _drawBotBody(ctx, state, bt, toX, toY, zoom, lod, now) {
    let corpseAlpha = 1;
    if (!bt.alive) {
      const dt = this.deathTick[bt.id];
      const age = dt < 0 ? 0 : state.tick - dt;
      if (age > this.corpseFadeStart + this.corpseFadeTicks) return;   // body gone
      if (age > this.corpseFadeStart) corpseAlpha = 1 - (age - this.corpseFadeStart) / this.corpseFadeTicks;
    }
    const x = toX(bt.x), y = toY(bt.y);
    const def = this.bots[bt.id];
    if (lod) {
      ctx.fillStyle = bt.alive ? (bt.crown ? PALETTE.gold : '#efa04b') : `rgba(60,45,60,${(0.5 * corpseAlpha).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(x, y, bt.alive ? 3.4 : 2, 0, Math.PI * 2); ctx.fill();
      if (bt.id === this.selectedId) { ctx.strokeStyle = '#5ce0e6'; ctx.lineWidth = 2; ctx.stroke(); }
      if (bt.alive && this.highlightIds.has(bt.id)) {
        ctx.fillStyle = MINE; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(x, y, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      return;
    }

    const sprite = this.assets.spriteFor(def.appearance, bt.faceLeft, bt.weapon, bt.crown);
    const dw = SPRITE_WORLD * zoom, dh = SPRITE_WORLD * zoom;
    const dx = x - dw * PIVOT_X, dy = y - dh * PIVOT_Y;

    // Match start: still under the parachute, drifting down onto the landing spot.
    const land = def.landTick | 0;
    if (bt.alive && state.tick < land) {
      this._drawParachute(ctx, sprite, x, y, dw, dh, zoom, (land - state.tick) / Math.max(1, land), bt.id, now);
      return;
    }

    // Ground rings first, so the sprite stands on them.
    if (bt.alive && bt.crown) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(now / 200) * 0.1;
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath(); ctx.ellipse(x, y, dw * 0.42, dh * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    if (bt.alive && this.highlightIds.has(bt.id)) {
      ctx.save();
      ctx.globalAlpha = 0.75 + Math.sin(now / 160) * 0.2;
      ctx.strokeStyle = MINE; ctx.lineWidth = Math.max(2.5, 4 * zoom);
      ctx.beginPath(); ctx.ellipse(x, y, dw * 0.46, dh * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (bt.alive && bt.id === this.selectedId) {
      ctx.save();
      ctx.strokeStyle = '#5ce0e6'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.ellipse(x, y, dw * 0.38, dh * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    // Procedural motion only — the art contract forbids an idle animation, so a
    // standing bot is one frozen frame (stand_000) with no bob at all.
    let squashX = 1, squashY = 1, lean = 0, offY = 0, offX = 0, alpha = 1;
    const isAttacking = bt.anim === ANIM.attack_melee || bt.anim === ANIM.attack_ranged || bt.attacking;
    if (!bt.alive) {
      alpha = 0.45 * corpseAlpha;
      lean = bt.faceLeft ? -0.5 : 0.5;   // fallen over, no death animation frames in V1
      offY = 6 * zoom;
      squashX = 0.92; squashY = 0.88;
    } else if (bt.anim === ANIM.run) {
      const ph = now / 110 + bt.id;
      offY = -Math.abs(Math.sin(ph)) * 3.4 * zoom;
      squashX = 1 + Math.sin(ph * 2) * 0.035;
      squashY = 1 - Math.sin(ph * 2) * 0.045;
    } else if (bt.anim === ANIM.dash || bt.dashing) {
      squashX = 1.16; squashY = 0.88; lean = bt.faceLeft ? 0.2 : -0.2;
      // Dash afterimage ghost & speed streaks
      const dir = bt.faceLeft ? 1 : -1;
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.drawImage(sprite, 0, 0, SPRITE_PX, SPRITE_PX, dx + dir * 14 * zoom, dy, dw, dh);
      ctx.globalAlpha = 0.14;
      ctx.drawImage(sprite, 0, 0, SPRITE_PX, SPRITE_PX, dx + dir * 26 * zoom, dy, dw, dh);
      ctx.strokeStyle = '#5ce0e6';
      ctx.lineWidth = Math.max(1, 2.2 * zoom);
      ctx.globalAlpha = 0.65;
      for (let s = 0; s < 3; s++) {
        const sy = y - dh * (0.22 + s * 0.18);
        ctx.beginPath();
        ctx.moveTo(x + dir * dw * 0.2, sy);
        ctx.lineTo(x + dir * dw * (0.65 + (s & 1) * 0.2), sy);
        ctx.stroke();
      }
      ctx.restore();
    } else if (bt.anim === ANIM.attack_melee) {
      const swing = Math.sin(now / 42 + bt.id);
      squashX = 1.14; squashY = 0.92;
      lean = (bt.faceLeft ? -0.16 : 0.16) + swing * 0.05;
      offX = (bt.faceLeft ? -4.5 : 4.5) * zoom;
    } else if (bt.anim === ANIM.attack_ranged) {
      squashX = 1.06; squashY = 0.96;
      lean = bt.faceLeft ? 0.08 : -0.08;
      offX = (bt.faceLeft ? 2.5 : -2.5) * zoom; // slight recoil
    } else if (bt.anim === ANIM.hit) {
      offY = -2 * zoom; squashX = 0.92; squashY = 1.08;
    } else if (bt.anim === ANIM.crown_receive) {
      squashY = 1.08; offY = -3 * zoom;
    }

    ctx.globalAlpha = alpha;
    ctx.translate(x + offX, y + offY);
    if (lean !== 0) ctx.rotate(lean);
    ctx.scale(squashX, squashY);
    ctx.translate(-(x + offX), -(y + offY));
    ctx.drawImage(sprite, 0, 0, SPRITE_PX, SPRITE_PX, dx + offX, dy + offY, dw, dh);
    ctx.restore();

    if (!bt.alive) return;

    // Weapon attack aura flare on the hamster's weapon hand while swinging/shooting
    if (isAttacking) {
      const wSpec = bt.weapon >= 0 ? WEAPONS[bt.weapon] : null;
      const tierCol = wSpec ? TIER_GLOW[Math.max(0, Math.min(6, wSpec.tier || 1))] : '#f8eadb';
      const hx = x + (bt.faceLeft ? -dw * 0.28 : dw * 0.28) + offX;
      const hy = y - dh * 0.34 + offY;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = tierCol;
      ctx.lineWidth = Math.max(1.2, 2.6 * zoom);
      const rAura = (wSpec && wSpec.tier >= 5 ? 15 : 11) * zoom;
      const spin = now / 90 + bt.id;
      ctx.beginPath();
      ctx.arc(hx, hy, rAura, spin, spin + Math.PI * 1.15);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, 1.3 * zoom);
      ctx.beginPath();
      ctx.arc(hx, hy, rAura * 0.72, -spin, -spin + Math.PI * 0.85);
      ctx.stroke();
      ctx.restore();
    }

    if (bt.anim === ANIM.hit) {
      ctx.save();
      ctx.globalAlpha = 0.34; ctx.fillStyle = '#ff384c';
      ctx.beginPath(); ctx.ellipse(x, y - dh * 0.3, dw * 0.32, dh * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // Stunned: orbiting golden stars above the hamster's head
    if (bt.stunned) {
      ctx.save();
      const sy = y - dh * 0.88;
      const rx = dw * 0.26, ry = dh * 0.09;
      ctx.strokeStyle = 'rgba(255, 224, 102, 0.45)';
      ctx.lineWidth = Math.max(1, 1.5 * zoom);
      ctx.beginPath(); ctx.ellipse(x, sy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const a = now / 180 + (k * Math.PI * 2) / 3;
        const sx = x + Math.cos(a) * rx, ssy = sy + Math.sin(a) * ry;
        const sr = 3.6 * zoom;
        ctx.fillStyle = k === 0 ? '#ffffff' : '#ffe066';
        ctx.beginPath();
        ctx.moveTo(sx, ssy - sr);
        ctx.lineTo(sx + sr * 0.4, ssy - sr * 0.4);
        ctx.lineTo(sx + sr, ssy);
        ctx.lineTo(sx + sr * 0.4, ssy + sr * 0.4);
        ctx.lineTo(sx, ssy + sr);
        ctx.lineTo(sx - sr * 0.4, ssy + sr * 0.4);
        ctx.lineTo(sx - sr, ssy);
        ctx.lineTo(sx - sr * 0.4, ssy - sr * 0.4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    // Status: haste (gold streaks), heal-over-time (rising green motes).
    if (bt.haste) {
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.strokeStyle = PALETTE.gold; ctx.lineWidth = Math.max(1, 3 * zoom);
      const dir = bt.faceLeft ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath(); ctx.moveTo(x + dir * dw * 0.32, y - dh * (0.2 + k * 0.14));
        ctx.lineTo(x + dir * dw * 0.62, y - dh * (0.2 + k * 0.14)); ctx.stroke();
      }
      ctx.restore();
    }
    if (bt.hot) {
      ctx.save();
      ctx.fillStyle = '#5ee08a';
      for (let k = 0; k < 3; k++) {
        const ph = (now / 700 + k / 3 + bt.id * 0.13) % 1;
        ctx.globalAlpha = 0.8 * (1 - ph);
        ctx.beginPath(); ctx.arc(x + (k - 1) * dw * 0.18, y - dh * (0.25 + ph * 0.55), Math.max(1, 2.6 * zoom), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  /** A hamster hanging under a striped parachute; k = 1 at the top of the drop, 0 on landing. */
  _drawParachute(ctx, sprite, x, y, dw, dh, zoom, k, id, now) {
    const h = this.parachuteHeight * k * zoom;
    const sway = Math.sin(now / 420 + id) * 0.12 * k;
    // shadow grows and darkens as the hamster nears the ground
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.2 * (1 - k);
    ctx.fillStyle = '#2d2418';
    ctx.beginPath(); ctx.ellipse(x, y, dw * (0.25 + 0.15 * (1 - k)), dh * (0.1 + 0.06 * (1 - k)), 0, 0, Math.PI * 2); ctx.fill();
    // the planned touch-down point (match plan): a dashed target ring the hamster drops onto
    ctx.globalAlpha = 0.35 + 0.45 * (1 - k);
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = Math.max(1, 2 * zoom); ctx.setLineDash([5 * zoom, 4 * zoom]);
    ctx.beginPath(); ctx.ellipse(x, y, dw * 0.42, dh * 0.19, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.save();
    ctx.translate(x, y - h);
    ctx.rotate(sway);
    const cw = dw * 1.25, ch = dh * 0.55, top = -dh * 1.55;     // canopy, above the hamster's head
    // strings
    ctx.strokeStyle = 'rgba(58,42,28,0.85)'; ctx.lineWidth = Math.max(1, 1.4 * zoom);
    for (const sx of [-0.95, -0.35, 0.35, 0.95]) {
      ctx.beginPath(); ctx.moveTo(sx * cw / 2, top + ch * 0.05); ctx.lineTo(sx * dw * 0.12, -dh * 0.62); ctx.stroke();
    }
    // canopy: striped dome with a bold outline (AGY palette)
    const cols = ['#f8c84d', '#e0459b', '#f8eadb', '#5ce0e6', '#f8c84d', '#e0459b'];
    const n = cols.length;
    for (let s = 0; s < n; s++) {
      const a0 = Math.PI + (s / n) * Math.PI, a1 = Math.PI + ((s + 1) / n) * Math.PI;
      ctx.fillStyle = cols[(s + id) % n];
      ctx.beginPath(); ctx.moveTo(0, top + ch * 0.05);
      ctx.ellipse(0, top + ch * 0.05, cw / 2, ch, 0, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = PALETTE.outline; ctx.lineWidth = Math.max(1, 2.6 * zoom);
    ctx.beginPath(); ctx.ellipse(0, top + ch * 0.05, cw / 2, ch, 0, Math.PI, Math.PI * 2); ctx.closePath(); ctx.stroke();
    // the hamster, legs dangling (slightly squashed)
    ctx.scale(1, 1.04);
    ctx.drawImage(sprite, 0, 0, SPRITE_PX, SPRITE_PX, -dw * PIVOT_X, -dh * PIVOT_Y, dw, dh);
    ctx.restore();
  }

  /** Name, HP bar and the item being eaten — drawn after the scene so props never cover them. */
  _drawBotOverlay(ctx, state, bt, toX, toY, zoom, now) {
    const x = toX(bt.x), y = toY(bt.y);
    const def = this.bots[bt.id];
    const dh = SPRITE_WORLD * zoom;
    if (state.tick < (def.landTick | 0)) {                       // still parachuting
      if (!this.highlightIds.has(bt.id) || zoom <= 0.12) return;
      // the viewer's own hamster is named from the first frame, above its parachute
      ctx.save();
      ctx.font = `900 ${Math.round(15 * Math.min(1.6, Math.max(0.8, zoom * 1.4)))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,240,235,0.95)';
      ctx.strokeText('▼ ' + def.name, x, y - dh * 2.1);
      ctx.fillStyle = MINE;
      ctx.fillText('▼ ' + def.name, x, y - dh * 2.1);
      ctx.restore();
      return;
    }
    if (bt.consuming && zoom > 0.28) {
      const ci = this._consumeItemFor(bt.id, state.tick);
      const icon = ci >= 0 ? this.assets.consumableIcon(ci) : null;
      if (icon) {
        const s = 22 * zoom, bob = Math.sin(now / 90) * 2 * zoom;
        ctx.drawImage(icon, x - s / 2, y - dh * 1.18 - s / 2 + bob, s, s);
      }
    }
    if (this.showHpBars && zoom > 0.3) {
      const bw = 40 * zoom, bh = 5 * zoom;
      const frac = Math.max(0, Math.min(1, bt.hp / (def.maxHp / 100)));
      const by = y - dh * 0.92;
      ctx.fillStyle = 'rgba(25,18,28,0.78)';
      ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = frac > 0.35 ? PALETTE.hp : PALETTE.hpLow;
      ctx.fillRect(x - bw / 2, by, bw * frac, bh);
    }
    if (this.highlightIds.has(bt.id) && zoom > 0.12) {
      // the viewer's own hamster: always named, bold dark red on a light outline, with a marker
      ctx.save();
      const fs = Math.round(15 * Math.min(1.6, Math.max(0.8, zoom * 1.4)));
      ctx.font = `900 ${fs}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const label = '▼ ' + def.name + (bt.crown ? ' ♛' : '');
      const ly = y - dh * 0.98 - (zoom > 0.45 ? 4 : 0);
      ctx.lineJoin = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,240,235,0.95)';
      ctx.strokeText(label, x, ly);
      ctx.fillStyle = MINE;
      ctx.fillText(label, x, ly);
      ctx.restore();
    } else if (this.showLabels && zoom > 0.45) {
      ctx.save();
      ctx.font = `600 ${Math.round(11 * Math.min(1.4, zoom))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(21,16,28,0.9)';
      const label = def.name + (bt.crown ? ' ♛' : '');
      ctx.strokeText(label, x, y - dh * 0.98);
      ctx.fillStyle = bt.crown ? PALETTE.gold : PALETTE.text;
      ctx.fillText(label, x, y - dh * 0.98);
      ctx.restore();
    }
  }

  _consumeItemFor(botId, tick) {
    const a = this.consumeStarts.get(botId);
    if (!a) return -1;
    let found = -1;
    for (let k = 0; k < a.length; k += 2) { if (a[k] > tick) break; found = a[k + 1]; }
    return found;
  }

  _drawProjectiles(ctx, state, toX, toY, zoom) {
    const now = performance.now();
    for (const p of state.projectiles) {
      const x = toX(p.x), y = toY(p.y);
      const ang = Math.atan2(p.vy, p.vx);
      const spec = WEAPONS[p.weapon];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      if (spec && spec.id === 'cheese_bomb') {
        ctx.rotate(now / 120);
        ctx.fillStyle = '#f6c945'; ctx.strokeStyle = PALETTE.outline; ctx.lineWidth = Math.max(1, 2.4 * zoom);
        ctx.beginPath(); ctx.arc(0, 0, 8 * zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c98a1c';
        ctx.beginPath(); ctx.arc(-2.5 * zoom, -2 * zoom, 2.2 * zoom, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(3 * zoom, 2.5 * zoom, 1.6 * zoom, 0, Math.PI * 2); ctx.fill();
      } else if (spec && spec.id === 'seed_sling') {
        // High-speed seed with motion slipstream
        ctx.strokeStyle = 'rgba(239, 233, 218, 0.45)';
        ctx.lineWidth = Math.max(1, 2.4 * zoom);
        ctx.beginPath(); ctx.moveTo(-18 * zoom, 0); ctx.lineTo(-4 * zoom, 0); ctx.stroke();
        ctx.fillStyle = '#2e2c36'; ctx.strokeStyle = '#efe9da'; ctx.lineWidth = Math.max(1, 1.2 * zoom);
        ctx.beginPath(); ctx.ellipse(0, 0, 6 * zoom, 3.4 * zoom, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else if (spec && spec.id === 'magic_staff') {
        // Arcane comet tail ribbon
        const grad = ctx.createLinearGradient(-38 * zoom, 0, 4 * zoom, 0);
        grad.addColorStop(0, 'rgba(159, 134, 184, 0)');
        grad.addColorStop(0.55, 'rgba(180, 108, 240, 0.45)');
        grad.addColorStop(1, 'rgba(107, 232, 245, 0.85)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(2 * zoom, -5.2 * zoom);
        ctx.lineTo(-38 * zoom, 0);
        ctx.lineTo(2 * zoom, 5.2 * zoom);
        ctx.closePath();
        ctx.fill();

        // Crackling mini arcane lightning trail
        ctx.strokeStyle = '#df9cff';
        ctx.lineWidth = Math.max(1, 1.4 * zoom);
        ctx.beginPath();
        const wave = Math.sin(now / 45);
        ctx.moveTo(-4 * zoom, 0);
        ctx.lineTo(-14 * zoom, 4.2 * zoom * wave);
        ctx.lineTo(-24 * zoom, -3.6 * zoom * wave);
        ctx.lineTo(-34 * zoom, 1.5 * zoom * wave);
        ctx.stroke();

        // Outer magical aura & spinning rune ring
        ctx.fillStyle = 'rgba(107,232,245,0.28)';
        ctx.beginPath(); ctx.arc(0, 0, 10.5 * zoom, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(180,108,240,0.75)';
        ctx.lineWidth = Math.max(1, 1.5 * zoom);
        const phase = (now % 400) / 400 * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(0, 0, 8.2 * zoom, phase, phase + Math.PI * 1.35);
        ctx.stroke();

        // Core orb + inner bright star
        ctx.fillStyle = '#6be8f5';
        ctx.beginPath(); ctx.arc(0, 0, 5.4 * zoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, 2.6 * zoom, 0, Math.PI * 2); ctx.fill();

        // Orbiting arcane motes
        ctx.fillStyle = '#e0b3ff';
        for (let k = 0; k < 3; k++) {
          const a = phase + k * Math.PI * 2 / 3;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 8.2 * zoom, Math.sin(a) * 8.2 * zoom, 1.7 * zoom, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (spec && spec.id === 'crossbow') {
        // Tier 6 Heavy Crossbow Bolt: blazing crimson-amber energy wake + supersonic Mach cone
        const wake = ctx.createLinearGradient(-44 * zoom, 0, 10 * zoom, 0);
        wake.addColorStop(0, 'rgba(240, 80, 60, 0)');
        wake.addColorStop(0.6, 'rgba(246, 162, 58, 0.5)');
        wake.addColorStop(1, 'rgba(255, 230, 128, 0.9)');
        ctx.fillStyle = wake;
        ctx.beginPath();
        ctx.moveTo(8 * zoom, -3.6 * zoom);
        ctx.lineTo(-44 * zoom, 0);
        ctx.lineTo(8 * zoom, 3.6 * zoom);
        ctx.closePath();
        ctx.fill();

        // Thick metallic shaft with dark outline
        ctx.strokeStyle = PALETTE.outline; ctx.lineWidth = Math.max(1, 4.4 * zoom);
        ctx.beginPath(); ctx.moveTo(-15 * zoom, 0); ctx.lineTo(11 * zoom, 0); ctx.stroke();
        ctx.strokeStyle = '#e8d4b4'; ctx.lineWidth = Math.max(1, 2.4 * zoom);
        ctx.beginPath(); ctx.moveTo(-15 * zoom, 0); ctx.lineTo(11 * zoom, 0); ctx.stroke();

        // Armor-piercing crimson broadhead
        ctx.fillStyle = '#ff3b30';
        ctx.strokeStyle = '#fff2a6';
        ctx.lineWidth = Math.max(0.8, 1.1 * zoom);
        ctx.beginPath();
        ctx.moveTo(16 * zoom, 0);
        ctx.lineTo(6.5 * zoom, -4.8 * zoom);
        ctx.lineTo(8.5 * zoom, 0);
        ctx.lineTo(6.5 * zoom, 4.8 * zoom);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Supersonic V-shockwave at the tip
        ctx.strokeStyle = 'rgba(255, 215, 110, 0.72)';
        ctx.lineWidth = Math.max(1, 1.6 * zoom);
        ctx.beginPath();
        ctx.moveTo(4 * zoom, -8.5 * zoom);
        ctx.lineTo(17.5 * zoom, 0);
        ctx.lineTo(4 * zoom, 8.5 * zoom);
        ctx.stroke();

        // Golden fletching
        ctx.fillStyle = '#efa04b';
        ctx.beginPath(); ctx.moveTo(-12 * zoom, 0); ctx.lineTo(-17 * zoom, -4 * zoom); ctx.lineTo(-14 * zoom, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-12 * zoom, 0); ctx.lineTo(-17 * zoom, 4 * zoom); ctx.lineTo(-14 * zoom, 0); ctx.closePath(); ctx.fill();
      } else {
        // Bow arrow: sleek wind-ribbon trail + golden arrowhead + feather fletching
        const wind = ctx.createLinearGradient(-32 * zoom, 0, 6 * zoom, 0);
        wind.addColorStop(0, 'rgba(95, 207, 107, 0)');
        wind.addColorStop(0.6, 'rgba(180, 245, 190, 0.38)');
        wind.addColorStop(1, 'rgba(248, 200, 77, 0.75)');
        ctx.fillStyle = wind;
        ctx.beginPath();
        ctx.moveTo(6 * zoom, -2.2 * zoom);
        ctx.lineTo(-32 * zoom, 0);
        ctx.lineTo(6 * zoom, 2.2 * zoom);
        ctx.closePath();
        ctx.fill();

        // Shaft
        ctx.strokeStyle = PALETTE.outline; ctx.lineWidth = Math.max(1, 3.0 * zoom);
        ctx.beginPath(); ctx.moveTo(-13 * zoom, 0); ctx.lineTo(9 * zoom, 0); ctx.stroke();
        ctx.strokeStyle = '#f0d9a8'; ctx.lineWidth = Math.max(1, 1.6 * zoom);
        ctx.beginPath(); ctx.moveTo(-13 * zoom, 0); ctx.lineTo(9 * zoom, 0); ctx.stroke();

        // Arrowhead
        ctx.fillStyle = PALETTE.gold;
        ctx.beginPath(); ctx.moveTo(13 * zoom, 0); ctx.lineTo(6 * zoom, -3.4 * zoom); ctx.lineTo(6 * zoom, 3.4 * zoom); ctx.closePath(); ctx.fill();

        // White/green feather fletching
        ctx.fillStyle = '#d8f8dc';
        ctx.beginPath(); ctx.moveTo(-10 * zoom, 0); ctx.lineTo(-14.5 * zoom, -3 * zoom); ctx.lineTo(-12.5 * zoom, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-10 * zoom, 0); ctx.lineTo(-14.5 * zoom, 3 * zoom); ctx.lineTo(-12.5 * zoom, 0); ctx.closePath(); ctx.fill();

        // Trailing wind spark
        const trail = (now % 160) / 160;
        ctx.globalAlpha = 0.7 * (1 - trail);
        ctx.fillStyle = '#a8ffbe';
        ctx.beginPath(); ctx.arc(-14 * zoom - trail * 11 * zoom, 0, Math.max(1, 2.0 * zoom * (1 - trail)), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  _drawEffects(ctx, toX, toY, zoom, dt) {
    if (!this.showVfx) { this.effects.length = 0; return; }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      if (e.t >= e.life) { this.effects.splice(i, 1); continue; }
      const k = e.t / e.life;

      if (e.fx === 'ring') {
        ctx.save();
        ctx.globalAlpha = 0.78 * (1 - k);
        ctx.strokeStyle = e.color; ctx.lineWidth = Math.max(1, 5.2 * zoom * (1 - k) + 1);
        ctx.beginPath(); ctx.arc(toX(e.x), toY(e.y), e.r * zoom * (0.32 + 0.68 * Math.sqrt(k)), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.18 * (1 - k); ctx.fillStyle = e.color; ctx.fill();
        ctx.restore();
        continue;
      }

      if (e.fx === 'cleave_arc') {
        // Sword (azure-silver blade wave) vs Axe (crimson-flame heavy cleave)
        const sx = toX(e.x), sy = toY(e.y);
        const rad = e.reach * zoom * (0.55 + 0.48 * Math.pow(k, 0.45));
        const a0 = e.ang - e.spread, a1 = e.ang + e.spread;
        ctx.save();
        ctx.translate(sx, sy);

        // Soft inner cone wash
        ctx.globalAlpha = (e.isAxe ? 0.28 : 0.20) * (1 - k);
        ctx.fillStyle = e.isAxe ? '#ff4d2e' : '#4aa8f0';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, rad, a0, a1);
        ctx.closePath();
        ctx.fill();

        // Outer crescent energy ribbon
        ctx.globalAlpha = 0.92 * (1 - k * k);
        ctx.strokeStyle = e.isAxe ? '#ff3838' : '#38a2ff';
        ctx.lineWidth = Math.max(2, (e.isAxe ? 14 : 10) * zoom * (1 - k * 0.6));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, rad * 0.92, a0, a1);
        ctx.stroke();

        // Mid glow band
        ctx.strokeStyle = e.isAxe ? '#ffae33' : '#7ce8ff';
        ctx.lineWidth = Math.max(1.5, (e.isAxe ? 7.5 : 5.5) * zoom * (1 - k * 0.5));
        ctx.beginPath();
        ctx.arc(0, 0, rad * 0.95, a0 + 0.06, a1 - 0.06);
        ctx.stroke();

        // Razor-white leading edge
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2.6 * zoom * (1 - k));
        ctx.beginPath();
        ctx.arc(0, 0, rad, a0 + 0.12, a1 - 0.12);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (e.fx === 'spear_thrust') {
        // Piercing lance beam with twin sonic boom rings along the thrust vector
        const sx = toX(e.x), sy = toY(e.y);
        const len = e.reach * zoom * Math.min(1, 0.35 + k * 1.35);
        const w = e.width * zoom * (1 - k * 0.65);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.ang);

        // Outer wind wake
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.fillStyle = '#b46cf0';
        ctx.beginPath();
        ctx.moveTo(8 * zoom, -w * 0.65);
        ctx.lineTo(len, 0);
        ctx.lineTo(8 * zoom, w * 0.65);
        ctx.closePath();
        ctx.fill();

        // Sharp golden-white spear beam
        ctx.globalAlpha = 0.95 * (1 - k * k);
        ctx.strokeStyle = '#ffe07a';
        ctx.lineWidth = Math.max(1.5, 6.5 * zoom * (1 - k * 0.5));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(10 * zoom, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2.6 * zoom * (1 - k * 0.5));
        ctx.beginPath();
        ctx.moveTo(14 * zoom, 0);
        ctx.lineTo(len + 6 * zoom, 0);
        ctx.stroke();

        // Sonic rings pierced by the spear shaft
        ctx.strokeStyle = '#dfbdff';
        ctx.lineWidth = Math.max(1, 2.0 * zoom * (1 - k));
        for (const frac of [0.42, 0.76]) {
          const rx = len * frac;
          const ry = (8 + k * 10) * zoom;
          ctx.beginPath();
          ctx.ellipse(rx, 0, ry * 0.38, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      if (e.fx === 'hammer_slam') {
        // Seismic ground-pound: vertical lightning/force pillar, radial fissures & flying rocks
        const sx = toX(e.x), sy = toY(e.y);
        const rad = e.r * zoom;
        ctx.save();
        ctx.translate(sx, sy);

        // 1) Initial vertical impact pillar (first 45% of life)
        if (k < 0.45) {
          const pk = k / 0.45;
          ctx.globalAlpha = 0.85 * (1 - pk);
          const pw = rad * 0.42 * (1 - pk * 0.5);
          const ph = rad * 1.9;
          const grad = ctx.createLinearGradient(0, -ph, 0, 0);
          grad.addColorStop(0, 'rgba(255, 230, 128, 0)');
          grad.addColorStop(0.6, 'rgba(255, 168, 52, 0.65)');
          grad.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
          ctx.fillStyle = grad;
          ctx.fillRect(-pw / 2, -ph, pw, ph);
        }

        // 2) Scorched ground crater glow
        ctx.globalAlpha = 0.55 * (1 - k);
        ctx.fillStyle = '#ff922b';
        ctx.beginPath();
        ctx.ellipse(0, 0, rad * (0.4 + 0.55 * Math.sqrt(k)), rad * 0.28 * (0.4 + 0.55 * Math.sqrt(k)), 0, 0, Math.PI * 2);
        ctx.fill();

        // 3) Radial jagged ground fissures
        const spokes = 7;
        ctx.lineCap = 'round';
        for (let s = 0; s < spokes; s++) {
          const a = (s / spokes) * Math.PI * 2 + (e.seed % 17) * 0.1;
          const cr = rad * (0.35 + 0.68 * Math.min(1, k * 1.8));
          const midR = cr * 0.55;
          const jag = ((s & 1) ? 1 : -1) * 0.16;
          ctx.globalAlpha = 0.9 * (1 - k);
          ctx.strokeStyle = '#2b180a';
          ctx.lineWidth = Math.max(1.5, 4.2 * zoom * (1 - k * 0.5));
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a + jag) * midR, Math.sin(a + jag) * midR * 0.65);
          ctx.lineTo(Math.cos(a) * cr, Math.sin(a) * cr * 0.65);
          ctx.stroke();

          ctx.strokeStyle = s % 2 === 0 ? '#ffe066' : '#ff7b29';
          ctx.lineWidth = Math.max(1, 2.0 * zoom * (1 - k * 0.6));
          ctx.stroke();
        }

        // 4) Parabolic flying rock debris
        for (let d = 0; d < 6; d++) {
          const da = (d / 6) * Math.PI * 2 + 0.3;
          const dx = Math.cos(da) * rad * 0.85 * k;
          const dy = Math.sin(da) * rad * 0.45 * k - (1 - (2 * k - 1) * (2 * k - 1)) * 28 * zoom;
          const dr = Math.max(1.2, 3.6 * zoom * (1 - k * 0.5));
          ctx.globalAlpha = 0.95 * (1 - k);
          ctx.fillStyle = d % 2 === 0 ? '#8c6239' : '#ffbe3d';
          ctx.beginPath();
          ctx.arc(dx, dy, dr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }

      if (e.fx === 'dagger_cross') {
        // Rapid twin X-slash with cyan-silver assassin glint
        const sx = toX(e.x), sy = toY(e.y);
        const r = e.r * zoom * (0.65 + 0.45 * k);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.ang);
        ctx.globalAlpha = 0.95 * (1 - k * k);
        for (const tilt of [-0.46, 0.46]) {
          ctx.save();
          ctx.rotate(tilt);
          ctx.strokeStyle = '#5ce0e6';
          ctx.lineWidth = Math.max(1.5, 5.2 * zoom * (1 - k));
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-r, 0);
          ctx.lineTo(r, 0);
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1, 2.2 * zoom * (1 - k));
          ctx.beginPath();
          ctx.moveTo(-r * 0.8, 0);
          ctx.lineTo(r * 0.8, 0);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
        continue;
      }

      if (e.fx === 'paw_swipe') {
        // Unarmed Bare Paws: 3 parallel claw marks
        const sx = toX(e.x), sy = toY(e.y);
        const r = e.r * zoom * (0.6 + 0.45 * k);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.ang);
        ctx.globalAlpha = 0.88 * (1 - k * k);
        ctx.lineCap = 'round';
        for (let c = -1; c <= 1; c++) {
          const offY = c * 6.5 * zoom;
          ctx.strokeStyle = '#ffd89b';
          ctx.lineWidth = Math.max(1.2, 3.4 * zoom * (1 - k));
          ctx.beginPath();
          ctx.moveTo(-r * 0.65, offY - 2 * zoom);
          ctx.quadraticCurveTo(0, offY, r * 0.75, offY + 2 * zoom);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      if (e.fx === 'ranged_charge') {
        // Ranged draw/cast flash when initiating an attack
        const sx = toX(e.x), sy = toY(e.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.ang);
        ctx.globalAlpha = 0.85 * (1 - k);
        const col = e.weaponId === 'magic_staff' ? '#6be8f5' : e.weaponId === 'crossbow' ? '#ff6b4a' : '#a8ffbe';
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, 2.4 * zoom);
        const r = 14 * zoom * (1 - k * 0.4);
        ctx.beginPath();
        ctx.arc(0, 0, r, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (e.fx === 'muzzle_flash') {
        // Projectile release burst (Bow wind snap, Crossbow fiery blast, Magic Staff arcane sigil)
        const sx = toX(e.x), sy = toY(e.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(e.ang);
        ctx.globalAlpha = 0.92 * (1 - k * k);
        if (e.weaponId === 'magic_staff') {
          const r = (12 + k * 14) * zoom;
          ctx.strokeStyle = '#6be8f5';
          ctx.lineWidth = Math.max(1.2, 2.8 * zoom * (1 - k));
          ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#df9cff';
          ctx.rotate(k * 2.2);
          ctx.strokeRect(-r * 0.65, -r * 0.65, r * 1.3, r * 1.3);
        } else if (e.weaponId === 'crossbow') {
          const len = (18 + k * 16) * zoom;
          ctx.fillStyle = '#ff6b3d';
          ctx.beginPath();
          ctx.moveTo(len, 0);
          ctx.lineTo(-4 * zoom, -9 * zoom * (1 - k * 0.5));
          ctx.lineTo(2 * zoom, 0);
          ctx.lineTo(-4 * zoom, 9 * zoom * (1 - k * 0.5));
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#fff3a8';
          ctx.beginPath(); ctx.arc(3 * zoom, 0, 4.5 * zoom * (1 - k), 0, Math.PI * 2); ctx.fill();
        } else {
          // Bow sonic wind V-snap
          const r = (13 + k * 12) * zoom;
          ctx.strokeStyle = '#d8f8dc';
          ctx.lineWidth = Math.max(1, 2.5 * zoom * (1 - k));
          ctx.beginPath();
          ctx.arc(-4 * zoom, 0, r, -0.75, 0.75);
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      if (e.fx === 'hit_impact') {
        // Directional weapon-specific hit burst on the victim
        const sx = toX(e.x), sy = toY(e.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.globalAlpha = 0.92 * (1 - k);
        const wid = e.weaponId;
        const col = wid === 'magic_staff' ? '#6be8f5'
          : wid === 'axe' || wid === 'crossbow' ? '#ff4757'
          : wid === 'hammer' ? '#ffbe3d'
          : wid === 'spear' ? '#d9a7ff'
          : wid === 'sword' || wid === 'dagger' ? '#7ce8ff'
          : '#ffe085';

        // Impact shock ring
        const rr = (14 + k * 24) * zoom;
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.2, 3.4 * zoom * (1 - k));
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();

        // Directional scatter spikes along the hit angle
        const spikes = 7;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1, 2.2 * zoom * (1 - k));
        ctx.beginPath();
        for (let s = 0; s < spikes; s++) {
          const sa = e.ang + (s - (spikes - 1) / 2) * 0.34;
          const r0 = rr * 0.35;
          const r1 = rr * (0.95 + ((s & 1) ? 0.38 : 0.1));
          ctx.moveTo(Math.cos(sa) * r0, Math.sin(sa) * r0);
          ctx.lineTo(Math.cos(sa) * r1, Math.sin(sa) * r1);
        }
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (e.fx === 'burst_sparks') {
        const sx = toX(e.x), sy = toY(e.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.globalAlpha = 0.95 * (1 - k * k);
        for (let s = 0; s < e.count; s++) {
          const frac = e.count > 1 ? s / (e.count - 1) - 0.5 : 0;
          const a = e.ang + frac * e.spread + ((s * 1.7) % 0.25);
          const dist = e.speed * (0.45 + (s % 3) * 0.25) * k * zoom;
          const px = Math.cos(a) * dist, py = Math.sin(a) * dist;
          const r = Math.max(1.1, (3.2 - k * 2.0) * zoom);
          ctx.fillStyle = (s & 1) ? e.color : e.subColor;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }

      if (e.fx === 'dodge_flash') {
        const sx = toX(e.x), sy = toY(e.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.globalAlpha = 0.75 * (1 - k);
        ctx.strokeStyle = '#5ce0e6';
        ctx.lineWidth = Math.max(1, 2.4 * zoom * (1 - k));
        const r = (16 + k * 18) * zoom;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.55, -0.25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (e.fx === 'dmg_text') {
        if (zoom < 0.26) continue;
        // Pop-in elastic scale then float upward
        const pop = k < 0.18 ? (0.65 + (k / 0.18) * 0.55) : (1.2 - Math.min(0.25, (k - 0.18) * 0.4));
        const fontPx = Math.round(14 * (e.scale || 1) * pop * Math.min(1.5, zoom + 0.25));
        ctx.save();
        ctx.globalAlpha = 1 - Math.pow(k, 2.2);
        ctx.font = `900 ${fontPx}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2.5, 3.6 * zoom);
        ctx.strokeStyle = 'rgba(18, 10, 24, 0.95)';
        const yy = toY(e.y) - 28 * zoom * Math.pow(k, 0.8);
        ctx.strokeText(e.text, toX(e.x), yy);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, toX(e.x), yy);
        ctx.restore();
        continue;
      }

      if (e.fx === 'icon') {                       // an item popping up and fading
        if (zoom < 0.15) continue;
        const s = e.size * zoom * (0.7 + 0.3 * Math.min(1, k * 4));
        ctx.save();
        ctx.globalAlpha = 1 - k * k;
        ctx.drawImage(e.img, toX(e.x) - s / 2, toY(e.y) - 40 * zoom * k - s / 2, s, s);
        ctx.restore();
        continue;
      }
      if (e.fx === 'text') {
        if (zoom < 0.3) continue;
        ctx.save();
        ctx.globalAlpha = 1 - k * k;
        ctx.font = `800 ${Math.round(14 * Math.min(1.5, zoom + 0.2))}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(21,16,28,0.9)';
        const yy = toY(e.y) - 22 * zoom * k;
        ctx.strokeText(e.text, toX(e.x), yy);
        ctx.fillStyle = e.color; ctx.fillText(e.text, toX(e.x), yy);
        ctx.restore();
        continue;
      }
      const frames = this.assets.vfx[e.fx];
      if (!frames || !frames.length) continue;
      const idx = Math.min(frames.length - 1, Math.floor(k * frames.length));
      const img = frames[idx];
      if (!img) continue;
      const s = 128 * e.scale * zoom;
      ctx.save();
      ctx.globalAlpha = 1 - Math.pow(k, 3);
      ctx.translate(toX(e.x), toY(e.y));
      if (e.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  /**
   * Items spread evenly along a ring of radius r, `spacing` world units apart. The count is
   * a power of two, so when the ring shrinks past a level the odd-index items (the finer
   * level) fade out instead of every item jumping to a new angle. Calls fn(angle, slot, alpha).
   */
  _ringSlots(r, spacing, maxLevel, fn) {
    const want = Math.max(4, (2 * Math.PI * r) / spacing);
    const lf = Math.min(maxLevel, Math.log2(want));
    const L = Math.max(2, Math.ceil(lf));
    const n = 1 << L;
    const frac = L === Math.ceil(lf) ? 1 - (L - lf) : 1;
    const fine = 1 << (maxLevel - L);             // slot id in the finest grid, stable across levels
    for (let k = 0; k < n; k++) fn((k / n) * Math.PI * 2, k * fine, (k & 1) ? frac : 1);
  }

  /** Cat Storm: purple fog, swirling storm clouds, glowing cat eyes and cat tails poking in. */
  _drawStorm(ctx, state, toX, toY, zoom, W, H) {
    const z = state.zone;
    const cx = toX(z.cx), cy = toY(z.cy), r = Math.max(0, z.r * zoom), rw = Math.max(1, z.r);
    const now = performance.now();
    const S = this.assets.storm || { clouds: [], eyes: [], tails: [] };
    const onScreen = (px, py, half) => px > -half && px < W + half && py > -half && py < H + half;
    const art = (a, px, py, w, rot) => {
      const h = (a.box.h / a.box.w) * w;
      if (rot) { ctx.save(); ctx.translate(px, py); ctx.rotate(rot); ctx.drawImage(a.img, a.box.x, a.box.y, a.box.w, a.box.h, -w / 2, -h / 2, w, h); ctx.restore(); }
      else ctx.drawImage(a.img, a.box.x, a.box.y, a.box.w, a.box.h, px - w / 2, py - h / 2, w, h);
    };
    const hash = (k) => { let h = Math.imul(k + 0x9e37, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };

    // Layering, back to front: fog -> glowing ring -> the cat (clouds, eyes, tails), all
    // of the cat strictly outside the safe circle so it never covers the playable area.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(58,20,80,0.6)';
    ctx.fill('evenodd');
    ctx.restore();

    // Glowing magenta edge (behind the cat). The glow is two wide translucent strokes:
    // shadowBlur on a circle this size was one of the most expensive things in the frame.
    ctx.save();
    const pulse = 7 + Math.sin(now / 250) * 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,32,144,0.18)'; ctx.lineWidth = Math.max(8, (pulse + 26) * zoom); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,32,144,0.32)'; ctx.lineWidth = Math.max(5, (pulse + 12) * zoom); ctx.stroke();
    ctx.strokeStyle = PALETTE.stormEdge;
    ctx.lineWidth = Math.max(2, pulse * zoom);
    ctx.stroke();
    ctx.strokeStyle = '#ffd0eb';
    ctx.lineWidth = Math.max(1, 2.2 * zoom);
    ctx.stroke();
    ctx.restore();

    // The cat lives outside the circle: clip to it (plus half the ring, so the clouds sit
    // in front of the ring's outer glow).
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(cx, cy, r + Math.max(1, 4 * zoom), 0, Math.PI * 2, true);
    ctx.clip('evenodd');

    // Storm clouds in two drifting bands, eyes glowing between them.
    if (S.clouds.length && 230 * zoom > 6) {
      const bands = [{ off: 80, size: 250, spacing: 150, drift: 1 / 90000 }, { off: 230, size: 300, spacing: 190, drift: -1 / 120000 }];
      for (let bi = 0; bi < bands.length; bi++) {
        const B = bands[bi];
        // Zoomed far out the whole ring is on screen: spread the clouds (and grow them to
        // match) so they stay >= 40 px apart — a few dozen sprites instead of ~500 specks.
        const spread = Math.min(3, Math.max(1, 40 / (B.spacing * zoom)));
        const rr = rw + B.off * spread;
        this._ringSlots(rr, B.spacing * spread, 11, (a0, slot, alpha) => {
          const a = a0 + now * B.drift;
          const px = cx + Math.cos(a) * rr * zoom, py = cy + Math.sin(a) * rr * zoom;
          const hs = hash(slot * 2 + bi);
          const w = B.size * spread * (0.85 + (hs % 100) / 330) * zoom;
          if (!onScreen(px, py, w)) return;
          ctx.globalAlpha = 0.9 * alpha;
          art(S.clouds[hs % S.clouds.length], px, py, w, 0);
        });
      }
    }
    if (S.eyes.length && 240 * zoom > 8) {
      const eyeSpread = Math.min(2.2, Math.max(1, 70 / (520 * zoom)));
      const rr = rw + 210 * eyeSpread;
      this._ringSlots(rr, 680 * eyeSpread, 9, (a0, slot, alpha) => {
        const hs = hash(slot + 77);
        const a = a0 + ((hs % 100) / 100 - 0.5) * 0.06;
        const px = cx + Math.cos(a) * rr * zoom, py = cy + Math.sin(a) * rr * zoom;
        const w = 245 * eyeSpread * zoom;
        if (!onScreen(px, py, w * 1.4)) return;

        const blink = Math.sin(now / 1200 + (hs % 628) / 100) > 0.965 ? 0.15 : 1;
        const glowAlpha = alpha * blink * (0.88 + 0.12 * Math.sin(now / 310 + (hs % 314) / 100));

        ctx.save();
        ctx.translate(px, py);
        ctx.globalAlpha = alpha * 0.55;
        ctx.fillStyle = '#1b0929';
        ctx.beginPath();
        ctx.ellipse(0, 4 * zoom, w * 0.68, w * 0.34, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = glowAlpha;
        const whiskerTwitch = Math.sin(now / 280 + slot) * 0.045;
        for (const side of [-1, 1]) {
          for (let wi = -1; wi <= 1; wi++) {
            const wy0 = (12 + wi * 11) * eyeSpread * zoom;
            const wx0 = side * w * 0.34;
            const wx1 = side * w * (0.88 + (1 - Math.abs(wi)) * 0.12);
            const wy1 = wy0 + (wi * 16 + Math.sin(now / 360 + wi + slot) * 5) * eyeSpread * zoom;
            const cpx = side * w * 0.62;
            const cpy = wy0 - (8 - wi * 6) * eyeSpread * zoom + whiskerTwitch * w;

            ctx.strokeStyle = '#240b36';
            ctx.lineWidth = Math.max(2.5, 6.5 * eyeSpread * zoom);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(wx0, wy0);
            ctx.quadraticCurveTo(cpx, cpy, wx1, wy1);
            ctx.stroke();

            ctx.strokeStyle = wi === 0 ? '#ffe885' : '#ff99d6';
            ctx.lineWidth = Math.max(1.3, 3.0 * eyeSpread * zoom);
            ctx.beginPath();
            ctx.moveTo(wx0, wy0);
            ctx.quadraticCurveTo(cpx, cpy, wx1, wy1);
            ctx.stroke();
          }
        }

        const ny = 14 * eyeSpread * zoom;
        const nw = 11 * eyeSpread * zoom, nh = 8 * eyeSpread * zoom;
        ctx.fillStyle = '#ff6ec7';
        ctx.strokeStyle = '#240b36';
        ctx.lineWidth = Math.max(1, 2.2 * eyeSpread * zoom);
        ctx.beginPath();
        ctx.moveTo(-nw, ny - nh * 0.5);
        ctx.lineTo(nw, ny - nh * 0.5);
        ctx.lineTo(0, ny + nh * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.globalAlpha = glowAlpha;
        art(S.eyes[hs % S.eyes.length], px, py - 4 * eyeSpread * zoom, w, 0);
      });
    }
    // Outer storm bursts / electric explosions (bão nổ bên ngoài, không có phần đuôi).
    if (200 * zoom > 6) {
      const burstSpread = Math.min(2.5, Math.max(1, 45 / (220 * zoom)));
      const br = rw + 145 * burstSpread;
      this._ringSlots(br, 260 * burstSpread, 10, (a0, slot, alpha) => {
        const hs = hash(slot + 503);
        const phase = ((now / 650 + (hs % 1000) / 1000) % 1);
        const a = a0 + Math.sin(now / 1400 + slot) * 0.04;
        const dist = br + (hs % 90) * burstSpread;
        const px = cx + Math.cos(a) * dist * zoom, py = cy + Math.sin(a) * dist * zoom;
        const maxR = (42 + (hs % 36)) * burstSpread * zoom;
        if (!onScreen(px, py, maxR * 2)) return;

        ctx.save();
        const bang = Math.sin(phase * Math.PI);
        ctx.globalAlpha = alpha * bang * 0.85;
        ctx.strokeStyle = phase < 0.45 ? '#ffe57f' : '#ff45a8';
        ctx.lineWidth = Math.max(1.2, (4.5 * (1 - phase)) * zoom);
        ctx.beginPath();
        ctx.arc(px, py, maxR * (0.3 + 0.7 * phase), 0, Math.PI * 2);
        ctx.stroke();

        const spikes = 6 + (hs % 3);
        ctx.strokeStyle = '#ffd0eb';
        ctx.lineWidth = Math.max(1, 2.2 * zoom);
        ctx.beginPath();
        for (let i = 0; i < spikes; i++) {
          const sa = (i / spikes) * Math.PI * 2 + (hs % 60) * 0.1 + phase * 0.6;
          const r0 = maxR * 0.18 * phase;
          const r1 = maxR * (0.55 + ((i & 1) ? 0.45 : 0.15)) * bang;
          ctx.moveTo(px + Math.cos(sa) * r0, py + Math.sin(sa) * r0);
          ctx.lineTo(px + Math.cos(sa) * r1, py + Math.sin(sa) * r1);
        }
        ctx.stroke();

        if (phase < 0.5) {
          ctx.fillStyle = '#fff3b0';
          ctx.globalAlpha = alpha * (1 - phase * 2) * 0.9;
          ctx.beginPath();
          ctx.arc(px, py, maxR * 0.28 * (1 - phase), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }
    ctx.restore();
  }

  _drawMinimap(ctx, state, W, H) {
    const size = Math.min(170, Math.max(110, W * 0.14));
    const pad = 14;
    const x0 = W - size - pad, y0 = H - size - pad;
    const k = size / this.world.width;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = 'rgba(21,16,28,0.86)';
    ctx.strokeStyle = '#4a3560'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 10); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(x0 + 2, y0 + 2, size - 4, size - 4, 8); ctx.clip();
    ctx.fillStyle = 'rgba(125,145,80,0.35)';
    ctx.fillRect(x0, y0, size, size);
    if (this._bakeOverview()) {
      ctx.globalAlpha = 0.75;
      ctx.drawImage(this.overview, x0, y0, size, size);
      ctx.globalAlpha = 0.88;
    }
    ctx.strokeStyle = PALETTE.stormEdge; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x0 + state.zone.cx * k, y0 + state.zone.cy * k, state.zone.r * k, 0, Math.PI * 2); ctx.stroke();
    for (const b of state.bots) {
      if (!b.alive) continue;
      ctx.fillStyle = b.crown ? PALETTE.gold : (b.id === this.selectedId ? '#5ce0e6' : '#efa04b');
      ctx.beginPath(); ctx.arc(x0 + b.x * k, y0 + b.y * k, b.crown ? 3 : 1.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    this.minimapRect = { x0, y0, size, k };
  }
}

export { PALETTE };
