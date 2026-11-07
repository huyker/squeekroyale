// Balance ruleset V1. Every number that can change a match outcome lives here,
// so rulesetHash alone identifies the balance. Tuning = new version + new hash.
import { hashObject } from './hash.js';
import { ITEM_STATS, STAT_BASE, GENOME_VERSION } from './hamster.js';

/** Equipment stat table is balance too: it is hashed with the ruleset. */
const GENOME = { version: GENOME_VERSION, base: STAT_BASE, items: ITEM_STATS };

/**
 * Weapon table — whitepaper §4.3 preset. `u` = game-world units, seconds -> ticks at 20 Hz.
 *
 * Attack patterns (v1.4):
 *   'straight'  – single-target strike in a line (dagger, unarmed)
 *   'cone'      – cleave in a cone, hits multiple targets (sword, axe)
 *   'circle'    – ground-pound AoE circle around the impact point (hammer)
 *   'line'      – thrust pierces in a straight line through all enemies (spear)
 *   'projectile'– ranged projectile (bow, crossbow, staff)
 *
 * coneAngle    – half-angle of the cone in permille of a half-turn (1000 = 180°), only for 'cone'
 * aoeRadius    – radius of the AoE circle in world units, only for 'circle'
 * lineWidth    – half-width of the piercing line in world units, only for 'line'
 */
export const WEAPONS = [
  { id: 'dagger',      name: 'Dagger',      type: 'melee',  damage: 12, cooldown: 0.35, range: 32,  tier: 1, stun: 0,  projectileSpeed: 0,   windup: 1, pattern: 'straight' },
  { id: 'sword',       name: 'Sword',       type: 'melee',  damage: 25, cooldown: 0.75, range: 46,  tier: 3, stun: 0,  projectileSpeed: 0,   windup: 2, pattern: 'cone', coneAngle: 333 },
  { id: 'axe',         name: 'Axe',         type: 'melee',  damage: 38, cooldown: 1.15, range: 48,  tier: 5, stun: 0,  projectileSpeed: 0,   windup: 3, pattern: 'cone', coneAngle: 389 },
  { id: 'spear',       name: 'Spear',       type: 'melee',  damage: 22, cooldown: 0.85, range: 85,  tier: 4, stun: 0,  projectileSpeed: 0,   windup: 2, pattern: 'line', lineWidth: 18 },
  { id: 'hammer',      name: 'Hammer',      type: 'melee',  damage: 45, cooldown: 1.55, range: 50,  tier: 6, stun: 8,  projectileSpeed: 0,   windup: 4, pattern: 'circle', aoeRadius: 55 },
  { id: 'bow',         name: 'Bow',         type: 'ranged', damage: 18, cooldown: 0.90, range: 220, tier: 2, stun: 0,  projectileSpeed: 520, windup: 2, pattern: 'projectile' },
  { id: 'crossbow',    name: 'Crossbow',    type: 'ranged', damage: 34, cooldown: 1.55, range: 250, tier: 6, stun: 0,  projectileSpeed: 640, windup: 3, pattern: 'projectile' },
  { id: 'magic_staff', name: 'Magic Staff', type: 'ranged', damage: 20, cooldown: 1.20, range: 190, tier: 4, stun: 0,  projectileSpeed: 380, windup: 3, pattern: 'projectile' },
  // --- v1.1 addition, TEMPORARILY DISABLED (disabled: true): every loot table gives it
  // weight 0, so it never appears in a match. To re-enable, drop the flag and give it a
  // weight in the loot tables below. (Twin Claws, Thorn Whip, Cheese Bomb and Reaper Scythe
  // were removed from the game in v1.3.1 together with their signature mechanics.)
  { id: 'seed_sling',  name: 'Seed Sling',  type: 'ranged', damage: 9,  cooldown: 0.40, range: 170, tier: 1, stun: 0,  projectileSpeed: 600, windup: 1, pattern: 'projectile', disabled: true },
];

/**
 * Healing consumables (v1.1). Picked up into a 3-slot bag, used by the AI when hurt.
 *   heal      instant HP restored when the channel completes
 *   hotHp     extra HP restored evenly over hotTicks (heal-over-time)
 *   useTicks  channel time; the bot keeps moving at channelSpeedPct but cannot attack
 *   interrupt true = taking a hit cancels the channel (the item stays in the bag)
 *   hasteTicks/hastePct  move-speed buff after use
 */
