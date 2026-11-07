#!/usr/bin/env node
// Sharing a match and picking a hamster by its picture, on the REAL Sepolia deployment:
//   node tools/sepolia-share-check.mjs --share <matchId> --join <openMatchId> [--shots <dir>]
// The player is bank bot #20 (key imported into the MetaMask stand-in).
//   * /play?match=<id>: the wallet gate says "invited to Match #id"; once connected the card of
//     that match is brought into view and highlighted
//   * the "Match ID" box opens another match the same way; every card has a Share button
//   * own 2+ hamsters, click the picture of a specific one on the open match's card -> it enters
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startBrowser, ensureWebSocket, keyWalletHandler } from './lib/browser.mjs';
import { ethers } from '../src/vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from '../src/chain/abi.js';
import { DEPLOYMENTS } from '../src/chain/deployments.js';

ensureWebSocket(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SHARE = Number(arg('share', 1)), JOIN = Number(arg('join', 2)), shots = arg('shots', null);
const env = Object.fromEntries(readFileSync(resolve(ROOT, '..', 'contracts', '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const CHAIN = 11155111, dep = DEPLOYMENTS[CHAIN];
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', CHAIN, { staticNetwork: true });
const person = new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, "m/44'/60'/0'/0/21").connect(provider));
const ME = (await person.getAddress()).toLowerCase();
const ham = new ethers.Contract(dep.hamster, HAMSTER_ABI, provider), are = new ethers.Contract(dep.arena, ARENA_ABI, provider);
const t0 = Date.now(), errors = [], steps = [];
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s]`, ...a);
const step = (t) => { steps.push(t); log('✓ ' + t); };
const bad = (t) => { errors.push(t); log('✗ ' + t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, what, ms = 150000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await sleep(4000); } throw new Error('timeout: ' + what); };

const br = await startBrowser({ root: ROOT, shots });
try {
  const p = await br.openPage(`${br.base}/play.html?match=${SHARE}`, { address: ME, chainId: CHAIN, handle: keyWalletHandler(person, provider, CHAIN, log),
    init: `localStorage.removeItem('squeek.deployments'); localStorage.setItem('squeek_lang', 'vi');` }, errors);
  await p.ev('window.confirm = () => true');
  await p.waitFor('!!window.squeekPlay', 30000);
  const gate = await p.ev(`document.getElementById('walletGateText').innerText`);
  if (!gate.includes(`Match #${SHARE}`)) bad(`gate does not mention the invite: ${gate.slice(0, 120)}`);
  step(`/play?match=${SHARE}: the wallet gate says "${gate.split('\n')[0].slice(0, 60)}"`);
  await p.shot('share-1-gate');
  await p.click('btnGateConnect');
  await p.waitFor('window.squeekPlay.S.loaded && window.squeekPlay.S.wallet', 90000, 'hub');
  await p.waitFor(`!!document.querySelector('.arena-card.focus[data-arena-id="${SHARE}"]')`, 30000, 'shared match highlighted');
  const inView = await p.ev(`(() => { const r = document.querySelector('.arena-card[data-arena-id="${SHARE}"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 40; })()`);
  if (!inView) bad('the shared match card is not scrolled into view');
  step(`after connecting: Match #${SHARE}'s card is in view and highlighted`);
  await p.shot('share-2-focused');

  const link = await p.ev(`(async () => { let copied = null; navigator.clipboard.writeText = async (t) => { copied = t; };
    document.querySelector('[data-share="${JOIN}"]').click(); await new Promise((r) => setTimeout(r, 300)); return copied; })()`);
  if (!link || !link.endsWith(`?match=${JOIN}`)) bad(`share button copied ${link}`);
  step(`"🔗 Chia sẻ" on Match #${JOIN} copies ${link}`);

  await p.ev(`document.getElementById('matchIdInput').value = '${JOIN}'; document.getElementById('btnOpenMatch').click()`);
  await p.waitFor(`!!document.querySelector('.arena-card.focus[data-arena-id="${JOIN}"]')`, 30000, 'typed match highlighted');
  step(`typing ${JOIN} in the Match ID box brings Match #${JOIN} into view`);

  // own at least 2 hamsters, then pick the second one by its picture
  let wallet = [...(await ham.tokensOfOwner(ME))].map(String), deposited = [...(await are.depositsOf(ME))].map(String);
  if (wallet.length + deposited.length < 2) {
    await p.ev(`window.squeekPlay.switchModule('my-hamsters'); document.getElementById('mintQty').value = '2'`);
    await p.click('btnMint');
    await until(async () => (await ham.tokensOfOwner(ME)).length >= 2, 'mint 2');
    await p.ev(`window.squeekPlay.switchModule('battle-arena'); window.squeekPlay.refresh()`);
  }
  await p.waitFor(`document.querySelectorAll('[data-join-ham^="${JOIN}:"]').length >= 2`, 90000, 'pictures on the open match card');
  const pics = await p.ev(`[...document.querySelectorAll('[data-join-ham^="${JOIN}:"]')].map((b) => ({ id: b.dataset.joinHam.split(':')[1], on: b.classList.contains('on'),
    drawn: (() => { const c = b.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, 128, 128).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })() }))`);
  if (pics.some((x) => x.drawn < 500)) bad(`a hamster picture is empty: ${JSON.stringify(pics)}`);
  const target = pics.find((x) => !x.on).id;
  await p.ev(`document.querySelector('[data-join-ham="${JOIN}:${target}"]').click()`);
  await p.waitFor(`document.querySelector('[data-join-ham="${JOIN}:${target}"]').classList.contains('on')`, 10000, 'picture selected');
  await p.ev(`document.querySelector('.arena-card[data-arena-id="${JOIN}"]').scrollIntoView({ block: 'center' })`);
  await p.shot('share-3-picture-picked');
  await p.ev(`document.querySelector('[data-join="${JOIN}"]').click()`);
  await until(async () => are.tokenInArena(JOIN, target), 'join with the picked picture');
  const others = pics.filter((x) => x.id !== target);
  for (const o of others) if (await are.tokenInArena(JOIN, o.id)) bad(`#${o.id} entered too`);
  step(`card shows ${pics.length} hamster pictures; clicked #${target}'s picture → #${target} entered Match #${JOIN}, the others did not`);
} catch (e) { bad('FATAL: ' + (e?.message || e)); }
finally { br.close(); }
const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e));
if (real.length) { console.error(`✗ ${real.length} problem(s):\n  - ` + real.join('\n  - ')); process.exit(1); }
console.log(`✓ share + pick by picture OK (${steps.length} checks)`);
