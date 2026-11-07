// AGY asset integration. Loads the modular layer PNGs from src/assets/agy and bakes
// one cached sprite per (appearance, facing, weapon, crown) combination, in the
// z-order published by the asset manifest. Renderer-only: nothing here touches core.

// Resolved from this module's own URL, not from the page's. A page-relative path breaks
// the moment a page lives in a sub-directory (admin/index.html), and silently: the sprites
// just 404 and every hamster renders blank.
export const AGY_BASE = new URL('../assets/agy', import.meta.url).href.replace(/\/$/, '');
export const SPRITE_PX = 128;          // baked sprite resolution
export const SPRITE_WORLD = 66;        // how wide a baked sprite is in world units

import { WEAPONS, CONSUMABLES } from '../core/ruleset.js';

// Derived from the ruleset so a new weapon only needs its PNGs, never a renderer edit.
const WEAPON_IDS = WEAPONS.map((w) => w.id);
const CONSUMABLE_IDS = CONSUMABLES.map((c) => c.id);

const nn = (i) => String(i + 1).padStart(2, '0');
/**
 * Map + storm art (AGY map pack). Indexed by obstacle kind (see core/world.js OBSTACLE_KIND)
 * then by variant, so the replay's (kind, v) pair picks the PNG directly.
 */
export const MAP_ART = {
  kinds: [
    Array.from({ length: 10 }, (_, i) => `map/rock_${nn(i)}`),
    Array.from({ length: 10 }, (_, i) => `map/crate_${nn(i)}`),
    Array.from({ length: 10 }, (_, i) => `map/bush_${nn(i)}`),
    Array.from({ length: 10 }, (_, i) => `map/stump_${nn(i)}`),
    [],                                                   // wall: reserved, dropped from the pack
    ['map/tree_green_large', 'map/tree_autumn_large', 'map/tree_green_medium', 'map/tree_autumn_medium'],
    ['map/building_cheese_windmill', 'map/building_hamster_cottage'],
  ],
  chestClosed: 'map/chest_paw_closed', chestOpen: 'map/chest_paw_open',
  daisy: 'map/foliage_daisy_patch', bridge: 'map/terrain_wooden_bridge',
  // Seamless 256x256 ground tiles; the match's decor.ground picks one.
  grounds: ['meadow_green', 'forest_moss', 'autumn_gold', 'sandy_dirt', 'cobblestone',
            'sunset_clay', 'lavender_twilight', 'snow_frost', 'cheese_cream', 'dark_slate'].map((g) => `map/ground_${g}`),
  // Tiles whose edges show as a grid when repeated (a lighter band along the border).
  // The renderer cross-fades them with a half-tile-shifted copy at load time; only safe
  // for textures without hard shapes (stone tiles would ghost), so it is opt-in.
  seamBlend: ['map/ground_cheese_cream'],
};
export const STORM_ART = {
  clouds: Array.from({ length: 4 }, (_, i) => `storm/storm_cloud_${nn(i)}`),
  eyes: Array.from({ length: 4 }, (_, i) => `storm/cat_eyes_${nn(i)}`),
  tails: Array.from({ length: 6 }, (_, i) => `storm/cat_tail_${nn(i)}`),
};

