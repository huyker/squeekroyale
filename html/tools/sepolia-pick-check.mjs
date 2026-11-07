#!/usr/bin/env node
// Choosing hamsters on /play, on Sepolia, as a real player (key imported into a MetaMask stand-in):
//   node tools/sepolia-pick-check.mjs <hamster address> <arena address> [--shots <dir>]
// (use a test deployment, e.g. the one tools/sepolia-ui-check.mjs prints at the end)
//
//   * own 3 hamsters, tick 2 in My Hamsters -> "Deposit 2 selected": exactly those 2 deposited,
//     the 3rd stays in the wallet
//   * open a room, pick a specific hamster in the arena card's picker -> that one enters
//   * tick 1 deposited hamster -> "Withdraw 1 selected": exactly that one comes back
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startBrowser, ensureWebSocket, keyWalletHandler } from './lib/browser.mjs';
import { ethers } from '../src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../src/chain/abi.js';

ensureWebSocket(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const [H, A] = argv;
const shots = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
const env = Object.fromEntries(readFileSync(resolve(ROOT, '..', 'contracts', '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const CHAIN = 11155111;
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', CHAIN, { staticNetwork: true });
const person = new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, "m/44'/60'/0'/0/21").connect(provider));
const ME = (await person.getAddress()).toLowerCase();
const ham = new ethers.Contract(H, HAMSTER_ABI, provider), are = new ethers.Contract(A, ARENA_ABI, provider);
const t0 = Date.now(), errors = [], steps = [];
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);
const step = (t) => { steps.push(t); log('✓ ' + t); };
const bad = (t) => { errors.push(t); log('✗ ' + t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 150000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await sleep(4000); } throw new Error('timeout: ' + what); };
const owned = async () => ({ wallet: [...(await ham.tokensOfOwner(ME))].map(String), deposited: [...(await are.depositsOf(ME))].map(String) });

const dep = { chainId: CHAIN, network: 'sepolia', hamster: H, arena: A, entryFeeWei: (await are.entryFee()).toString(), mintPriceWei: '0', fromBlock: (await provider.getBlockNumber()) - 3000 };
const br = await startBrowser({ root: ROOT, shots });
try {
  const p = await br.openPage(`${br.base}/play.html`, { address: ME, chainId: CHAIN, handle: keyWalletHandler(person, provider, CHAIN, log),
    init: `localStorage.setItem('squeek.deployments', JSON.stringify({ ${CHAIN}: ${JSON.stringify(dep)} })); localStorage.setItem('squeek_lang', 'vi');` }, errors);
  await p.ev('window.confirm = () => true');
  await p.waitFor('!!window.squeekPlay', 30000);
  await p.click('btnGateConnect');
  await p.waitFor('window.squeekPlay.S.loaded && window.squeekPlay.S.wallet', 90000, 'hub');

  // ---------------------------------------------------------------- 3 hamsters, all in the wallet
  let o = await owned();
  if (o.deposited.length) {                                            // start clean: everything in the wallet
    await (await are.connect(person).withdraw(o.deposited)).wait();
    o = await owned();
  }
  const need = Math.max(0, 3 - o.wallet.length);
  if (need) {
    await p.ev(`window.squeekPlay.switchModule('my-hamsters'); document.getElementById('mintQty').value = '${need}'`);
    await p.click('btnMint');
    await until(async () => (await owned()).wallet.length >= 3, 'mint');
  }
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`window.squeekPlay.S.hamsters.length >= 3 && window.squeekPlay.S.hamsters.every((h) => !h.deposited)`, 60000, '3 hamsters in the wallet');
  const ids = await p.ev('window.squeekPlay.S.hamsters.map((h) => h.id)');
  step(`player owns ${ids.length} hamsters (${ids.join(', ')}), all in the wallet`);

  // ---------------------------------------------------------------- tick 2, deposit them
  await p.ev(`window.squeekPlay.switchModule('my-hamsters')`);
  const [d1, d2, keep] = ids;
  for (const id of [d1, d2]) await p.ev(`(() => { const c = document.querySelector('[data-pick="${id}"]'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
  const label = await p.ev(`document.getElementById('btnBulkDeposit').innerText`);
  if (!/2/.test(label)) bad(`bulk deposit button says "${label}"`);
  await p.shot('pick-1-two-ticked');
  await p.ev(`document.getElementById('btnBulkDeposit').click()`);
  await until(async () => (await owned()).deposited.length === 2, 'bulk deposit');
  o = await owned();
  if (o.deposited.sort().join() !== [d1, d2].sort().join() || !o.wallet.includes(keep)) bad(`deposited ${o.deposited}, wallet ${o.wallet}`);
  step(`ticked #${d1} and #${d2} → "Ký gửi 2 con đã chọn": exactly those deposited, #${keep} still in the wallet`);

  // ---------------------------------------------------------------- a room, enter with a chosen hamster
  const IR = Number(await are.arenaCount());
  await p.ev(`window.squeekPlay.switchModule('battle-arena')`);
  await p.click('btnCreateRoom');
  await until(async () => Number(await are.arenaCount()) > IR, 'room created');
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`!!document.querySelector('[data-join-pick="${IR}"]')`, 60000, 'hamster picker on the room card');
  const opts = await p.ev(`[...document.querySelector('[data-join-pick="${IR}"]').options].map((o) => o.value + ' ' + o.text)`);
  if (opts.length !== 3) bad(`the picker should offer the 3 hamsters: ${opts.join(' | ')}`);
  await p.ev(`(() => { const s = document.querySelector('[data-join-pick="${IR}"]'); s.value = '${d2}'; s.dispatchEvent(new Event('change')); })()`);
  await p.waitFor(`document.querySelector('[data-join-pick="${IR}"]').value === '${d2}'`, 10000, 'pick kept after re-render');
  await p.shot('pick-2-room-picker');
  await p.ev(`document.querySelector('[data-join="${IR}"]').click()`);
  await until(async () => are.tokenInArena(IR, d2), 'join with the picked hamster');
  if (await are.tokenInArena(IR, d1)) bad('the other hamster entered instead');
  step(`room #${IR}: picker listed ${opts.length} hamsters (deposited first); picked #${d2} → #${d2} entered, #${d1} did not`);
  await p.ev('window.squeekPlay.refresh()');
  await p.waitFor(`!!document.querySelector('[data-join-pick="${IR}"]')`, 60000, 'picker again');
  const left = await p.ev(`[...document.querySelector('[data-join-pick="${IR}"]').options].map((o) => o.value)`);
  if (left.includes(d2) || left.length !== 2) bad(`after joining, the picker should offer the other 2: ${left}`);
  step(`after joining, the room card still offers the other ${left.length} hamsters (one wallet, several hamsters per room)`);

  // ---------------------------------------------------------------- tick 1 deposited, withdraw it
  await p.ev(`window.squeekPlay.switchModule('my-hamsters')`);
  await p.waitFor(`!!document.querySelector('[data-pick="${d1}"]')`, 30000);
  await p.ev(`(() => { const c = document.querySelector('[data-pick="${d1}"]'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
  await p.ev(`document.getElementById('btnBulkWithdraw').click()`);
  await until(async () => (await owned()).wallet.includes(d1), 'bulk withdraw');
  o = await owned();
  if (o.deposited.join() !== d2) bad(`after withdrawing #${d1}: deposited ${o.deposited}`);
  step(`ticked #${d1} → "Rút 1 con đã chọn": #${d1} back in the wallet, #${d2} still deposited (and still in room #${IR})`);
  await p.shot('pick-3-after');
} catch (e) { bad('FATAL: ' + (e?.message || e)); }
finally { br.close(); }
const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e));
if (real.length) { console.error(`✗ ${real.length} problem(s):\n  - ` + real.join('\n  - ')); process.exit(1); }
console.log(`✓ choosing hamsters on /play OK (${steps.length} checks)`);