export const CONSUMABLES = [
  { id: 'sunflower_seed',    name: 'Sunflower Seed',    heal: 25,  hotHp: 0,  hotTicks: 0,  useTicks: 6,  interrupt: false, hasteTicks: 0,  hastePct: 0 },
  { id: 'cheese_wedge',      name: 'Cheese Wedge',      heal: 10,  hotHp: 55, hotTicks: 80, useTicks: 10, interrupt: false, hasteTicks: 0,  hastePct: 0 },
  { id: 'honey_milk',        name: 'Honey Milk',        heal: 100, hotHp: 0,  hotTicks: 0,  useTicks: 24, interrupt: true,  hasteTicks: 0,  hastePct: 0 },
  { id: 'golden_strawberry', name: 'Golden Strawberry', heal: 45,  hotHp: 0,  hotTicks: 0,  useTicks: 8,  interrupt: false, hasteTicks: 60, hastePct: 35 },
];
export const CONSUMABLE_INDEX = Object.fromEntries(CONSUMABLES.map((c, i) => [c.id, i]));
export const WEAPON_INDEX = Object.fromEntries(WEAPONS.map((w, i) => [w.id, i]));

/**
 * Bare paws. Not one of the lootable weapons (§4.3 + v1.1) and never spawns as loot —
 * it exists so an unarmed stand-off can always resolve instead of waiting for the zone.
 * Weapon index -1 means "unarmed" everywhere in the core.
 */
export const UNARMED = { id: 'unarmed', name: 'Bare Paws', type: 'melee', damage: 5,
                         cooldown: 0.60, range: 28, tier: -1, stun: 0, projectileSpeed: 0, windup: 1, pattern: 'straight' };
export const specOf = (w) => (w >= 0 ? WEAPONS[w] : UNARMED);

