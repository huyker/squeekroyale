#!/usr/bin/env node
// Arena operator (keeper). Drives every arena through its life on-chain:
//   Open, head past closeBlock and seedBlock -> derive the seed from the seed block, run
//                                 the deterministic simulator on (seed, entrants) and
//                                 submitResult(points, resultHash, replayHash) — one tx that
//                                 stores the seed and the Merkle root of the points
//   closed with < 2 entrants   -> pinSeed() cancels it (refunds)
//   seed block > 256 blocks old and never used -> rearm()
// Optionally keeps one upcoming arena open (--schedule <minutes>).
//
//   node scripts/operator.mjs --network localhost [--once] [--interval 10] [--schedule 5 --max 50 --preset 0]
//   node scripts/operator.mjs --network sepolia   (OPERATOR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY in contracts/.env)
//
// Anyone can re-run the same simulation (web viewer or `--verify <arenaId>`) and compare
// with the hashes this script posts: the operator cannot pick a result, only publish it.
// dotenv is a convenience for local work (contracts/.env); in a container the variables come
// from the environment already, and the image should not need an npm install at all.
try { await import('dotenv/config'); } catch { /* not installed: env is already set */ }
// The vendored ethers, the same build the browser uses — so the keeper needs no
// node_modules and its image is just Node plus this repository's files.
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { buildManifest } from '../../html/src/core/manifest.js';
import { simulate } from '../../html/src/core/simulator.js';
import { validateReplay } from '../../html/src/replay/replay.js';
import { ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';
import { manifestInputFromArena, pointsFromResult, statsFromResult, bytes32ToHash } from '../../html/src/chain/arena-manifest.js';
import { readArena, blockTimeOf } from '../../html/src/chain/arena-read.js';
import { hashToBytes8, encodeStats } from '../../html/src/chain/proofs.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const NET = arg('network', 'localhost');
const ONCE = argv.includes('--once');
const INTERVAL = Number(arg('interval', NET === 'localhost' ? 3 : 15)) * 1000;
const SCHEDULE_MIN = Number(arg('schedule', 0));
const MAX = Number(arg('max', 50));
const PRESET = Number(arg('preset', 0));
const VERIFY = arg('verify', null);

const NETS = {
  localhost: { rpc: 'http://127.0.0.1:8545', chainId: 31337, key: process.env.OPERATOR_PRIVATE_KEY_LOCAL },
  sepolia: { rpc: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', chainId: 11155111,
             key: process.env.OPERATOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY },
};

const net = NETS[NET];
if (!net) throw new Error(`unknown network ${NET}`);
// On a server the addresses do not come from the committed deployments.js — that file is
// a snapshot of whatever was last deployed from a developer's machine. Flags and env win,
// so one image runs against any deployment without being rebuilt.
net.rpc = arg('rpc', process.env.RPC_URL || net.rpc);
const dep = {
  ...(DEPLOYMENTS[net.chainId] || {}),
  ...(process.env.ARENA_ADDRESS || arg('arena-address', null) ? { arena: arg('arena-address', process.env.ARENA_ADDRESS) } : {}),
  ...(process.env.HAMSTER_ADDRESS || arg('hamster-address', null) ? { hamster: arg('hamster-address', process.env.HAMSTER_ADDRESS) } : {}),
};
if (!dep.arena) throw new Error(
  `no arena address for chain ${net.chainId}: deploy first, or set ARENA_ADDRESS`);
const provider = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Simulate one seeded arena exactly like every viewer will. */
/** Simulate one arena (its seed is pinned, or derived from the seed block) like every viewer will. */
async function simulateArena(arena, id) {
  const { arena: a, entries, head } = await readArena(arena, provider, { chainId: net.chainId, arenaId: id });
  const input = manifestInputFromArena({ chainId: net.chainId, contract: dep.arena, arenaId: id, arena: a, entries });
  const { manifest, ruleset } = buildManifest({ ...input, recordDecisions: false });
  const t0 = Date.now();
  const replay = simulate(manifest, ruleset);
  const verdict = validateReplay(replay);
  if (!verdict.ok) throw new Error(`replay failed validation: ${verdict.problems.join('; ')}`);
  return { a, entries, head, manifest, replay, points: pointsFromResult(replay.result),
           stats: encodeStats(statsFromResult(replay.result)), ms: Date.now() - t0 };
}

async function verify(arena, id) {
  const run = await simulateArena(arena, id);
  const onchain = bytes32ToHash(run.a.resultHash);
  log(`arena ${id}: simulated resultHash ${run.replay.result.resultHash}, on-chain ${onchain} -> ${onchain === run.replay.result.resultHash ? 'MATCH' : 'MISMATCH'}`);
  const pts = run.entries.map((e, i) => (e.points === run.points[i] ? '' : `entry ${i}: ${e.points} != ${run.points[i]}`)).filter(Boolean);
  if (pts.length) log('points mismatch:', pts.join(', '));
}

/**
 * One pass over every arena. Per game the operator sends only TWO transactions:
 * createArena and submitResult — entries close at closeBlock by themselves, and the seed
 * is the hash of seedBlock (derived here, stored by submitResult).
 */
// Cheapest possible operation (a week of games every 10 min is ~1,000 arenas):
//   * headers are read 100 at a time with getArenas (free view calls), finished arenas are
//     remembered and never read again, arenas still taking entries are skipped by closeBlock;
//   * a transaction is sent ONLY for a match with 2+ hamsters (submitResult) or a stale seed
//     (rearm). An empty arena needs nothing, and a lone player takes the refund by claiming
//     (the claim cancels the arena) — so no pinSeed is ever paid for;
//   * fees: base fee x2 cap and a 1-wei tip, instead of the library's 1 gwei default tip.
const done = new Set();
async function fees() {
  if (NET === 'localhost') return {};
  const base = (await provider.getBlock('latest')).baseFeePerGas || 0n;
  return { maxPriorityFeePerGas: 1n, maxFeePerGas: base * 2n + 1n };
}

async function tick(arena) {
  let head = await provider.getBlockNumber();
  const count = Number(await arena.arenaCount());
  let upcoming = false;
  for (let from = 0; from < count; from += 100) {
    const page = await arena.getArenas(from, 100);
    for (let k = 0; k < page.length; k++) {
      const id = from + k;
      if (done.has(id)) continue;
      const h = page[k];
      const status = Number(h.status), closeBlock = Number(h.closeBlock), n = Number(h.entrantCount);
      if (status >= 3) { done.add(id); continue; }                       // Settled / Cancelled / Swept
      if (status === 1 && head < closeBlock) { upcoming = true; continue; }   // still taking entries
      if (status === 1 && n < 2) { done.add(id); continue; }            // no match: nothing to pay for
      const { arena: a } = await readArena(arena, provider, { chainId: net.chainId, arenaId: id });
      if (a.status === 'Open') {
        if (head <= a.seedBlock) {
          if (NET === 'localhost') { await provider.send('hardhat_mine', ['0x' + (a.seedBlock - head + 1).toString(16)]); head = await provider.getBlockNumber(); }
          else continue;                                                 // seed block not mined yet
        }
        if (a.seedExpired) {
          log(`arena ${id}: seed block ${a.seedBlock} is past the 256-block window -> rearm`);
          await (await arena.rearm(id, await fees())).wait();
          continue;
        }
      }
      const run = await simulateArena(arena, id);
      const r = run.replay.result;
      log(`arena ${id}: seed ${run.a.seed.slice(0, 18)}… · simulated ${run.entries.length} hamsters in ${run.ms} ms · winner #${r.winnerId} ${r.winnerName} · ${r.durationSeconds}s · resultHash ${r.resultHash}`);
      const rc = await (await arena.submitResult(id, run.points, run.stats, hashToBytes8(r.resultHash), hashToBytes8(run.replay.replayHash), await fees())).wait();
      done.add(id);
      log(`arena ${id}: result posted (${rc.gasUsed} gas at ${rc.gasPrice} wei = ${ethers.formatEther(rc.gasUsed * rc.gasPrice)} ETH) · total points ${run.points.reduce((s, v) => s + v, 0)}`);
    }
  }
  if (SCHEDULE_MIN > 0 && !upcoming) {
    const bt = await blockTimeOf(provider, net.chainId);
    const blocks = Math.max(5, Math.round((SCHEDULE_MIN * 60) / bt));
    await (await arena.createArena(head + blocks, MAX, PRESET, await fees())).wait();
    log(`created arena ${count}: closes at block ${head + blocks} (~${SCHEDULE_MIN} min at ${bt}s/block) · max ${MAX} · preset ${PRESET}`);
  }
}

async function main() {
  if (!net.key && !VERIFY) throw new Error(`no operator key for ${NET}: set OPERATOR_PRIVATE_KEY in contracts/.env`);
  const wallet = net.key ? new ethers.Wallet(net.key, provider) : null;
  const arena = new ethers.Contract(dep.arena, ARENA_ABI, wallet || provider);
  if (VERIFY !== null) { await verify(arena, Number(VERIFY)); return; }
  log(`operator ${wallet.address} on ${NET} (${net.chainId}) · arena ${dep.arena}`);
  for (;;) {
    try { await tick(arena); } catch (e) { log('error:', e.shortMessage || e.message); }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/operator.mjs');
if (isMain) main().catch((e) => { console.error(e); process.exitCode = 1; });
