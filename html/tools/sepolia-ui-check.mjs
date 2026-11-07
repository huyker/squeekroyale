#!/usr/bin/env node
// End-to-end on Sepolia: bots by script + one player through the real /play page.
//
//   node tools/sepolia-ui-check.mjs [--shots <dir>] [--bots 4] [--claim-delay 150]
//
// Wallets: contracts/.env BANK_MNEMONIC (the admin page's bank). runner = path 0 deploys and
// operates; bank bots #0..#n-1 play by script; bank bot #20 is the "person": its key is
// imported into a MetaMask stand-in and it does everything by clicking the page.
//
//   1  runner deploys a fresh SqueekHamster + SqueekArena            (script)
//   2  runner schedules arena A (closes in ~6 min) and B (stays open)  (script)
//   3  bots mint, deposit and join A                                  (script)
//   4  person: connect wallet, mint, deposit + join A, join B          (UI)
//      + creates a room of their own (start ~4 min, 100 max, Brawler) and is its only player
//   5  A closes; runner simulates and posts the result                (script)
//   6  person: Watch A — viewer opens under the card, hub mode (no seek / speed / VFX
//      toggles), own hamster in dark red, "Follow yourself" zooms in on it          (UI)
//   7  person: withdraw the hamster — B entry cancelled + refunded, A entry kept    (UI)
//   8  before the claim delay: not Confirmed, nothing claimable                     (UI)
//   9  after: ✓ CONFIRMED, On-chain Records rank/kills/tx = chain, Leaderboard and
//      Match History filled, Claim All pays exactly the reward (1 transaction)      (UI)
//  10  bots claim by script
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startBrowser, ensureWebSocket, keyWalletHandler } from './lib/browser.mjs';
import { ethers } from '../src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../src/chain/abi.js';
import { HAMSTER_BYTECODE, ARENA_BYTECODE } from '../src/chain/bytecode.js';
import { readArena } from '../src/chain/arena-read.js';
import { manifestInputFromArena, pointsFromResult, statsFromResult, rewardsOf } from '../src/chain/arena-manifest.js';
import { encodeStats, hashToBytes8 } from '../src/chain/proofs.js';
import { buildManifest } from '../src/core/manifest.js';
import { simulate } from '../src/core/simulator.js';