export const RULESET_V1 = {
  rulesetVersion: '1.3.1',
  world: {
    // 3× the V1 side length (9× the area). Everything distance-based below is scaled to match.
    width: 10800, height: 10800,
    obstacleCount: 864, obstacleMinR: 22, obstacleMaxR: 60, obstacleMinGap: 140,
    // Solid landmarks placed before the small props. A tree's circle is its trunk only.
    landmarks: { buildings: 20, buildingMinR: 75, buildingMaxR: 95,
                 trees: 110, treeMinR: 26, treeMaxR: 34, minGap: 150 },
    spawnRingInner: 540, spawnRingOuter: 4500, spawnMinGap: 375,   // inside the round arena (zone.startRadius)
  },
  bot: {
    maxHp: 220, radius: 15,
    moveSpeedMin: 92, moveSpeedMax: 132,       // u/s
    dashSpeedMul: 290,                          // percent of move speed
    dashTicks: 5, dashCooldownTicks: 64,
    aggressionMin: 150, aggressionMax: 950,     // per-mille traits
    cautionMin: 100, cautionMax: 900,
    aimSkillMin: 250, aimSkillMax: 950,
    dodgeSkillMin: 150, dodgeSkillMax: 900,
    lootingBiasMin: 200, lootingBiasMax: 950,
    awarenessMin: 300, awarenessMax: 470,       // u
    armorMin: 0, armorMax: 12,                  // percent damage reduction
    attackCdMulMin: 88, attackCdMulMax: 112,    // percent
    separationRadius: 46, separationForce: 260,
    pickupRadius: 30,
  },
  loot: {
    // Nobody spawns armed: weapons are sparse ground loot that has to be walked to.
    spawnClearRadius: 450,                         // no loot this close to any spawn point
    groundWeapons: 160,
    //             dagger sword axe spear hammer bow xbow staff | sling (disabled)
    tierWeights:       [22, 20, 14, 14, 10, 12, 8, 10,  0],   // per WEAPONS index
    upgradeHysteresis: 1,                          // must beat current tier by this much
    supplyTicks: [400, 900, 1400, 1900],           // 20s, 45s, 70s, 95s (2-minute matches)
    supplyPerDrop: 3,
    supplyMinGap: 900,
    supplyTierWeights: [0, 4, 14, 12, 18, 10, 20, 14,  0],
    supplyHeal: 80,
    // Healing consumables on the ground (own RNG stream, so weapon placement is unchanged).
    groundConsumables: 150,
    consumableWeights: [48, 28, 14, 10],           // per CONSUMABLES index
    supplyConsumableWeights: [0, 20, 50, 30],      // every crate also holds one, rarer ones favoured
    bagSlots: 3,
    // Treasure chests lying on the map from the start: touch one while hurt and it pops
    // open, the cheese inside heals at once. Own RNG stream ('world/chests').
    chests: 70,
    chestHeal: 65,
    chestRadius: 34,
    supplyOpenTicks: 10,
    supplyWarnTicks: 60,
  },
  zone: {
    // startTick, endTick, radius at end (u). Centre drifts deterministically per phase.
    // The circle shrinks continuously across each whole phase (holdPermille = 0), so it
    // closes in steadily from the first tick instead of pausing between phases.
    // v1.2.1: the arena is round from the first tick — the Cat Storm already covers the
    // corners (startRadius = the circle inscribed in the map) — and closes in ~2 minutes.
    phases: [
      { start: 0,    end: 500,  radius: 3800, dps: 4 },
      { start: 500,  end: 1100, radius: 2400, dps: 8 },
      { start: 1100, end: 1700, radius: 1200, dps: 16 },
      { start: 1700, end: 2200, radius: 450,  dps: 28 },
      { start: 2200, end: 2600, radius: 150,  dps: 45 },
    ],
    startRadius: 5300,
    lootRadius: 5050,               // weapons, healing items, chests and spawns only inside this circle
    holdPermille: 0,                // share of each phase the circle stands still before shrinking
    damageEvery: 4,                 // apply zone damage at 5 Hz
    suddenDeathStart: 2700,
    suddenDeathDpsStep: 9,          // extra dps per 100 ticks past suddenDeathStart
    suddenDeathRadius: 90,
    hardLimitTicks: 4800,           // 4 minutes (a normal match ends ~2)
  },
  combat: {
    meleeDodgeBase: 180,            // per-mille, scaled by dodgeSkill vs aimSkill
    rangedSpreadBase: 70,           // u of aim error at max range for a 0-skill shooter
    projectileRadius: 9,
    predictLeadPermille: 820,       // how much of target velocity is led
    attackFacingTolerance: 60,      // degrees-equivalent via dot product permille
    stunTicksOnHammer: 8,
    hitAnimTicks: 3,
    attackAnimTicks: 5,
    deathAnimTicks: 12,
    pickupAnimTicks: 4,
  },
  // Match start: every hamster parachutes in. Bot i touches down at
  // landBaseTicks + (hash(i) mod landSpreadTicks); until then it is out of play.
  start: { landBaseTicks: 30, landSpreadTicks: 40 },
  // Score — what every hamster plays for (the AI's objective, and the result table):
  //   live points: 1 per second alive, x crownLiveMul while wearing the Crown
  //   kill points: 1 per kill, x crownKillMul for killing the Crown holder
  //   score = live points + killValueLP * kill points
  score: { livePerSecond: 1, crownLiveMul: 2, killPoints: 1, crownKillMul: 2, killValueLP: 50 },   // K = 50 for ~2-minute matches: see tools/score-report.mjs
  crown: {
    killsToCrown: 1,                // first blood takes the Crown
    healOnTransferPercent: 100,
    huntBonus: 34,
    huntRange: 1500,
    dropPickupRadius: 34,
  },
  ai: {
    stickiness: 40,
    minCommitTicks: 8,
    hysteresis: 6,
    fleeHpPermille: 560,            // tuned (tools/tune-ai.mjs), was 620
    fleeWinProbPermille: 460,
    fleeMaxTicks: 80,               // 4s of fleeing before considering a last stand
    roamRepickTicks: 90,
    engageRange: 430,
    kiteBandPermille: 760,          // ranged preferred distance = range * this
    meleeApproachPermille: 780,
    lootMaxRange: 1800,
    supplyMaxRange: 3000,
    scoreZoneBase: 72,
    scoreRoamBase: 10,
    maxActionTicks: 160,          // force a fresh evaluation if an action never completes
    lootPhaseTicks: 600,          // first 30 s: gear beats long chases
    lootPhaseAttackPenalty: 40,
    endgameAlive: 8,              // final circle: survivors commit instead of circling
    endgameAggro: 26,
    // Engagement rules (v1.2): fight what is in your face, chase the weaker, answer an
    // attacker, run from a stronger chaser; ranged weapons shoot and fall back.
    contactRange: 170,              // an enemy this close is fought, not walked past
    contactBonus: 10,               // tuned, was 30
    preyWinProbPermille: 700,       // equal HP but we clearly out-gun them: still prey (tuned, was 620)
    fleeVsChaserPermille: 600,      // chaser has more HP and we are not favoured: may run (tuned, was 520)
    kiteFirePermille: 860,          // ranged: step in to this share of range when ready to fire
    kiteRetreatPermille: 1000,      // ranged: after a shot, fall back to this share of range (tuned, was 960)
    // Shared kills (v1.2.1): rivals = others already chasing the same target and closer to it.
    maxRivals: 2,                   // at this many, leave the target to them
    rivalPenalty: 30,               // per rival, on the prey score
    backTurnMargin: 120,            // a target this much further than the adjacent enemy waits
    adjacentFightScore: 55,         // ATTACK score for the enemy right next to us
    corneredRange: 70,              // the enemy we flee is this close and hitting us: fight back
    ksHpPercent: 30,                // an enemy below this HP% is a kill-steal target
    ksBonus: 20,                    // tuned, was 45
    ksRange: 320,                   // close enough to drop everything for the steal
    leaderBonus: 10,                // the crown holder (else top killer) is focus-fired (tuned, was 35)
    leaderMinWinProbPermille: 300,  // ... unless we would simply be fed to them
    // Score-driven fight value (see rs.score): weight of the expected-score term on
    // ATTACK / HUNT (+) and FLEE (-), the share of the remaining match a bot expects to
    // live through, and a floor so the last seconds still have something to lose.
    evWeight: 45,                   // tuned, was 30
    lifeValuePermille: 450,
    minRemainSeconds: 20,
    // Healing consumables: drink when HP drops below this (scaled up by caution), and
    // only start an interruptible channel when no one has hit us recently.
    healHpPermille: 560,
    healEmergencyPermille: 300,
    healSafeTicks: 40,
    healSafeRange: 320,             // an interruptible drink also needs nobody this close
    consumableLootBase: 16,
  },
};

