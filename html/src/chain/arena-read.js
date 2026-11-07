// Read one arena from the chain into the plain form the game needs — the same code in the
// browser (client.js, autopilot in the page) and in Node (operator, autopilot CLI, tests).
// Works with any ethers v6 Contract + provider.
//
//   * Before the seed is pinned on-chain, the seed is derived from the seed block's hash
//     (exactly as the contract will store it) as soon as that block exists.
//   * After settlement, the points (and rank + kills) are read back from the submitResult
//     transaction's calldata; the points are checked against the Merkle root the contract
//     stored. The result counts as CONFIRMED only once the claim delay has passed on-chain
//     (until then the owner may still void it) — the same rule the contract applies to claims.
import { normaliseArena, normaliseEntries } from './arena-manifest.js';
import { seedFromBlockHash, pointsTree, decodeStats } from './proofs.js';

/** Average seconds per block (Sepolia: 12; a dev chain is measured from recent blocks). */
export async function blockTimeOf(provider, chainId) {
  if (Number(chainId) === 11155111) return 12;
  try {
    const head = await provider.getBlock('latest');
    if (head.number < 10) return 1;
    const past = await provider.getBlock(head.number - 10);
    return Math.max(1, (head.timestamp - past.timestamp) / 10);
  } catch { return 1; }
}

/** The points posted for a settled arena, read from the submitResult tx and root-checked;
 *  `.stats` = [{ rank, kills }] when the operator posted them, `.txHash` the transaction. */
export async function resultPoints(arenaContract, provider, arenaId, arena) {
  const logs = await arenaContract.queryFilter(arenaContract.filters.ResultPosted(arenaId), arena.settledBlock, arena.settledBlock);
  if (!logs.length) throw new Error(`no ResultPosted for arena ${arenaId} in block ${arena.settledBlock}`);
  const txHash = logs[0].transactionHash;
  const tx = await provider.getTransaction(txHash);
  const parsed = arenaContract.interface.parseTransaction({ data: tx.data });
  const points = Array.from(parsed.args.points, (p) => Number(p));
  const computedRoot = pointsTree(points).root;
  if (computedRoot !== arena.pointsRoot) throw new Error(`arena ${arenaId}: posted points do not match the stored Merkle root`);
  points.txHash = txHash;
  points.verified = true;
  points.stats = parsed.args.stats === undefined ? null : decodeStats(parsed.args.stats, points.length);
  return points;
}

/**
 * { arena, entries, head } for one arena. arena.seed is filled in once it is knowable;
 * entries[i].points once the result is posted.
 */
export async function readArena(arenaContract, provider, { chainId, arenaId }) {
  const [a, [es, dnas], latest] = await Promise.all([
    arenaContract.getArena(arenaId), arenaContract.getEntries(arenaId), provider.getBlock('latest')]);
  const head = latest.number, now = latest.timestamp;
  const arena = normaliseArena(a);
  const entries = normaliseEntries(es, dnas);
  arena.confirmed = false;
  arena.settledTxHash = null;
  if (!arena.seedPinned && arena.status === 'Open' && head > arena.seedBlock && arena.entrantCount >= 2) {
    const blk = await provider.getBlock(arena.seedBlock);
    if (blk && blk.hash) {
      arena.seed = seedFromBlockHash(blk.hash, arenaId, await arenaContract.getAddress(), chainId);
      // the contract can only read the last 256 block hashes: past that, rearm() picks a new block
      arena.seedExpired = head - arena.seedBlock > 256;
    }
  }
  if (arena.status === 'Settled') {
    const pts = await resultPoints(arenaContract, provider, arenaId, arena);
    entries.forEach((e, i) => {
      e.points = pts[i];
      if (pts.stats) { e.rank = pts.stats[i].rank; e.kills = pts.stats[i].kills; }
    });
    arena.hasStats = !!pts.stats;
    const hasValidResultHash = typeof arena.resultHash === 'string'
      && /^0x[0-9a-fA-F]{16,64}$/.test(arena.resultHash)
      && !/^0x0+$/.test(arena.resultHash);
    const hasValidPointsRoot = typeof arena.pointsRoot === 'string'
      && /^0x[0-9a-fA-F]{64}$/.test(arena.pointsRoot)
      && !/^0x0{64}$/.test(arena.pointsRoot);
    arena.settledTxHash = pts.txHash || null;
    // final only after the claim delay: before that the owner may still void the result
    arena.claimOpen = !arena.claimableAt || now >= arena.claimableAt;
    arena.confirmed = Boolean(pts.verified && hasValidResultHash && hasValidPointsRoot && arena.settledBlock > 0 && arena.claimOpen);
  }
  return { arena, entries, head, now };
}
