// Hamster genome (v1.3). One 256-bit DNA fixes everything a hamster *is*: look,
// equipment, the five stats the equipment grants, and its temperament. Nothing here
// reads the match seed, so the same hamster (e.g. the same NFT) is identical in every
// match it enters. The on-chain contract (contracts/contracts/SqueekHamster.sol) decodes
// DNA with exactly these rules; tests/run-tests.mjs and chain/test check they agree.
//
//   DNA word k = (dna >> (16 * k)) & 0xffff           (sixteen 16-bit words)
//   w0 fur colour   w1 fur pattern   w2 eyes
//   w3 outfit body  w4 headwear      w5 outfit back   (index 0 of head/back = none)
//   w6 aggression   w7 caution       w8 looting bias  (temperament, not equipment)
//   w9..w11 name
import { fnv1a32 } from './rng.js';
import { FUR_COLORS, FUR_PATTERNS, FACE_EYES, OUTFIT_BODY, HEADWEAR, OUTFIT_BACK, CATALOGUE_VERSION } from './appearance.js';

export const GENOME_VERSION = 1;
export const STAT_KEYS = ['str', 'agi', 'arm', 'vit', 'per'];
export const STAT_NAMES = { str: 'Sức mạnh', agi: 'Nhanh nhẹn', arm: 'Giáp', vit: 'Sinh lực', per: 'Tinh mắt' };
export const STAT_BASE = 6;
const S = (str = 0, agi = 0, arm = 0, vit = 0, per = 0) => ({ str, agi, arm, vit, per });

/**
 * Stat bonus of every equipment item. Every body piece is worth 10 points, every hat
 * and back piece 6; an empty slot is worth 4 (all agility/perception: travelling light).
 * So no item is strictly better than another, they only specialise.
 */
export const ITEM_STATS = {
  body: {
    knight_plate:    S(1, 0, 5, 4, 0),
    archer_cloak:    S(1, 4, 0, 0, 5),
    bandit_vest:     S(3, 5, 0, 0, 2),
    ronin_haori:     S(5, 4, 0, 0, 1),
    royal_robe:      S(0, 0, 3, 4, 3),
    tank_rivet_belt: S(1, 0, 4, 5, 0),
    pastel_frill:    S(0, 4, 0, 3, 3),
    maple_tunic:     S(2, 3, 0, 3, 2),
    spiked_harness:  S(5, 0, 3, 2, 0),
    scholar_vest:    S(0, 2, 0, 2, 6),
  },
  head: {
    none:             S(0, 2, 0, 0, 2),
    knight_helm:      S(0, 0, 4, 2, 0),
    archer_hood:      S(0, 2, 0, 0, 4),
    bandit_mask:      S(3, 3, 0, 0, 0),
    ronin_kasa:       S(3, 0, 0, 0, 3),
    engineer_goggles: S(0, 0, 1, 0, 5),
    frill_bonnet:     S(0, 3, 0, 3, 0),
    maple_crest:      S(2, 0, 0, 2, 2),
    biker_goggles:    S(0, 4, 0, 0, 2),
    wizard_hat:       S(0, 0, 0, 3, 3),
    viking_horn:      S(4, 0, 0, 2, 0),
  },
  back: {
    none:          S(0, 4, 0, 0, 0),
    knight_cape:   S(0, 0, 3, 3, 0),
    bandit_knot:   S(2, 4, 0, 0, 0),
    ronin_ribbon:  S(3, 3, 0, 0, 0),
    royal_mantle:  S(0, 0, 2, 3, 1),
    tank_boiler:   S(2, 0, 4, 0, 0),
    maid_bow:      S(0, 3, 0, 3, 0),
    autumn_cape:   S(0, 2, 0, 2, 2),
    spike_pelt:    S(3, 0, 3, 0, 0),
    explorer_pack: S(0, 0, 0, 2, 4),
    fairy_wings:   S(0, 5, 0, 0, 1),
  },
};
export const HEAD_KEYS = ['none', ...HEADWEAR];
export const BACK_KEYS = ['none', ...OUTFIT_BACK];

export const FIRST_NAMES = ['Nori', 'Fluff', 'Boba', 'Miso', 'Cheddar', 'Mochi', 'Pudding', 'Maple', 'Spike', 'Taro', 'Ginger', 'Biscuit', 'Toffee', 'Peanut', 'Clover', 'Yuzu', 'Pepper', 'Hazel', 'Cocoa', 'Sesame'];
export const LAST_NAMES = ['Knight', 'Archer', 'Bandit', 'Ronin', 'Lord', 'Tank', 'Paw', 'Spear', 'Fang', 'Whisk', 'Tail', 'Claw', 'Crumb', 'Dash', 'Squeak', 'Nibble'];

const MASK256 = (1n << 256n) - 1n;