export const RULESET_HASH = hashObject({ ruleset: RULESET_V1, weapons: WEAPONS, unarmed: UNARMED, consumables: CONSUMABLES, genome: GENOME });

export const PRESETS = {
  standard: { id: 'standard', label: 'Standard V1', patch: null },
  brawler:  { id: 'brawler',  label: 'Brawler (melee-heavy loot, faster zone)', patch: {
    loot: { tierWeights: [26, 24, 18, 16, 14, 6, 4, 6,  0] },
    zone: { phases: [
      { start: 0,    end: 420,  radius: 3600, dps: 5 },
      { start: 420,  end: 900,  radius: 2200, dps: 10 },
      { start: 900,  end: 1400, radius: 1000, dps: 20 },
      { start: 1400, end: 1800, radius: 400,  dps: 32 },
      { start: 1800, end: 2100, radius: 140,  dps: 48 },
    ], suddenDeathStart: 2200 },
  } },
  sniper:   { id: 'sniper',   label: 'Sniper (ranged-heavy loot, slower zone)', patch: {
    loot: { tierWeights: [8, 10, 8, 10, 6, 22, 16, 20,  0] },
    ai: { engageRange: 640 },
  } },
};

/** Deep-merge a preset patch onto the base ruleset, producing a new frozen ruleset. */
export function resolveRuleset(presetId) {
  const preset = PRESETS[presetId] || PRESETS.standard;
  const base = JSON.parse(JSON.stringify(RULESET_V1));
  if (preset.patch) deepMerge(base, preset.patch);
  base.presetId = preset.id;
  return base;
}

function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') deepMerge(dst[k], v);
    else dst[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v;
  }
}

export function rulesetHashOf(ruleset) { return hashObject({ ruleset, weapons: WEAPONS, unarmed: UNARMED, consumables: CONSUMABLES, genome: GENOME }); }
