#!/usr/bin/env node
// Full contract 1.4 flow on Sepolia with throwaway wallets — no browser, no MetaMask.
//
//   node scripts/sepolia-e2e.mjs [--bots 6] [--claim-delay 120] [--reuse]
//
// Uses contracts/.env (gitignored): BANK_MNEMONIC = the admin page's wallet bank (runner = path 0
// deploys and owns, bot #i = path i+1 plays) — or, without it, DEPLOYER_PRIVATE_KEY plus a
// BOT_MNEMONIC created on first run. SEPOLIA_RPC_URL optional. Deploys a FRESH test pair (not written to
// deployments/: the web keeps using the real deployment), then:
//
//   bots mint -> deposit (safeTransferFrom and approve+deposit) -> joinMany into a schedule
//   one bot withdraws while its arenas are still open -> refund, entries removed
//   arena A: simulate -> submitResult with rank/kills -> still "Confirming" -> claim refused
//   arena B: result posted, then voided by the owner -> refunds
//   arena C: one entrant -> cancelled
//   after the claim delay: claimAcross (A reward + B refund + C refund) and claimMany
//   every balance change checked against the contract's own numbers
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from '../../html/src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../../html/src/chain/abi.js';
import { HAMSTER_BYTECODE, ARENA_BYTECODE } from '../../html/src/chain/bytecode.js';
import { readArena } from '../../html/src/chain/arena-read.js';
import { manifestInputFromArena, pointsFromResult, statsFromResult, phaseOf } from '../../html/src/chain/arena-manifest.js';
import { pointsTree, encodeStats, hashToBytes8 } from '../../html/src/chain/proofs.js';
import { buildManifest } from '../../html/src/core/manifest.js';
import { simulate } from '../../html/src/core/simulator.js';

