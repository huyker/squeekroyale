// On-chain arena <-> simulator glue. Pure (no ethers, no DOM), shared by the operator
// (Node, contracts/scripts/operator.mjs), the contract tests and the web viewer, so all three
// build the *same* manifest from the same arena and can only ever agree on the result.
//
//   arena   = SqueekArena.getArena(id)                 (block window, seed, hashes ...)
//   entries = SqueekArena.getEntries(id) -> [entries, dnas]   in join order = bot ids
//
// Contract 1.4 adds: NFT deposit, per-arena fee / reward share / simulator version
// (`ruleset`), rank + kills posted with the points, and a claim delay — a result is final
// ("Confirmed") only once claimableAt has passed without the owner voiding it.
//
// Contract 1.3 (gas-lean):
//   * an entry has NO position — drop points are random, drawn from the seed;
//   * entries close at a block (closeBlock); the seed is the hash of seedBlock, which anyone
//     can compute off-chain once it exists (client.js fills `arena.seed` before it is pinned);
//   * the chain keeps only a Merkle root of the points; client.js reads the points back from
//     the submitResult transaction and attaches them to the entries.
import { buildManifest } from '../core/manifest.js';
import { planMatch } from '../core/plan.js';

export const PRESET_IDS = ['standard', 'brawler', 'sniper'];
export const STATUS = ['None', 'Open', 'Seeded', 'Settled', 'Cancelled', 'Swept'];
/** Labels for phaseOf(): the on-chain status refined by the current block / time. */
export const STATUS_VI = {
  None: '-', Open: 'Đang nhận đăng ký', Closed: 'Đã đóng, chờ block seed', Revealed: 'Đã có seed, chờ kết quả',
  Seeded: 'Đã có seed, chờ kết quả', Confirming: 'Đã có kết quả, chờ xác nhận', Settled: 'Đã xác nhận',
  Cancelled: 'Đã huỷ (hoàn phí)', Swept: 'Đã đóng sổ',
};

/**
 * Simulator builds by the on-chain `ruleset` number an arena was created with. A match must
 * be re-run with the build it was played on: when the game rules change, bump the contract's
 * default ruleset (setDefaults) and keep the old build reachable here.
 */
export const RULESETS = { 1: 'core 1.4 (src/core)' };
export const CURRENT_RULESET = 1;

const big = (v) => (typeof v === 'bigint' ? v : BigInt(v));
const hex32 = (v) => '0x' + big(v).toString(16).padStart(64, '0');
const ZERO32 = /^0x0{64}$/;

/** Plain-JS copy of an ethers Result for getArena (bigints kept for money). */
export function normaliseArena(a) {
  const seed = String(a.seed).toLowerCase();
  return {
    closeBlock: Number(a.closeBlock), seedBlock: Number(a.seedBlock), seededAt: Number(a.seededAt),
    maxEntrants: Number(a.maxEntrants), entrantCount: Number(a.entrantCount), claimedCount: Number(a.claimedCount),
    preset: Number(a.preset), status: STATUS[Number(a.status)] || 'None',
    pot: big(a.pot), seed, seedPinned: !ZERO32.test(seed),
    pointsRoot: String(a.pointsRoot).toLowerCase(), rewardPool: big(a.rewardPool), totalPoints: big(a.totalPoints),
    paidOut: big(a.paidOut), resultHash: String(a.resultHash).toLowerCase(), replayHash: String(a.replayHash).toLowerCase(),
    settledBlock: Number(a.settledBlock),
    // contract 1.4 (absent on older deployments)
    ruleset: a.ruleset === undefined ? CURRENT_RULESET : Number(a.ruleset),
    fee: a.fee === undefined ? null : big(a.fee), rewardBps: a.rewardBps === undefined ? 9000 : Number(a.rewardBps),
    finalAt: a.finalAt === undefined ? 0 : Number(a.finalAt), claimableAt: a.claimableAt === undefined ? 0 : Number(a.claimableAt),
  };
}
/** Entries in join order. `points` is filled in from the result transaction (client.js). */
export function normaliseEntries(entries, dnas) {
  return entries.map((e, i) => ({
    index: i, tokenId: big(e.tokenId).toString(), player: String(e.player).toLowerCase(),
    claimed: Boolean(e.claimed), dna: hex32(dnas[i]), points: 0,
  }));
}

