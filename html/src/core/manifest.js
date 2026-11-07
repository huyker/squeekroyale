// Canonical match manifest. MatchKey = (simulatorVersion, rulesetHash, canonicalConfig,
// seed, rngAlgorithmVersion). assetVersion is carried for provenance but is NOT part
// of the key — swapping art can never change a result.
import { SIMULATOR_VERSION, RNG_ALGORITHM_VERSION, REPLAY_SCHEMA_VERSION } from './constants.js';
import { canonicalSeed } from './rng.js';
import { resolveRuleset, rulesetHashOf } from './ruleset.js';
import { hashObject } from './hash.js';
import { normalizeDna } from './hamster.js';

export const ALLOWED_BOT_COUNTS = [50, 100, 200, 500, 1000];
export const MIN_ENTRANTS = 2, MAX_ENTRANTS = 1000;

/**
 * Canonical entrant list of an arena match. Order is the join order and is part of the
 * MatchKey: entrant i is bot i. Each entrant is a hamster DNA plus provenance (tokenId,
 * owner) carried for labels.
 *
 * v1.4: drop points are RANDOM. Nobody chooses where a hamster lands — not the player,
 * not the operator: the match plan draws every drop point from the seed (which comes from
 * a block hash after entries closed). An entrant that carries a drop point or a grid cell
 * is rejected outright rather than silently ignored.
 */
export function canonicaliseEntrants(list) {
  if (!Array.isArray(list)) return null;
  if (list.length < MIN_ENTRANTS || list.length > MAX_ENTRANTS) throw new Error(`entrants: need ${MIN_ENTRANTS}..${MAX_ENTRANTS}, got ${list.length}`);
  return list.map((e, i) => {
    if (e.drop != null || e.cell != null) throw new Error(`entrants[${i}]: drop points are random (drawn from the seed); choosing one is not allowed`);
    return {
      dna: normalizeDna(e.dna),
      tokenId: e.tokenId == null ? null : String(e.tokenId),
      owner: e.owner == null ? null : String(e.owner).toLowerCase(),
    };
  });
}

export function canonicaliseConfig(raw = {}) {
  const entrants = Array.isArray(raw.entrants) ? raw.entrants : null;
  const botCount = entrants ? entrants.length
    : ALLOWED_BOT_COUNTS.includes(Number(raw.botCount)) ? Number(raw.botCount) : 100;
  const presetId = ['standard', 'brawler', 'sniper'].includes(raw.presetId) ? raw.presetId : 'standard';
  return {
    botCount,
    presetId,
    recordDecisions: raw.recordDecisions === false ? false : true,
  };
}

export function buildManifest(raw = {}) {
  const config = canonicaliseConfig(raw);
  const entrants = canonicaliseEntrants(raw.entrants);
  const seed = canonicalSeed(raw.seed);
  const ruleset = resolveRuleset(config.presetId);
  const rulesetHash = rulesetHashOf(ruleset);
  const manifest = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    simulatorVersion: SIMULATOR_VERSION,
    rngAlgorithmVersion: RNG_ALGORITHM_VERSION,
    rulesetVersion: ruleset.rulesetVersion,
    rulesetHash,
    mapVersion: '1.0.0',
    assetVersion: String(raw.assetVersion || '2.0.0'), // provenance only, not in MatchKey
    seed,
    seedInput: String(raw.seed == null ? seed : raw.seed),
    config,
    entrants,                                          // null = seed-only demo match
    entrantsHash: entrants ? hashObject(entrants) : null,
    arena: raw.arena || null,                          // provenance only (chain id, contract, arena id)
  };
  manifest.matchKey = hashObject({
    simulatorVersion: manifest.simulatorVersion,
    rngAlgorithmVersion: manifest.rngAlgorithmVersion,
    rulesetHash: manifest.rulesetHash,
    config: manifest.config,
    seed: manifest.seed,
    entrants: manifest.entrantsHash,
  });
  return { manifest, ruleset };
}