/** Normalise any DNA input (0x-hex string, decimal string, bigint) to a 0x + 64 hex string. */
export function normalizeDna(dna) {
  let v;
  if (typeof dna === 'bigint') v = dna;
  else {
    const s = String(dna).trim();
    if (!/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/.test(s)) throw new Error(`invalid DNA: ${s.slice(0, 20)}`);
    v = BigInt(s);
  }
  return '0x' + (v & MASK256).toString(16).padStart(64, '0');
}

/** 16-bit word k of a DNA (0 = least significant). */
export function dnaWord(dna, k) { return Number((BigInt(dna) >> BigInt(16 * k)) & 0xffffn); }

/** DNA of demo bot `botId` in a seed-only match (no NFTs): 8 chained 32-bit hashes. */
export function demoDna(seed, botId) {
  let v = 0n;
  for (let k = 0; k < 8; k++) v = (v << 32n) | BigInt(fnv1a32(`squeek:dna:${seed}:${botId}:${k}`));
  return normalizeDna(v);
}

/** Equipment + five stats of a DNA (what the NFT contract's traitsOf returns). */
export function traitsOf(dna) {
  dna = normalizeDna(dna);
  const w = (k) => dnaWord(dna, k);
  const fur = w(0) % FUR_COLORS.length, pattern = w(1) % FUR_PATTERNS.length, eyes = w(2) % FACE_EYES.length;
  const body = w(3) % OUTFIT_BODY.length, head = w(4) % HEAD_KEYS.length, back = w(5) % BACK_KEYS.length;
  const items = [ITEM_STATS.body[OUTFIT_BODY[body]], ITEM_STATS.head[HEAD_KEYS[head]], ITEM_STATS.back[BACK_KEYS[back]]];
  const stats = {};
  for (const k of STAT_KEYS) stats[k] = STAT_BASE + items[0][k] + items[1][k] + items[2][k];
  return { dna, fur, pattern, eyes, body, head, back, stats };
}

/** Name from DNA words 9..11, e.g. "MochiRonin42". */
export function dnaName(dna) {
  const w = (k) => dnaWord(dna, k);
  return `${FIRST_NAMES[w(9) % FIRST_NAMES.length]}${LAST_NAMES[w(10) % LAST_NAMES.length]}${(w(11) % 90) + 10}`;
}

/** Renderer recipe (same shape appearance.js always produced). */
export function appearanceOfTraits(t, botId) {
  const furColor = FUR_COLORS[t.fur], furPattern = FUR_PATTERNS[t.pattern], faceEyes = FACE_EYES[t.eyes];
  const outfitBody = OUTFIT_BODY[t.body], headwear = HEAD_KEYS[t.head], outfitBack = BACK_KEYS[t.back];
  const appearanceHash = fnv1a32(`${furColor}|${furPattern}|${faceEyes}|${outfitBack}|${outfitBody}|${headwear}`)
    .toString(16).padStart(8, '0');
  return { botId, appearanceSeed: t.dna, catalogueVersion: CATALOGUE_VERSION, appearanceHash,
           furColor, furPattern, faceEyes, outfitBack, outfitBody, neckwear: 'none', headwear, accessoryFront: 'none' };
}

/**
 * What the stats do in a match. Linear, integer-only, centred so an average hamster
 * matches the v1.2 average bot (the AI and the score K were calibrated on those).
 *   STR  damage dealt        82 + 2·STR %          (6 -> 94 %, 18 -> 118 %)
 *   AGI  move speed          76 + 3.5·AGI u/s      (6 -> 97, 20 -> 146)
 *        dodge skill         100 + 40·AGI ‰  (≤ 950)
 *        attack cooldown     110 - AGI %
 *   ARM  damage taken        -(ARM - 2) %          (6 -> 4 %, 19 -> 17 %)
 *   VIT  max HP              170 + 5·VIT           (6 -> 200, 17 -> 255)
 *   PER  aim skill           150 + 45·PER ‰  (≤ 950)
 *        awareness           270 + 10·PER u
 */
export function combatParams(stats) {
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    strMul: 82 + 2 * stats.str,
    moveSpeed: 76 + ((stats.agi * 7) >> 1),
    dodgeSkill: cl(100 + 40 * stats.agi, 0, 950),
    atkCdMul: 110 - stats.agi,
    armor: cl(stats.arm - 2, 0, 40),
    maxHpUnits: 170 + 5 * stats.vit,
    aimSkill: cl(150 + 45 * stats.per, 0, 950),
    awareness: 270 + 10 * stats.per,
  };
}

/** Temperament from DNA words 6..8, mapped into the ruleset's ranges. */
export function temperamentOf(dna, ruleset) {
  const b = ruleset.bot;
  const span = (k, lo, hi) => lo + (dnaWord(dna, k) % (hi - lo + 1));
  return {
    aggression: span(6, b.aggressionMin, b.aggressionMax),
    caution: span(7, b.cautionMin, b.cautionMax),
    lootingBias: span(8, b.lootingBiasMin, b.lootingBiasMax),
  };
}

/** Sum of the five stats (a quick "power" figure for UI). */
export const statTotal = (stats) => STAT_KEYS.reduce((a, k) => a + stats[k], 0);
