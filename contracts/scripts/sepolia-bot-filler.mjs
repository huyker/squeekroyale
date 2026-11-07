#!/usr/bin/env node
// Keeps the scheduled matches on the REAL Sepolia deployment populated with admin-bank bots:
//   node scripts/sepolia-bot-filler.mjs [--min 10] [--max 20] [--ahead 40] [--pool 0-38] [--skip 20] [--dry]
//
//   * every match that closes within the next --ahead minutes gets a random number of bots
//     (--min..--max, fixed per match), random bots from the pool, each joining at a random
//     moment before registration closes — so matches fill up gradually, like real players;
//   * rooms opened by players (RoomCreated) are left alone;
//   * once a result is final (claim delay over) every bot claims what it won (claimAcross),
//     so the ETH keeps cycling; a bot that runs low is topped up by the richest bot;
//   * each bot plays with one hamster, minted and deposited the first time it is needed.
// Bot #i = BANK_MNEMONIC path i+1 (path 0 is the operator). Bot #20 is the UI-test player and
// is skipped by default. Fees: base fee x2 cap and a 2-wei tip (Sepolia blocks are empty).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../../html/src/chain/abi.js';
import { DEPLOYMENTS } from '../../html/src/chain/deployments.js';
import { readArena } from '../../html/src/chain/arena-read.js';
import { rewardsOf } from '../../html/src/chain/arena-manifest.js';
import { claimAcrossArgs } from '../../html/src/chain/client.js';