/**
 * Where an arena is right now, given the latest block number:
 *   Open      entries accepted (head < closeBlock)
 *   Closed    entries closed, the seed block is not mined yet
 *   Revealed  the seed block exists: the seed (and the whole match) is known off-chain
 *   Seeded    the seed is stored on-chain, result pending
 *   Confirming  result posted, still inside the claim delay (the owner may void it)
 *   Settled   final: claims open                                       (needs `now`)
 *   Cancelled / Swept
 */
export function phaseOf(arena, head, now) {
  if (arena.status === 'Settled' && now !== undefined && now < arena.claimableAt) return 'Confirming';
  if (arena.status !== 'Open') return arena.status;
  if (head < arena.closeBlock) return 'Open';
  if (arena.entrantCount < 2) return 'Closed';           // the next pinSeed / submit cancels it
  return head > arena.seedBlock ? 'Revealed' : 'Closed';
}

/**
 * buildManifest() input for a seeded arena. Entrant i = entry i = bot i. No drop points:
 * the plan draws them from the seed (an entrant carrying one would be rejected).
 */
export function manifestInputFromArena({ chainId, contract, arenaId, arena, entries }) {
  if (!hasSeed(arena)) throw new Error('arena has no seed yet');
  if (arena.ruleset !== undefined && !RULESETS[arena.ruleset])
    throw new Error(`arena ${arenaId} chạy simulator ruleset ${arena.ruleset}, bản này chỉ có ${Object.keys(RULESETS).join(', ')}`);
  return {
    seed: arena.seed,                                     // bytes32 hex -> canonicalSeed() hashes it to 32 bits
    presetId: PRESET_IDS[arena.preset] || 'standard',
    recordDecisions: entries.length <= 200,
    entrants: entries.map((e) => ({ dna: e.dna, tokenId: e.tokenId, owner: e.player })),
    arena: { chainId: Number(chainId), contract: String(contract).toLowerCase(), arenaId: Number(arenaId) },
  };
}

/** Does this arena have its seed yet (on-chain, or derived from the seed block)? */
export const hasSeed = (arena) => /^0x[0-9a-f]{64}$/.test(arena.seed) && !ZERO32.test(arena.seed);

/**
 * The match plan of a seeded arena — real map and every hamster's random drop point
 * (plan.drops[i] belongs to entry i) — or null before the seed exists. For UIs.
 */
export function planOfArena({ chainId, contract, arenaId, arena, entries }) {
  if (!hasSeed(arena) || entries.length < 2) return null;
  const { manifest, ruleset } = buildManifest(manifestInputFromArena({ chainId, contract, arenaId, arena, entries }));
  return planMatch(manifest, ruleset);
}

/** Rank and kills per entry (join order) from a simulator result. */
export function statsFromResult(result) {
  const out = [];
  for (const s of result.standings) out[s.botId] = { rank: s.rank, kills: s.kills };
  return out;
}

/** Points per entry (join order) from a simulator result: the score each hamster earned. */
export function pointsFromResult(result) {
  const pts = [];
  for (const s of result.standings) pts[s.botId] = s.score;
  return pts;
}

/** The 64-bit simulator hash stored on-chain (bytes8, or a legacy right-aligned bytes32). */
export const bytes32ToHash = (b) => String(b).replace(/^0x/, '').slice(-16);
export const hashToBytes32 = (h) => '0x' + String(h).replace(/^0x/, '').padStart(64, '0');

/** Reward of each entry, exactly like SqueekArena.rewardFor (integer division). */
export function rewardsOf(arena, entries) {
  if (arena.status !== 'Settled' || arena.totalPoints === 0n) return entries.map(() => 0n);
  return entries.map((e) => (arena.rewardPool * BigInt(e.points)) / arena.totalPoints);
}
