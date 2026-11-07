// Settle an arena from the browser: read seed + entrants, run the same simulator the
// operator runs, and return what submitResult needs. Shared by dapp.js and manage.js.
import { loadArena } from './client.js';
import { manifestInputFromArena, pointsFromResult, statsFromResult } from './arena-manifest.js';
import { hashToBytes8, encodeStats } from './proofs.js';

/** Re-run a match whose seed is known (pinned, or derivable from the seed block). */
export async function simulateLoaded(chainId, arenaId, d) {
  const [{ buildManifest }, { simulate }, { validateReplay }] = await Promise.all([
    import('../core/manifest.js'), import('../core/simulator.js'), import('../replay/replay.js')]);
  const input = manifestInputFromArena({ chainId, contract: d.contract, arenaId, arena: d.arena, entries: d.entries });
  const { manifest, ruleset } = buildManifest({ ...input, recordDecisions: false });
  const replay = simulate(manifest, ruleset);
  const v = validateReplay(replay);
  if (!v.ok) throw new Error('replay không hợp lệ: ' + v.problems.join('; '));
  return {
    result: replay.result, points: pointsFromResult(replay.result),
    stats: encodeStats(statsFromResult(replay.result)),        // rank + kills, posted with the points
    // what the contract stores (bytes8) — and what the viewer compares against
    resultHash: hashToBytes8(replay.result.resultHash), replayHash: hashToBytes8(replay.replayHash),
  };
}

export async function simulateArena(chainId, arenaId) {
  const d = await loadArena(chainId, arenaId);
  if (d.arena.seedExpired) throw new Error('Block seed đã quá 256 block: cần rearm trước khi công bố.');
  return simulateLoaded(chainId, arenaId, d);
}