const env = Object.fromEntries(readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const MIN = Number(arg('min', 10)), MAX = Number(arg('max', 20));
const AHEAD_S = Number(arg('ahead', 40)) * 60;
const DRY = argv.includes('--dry');
const [p0, p1] = arg('pool', '0-38').split('-').map(Number);
const SKIP = new Set(arg('skip', '20').split(',').filter(Boolean).map(Number));
const POOL = Array.from({ length: p1 - p0 + 1 }, (_, k) => p0 + k).filter((i) => !SKIP.has(i));
const CHAIN = 11155111, dep = DEPLOYMENTS[CHAIN];
const BLOCK_S = 12;
const LAST_JOIN_S = 90;                 // stop joining this long before registration closes

const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', CHAIN, { staticNetwork: true });
provider.pollingInterval = 4000;
const arena = new ethers.Contract(dep.arena, ARENA_ABI, provider);
const hamster = new ethers.Contract(dep.hamster, HAMSTER_ABI, provider);
const log = (...a) => console.log(new Date().toLocaleString('vi-VN'), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (e) => (e?.shortMessage || e?.message || String(e)).slice(0, 160);

// ------------------------------------------------------------------ bots
const bots = new Map();                 // i -> { i, addr, signer, token, busy }
for (const i of POOL) {
  const w = ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, `m/44'/60'/0'/0/${i + 1}`).connect(provider);
  bots.set(i, { i, addr: w.address.toLowerCase(), signer: new ethers.NonceManager(w), token: null });
}
const byAddr = new Map([...bots.values()].map((b) => [b.addr, b]));

async function fees() {
  const base = (await provider.getBlock('latest')).baseFeePerGas || 0n;
  return { maxPriorityFeePerGas: 2n, maxFeePerGas: base * 2n + 2n };
}
/** Send with 30% gas headroom (joins get dearer as the arena fills) and cheap fees. */
async function send(b, contract, method, args, value) {
  const c = contract.connect(b.signer);
  const o = value === undefined ? {} : { value };
  try {
    const gas = await c[method].estimateGas(...args, o);
    const tx = await c[method](...args, { ...o, ...(await fees()), gasLimit: (gas * 13n) / 10n });
    return await tx.wait();
  } catch (e) { b.signer.reset(); throw e; }
}

async function ensureHamster(b) {
  if (b.token) return b.token;
  const dep0 = [...(await arena.depositsOf(b.addr))].map(String);
  if (dep0.length) return (b.token = dep0[0]);
  if (DRY) return null;
  let wallet = [...(await hamster.tokensOfOwner(b.addr))].map(String);
  if (!wallet.length) {
    await send(b, hamster, 'mint', [1], 0n);
    wallet = [...(await hamster.tokensOfOwner(b.addr))].map(String);
  }
  await send(b, hamster, 'safeTransferFrom(address,address,uint256)', [b.addr, dep.arena, wallet[0]]);
  log(`bot #${b.i} ${b.addr.slice(0, 10)}… minted + deposited hamster #${wallet[0]}`);
  return (b.token = wallet[0]);
}

// ------------------------------------------------------------------ rooms (left alone)
const rooms = new Set();
let roomsFrom = dep.fromBlock;
async function scanRooms(head) {
  for (let from = roomsFrom; from <= head; from += 40000) {
    const to = Math.min(head, from + 39999);
    for (const l of await arena.queryFilter(arena.filters.RoomCreated(), from, to)) rooms.add(Number(l.args.arenaId));
  }
  roomsFrom = head + 1;
}

// ------------------------------------------------------------------ fill upcoming matches
const target = (id) => MIN + (Number(BigInt(ethers.id(`squeek-bots:${dep.arena}:${id}`)) % BigInt(MAX - MIN + 1)));
const plans = new Map();                // arenaId -> [{ bot, at (unix s) }]
const filled = new Set();               // arenas whose plan has run out
let lowFrom = 0;                        // every arena below this one has closed

async function planUpcoming(head, now) {
  const count = Number(await arena.arenaCount());
  for (let from = lowFrom; from < count; from += 100) {
    const page = await arena.getArenas(from, 100);
    let stop = false;
    for (let k = 0; k < page.length; k++) {
      const id = from + k, h = page[k];
      const status = Number(h.status), close = Number(h.closeBlock);
      if (status !== 1 || head >= close) { if (id === lowFrom) lowFrom++; continue; }
      const closesAt = now + (close - head) * BLOCK_S;
      if (closesAt - now > AHEAD_S) { stop = true; break; }   // ids are created in time order
      if (rooms.has(id) || plans.has(id) || filled.has(id)) continue;
      const { entries } = await readArena(arena, provider, { chainId: CHAIN, arenaId: id });
      const inside = new Set(entries.map((e) => e.player));
      const want = Math.min(target(id) - entries.filter((e) => byAddr.has(e.player)).length, Number(h.maxEntrants) - entries.length);
      if (want <= 0) { filled.add(id); continue; }
      const free = POOL.filter((i) => !inside.has(bots.get(i).addr)).sort(() => Math.random() - 0.5).slice(0, want);
      const last = closesAt - LAST_JOIN_S;
      if (last - now < 30) { filled.add(id); continue; }                 // too close to the start to get in
      const plan = free.map((i) => ({ bot: i, at: now + Math.random() * (last - now), last })).sort((x, y) => x.at - y.at);
      plans.set(id, plan);
      log(`Match #${id}: ${target(id)} bots planned (${plan.length} to join over the next ${Math.round((last - now) / 60)} min)`);
    }
    if (stop) break;
  }
}

const fee = BigInt(dep.entryFeeWei);
const RESERVE = ethers.parseEther('0.00002');   // gas money kept beside the fee
async function runDueJoins(head, now) {
  const jobs = [];
  for (const [id, plan] of plans) {
    while (plan.length && plan[0].at <= now) {
      const { bot, last } = plan.shift();
      if (now > last + 30) continue;                                      // missed the window (e.g. a slow tick)
      const b = bots.get(bot);
      jobs.push((async () => {
        try {
          if ((await provider.getBalance(b.addr)) < fee + RESERVE) { log(`Match #${id}: bot #${bot} is out of ETH, skipped`); return; }
          const tok = b.token || await ensureHamster(b);
          if (!tok) return;
          if (DRY) { log(`[dry] bot #${bot} would join Match #${id} with #${tok}`); return; }
          await send(b, arena, 'join', [id, tok], fee);
          const a = await arena.getArena(id);
          log(`Match #${id}: bot #${bot} joined with hamster #${tok} → ${a.entrantCount}/${a.maxEntrants}`);
        } catch (e) { log(`Match #${id}: bot #${bot} could not join: ${short(e)}`); }
      })());
    }
    if (!plan.length) { plans.delete(id); filled.add(id); }
  }
  await Promise.all(jobs);
}

// ------------------------------------------------------------------ claim winnings
const claimDone = new Set();            // arenas whose bot rewards are all claimed (or nothing)
let claimFrom = 0;
async function claimWinnings(head, now) {
  const count = Number(await arena.arenaCount());
  const owed = new Map();               // bot i -> [{ d, indexes }]
  let n = 0;
  while (claimDone.has(claimFrom)) claimFrom++;
  for (let from = claimFrom; from < count; from += 100) {
    const page = await arena.getArenas(from, 100);
    for (let k = 0; k < page.length; k++) {
      const id = from + k, h = page[k];
      if (claimDone.has(id)) continue;
      const status = Number(h.status);
      if (status === 1 || status === 2) {                                // not played yet
        if (Number(h.entrantCount) === 0 && head >= Number(h.closeBlock)) claimDone.add(id);
        continue;
      }
      if (status !== 3) { claimDone.add(id); continue; }                 // cancelled / swept: bots never sit alone
      if (Number(h.claimableAt) > now) continue;                         // owner may still void it
      const d = await readArena(arena, provider, { chainId: CHAIN, arenaId: id });
      if (!d.arena.claimOpen) continue;
      d.arenaId = id;
      const rw = rewardsOf(d.arena, d.entries);
      for (const e of d.entries) {
        const b = byAddr.get(e.player);
        if (!b || e.claimed || rw[e.index] === 0n) continue;
        if (!owed.has(b.i)) owed.set(b.i, []);
        const list = owed.get(b.i);
        const item = list.find((x) => x.d === d);
        if (item) item.indexes.push(e.index); else list.push({ d, indexes: [e.index] });
        n++;
      }
      claimDone.add(id);
    }
  }
  if (!n) return;
  await Promise.all([...owed].map(async ([i, items]) => {
    const b = bots.get(i);
    try {
      if (DRY) { log(`[dry] bot #${i} would claim ${items.length} arena(s)`); return; }
      const before = await provider.getBalance(b.addr);
      await send(b, arena, 'claimAcross', claimAcrossArgs(items));
      const got = (await provider.getBalance(b.addr)) - before;
      log(`bot #${i} claimed Match ${items.map((x) => '#' + x.d.arenaId).join(', ')} (+${ethers.formatEther(got)} ETH net)`);
    } catch (e) {
      for (const x of items) claimDone.delete(x.d.arenaId);           // try again next round
      log(`bot #${i} claim failed: ${short(e)}`);
    }
  }));
}

// ------------------------------------------------------------------ keep every bot able to play
async function rebalance() {
  const bal = await Promise.all(POOL.map(async (i) => [i, await provider.getBalance(bots.get(i).addr)]));
  bal.sort((x, y) => (x[1] < y[1] ? -1 : 1));
  const [poorI, poor] = bal[0], [richI, rich] = bal[bal.length - 1];
  const floor = fee * 3n, keep = fee * 20n;
  if (poor >= floor || rich <= keep + floor) return;
  const amount = (rich - keep) / 2n;
  if (DRY) { log(`[dry] bot #${richI} would send ${ethers.formatEther(amount)} ETH to bot #${poorI}`); return; }
  try {
    const b = bots.get(richI);
    const tx = await b.signer.sendTransaction({ to: bots.get(poorI).addr, value: amount, ...(await fees()), gasLimit: 21000n });
    await tx.wait();
    log(`bot #${richI} → bot #${poorI}: ${ethers.formatEther(amount)} ETH (keeps the poorest bot playing)`);
  } catch (e) { bots.get(richI).signer.reset(); log(`rebalance failed: ${short(e)}`); }
}

// ------------------------------------------------------------------ main loop
log(`bot filler on Sepolia · arena ${dep.arena} · ${POOL.length} bots (#${POOL[0]}…#${POOL[POOL.length - 1]}, skipping ${[...SKIP].join(',') || 'none'}) · ${MIN}-${MAX} per match · ${AHEAD_S / 60} min ahead${DRY ? ' · DRY RUN' : ''}`);
const ready = await Promise.allSettled(POOL.map((i) => ensureHamster(bots.get(i))));
ready.forEach((r, k) => { if (r.status === 'rejected') log(`bot #${POOL[k]} has no hamster yet: ${short(r.reason)}`); });
log(`hamsters: ${POOL.map((i) => `#${i}:${bots.get(i).token ?? '-'}`).join(' ')}`);
let tick = 0;
for (;;) {
  try {
    const blk = await provider.getBlock('latest');
    const head = blk.number, now = blk.timestamp;
    if (tick % 3 === 0) { await scanRooms(head); await planUpcoming(head, now); }
    await runDueJoins(head, now);
    if (tick % 15 === 0) { await claimWinnings(head, now); await rebalance(); }
  } catch (e) { log('tick failed:', short(e)); }
  if (DRY && tick >= 1) break;
  tick++;
  await sleep(20000);
}
