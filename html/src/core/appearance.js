// Cosmetic stream. Runs on its own hash chain so a catalogue change can never shift
// a combat/loot draw, and never writes into simulation state (whitepaper §2.1, §6.4).
import { fnv1a32 } from './rng.js';

// v3: 10 independent options per slot (headwear, outfit_body, outfit_back).
// Neckwear & front badges removed per user direction; weapons are standalone gameplay items.
export const CATALOGUE_VERSION = 3;

export const FUR_COLORS = ['honey_orange', 'russet_brown', 'ash_grey', 'taro_lilac', 'snow_cream', 'golden_butter', 'charcoal_spike', 'maple_cinnamon'];
export const FUR_PATTERNS = ['solid', 'dorsalsaddle', 'cheek_blaze', 'cap_patch', 'tiger_stripes'];
export const FACE_EYES = ['fierce', 'focused', 'sly', 'wink', 'royal', 'goggle_squint', 'berserk', 'cute_alert'];
export const OUTFIT_BODY = ['knight_plate', 'archer_cloak', 'bandit_vest', 'ronin_haori', 'royal_robe', 'tank_rivet_belt', 'pastel_frill', 'maple_tunic', 'spiked_harness', 'scholar_vest'];
export const HEADWEAR = ['knight_helm', 'archer_hood', 'bandit_mask', 'ronin_kasa', 'engineer_goggles', 'frill_bonnet', 'maple_crest', 'biker_goggles', 'wizard_hat', 'viking_horn'];
export const NECKWEAR = [];
export const OUTFIT_BACK = ['knight_cape', 'bandit_knot', 'ronin_ribbon', 'royal_mantle', 'tank_boiler', 'maid_bow', 'autumn_cape', 'spike_pelt', 'explorer_pack', 'fairy_wings'];
export const ACCESSORY_FRONT = [];

const FIRST = ['Nori', 'Fluff', 'Boba', 'Miso', 'Cheddar', 'Mochi', 'Pudding', 'Maple', 'Spike', 'Taro', 'Ginger', 'Biscuit', 'Toffee', 'Peanut', 'Clover', 'Yuzu', 'Pepper', 'Hazel', 'Cocoa', 'Sesame'];
const LAST = ['Knight', 'Archer', 'Bandit', 'Ronin', 'Lord', 'Tank', 'Paw', 'Spear', 'Fang', 'Whisk', 'Tail', 'Claw', 'Crumb', 'Dash', 'Squeak', 'Nibble'];

/**
 * Deterministic cosmetic recipe. Every item is 100% independent (no neckwear, no front badges, no weapon attached).
 */
export function appearanceFor(appearanceSeed, botId) {
  const h1 = fnv1a32(`squeek:${appearanceSeed}:${botId}:1`);
  const h2 = fnv1a32(`squeek:${appearanceSeed}:${botId}:2`);
  const h3 = fnv1a32(`squeek:${appearanceSeed}:${botId}:3`);
  const headKeys = ['none', ...HEADWEAR];
  const backKeys = ['none', ...OUTFIT_BACK];

  const furColor = FUR_COLORS[h1 % FUR_COLORS.length];
  const furPattern = FUR_PATTERNS[(h1 >>> 4) % FUR_PATTERNS.length];
  const faceEyes = FACE_EYES[(h1 >>> 8) % FACE_EYES.length];
  const outfitBody = OUTFIT_BODY[h2 % OUTFIT_BODY.length];
  const headwear = headKeys[(h2 >>> 4) % headKeys.length];
  const neckwear = 'none';
  const outfitBack = backKeys[h3 % backKeys.length];
  const accessoryFront = 'none';

  const appearanceHash = fnv1a32(`${furColor}|${furPattern}|${faceEyes}|${outfitBack}|${outfitBody}|${headwear}`)
    .toString(16).padStart(8, '0');

  return { botId, appearanceSeed, catalogueVersion: CATALOGUE_VERSION, appearanceHash,
           furColor, furPattern, faceEyes, outfitBack, outfitBody, neckwear, headwear, accessoryFront };
}

export function nameFor(appearanceSeed, botId) {
  const h = fnv1a32(`squeek:name:${appearanceSeed}:${botId}`);
  const a = FIRST[h % FIRST.length];
  const b = LAST[(h >>> 9) % LAST.length];
  const n = ((h >>> 18) % 90) + 10;
  return `${a}${b}${n}`;
}