ensureWebSocket(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const shots = arg('shots', null);
const NBOTS = Number(arg('bots', 4));
const CLAIM_DELAY = Number(arg('claim-delay', 150));
const CHAIN = 11155111;
const env = Object.fromEntries(readFileSync(resolve(ROOT, '..', 'contracts', '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
if (!env.BANK_MNEMONIC) throw new Error('contracts/.env needs BANK_MNEMONIC (the admin wallet bank)');

const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', CHAIN, { staticNetwork: true });
provider.pollingInterval = 3000;
const hd = (i) => new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).connect(provider));
const runner = hd(0);
const bots = Array.from({ length: NBOTS }, (_, i) => hd(i + 1));
const person = hd(21);                                   // bank bot #20, "imported into MetaMask"
const ME = (await person.getAddress()).toLowerCase();

const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);
const errors = [], steps = [];
const step = (t) => { steps.push(t); log('✓ ' + t); };
const bad = (t) => { errors.push(t); log('✗ ' + t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const head = () => provider.getBlockNumber();
const chainNow = async () => (await provider.getBlock('latest')).timestamp;
const wait = async (p) => (await p).wait();
const headroom = async (fn, args, value) => {
  const o = value === undefined ? {} : { value };
  return fn(...args, { ...o, gasLimit: ((await fn.estimateGas(...args, o)) * 13n) / 10n });
};
async function untilBlock(n, what) { for (let h = await head(); h < n; h = await head()) { log(`… ${what}: block ${h} → ${n}`); await sleep(Math.min(60, (n - h) * 12) * 1000); } }

// ------------------------------------------------------------------ 1. deploy (bot)
const FEE = ethers.parseEther('0.0001');
log(`runner ${await runner.getAddress()} · person ${ME} (${ethers.formatEther(await provider.getBalance(ME))} ETH)`);
const ham = await new ethers.ContractFactory(HAMSTER_ABI, HAMSTER_BYTECODE, runner).deploy(await runner.getAddress(), 0);
await ham.waitForDeployment();
const are = await new ethers.ContractFactory(ARENA_ABI, ARENA_BYTECODE, runner).deploy(await runner.getAddress(), await ham.getAddress(), FEE, 86400, CLAIM_DELAY);
await are.waitForDeployment();
const H = await ham.getAddress(), A = await are.getAddress();
const dep = { chainId: CHAIN, network: 'sepolia', deployedAt: new Date().toISOString(), fromBlock: (await head()) - 2,
  owner: await runner.getAddress(), hamster: H, arena: A, entryFeeWei: FEE.toString(), mintPriceWei: '0',
  resultTimeout: 86400, claimDelay: CLAIM_DELAY, deployedFrom: 'sepolia-ui-check' };
step(`1 bot deployed SqueekHamster ${H} + SqueekArena ${A} (claim delay ${CLAIM_DELAY}s)`);

// ------------------------------------------------------------------ 2. schedule (bot)
const h0 = await head();
await wait(are.createArena(h0 + 30, 50, 0));
await wait(are.createArena(h0 + 400, 50, 1));
const [IA, IB] = [0, 1];
const closeA = Number((await are.getArena(IA)).closeBlock);
step(`2 runner opened arena #${IA} (closes block ${closeA}, ~6 min) and #${IB} (stays open)`);

// ------------------------------------------------------------------ 3. bots join (script)
await Promise.all(bots.map(async (b) => {
  const me = await b.getAddress();
  const h = ham.connect(b), ar = are.connect(b);
  await wait(headroom(h.mint, [1]));
  const tok = [...(await ham.tokensOfOwner(me))].at(-1);
  await wait(headroom(h['safeTransferFrom(address,address,uint256)'], [me, A, tok]));
  await wait(headroom(ar.join, [IA, tok], FEE));
}));
step(`3 ${NBOTS} bots minted, deposited and joined #${IA} by script`);

// ------------------------------------------------------------------ 4. the person, through the page
const br = await startBrowser({ root: ROOT, shots });
const wallet = { address: ME, chainId: CHAIN, handle: keyWalletHandler(person, provider, CHAIN, log),
  init: `try { localStorage.setItem('squeek.deployments', JSON.stringify({ ${CHAIN}: ${JSON.stringify(dep)} })); localStorage.setItem('squeek_lang', 'vi'); } catch (e) {}` };
let p;
try {
  p = await br.openPage(`${br.base}/play.html`, wallet, errors);
  await p.ev('window.confirm = () => true');
  await p.waitFor('!!window.squeekPlay', 30000, 'play page booted');
  // short page (wallet gate): the footer must still sit at the bottom of the screen
  const foot = await p.ev(`(() => { const f = document.querySelector('.site-footer').getBoundingClientRect();
    return { bottom: Math.round(f.bottom), vh: innerHeight, docH: document.documentElement.scrollHeight }; })()`);
  if (foot.docH <= foot.vh + 1 && Math.abs(foot.bottom - foot.vh) > 2) bad(`footer not at the bottom of the screen: ${JSON.stringify(foot)}`);
  step(`4· footer at the bottom of the screen (bottom ${foot.bottom}px of ${foot.vh}px)`);
  await p.click('btnGateConnect');
  await p.waitFor(`document.getElementById('hubContent').style.display !== 'none' && window.squeekPlay.S.wallet && window.squeekPlay.S.loaded`, 60000, 'hub unlocked');
  const stage0 = await p.ev(`({ hidden: getComputedStyle(document.getElementById('spectatorStageCard')).display === 'none',
    src: document.getElementById('spectatorIframe').getAttribute('src'), demo: !!document.getElementById('btnWatchInstantDemo') })`);
  if (!stage0.hidden || stage0.src || stage0.demo) bad(`the match viewer must stay hidden until the player picks a game: ${JSON.stringify(stage0)}`);
  step('4a person connected MetaMask on /play (imported key, Sepolia); no match viewer / demo / seed on the page');

  await p.ev(`window.squeekPlay.switchModule('my-hamsters')`);
  await p.ev(`document.getElementById('mintQty').value = '1'`);
  await p.click('btnMint');
  await p.waitFor('window.squeekPlay.S.hamsters.length === 1', 120000, 'minted hamster shows up');
  const myTok = await p.ev('window.squeekPlay.S.hamsters[0].id');
  await p.waitFor(`!!document.querySelector('[data-deposit="${myTok}"]')`, 20000, 'deposit button on the card');
  step(`4b person minted hamster #${myTok} from the page; its card offers "Ký gửi"`);
  await p.shot('ui-1-minted');

  await p.ev(`window.squeekPlay.switchModule('battle-arena')`);
  await p.waitFor(`!!document.querySelector('[data-join="${IA}"]')`, 60000, `join button on #${IA}`);
  await p.ev(`document.querySelector('[data-join="${IA}"]').click()`);
  for (let i = 0; i < 60 && !(await are.tokenInArena(IA, myTok)); i++) await sleep(4000);
  if (!(await are.tokenInArena(IA, myTok))) throw new Error(`the person never got into #${IA}`);
  if ((await are.depositorOf(myTok)).toLowerCase() !== ME) bad('joining did not deposit the hamster first');
  step(`4c person pressed "Ký gửi + tham gia" on #${IA}: deposited and joined (2 MetaMask confirmations)`);
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`!!document.querySelector('[data-join="${IB}"]')`, 60000, `join button on #${IB}`);
  await p.ev(`document.querySelector('[data-join="${IB}"]').click()`);
  for (let i = 0; i < 40 && !(await are.tokenInArena(IB, myTok)); i++) await sleep(4000);
  if (!(await are.tokenInArena(IB, myTok))) throw new Error(`the person never got into #${IB}`);
  step(`4d person joined #${IB} too (already deposited: 1 confirmation)`);

  // the person opens a room from the page and is its only player
  const IR = Number(await are.arenaCount());
  await p.ev(`(() => { const t = new Date(Date.now() + 4 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('roomStart').value = t; document.getElementById('roomMax').value = '100'; document.getElementById('roomPreset').value = '1'; })()`);
  await p.click('btnCreateRoom');
  for (let i = 0; i < 40 && Number(await are.arenaCount()) <= IR; i++) await sleep(3000);
  const room = await are.getArena(IR);
  const created = [...(await are.queryFilter(are.filters.RoomCreated(IR), (await head()) - 50))][0];
  if (!created || created.args.creator.toLowerCase() !== ME) bad(`room #${IR} creator ${created && created.args.creator}`);
  if (Number(room.maxEntrants) !== 100 || Number(room.preset) !== 1) bad(`room #${IR}: max ${room.maxEntrants}, preset ${room.preset}`);
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`!!document.querySelector('[data-join="${IR}"]')`, 60000, `join button on room #${IR}`);
  await p.ev(`document.querySelector('[data-join="${IR}"]').click()`);
  for (let i = 0; i < 40 && !(await are.tokenInArena(IR, myTok)); i++) await sleep(4000);
  if (!(await are.tokenInArena(IR, myTok))) bad(`the person could not join their own room #${IR}`);
  const roomClose = Number(room.closeBlock);
  step(`4e person created room #${IR} from the page (100 hamsters, Brawler, starts at block ${roomClose}) and joined it alone`);
  await p.shot('ui-2-joined');

  // ---------------------------------------------------------------- 5. close + settle (operator script)
  const seedBlock = Number((await are.getArena(IA)).seedBlock);
  await untilBlock(seedBlock + 1, `arena #${IA} closing, then its seed block`);
  const { arena: a0, entries } = await readArena(are, provider, { chainId: CHAIN, arenaId: IA });
  const { manifest, ruleset } = buildManifest({ ...manifestInputFromArena({ chainId: CHAIN, contract: A, arenaId: IA, arena: a0, entries }), recordDecisions: false });
  const replay = simulate(manifest, ruleset);
  const r = replay.result;
  await wait(headroom(are.connect(runner).submitResult, [IA, pointsFromResult(r), encodeStats(statsFromResult(r)), hashToBytes8(r.resultHash), hashToBytes8(replay.replayHash)]));
  const myIdx = entries.findIndex((e) => e.player === ME);
  step(`5 operator posted #${IA}: ${entries.length} hamsters, winner #${r.winnerId} ${r.winnerName}; the person is entry ${myIdx}`);

  // ---------------------------------------------------------------- 6. watch in the hub
  await p.ev(`document.querySelector('#arenaTabs .play-tab[data-tab="registered"]').click()`);   // "my matches"
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`!!document.querySelector('[data-watch-inline="${IA}"]')`, 60000, 'watch button');
  if (await p.ev(`!!document.querySelector('a[target="_blank"][href*="viewer.html"]')`)) bad('a "new tab" link to the viewer is still on the page');
  await p.ev(`document.querySelector('[data-watch-inline="${IA}"]').click()`);
  // "Watch" opens the match's own page (/play?match=<id>); the match is still on, so it plays LIVE there
  await p.waitFor(`window.squeekPlay.S.activeModule === 'match' && location.search === '?match=${IA}'`, 20000, 'match page');
  await p.waitFor(`!!document.getElementById('spectatorIframe').getAttribute('src')`, 60000, 'viewer started on the match page');
  const placed = await p.ev(`(() => { const s = document.getElementById('spectatorStageCard');
    return { inSlot: !!s.closest('#matchStageSlot'), src: document.getElementById('spectatorIframe').getAttribute('src') }; })()`);
  if (!placed.inSlot) bad(`viewer not on the match page: ${JSON.stringify(placed)}`);
  if (!/hub=1/.test(placed.src) || !placed.src.includes(`me=${ME}`) || /seed=/.test(placed.src) || !/live=\d+/.test(placed.src)) bad(`viewer URL ${placed.src}`);
  const W = `document.getElementById('spectatorIframe').contentWindow`;
  await p.waitFor(`!!${W}.squeek && !!${W}.squeek.renderer && ${W}.document.getElementById('playScreen') !== null`, 120000, 'viewer playing');
  await p.waitFor(`${W}.document.querySelector('.screen.active') && ${W}.document.querySelector('.screen.active').id === 'playScreen'`, 120000, 'viewer on the play screen').catch(() => {});
  const hubUi = await p.ev(`(() => { const d = ${W}.document, vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    const r = ${W}.squeek.renderer;
    return { seek: vis(d.getElementById('seek')), speed: [...d.querySelectorAll('.spd')].some(vis), restart: vis(d.getElementById('btnRestart')),
      nextKill: vis(d.getElementById('btnNextKill')), vfxTgl: vis(d.querySelector('.tgl[data-t="vfx"]')), namesTgl: vis(d.querySelector('.tgl[data-t="labels"]')),
      cams: [...d.querySelectorAll('.cam')].filter(vis).length, followMe: vis(d.getElementById('btnFollowMe')),
      seedField: vis(d.getElementById('seedInput')), vfx: r.showVfx, labels: r.showLabels, hp: r.showHpBars,
      mine: [...r.highlightIds] }; })()`);
  for (const k of ['seek', 'speed', 'restart', 'nextKill', 'vfxTgl', 'namesTgl', 'seedField']) if (hubUi[k]) bad(`viewer in the hub still shows ${k}`);
  if (hubUi.cams !== 3) bad(`expected the 3 camera buttons, saw ${hubUi.cams}`);
  if (!hubUi.followMe) bad('no "Follow yourself" button');
  if (!hubUi.vfx || !hubUi.labels || !hubUi.hp) bad('names / HP / effects must be on');
  if (JSON.stringify(hubUi.mine) !== JSON.stringify([myIdx])) bad(`highlighted hamsters ${JSON.stringify(hubUi.mine)}, expected [${myIdx}]`);
  step(`6a Watch: /play?match=${IA} plays the match LIVE on its page — no seed / seek / speed / effect toggles, 3 camera modes, own hamster #${myIdx} highlighted`);
  await p.ev(`${W}.document.querySelector('.cam[data-c="free"]').click()`);
  const freeOk = await p.ev(`${W}.squeek.camera.mode === 'free'`);
  await p.ev(`${W}.document.getElementById('btnFollowMe').click()`);
  await sleep(2500);
  const cam = await p.ev(`(() => { const c = ${W}.squeek.camera; return { mode: c.mode, id: c.followId, zoom: c.followZoom, now: Math.round(c.zoom * 100) / 100 }; })()`);
  if (!freeOk || cam.mode !== 'follow' || cam.id !== myIdx || cam.zoom < 1.3) bad(`follow yourself: ${JSON.stringify(cam)} (free mode ok ${freeOk})`);
  step(`6b camera choice works; "Follow yourself" → follow #${cam.id}, zoom ${cam.now} → ${cam.zoom}`);
  await p.ev(`document.getElementById('spectatorStageCard').scrollIntoView()`);
  await sleep(800);
  await p.shot('ui-3-watch-follow-me');

  // ---------------------------------------------------------------- 7. withdraw from the page
  await untilBlock(roomClose, `room #${IR} start`);                  // the lone room must have started first
  await p.ev(`window.squeekPlay.switchModule('my-hamsters')`);
  await p.waitFor(`!!document.querySelector('[data-withdraw="${myTok}"]')`, 30000, 'withdraw button');
  const potB0 = (await are.getArena(IB)).pot;
  await p.ev(`document.querySelector('[data-withdraw="${myTok}"]').click()`);
  for (let i = 0; i < 40 && (await ham.ownerOf(myTok)).toLowerCase() !== ME; i++) await sleep(4000);
  if ((await ham.ownerOf(myTok)).toLowerCase() !== ME) bad('withdraw from the page did not return the NFT');
  if (await are.tokenInArena(IB, myTok)) bad(`still entered in open arena #${IB} after withdrawing`);
  if (potB0 - (await are.getArena(IB)).pot !== FEE) bad('the open arena did not refund the fee');
  if (!(await are.tokenInArena(IA, myTok))) bad(`the closed arena #${IA} lost the entry`);
  if (!(await are.tokenInArena(IR, myTok))) bad(`the started room #${IR} lost the entry`);
  step(`7 person withdrew #${myTok} from the page: #${IB} entry cancelled + fee refunded, #${IA} entry kept`);

  // ---------------------------------------------------------------- 8. not final yet
  await p.ev(`window.squeekPlay.switchModule('onchain-records'); window.squeekPlay.refresh()`);
  await sleep(6000);
  const pre = await p.ev(`({ confirmed: !!(window.squeekPlay.S.arenas.find((a) => a.id === ${IA}) || {}).confirmed,
    claimAll: !document.getElementById('btnClaimAllRewards').disabled, label: document.getElementById('btnClaimAllRewards').innerText })`);
  // #0 is not final yet, so its reward must not be offered; the lone room has started, so its
  // refund already is (and only that: 0.0001 ETH from 1 match)
  if (pre.confirmed) bad(`#${IA} shows Confirmed before the claim delay`);
  if (!pre.claimAll || !/\(0\.0001 ETH/.test(pre.label) || !/\b1 (match|trận)/.test(pre.label)) bad(`before the claim delay Claim All should offer only the room refund: "${pre.label}"`);
  else step(`8 before the confirmation delay: #${IA} not Confirmed; Claim All offers only the lone room's refund ("${pre.label}")`);

  // ---------------------------------------------------------------- 9. confirmed, records, claim
  const ca = Number((await are.getArena(IA)).claimableAt);
  for (let now = await chainNow(); now < ca + 13; now = await chainNow()) { log(`… confirmation in ${ca - now}s`); await sleep(Math.min(30, ca - now + 14) * 1000); }
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`(window.squeekPlay.S.arenas.find((a) => a.id === ${IA}) || {}).confirmed === true`, 120000, 'arena confirmed in the hub');
  await p.waitFor(`!document.getElementById('btnClaimAllRewards').disabled`, 60000, 'claim all enabled');
  const chainA = await readArena(are, provider, { chainId: CHAIN, arenaId: IA });
  const mine = chainA.entries[myIdx];
  const rec = await p.ev(`(() => { const rows = [...document.querySelectorAll('#onchainRecordsBody tr')];
    return rows.map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim()); })()`);
  const row = rec.find((t) => t.includes(`#${IA}`) && t.toLowerCase().includes(ME.slice(2, 6)));
  if (!row) bad(`no On-chain Records row for the person in #${IA}: ${rec.slice(0, 3).join(' | ')}`);
  else {
    if (!/confirmed/i.test(row)) bad(`record row not Confirmed: ${row}`);
    if (!row.includes(String(mine.kills))) bad(`record row kills differ from chain (${mine.kills}): ${row}`);
  }
  const lb = await p.ev(`document.querySelectorAll('#leaderboardBody tr').length`);
  const mh = await p.ev(`document.querySelectorAll('#matchHistoryBody tr').length`);
  if (!lb) bad('leaderboard is empty');
  if (!mh) bad('match history is empty');
  step(`9a #${IA} ✓ CONFIRMED in the hub; On-chain Records row (rank ${mine.rank}, ${mine.kills} kills, tx) matches the chain; leaderboard ${lb} rows, history ${mh} rows`);
  await p.shot('ui-4-records');
  const owed = rewardsOf(chainA.arena, chainA.entries)[myIdx];
  const before = await provider.getBalance(ME);
  const n0 = await provider.getTransactionCount(ME);
  await p.ev(`document.getElementById('btnClaimAllRewards').click()`);
  for (let i = 0; i < 40 && !(await readArena(are, provider, { chainId: CHAIN, arenaId: IA })).entries[myIdx].claimed; i++) await sleep(4000);
  const after = await provider.getBalance(ME);
  const sent = (await provider.getTransactionCount(ME)) - n0;
  const lastTx = [...(await are.queryFilter(are.filters.Claimed(IA, ME), (await head()) - 60))].at(-1);
  const rc = lastTx ? await provider.getTransactionReceipt(lastTx.transactionHash) : null;
  const delta = rc ? after - before + rc.gasUsed * rc.gasPrice : -1n;
  if (delta !== owed + FEE) bad(`claim all paid ${delta} wei, expected the #${IA} reward ${owed} + the room refund ${FEE}`);
  if (sent !== 1) bad(`claim all took ${sent} transactions, expected 1`);
  if (Number((await are.getArena(IR)).status) !== 4) bad(`room #${IR} should be cancelled by the lone player's claim`);
  step(`9b Claim All from the page: 1 transaction paid the #${IA} reward ${ethers.formatEther(owed)} ETH + 100% of the lone room's fee (room cancelled, no match)`);

  // ---------------------------------------------------------------- 10. bots claim (script)
  const tree = (await import('../src/chain/proofs.js')).pointsTree(chainA.entries.map((e) => e.points));
  const botIdx = chainA.entries.filter((e) => e.player !== ME).map((e) => e.index);
  await wait(headroom(are.connect(runner).claimMany, [IA, botIdx, botIdx.map((i) => chainA.entries[i].points), botIdx.map((i) => tree.proof(i))]));
  const done = (await readArena(are, provider, { chainId: CHAIN, arenaId: IA })).entries.every((e) => e.claimed);
  if (!done) bad('some entries still unclaimed');
  step(`10 bots' rewards claimed by script; every entry of #${IA} paid`);

  // ---------------------------------------------------------------- 11. history: only my games, replay opens there
  await p.ev(`window.squeekPlay.switchModule('match-history')`);
  const hist = await p.ev(`[...document.querySelectorAll('#matchHistoryBody tr')].map((tr) => tr.innerText.replace(/\\s+/g, ' '))`);
  if (!hist.length || hist.some((t) => !t.includes('#' + IA))) bad(`match history should list only the player's game #${IA}: ${hist.join(' | ')}`);
  await p.waitFor(`!!document.querySelector('[data-mh-watch="${IA}"]')`, 20000, 'replay button in history');
  await p.ev(`document.querySelector('[data-mh-watch="${IA}"]').click()`);
  // the match is over by now: its page offers Replay, which plays it from the start
  await p.waitFor(`window.squeekPlay.S.activeModule === 'match' && !!document.getElementById('btnMatchReplay')`, 60000, 'replay on the match page');
  await p.ev(`document.getElementById('btnMatchReplay').click()`);
  const inHist = await p.ev(`(() => { const s = document.getElementById('spectatorStageCard');
    return { inSlot: !!s.closest('#matchStageSlot'), shown: getComputedStyle(s).display !== 'none', src: document.getElementById('spectatorIframe').getAttribute('src') }; })()`);
  if (!inHist.inSlot || !inHist.shown || !inHist.src.includes('arena=' + IA) || /live=/.test(inHist.src)) bad(`history replay: ${JSON.stringify(inHist)}`);
  await p.ev(`document.getElementById('btnToggleSpectator').click()`);
  const closed = await p.ev(`getComputedStyle(document.getElementById('spectatorStageCard')).display === 'none' && !document.getElementById('spectatorIframe').getAttribute('src')`);
  if (!closed) bad('the Close button did not close the viewer');
  step(`11 Match History lists only the player's own game; it opens the match page, whose ▶ Replay plays it from the start; Close hides it`);
} catch (e) {
  bad('FATAL: ' + (e?.message || e));
  try { if (p) { await p.shot('ui-fatal'); log('msg:', await p.ev(`document.getElementById('msg') && document.getElementById('msg').innerText`)); } } catch {}
} finally {
  br.close();
}
const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|ERR_FILE/.test(e));
console.log(`\nSqueekHamster ${H}\nSqueekArena   ${A}\n${steps.length} steps passed.`);
if (real.length) { console.error(`✗ ${real.length} problem(s):\n  - ` + real.join('\n  - ')); process.exit(1); }
console.log('✓ Sepolia full flow through the UI OK');
