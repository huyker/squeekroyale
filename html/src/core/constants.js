// Core constants. Pure data; no browser APIs, no Date, no Math.random.
export const SIMULATOR_VERSION = '1.4.0';
export const RNG_ALGORITHM_VERSION = 'xoshiro128ss-1';
export const REPLAY_SCHEMA_VERSION = 7;

/** Simulation runs at a fixed integer tick rate. */
export const TICK_HZ = 20;
export const MS_PER_TICK = 1000 / TICK_HZ; // 50 — display only, never used for stepping

/** Fixed-point scale for all world units (position, velocity, radius). */
export const FP = 256;

/** HP is stored in centi-HP so damage/armor division stays integral. */
export const HP_SCALE = 100;

/** A snapshot every N ticks (20 Hz / 2 = 10 Hz). */
export const SNAPSHOT_EVERY = 2;

/** Strategic AI decision cadence: every 4 ticks = 5 Hz, staggered by botId. */
export const STRATEGIC_EVERY = 4;

export const ACTIONS = ['ZONE', 'FLEE', 'ATTACK', 'LOOT', 'SUPPLY', 'HUNT', 'ROAM'];
export const ACT_ZONE = 0, ACT_FLEE = 1, ACT_ATTACK = 2, ACT_LOOT = 3,
             ACT_SUPPLY = 4, ACT_HUNT = 5, ACT_ROAM = 6;

/** Event type ids — order is part of the replay schema, never reorder. */
export const EV = {
  SPAWN: 0, PICKUP: 1, DROP: 2, ATTACK: 3, PROJECTILE_SPAWN: 4, HIT: 5, MISS: 6,
  DAMAGE: 7, DASH: 8, STUN: 9, DEATH: 10, KILL: 11, ZONE_PHASE: 12, ZONE_DAMAGE: 13,
  SUPPLY_SPAWN: 14, SUPPLY_OPEN: 15, CROWN_CREATE: 16, CROWN_TRANSFER: 17,
  CROWN_DROP: 18, CROWN_PICKUP: 19, TIEBREAK: 20, MATCH_END: 21,
  // schema v4 — healing consumables and weapon signatures
  CONSUMABLE_PICKUP: 22,  // a bot, b item id, c consumable index, d x, e y
  CONSUME: 23,            // a bot, b consumable index, c channel ticks, d 0 start / 1 done / 2 interrupted
  HEAL: 24,               // a bot, b source (consumable index, -3 supply, -4 chest), c centi-HP healed, d hp after
  EXPLODE: 25,            // reserved: removed in v1.3.1 with Cheese Bomb, never emitted
  SLOW: 26,               // reserved: removed in v1.3.1 with Thorn Whip, never emitted
  // schema v5 — map treasure chests (touch to open, the cheese inside heals)
  CHEST_OPEN: 27,         // a bot, b chest id, c centi-HP healed, d x, e y
  LAND: 28,               // a bot, b x, c y — parachute touch-down; the bot may act from now on
};
export const EV_NAME = Object.keys(EV);

/** Snapshot bot record layout (6 int32 per bot). */
export const SNAP_STRIDE = 6;
export const S_X = 0, S_Y = 1, S_HP = 2, S_FLAGS = 3, S_WEAPON = 4, S_ANIM = 5;
export const F_ALIVE = 1, F_FACE_LEFT = 2, F_CROWN = 4, F_DASH = 8, F_STUN = 16, F_ATTACK = 32;
export const F_CONSUMING = 64, F_SLOWED = 128, F_HOT = 256, F_HASTE = 512;
/** Bag size (0..3) rides in flag bits 12-13, so the 6-int snapshot stride is unchanged. */
export const F_BAG_SHIFT = 12, F_BAG_MASK = 3;

/** Animation ids, matching assets/agy manifest animation keys (no idle — stand is one frame). */
export const ANIM = { stand: 0, run: 1, attack_melee: 2, attack_ranged: 3, dash: 4, hit: 5, death: 6, pickup: 7, crown_receive: 8 };
export const ANIM_NAME = Object.keys(ANIM);