const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url));
const env = Object.fromEntries(readFileSync(ENV_PATH, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const NBOTS = Number(arg('bots', 6));
const CLAIM_DELAY = Number(arg('claim-delay', 120));
const CHAIN = 11155111;
const SAFE = 'safeTransferFrom(address,address,uint256)';

const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', CHAIN, { staticNetwork: true, polling: true });
provider.pollingInterval = 3000;
const hd = (phrase, i) => ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
let deployer, bots;
if (env.BANK_MNEMONIC) {                       // the admin page's bank: runner = path 0, bot #i = path i+1
  deployer = new ethers.NonceManager(hd(env.BANK_MNEMONIC, 0));
  bots = Array.from({ length: NBOTS }, (_, i) => new ethers.NonceManager(hd(env.BANK_MNEMONIC, i + 1)));
} else {
deployer = new ethers.NonceManager(new ethers.Wallet(env.DEPLOYER_PRIVATE_KEY, provider));
if (!env.BOT_MNEMONIC) {
  env.BOT_MNEMONIC = ethers.Wallet.createRandom().mnemonic.phrase;
  appendFileSync(ENV_PATH, `BOT_MNEMONIC=${env.BOT_MNEMONIC}\n`);
}
bots = Array.from({ length: NBOTS }, (_, i) => new ethers.NonceManager(hd(env.BOT_MNEMONIC, i)));
}
const addr = await Promise.all(bots.map((b) => b.getAddress()));

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const problems = [];
const check = (ok, what) => { if (ok) log('  ✓', what); else { log('  ✗', what); problems.push(what); } };
const wait = async (txp) => (await txp).wait();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const head = () => provider.getBlockNumber();
const chainNow = async () => (await provider.getBlock('latest')).timestamp;
async function untilBlock(n, what) {
  for (let h = await head(); h < n; h = await head()) { log(`  … chờ block ${n} (${what}), đang ở ${h}`); await sleep(Math.min(60, (n - h) * 12) * 1000); }
}
const withGas = async (fn, args, value, pct = 130n) => {
  const gas = await fn.estimateGas(...args, value === undefined ? {} : { value });
  return fn(...args, { ...(value === undefined ? {} : { value }), gasLimit: (gas * pct) / 100n });
};

// ------------------------------------------------------------------ 0. wallets
const me = await deployer.getAddress();
const bal0 = await provider.getBalance(me);
log(`deployer ${me}: ${ethers.formatEther(bal0)} ETH · ${NBOTS} bot · claim delay ${CLAIM_DELAY}s · gas ${ethers.formatUnits((await provider.getFeeData()).gasPrice, 'gwei')} gwei`);
if (bal0 < ethers.parseEther('0.001')) throw new Error('deployer cần ít nhất 0.001 Sepolia ETH');

// ------------------------------------------------------------------ 1. deploy a fresh test pair
const FEE = ethers.parseEther('0.0001');
const ham = await new ethers.ContractFactory(HAMSTER_ABI, HAMSTER_BYTECODE, deployer).deploy(me, 0);
await ham.waitForDeployment();
const are = await new ethers.ContractFactory(ARENA_ABI, ARENA_BYTECODE, deployer).deploy(me, await ham.getAddress(), FEE, 86400, CLAIM_DELAY);
await are.waitForDeployment();
const H = await ham.getAddress(), A = await are.getAddress();
log(`deployed SqueekHamster ${H} · SqueekArena ${A}`);
check(Number(await are.claimDelay()) === CLAIM_DELAY && (await are.entryFee()) === FEE && Number(await are.rewardBps()) === 9000, 'arena constructor settings (fee, 90 %, claim delay)');
check(await ham.supportsInterface('0x49064906') && await ham.supportsInterface('0x2a55205a'), 'NFT supports EIP-4906 + EIP-2981');
await wait(ham.setRoyalty(me, 500));
check((await ham.royaltyInfo(1, 10000))[1] === 500n, 'royalty 5 % set');

// ------------------------------------------------------------------ 2. fund bots, mint, deposit
const PER_BOT = ethers.parseEther('0.0008');            // 3 fees + gas; the bank bots already hold ~0.002
for (const a of addr) {
  const b = await provider.getBalance(a);
  if (b < PER_BOT) await wait(deployer.sendTransaction({ to: a, value: PER_BOT - b }));
}
log(`funded ${NBOTS} bots to ${ethers.formatEther(PER_BOT)} ETH`);
const hb = bots.map((b) => ham.connect(b)), ab = bots.map((b) => are.connect(b));
await Promise.all(hb.map((h) => wait(withGas(h.mint, [1]))));
const tok = await Promise.all(addr.map(async (a) => (await ham.tokensOfOwner(a)).at(-1)));
log(`minted tokens ${tok.join(', ')}`);
const half = Math.ceil(NBOTS / 2);
await Promise.all(bots.map(async (b, i) => {
  if (i < half) return wait(withGas(hb[i][SAFE], [addr[i], A, tok[i]]));          // one step
  await wait(hb[i].setApprovalForAll(A, true));                                    // approve + deposit
  return wait(withGas(ab[i].deposit, [[tok[i]]]));
}));
const deps = await Promise.all(addr.map((a) => are.depositsOf(a)));
check(deps.every((d, i) => d.length === 1 && d[0] === tok[i]), 'every bot deposited its hamster (safeTransferFrom + deposit)');
check(await ham.ownerOf(tok[0]) === A, 'deposited NFT is held by the arena');
let blocked = false;
try { await hb[0].transferFrom.staticCall(addr[0], addr[1], tok[0]); } catch { blocked = true; }
check(blocked, 'a deposited hamster cannot be transferred by its player');

// ------------------------------------------------------------------ 3. schedule + joinMany
const h0 = await head();
const first = h0 + 14;                                       // ~3 min to get every join in
const firstId = Number(await are.arenaCount());
await wait(are.createArenas(first, 2, 3, 20, 0, true));
const [IA, IB, IC] = [firstId, firstId + 1, firstId + 2];
log(`arenas #${IA} #${IB} #${IC} close at blocks ${first}, ${first + 2}, ${first + 4}`);
const players = bots.slice(0, NBOTS - 1).map((_, i) => i);                            // bots 0..n-2 play A + B
await Promise.all(players.map((i) => wait(withGas(ab[i].joinMany, [[IA, IB], [tok[i], tok[i]]], FEE * 2n))));
const lone = NBOTS - 1;
await wait(withGas(ab[lone].join, [IC, tok[lone]], FEE));                              // C: one entrant -> cancelled
check(Number((await are.getArena(IA)).entrantCount) === players.length && Number((await are.getArena(IC)).entrantCount) === 1, `joinMany: ${players.length} hamsters in A and B, 1 in C`);

// one bot changes its mind while A and B are still open: withdraw = cancel + refund
const quitter = players[players.length - 1];
const qb = await provider.getBalance(addr[quitter]);
const rc = await wait(withGas(ab[quitter].withdraw, [[tok[quitter]]]));
const qa = await provider.getBalance(addr[quitter]);
check(qa - qb + rc.gasUsed * rc.gasPrice === FEE * 2n, 'withdraw while open refunds both entries (2 × fee)');
check(await ham.ownerOf(tok[quitter]) === addr[quitter], 'withdrawn NFT is back in the wallet');
check(!(await are.tokenInArena(IA, tok[quitter])) && Number((await are.getArena(IA)).entrantCount) === players.length - 1, 'its entries are gone from the open arenas');
const stay = players.slice(0, -1);

// ------------------------------------------------------------------ 4. settle A and B, cancel C
await untilBlock(first + 4 + 3, 'seed blocks of A, B, C');
async function settle(id) {
  const { arena: a, entries } = await readArena(are, provider, { chainId: CHAIN, arenaId: id });
  const { manifest, ruleset } = buildManifest({ ...manifestInputFromArena({ chainId: CHAIN, contract: A, arenaId: id, arena: a, entries }), recordDecisions: false });
  const replay = simulate(manifest, ruleset);
  const r = replay.result;
  const points = pointsFromResult(r), stats = statsFromResult(r);
  const rc2 = await wait(withGas(are.submitResult, [id, points, encodeStats(stats), hashToBytes8(r.resultHash), hashToBytes8(replay.replayHash)]));
  log(`  #${id}: ${entries.length} hamster, winner #${r.winnerId} ${r.winnerName}, submitResult ${rc2.gasUsed} gas`);
  return { points, stats, r };
}
const sA = await settle(IA);
const sB = await settle(IB);
await wait(are.pinSeed(IC));
check(Number((await are.getArena(IC)).status) === 4, 'C (1 entrant) cancelled by pinSeed');

const rA = await readArena(are, provider, { chainId: CHAIN, arenaId: IA });
check(rA.arena.status === 'Settled' && rA.arena.hasStats, 'A settled, rank + kills read back from the transaction');
check(rA.entries.every((e, i) => e.points === sA.points[i] && e.rank === sA.stats[i].rank && e.kills === sA.stats[i].kills), 'points, ranks and kills on chain = simulator');
check(!rA.arena.confirmed && phaseOf(rA.arena, rA.head, rA.now) === 'Confirming', 'A is "Confirming", not yet Confirmed');
const treeA = pointsTree(sA.points);
let early = false;
try { await ab[0].claim.staticCall(IA, 0, sA.points[0], treeA.proof(0)); } catch { early = true; }
check(early, 'claim before the delay is refused');

// B: the owner voids the result during the delay
const t1 = await are.treasury();
await wait(are.voidResult(IB));
check(Number((await are.getArena(IB)).status) === 4 && (await are.treasury()) < t1, 'B voided by the owner: cancelled, treasury cut returned');

// ------------------------------------------------------------------ 5. after the delay: claim
const ca = Number((await are.getArena(IA)).claimableAt);
for (let now = await chainNow(); now < ca; now = await chainNow()) { log(`  … chờ xác nhận, còn ${ca - now}s`); await sleep(Math.min(30, ca - now + 2) * 1000); }
await sleep(13000);                                                                    // one more block past claimableAt
const rA2 = await readArena(are, provider, { chainId: CHAIN, arenaId: IA });
check(rA2.arena.confirmed && phaseOf(rA2.arena, rA2.head, rA2.now) === 'Settled', 'A is Confirmed after the delay');

// bot 0: A reward + B refund in ONE claimAcross (sent by someone else: money goes to the player)
const p0 = rA2.entries.find((e) => e.player === addr[0].toLowerCase()).index;
const want0 = (await are.rewardFor(IA, sA.points[p0])) + FEE;
const pB0 = (await are.getEntries(IB))[0].findIndex((e) => e.player === addr[0]);
const b0 = await provider.getBalance(addr[0]);
await wait(withGas(are.claimAcross, [[IA, IB], [p0, pB0], [sA.points[p0], 0], [treeA.proof(p0), []]]));
check((await provider.getBalance(addr[0])) - b0 === want0, `claimAcross paid bot 0 its A reward + B refund (${ethers.formatEther(want0)} ETH) in one tx`);

// the others: claimMany on A, refunds on B, C refund for the lone bot
for (const i of stay.slice(1)) {
  const idx = rA2.entries.filter((e) => e.player === addr[i].toLowerCase()).map((e) => e.index);
  const pb = (await are.getEntries(IB))[0].findIndex((e) => e.player === addr[i]);
  const want = (await are.rewardFor(IA, sA.points[idx[0]])) + FEE;
  const before = await provider.getBalance(addr[i]);
  const rc3 = await wait(withGas(ab[i].claimAcross, [[IA, IB], [idx[0], pb], [sA.points[idx[0]], 0], [treeA.proof(idx[0]), []]]));
  check((await provider.getBalance(addr[i])) - before + rc3.gasUsed * rc3.gasPrice === want, `bot ${i} claimed A + B refund`);
}
const bl = await provider.getBalance(addr[lone]);
const rc4 = await wait(withGas(ab[lone].claim, [IC, 0, 0, []]));
check((await provider.getBalance(addr[lone])) - bl + rc4.gasUsed * rc4.gasPrice === FEE, 'lone bot refunded from C');

// ------------------------------------------------------------------ 6. views + leftovers
const page = await are.getArenas(IA, 3);
check(page.length === 3 && Number(page[0].status) === 3 && Number(page[1].status) === 4 && Number(page[2].status) === 4, 'getArenas: A Settled, B and C Cancelled in one call');
const arenaBal = await provider.getBalance(A);
const treasury = await are.treasury();
log(`arena holds ${ethers.formatEther(arenaBal)} ETH (treasury ${ethers.formatEther(treasury)}, the rest = A rounding dust)`);
check(arenaBal >= treasury && arenaBal - treasury < 10n, 'nothing owed is left in the arena except rounding dust');
await wait(are.withdrawTreasury(me));

// bots withdraw their hamsters (closed arenas only: nothing to cancel)
for (const i of stay) await wait(withGas(ab[i].withdraw, [[tok[i]]]));
check((await Promise.all(stay.map((i) => ham.ownerOf(tok[i])))).every((o, k) => o === addr[stay[k]]), 'every hamster withdrawn back to its wallet');

const spent = bal0 - (await provider.getBalance(me));
log(`\nSqueekHamster ${H}\nSqueekArena   ${A}\ndeployer spent ${ethers.formatEther(spent)} ETH (bots kept their leftovers)`);
if (problems.length) { console.error(`\n✗ ${problems.length} problem(s):\n  - ` + problems.join('\n  - ')); process.exit(1); }
console.log('\n✓ Sepolia contract 1.4 flow OK');
