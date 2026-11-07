#!/usr/bin/env node
// The match page (/play?match=<id>) on the REAL Sepolia deployment, as a bank bot that played in it:
//   node tools/sepolia-match-page-check.mjs --as <bank bot #> --match <id> --expect replay|live [--shots <dir>]
//   replay: a finished match shows "Replay"; pressing it plays the match from the start
//   live:   during the match, the viewer opens by itself in LIVE mode at the wall-clock moment
// Also: clicking a card in the list opens its page (URL ?match=<id>), Back returns to the list.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { startBrowser, ensureWebSocket, keyWalletHandler } from './lib/browser.mjs';
import { ethers } from '../src/vendor/ethers.min.js';

ensureWebSocket(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const AS = Number(arg('as', 0)), ID = Number(arg('match', 3)), EXPECT = arg('expect', 'replay'), shots = arg('shots', null);
const env = Object.fromEntries(readFileSync(resolve(ROOT, '..', 'contracts', '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
const CHAIN = 11155111;
const provider = new ethers.JsonRpcProvider(env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', CHAIN, { staticNetwork: true });
const player = new ethers.NonceManager(ethers.HDNodeWallet.fromPhrase(env.BANK_MNEMONIC, undefined, `m/44'/60'/0'/0/${AS + 1}`).connect(provider));
const ME = (await player.getAddress()).toLowerCase();
const errors = [], steps = [];
const log = (...a) => console.log(new Date().toLocaleTimeString('vi-VN'), ...a);
const step = (t) => { steps.push(t); log('✓ ' + t); };
const bad = (t) => { errors.push(t); log('✗ ' + t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const br = await startBrowser({ root: ROOT, shots });
try {
  const p = await br.openPage(`${br.base}/play.html?match=${ID}`, { address: ME, chainId: CHAIN, handle: keyWalletHandler(player, provider, CHAIN),
    init: `localStorage.removeItem('squeek.deployments'); localStorage.setItem('squeek_lang', 'vi');` }, errors);
  await p.waitFor('!!window.squeekPlay', 30000);
  await p.click('btnGateConnect');
  await p.waitFor(`window.squeekPlay.S.loaded && window.squeekPlay.S.activeModule === 'match' && document.getElementById('matchTitle').textContent === 'Match #${ID}'`, 90000, 'match page');
  await p.waitFor(`document.getElementById('matchInfo').innerText.length > 20 && !!document.querySelector('#matchCard .arena-card')`, 30000, 'match details');
  const info = await p.ev(`document.getElementById('matchInfo').innerText.replace(/\\s+/g, ' ')`);
  step(`/play?match=${ID} opens the match page: ${info.slice(0, 110)}`);
  const W = `document.getElementById('spectatorIframe').contentWindow`;

  if (EXPECT === 'replay') {
    await p.waitFor(`!!document.getElementById('btnMatchReplay')`, 60000, 'replay button');
    const hidden = await p.ev(`getComputedStyle(document.getElementById('spectatorStageCard')).display === 'none' || !document.getElementById('spectatorIframe').getAttribute('src')`);
    if (!hidden) bad('a finished match should not start playing by itself');
    step(`finished match: "${(await p.ev(`document.getElementById('matchNote').innerText`)).trim()}"`);
    await p.ev(`document.getElementById('btnMatchReplay').click()`);
    const src = await p.ev(`document.getElementById('spectatorIframe').getAttribute('src')`);
    if (!src || /live=/.test(src) || !src.includes(`arena=${ID}`)) bad(`replay URL ${src}`);
    await p.waitFor(`!!${W}.squeek && !!${W}.squeek.renderer && ${W}.document.querySelector('.screen.active').id === 'playScreen'`, 120000, 'replay playing');
    await sleep(3000);
    const v = await p.ev(`({ live: ${W}.document.body.classList.contains('is-live'), t: ${W}.squeek.state().tick, inSlot: !!document.getElementById('spectatorStageCard').closest('#matchStageSlot') })`);
    if (v.live || v.t > 200 || !v.inSlot) bad(`replay should start from the beginning on the match page: ${JSON.stringify(v)}`);
    step(`"Replay" plays the match from the start on its page (tick ${v.t}, not live)`);
  } else {
    await p.waitFor(`(document.getElementById('spectatorIframe').getAttribute('src') || '').includes('live=')`, 180000, 'live viewer');
    const live = Number(new URL(await p.ev(`document.getElementById('spectatorIframe').src`)).searchParams.get('live'));
    await p.waitFor(`!!${W}.squeek && !!${W}.squeek.renderer && ${W}.document.body.classList.contains('is-live')`, 120000, 'live playing');
    await sleep(4000);
    const v = await p.ev(`({ t: ${W}.squeek.state().tick, pause: getComputedStyle(${W}.document.getElementById('btnPlayPause')).display })`);
    const want = Math.floor((Date.now() / 1000 - live) * 20);
    if (Math.abs(v.t - want) > 40) bad(`live view at tick ${v.t}, the wall clock says ${want}`);
    if (v.pause !== 'none') bad('no pause button in a live view');
    step(`LIVE: the viewer opened by itself at tick ${v.t} (wall clock ${want}, started ${new Date(live * 1000).toLocaleTimeString('vi-VN')}), no pause`);
  }
  await p.ev(`document.getElementById('spectatorStageCard').scrollIntoView({ block: 'start' })`);
  await sleep(1500);
  await p.shot(`match-page-${ID}-${EXPECT}`);

  // back to the list, then a card click opens the page again
  await p.ev(`document.getElementById('btnMatchBack').click()`);
  const back = await p.ev(`({ mod: window.squeekPlay.S.activeModule, url: location.search, viewer: !!document.getElementById('spectatorIframe').getAttribute('src') })`);
  if (back.mod !== 'battle-arena' || back.url.includes('match') || back.viewer) bad(`back: ${JSON.stringify(back)}`);
  await p.ev(`document.querySelector('#arenaTabs .play-tab[data-tab="all"]').click()`);
  await p.waitFor(`!!document.querySelector('#arenaGrid .arena-card[data-arena-id="${ID}"]')`, 20000, 'card in the list');
  await p.ev(`document.querySelector('#arenaGrid .arena-card[data-arena-id="${ID}"] .arena-card-info').click()`);
  await p.waitFor(`window.squeekPlay.S.activeModule === 'match' && location.search === '?match=${ID}'`, 10000, 'card click opens the page');
  await p.ev('history.back()');
  await p.waitFor(`window.squeekPlay.S.activeModule === 'battle-arena'`, 10000, 'browser Back returns to the list');
  step('"← Danh sách trận" and the browser Back return to the list; clicking a card opens /play?match=<id>');
} catch (e) { bad('FATAL: ' + (e?.message || e)); }
finally { br.close(); }
const real = errors.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e));
if (real.length) { console.error(`✗ ${real.length} problem(s):\n  - ` + real.join('\n  - ')); process.exit(1); }
console.log(`✓ match page OK (${steps.length} checks)`);