/** Opaque-pixel bounding box, so sprites with different padding anchor at their real feet. */
function contentBox(img) {
  const box = { x: 0, y: 0, w: img.width, h: img.height };
  try {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, img.width, img.height).data;
    let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        if (d[(y * img.width + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 >= x0 && y1 >= y0) { box.x = x0; box.y = y0; box.w = x1 - x0 + 1; box.h = y1 - y0 + 1; }
  } catch (_) { /* tainted canvas (file://): fall back to the full image */ }
  return box;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Layer file paths for one cosmetic recipe, in manifest z-order.
 * Weapons ship as ONE right-facing image (weapon_<id>_right.png); a left-facing hamster
 * draws it mirrored around the sprite centre (see spriteFor). The old _left files were
 * exact mirrors of _right, so this is pixel-identical.
 */
const weaponUrl = (weapon) => `${AGY_BASE}/weapons/weapon_${WEAPON_IDS[weapon]}_right.png`;
const isWeaponUrl = (url) => url.includes('/weapons/weapon_');

function layerUrls(app, facing, weapon, crown) {
  const f = facing;
  const urls = [`${AGY_BASE}/hamster/base/shadow_${f}.png`];
  if (app.outfitBack && app.outfitBack !== 'none') urls.push(`${AGY_BASE}/hamster/accessories/back_${app.outfitBack}_${f}.png`);
  urls.push(`${AGY_BASE}/hamster/fur/body_${app.furColor}_${f}.png`);
  if (app.furPattern && app.furPattern !== 'solid' && app.furPattern !== 'none') urls.push(`${AGY_BASE}/hamster/fur/pattern_${app.furPattern}_${f}.png`);
  urls.push(`${AGY_BASE}/hamster/faces/face_mouth_${f}.png`);
  if (app.faceEyes && app.faceEyes !== 'none') urls.push(`${AGY_BASE}/hamster/faces/eyes_${app.faceEyes}_${f}.png`);
  if (app.outfitBody && app.outfitBody !== 'none') urls.push(`${AGY_BASE}/hamster/outfits/body_${app.outfitBody}_${f}.png`);
  if (app.headwear && app.headwear !== 'none') urls.push(`${AGY_BASE}/hamster/outfits/head_${app.headwear}_${f}.png`);
  if (weapon >= 0) urls.push(weaponUrl(weapon));
  if (crown) urls.push(`${AGY_BASE}/hamster/accessories/crown_king_${f}.png`);
  return urls;
}

/** Fur colour of the dot that stands in for a hamster when the art pack is absent. */
const DOT_FUR = {
  honey_orange: '#efa04b', russet_brown: '#a8643a', ash_grey: '#9aa0a8', taro_lilac: '#b79ad8',
  snow_cream: '#f3e9d2', golden_butter: '#f2cf5b', charcoal_spike: '#4a4550', maple_cinnamon: '#c5743f',
};
const DOT_FEET_Y = 0.84375;   // sprite pivot (feet), same as the renderer's PIVOT_Y

/** Dot sprite: body dot at the feet pivot, gold ring for the Crown, small tick on the weapon side. */
function drawDot(ctx, app, faceLeft, weapon, crown) {
  const S = SPRITE_PX, r = S * 0.17, cx = S / 2, cy = S * DOT_FEET_Y - r;
  ctx.fillStyle = DOT_FUR[app && app.furColor] || '#efa04b';
  ctx.strokeStyle = '#2b2230'; ctx.lineWidth = S * 0.03;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (weapon >= 0) {
    ctx.fillStyle = '#2b2230';
    ctx.beginPath(); ctx.arc(cx + (faceLeft ? -1 : 1) * r * 1.15, cy, r * 0.32, 0, Math.PI * 2); ctx.fill();
  }
  if (crown) {
    ctx.strokeStyle = '#f8c84d'; ctx.lineWidth = S * 0.035;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2); ctx.stroke();
  }
}

export class AssetLibrary {
  constructor() {
    this.images = new Map();
    this.sprites = new Map();
    this.manifest = null;
    this.ready = false;
    this.vfx = { weapon_slash: [], hit_sparks: [], crown_pulse: [], dash_dust: [] };
    this.weaponIcons = [];
    this.consumableIcons = [];
    this.missing = [];
    // { img, box } per entry; box = opaque bounds used to anchor props at their base.
    this.mapKinds = [];
    this.map = {};
    this.storm = { clouds: [], eyes: [], tails: [] };
  }

  _art(key) {
    const img = this.images.get(`${AGY_BASE}/${key}.png`);
    return img ? { img, box: contentBox(img) } : null;
  }

  async _img(url) {
    if (this.images.has(url)) return this.images.get(url);
    const img = await loadImage(url);
    if (!img) this.missing.push(url);
    this.images.set(url, img);
    return img;
  }

  /**
   * Preload exactly the layers this match needs, plus weapons, crown, VFX and icons.
   * onProgress(loaded, total) drives the loading bar.
   */
  async loadForMatch(bots, onProgress) {
    // The art pack is optional: without it every hamster renders as a dot (see spriteFor).
    try {
      const res = await fetch(`${AGY_BASE}/manifest.json`);
      this.manifest = res.ok ? await res.json() : null;
    } catch (_) { this.manifest = null; }

    const needed = new Set();
    for (const f of ['left', 'right']) {
      needed.add(`${AGY_BASE}/hamster/base/shadow_${f}.png`);
      needed.add(`${AGY_BASE}/hamster/faces/face_mouth_${f}.png`);
      needed.add(`${AGY_BASE}/hamster/accessories/crown_king_${f}.png`);
      for (const b of bots) for (const u of layerUrls(b.appearance, f, -1, false)) needed.add(u);
    }
    for (let w = 0; w < WEAPON_IDS.length; w++) needed.add(weaponUrl(w));      // right-facing only
    for (const w of WEAPON_IDS) needed.add(`${AGY_BASE}/weapons/icon_${w}.png`);
    for (const c of CONSUMABLE_IDS) needed.add(`${AGY_BASE}/items/icon_${c}.png`);
    const artKeys = [...MAP_ART.kinds.flat(), MAP_ART.chestClosed, MAP_ART.chestOpen, MAP_ART.daisy,
                     MAP_ART.bridge, ...MAP_ART.grounds, ...STORM_ART.clouds, ...STORM_ART.eyes, ...STORM_ART.tails];
    for (const k of artKeys) needed.add(`${AGY_BASE}/${k}.png`);
    for (const fx of Object.keys(this.vfx)) {
      const count = fx === 'weapon_slash' ? 5 : fx === 'crown_pulse' ? 5 : fx === 'dash_dust' ? 5 : 4;
      for (let i = 0; i < count; i++) needed.add(`${AGY_BASE}/vfx/${fx}-0${i}.png`);
    }

    const list = [...needed];
    let done = 0;
    const CONCURRENCY = 24;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      await Promise.all(list.slice(i, i + CONCURRENCY).map(async (u) => {
        await this._img(u);
        done++;
        if (onProgress && (done % 8 === 0 || done === list.length)) onProgress(done, list.length);
      }));
    }

    for (const fx of Object.keys(this.vfx)) {
      const count = fx === 'weapon_slash' ? 5 : fx === 'crown_pulse' ? 5 : fx === 'dash_dust' ? 5 : 4;
      this.vfx[fx] = [];
      for (let i = 0; i < count; i++) {
        const img = this.images.get(`${AGY_BASE}/vfx/${fx}-0${i}.png`);
        if (img) this.vfx[fx].push(img);
      }
    }
    this.weaponIcons = WEAPON_IDS.map((w) => this.images.get(`${AGY_BASE}/weapons/icon_${w}.png`) || null);
    this.consumableIcons = CONSUMABLE_IDS.map((c) => this.images.get(`${AGY_BASE}/items/icon_${c}.png`) || null);
    this.mapKinds = MAP_ART.kinds.map((list) => list.map((k) => this._art(k)));
    for (const k of ['chestClosed', 'chestOpen', 'daisy', 'bridge']) this.map[k] = this._art(MAP_ART[k]);
    this.map.grounds = MAP_ART.grounds.map((k) => this.images.get(`${AGY_BASE}/${k}.png`) || null);
    this.map.groundSeamBlend = MAP_ART.grounds.map((k) => MAP_ART.seamBlend.includes(k));
    for (const k of Object.keys(STORM_ART)) this.storm[k] = STORM_ART[k].map((key) => this._art(key)).filter(Boolean);
    this.ready = true;
    return { loaded: list.length, missing: this.missing.length };
  }

  /** Load only the hamster layers for these appearances (NFT cards in the dApp). */
  async loadHamsterLayers(appearances) {
    const needed = new Set();
    for (const f of ['left', 'right']) {
      needed.add(`${AGY_BASE}/hamster/base/shadow_${f}.png`);
      needed.add(`${AGY_BASE}/hamster/faces/face_mouth_${f}.png`);
      for (const a of appearances) for (const u of layerUrls(a, f, -1, false)) needed.add(u);
    }
    await Promise.all([...needed].map((u) => this._img(u)));
  }

  /** Cached composite sprite. Layers are already pivot-aligned in the source PNGs. */
  spriteFor(appearance, faceLeft, weapon, crown) {
    const facing = faceLeft ? 'left' : 'right';
    const key = `${appearance.appearanceHash}|${facing}|${weapon}|${crown ? 1 : 0}`;
    const hit = this.sprites.get(key);
    if (hit) return hit;

    const cv = document.createElement('canvas');
    cv.width = SPRITE_PX; cv.height = SPRITE_PX;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    let drawn = 0;
    for (const url of layerUrls(appearance, facing, weapon, crown)) {
      const img = this.images.get(url);
      if (!img) continue;
      drawn++;
      if (faceLeft && isWeaponUrl(url)) {            // the weapon art is right-facing: mirror it
        ctx.save();
        ctx.translate(SPRITE_PX, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, SPRITE_PX, SPRITE_PX);
        ctx.restore();
      } else ctx.drawImage(img, 0, 0, SPRITE_PX, SPRITE_PX);
    }
    if (!drawn) drawDot(ctx, appearance, faceLeft, weapon, crown);
    if (this.sprites.size > 1400) this.sprites.clear();    // simple bound, re-bakes on demand
    this.sprites.set(key, cv);
    return cv;
  }

  /** Art for an obstacle; null falls back to the vector drawing. */
  obstacleArt(kind, v) {
    const list = this.mapKinds[kind];
    if (!list || !list.length) return null;
    return list[(v | 0) % list.length] || null;
  }

  weaponIcon(weapon) { return weapon >= 0 ? this.weaponIcons[weapon] : null; }
  consumableIcon(c) { return c >= 0 ? this.consumableIcons[c] : null; }
  /** The right-facing weapon image; mirror it yourself for a left-facing hamster. */
  weaponSprite(weapon) {
    if (weapon < 0) return null;
    return this.images.get(weaponUrl(weapon)) || null;
  }
}

export { WEAPON_IDS, CONSUMABLE_IDS };
