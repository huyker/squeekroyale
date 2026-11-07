// Gameplay & Player Hub (/play). Everything on this page needs a connected wallet:
// 1. 🎮 Battle Arena (watch matches + join arenas)
// 2. 🐹 My Hamsters (your NFTs, mint)
// 3. 🏆 Leaderboard (aggregated from verified, settled arenas)
// 4. 📊 Match History (win/loss)
// 5. ⛓️ On-chain Records (verified results + Claim All)
// The site is Sepolia-only. Text follows the EN/VI toggle: L(en, vi), re-rendered on `squeek:lang`.

import { NETWORKS, DEFAULT_CHAIN, chainReady, deploymentOf, readProvider, contracts, loadArena, hasWallet,
         connectWallet, switchChain, errorText, shortAddr, fmtEth, tryReconnect, blockTime, withClock,
         claimManyArgs, claimAcrossArgs, hamstersOf, depositHamsters, joinTx, arenaIdsNear } from '../chain/client.js';
import { simulateLoaded } from '../chain/settle.js';
import { normaliseArena, normaliseEntries, rewardsOf, STATUS_VI, PRESET_IDS } from '../chain/arena-manifest.js';
import { traitsOf, dnaName, appearanceOfTraits } from '../core/hamster.js';
import { AssetLibrary } from '../render/assets.js';
import { renderNftCardHtml } from './nft-cards.js';
import { L } from './portal.js';
import { squeekAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const MODULES = ['battle-arena', 'my-hamsters', 'leaderboard', 'match-history', 'onchain-records', 'match'];
const S = {
  chainId: DEFAULT_CHAIN,  // Sepolia, always
  wallet: null,
  hamsters: [],
  arenas: [],          // normalised arena summaries
  arenaDetails: {},    // arenaId -> { arena, entries, strictlyConfirmed }
  arenaEntries: {},    // arenaId -> entries array
  activeTab: 'upcoming',
  activeModule: 'battle-arena',
  token: null,
  skew: 0,
  head: null,
  owner: null,
  operator: null,
  fee: 0n,
  mintPrice: 0n,
  spectatorOpen: false,
  spectator: null,          // { arenaId }: one of the player's own matches, picked from a card or the history
  pick: new Set(),          // My Hamsters: ticked for a bulk deposit / withdraw
  joinPick: {},             // arenaId -> the hamster chosen to enter it
  match: null,             // the match page on screen (/play?match=<id>)
  pendingMatch: null,       // ?match=<id> in the URL: opened once the arenas are loaded
  liveStart: {},            // "<id>:<seedBlock>" -> unix time the match starts playing
  headers: [],              // every arena's header (getArenas, 100 per call): the tabs sort + page over these
  mine: [],                 // arenas the wallet has entries in (Joined − Left events, indexed by player)
  mineScan: null,           // { to, counts } incremental event scan
  page: {},                 // tab -> page index
  joinOpen: null,           // the arena whose "Join" was pressed: its hamster picker is shown
  loaded: false,
};
const assets = new AssetLibrary();
const nowChain = () => Math.floor(Date.now() / 1000 + S.skew);
const netName = () => NETWORKS[S.chainId]?.name || `chain ${S.chainId}`;

const STATUS_EN = {
  None: '-', Open: 'Registration open', Closed: 'Closed, waiting for seed block', Revealed: 'Seeded, waiting for result',
  Seeded: 'Seeded, waiting for result', Confirming: 'Result posted, confirming', Settled: 'Confirmed',
  Cancelled: 'Cancelled (refunded)', Swept: 'Closed out',
};
const statusLabel = (phase) => L(STATUS_EN[phase] || phase, STATUS_VI[phase] || phase);

/** "20:57 (in 34 min)" — when a posted result leaves the claim delay and rewards unlock. */
function claimOpensText(a) {
  const left = Math.max(0, a.claimableAt - nowChain());
  const at = new Date((Date.now() / 1000 + left) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const mins = Math.max(1, Math.ceil(left / 60));
  return L(`${at} (in ${mins} min)`, `${at} (còn ${mins} phút)`);
}

// Cache deterministic simulation standings keyed by chainId:arenaId:resultHash
const simCache = new Map();

// ------------------------------------------------------------------ messages
function say(text, kind = 'info') {
  const m = $('msg');
  if (!m) return;
  m.className = `msg show ${kind}`;
  m.innerHTML = text;
  if (kind === 'info') { clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('show'), 8000); }
}

async function tx(label, send) {
  try {
    say(`${label}: ${L('confirm in MetaMask…', 'chờ xác nhận trong MetaMask…')}`);
    const t = await send();
    say(`${label}: ${L('sent', 'đã gửi')} <span class="mono">${t.hash.slice(0, 12)}…</span>, ${L('waiting for a block…', 'chờ vào block…')}`);
    await t.wait();
    say(`${label}: ${L('success', 'thành công')} ✓`);
    await refresh();
    return true;
  } catch (e) {
    console.error(e);
    say(`${label}: ${errorText(e)}`, 'err');
    return false;
  }
}

// ------------------------------------------------------------------ module navigation (top nav)
function switchModule(modId) {
  if (!MODULES.includes(modId)) modId = 'battle-arena';
  if (modId !== 'match' && S.match !== null) { S.match = null; closeStage(); }   // leaving a match page
  S.activeModule = modId;
  document.querySelectorAll('#hubTopNavMenu .nav-link').forEach((link) => {
    link.classList.toggle('active', link.getAttribute('data-mod-jump') === modId);
  });
  document.querySelectorAll('.hub-module-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `mod-${modId}`);
  });
}

function initModuleNavigation() {
  document.querySelectorAll('[data-mod-jump]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const mod = link.getAttribute('data-mod-jump');
      if (mod) {
        e.preventDefault();
        history.pushState(null, '', `${location.pathname}#${mod}`);
        switchModule(mod);
        document.querySelector('.nav-menu')?.classList.remove('open');
      }
    });
  });
  const handleHash = () => {
    const h = location.hash.replace(/^#/, '');
    if (MODULES.includes(h)) switchModule(h);
  };
  window.addEventListener('hashchange', handleHash);
  handleHash();
}

// ------------------------------------------------------------------ wallet gate
const connected = () => Boolean(S.wallet);

function applyGate() {
  const on = connected();
  $('walletGate').style.display = on ? 'none' : '';
  $('hubContent').style.display = on ? '' : 'none';
  $('walletGateNoMM').style.display = hasWallet() ? 'none' : '';
  $('btnGateConnect').style.display = hasWallet() ? '' : 'none';
  if (!on) {
    // Nothing of the hub stays loaded without a wallet, the match viewer included.
    const iframe = $('spectatorIframe');
    if (iframe.getAttribute('src')) iframe.removeAttribute('src');
    $('noDeploy').style.display = 'none';
    $('btnQuickClaimBar').style.display = 'none';
    closeStage();
  }
}

// ------------------------------------------------------------------ embedded match viewer
// The viewer runs in Hub mode (viewer.html?hub=1): it plays in real time with every overlay on,
// shows no seed / match settings and cannot seek; the camera stays the viewer's choice, and
// ?me= highlights the viewer's own hamsters and offers "Follow yourself".
// Only the player's own matches are ever shown: no demo, no seed, no arbitrary arena.
function spectatorUrl() {
  const me = S.wallet && S.wallet.address ? `&me=${S.wallet.address}` : '';
  const live = S.spectator.live ? `&live=${S.spectator.live}` : '';
  return `viewer.html?arena=${S.spectator.arenaId}&chain=${S.chainId}&autostart=1&hub=1${live}${me}`;
}

/** Did the connected wallet play in this arena? */
function playedIn(arenaId) {
  const me = S.wallet && S.wallet.address && S.wallet.address.toLowerCase();
  return !!me && (S.arenaEntries[arenaId] || []).some((e) => e.player === me);
}

// The viewer card is hidden until the player picks one of their games: "Watch" on an arena
// card opens it right under that card, "Replay" in Match History opens it above the history
// table. Moving an iframe reloads it, so re-rendering the grid keeps the card where it is and
// puts the arena cards around it.
let stageHome = null;
function parkStage() {
  const stage = $('spectatorStageCard');
  if (!stageHome) return;
  stage.classList.remove('inline');
  if (stage.parentElement !== stageHome.parent) stageHome.parent.insertBefore(stage, stageHome.next);
}
function placeStageUnder(arenaId) {
  const stage = $('spectatorStageCard');
  const card = $('arenaGrid').querySelector(`.arena-card[data-arena-id="${arenaId}"]`);
  if (!card) { parkStage(); return; }
  stage.classList.add('inline');
  card.after(stage);
}

function loadSpectator() {
  if (!connected() || !S.spectator) return;
  $('spectatorStageCard').style.display = '';
  $('spectatorIframe').src = spectatorUrl();
  squeekAudio.setBgmSuppressed(true);
  renderSpectatorText();
}

/** Close the viewer: stop the match, hide the card, put it back where it lives. */
function closeStage() {
  const iframe = $('spectatorIframe');
  if (iframe.getAttribute('src')) iframe.removeAttribute('src');
  S.spectator = null;
  S.spectatorOpen = false;
  $('spectatorStageCard').style.display = 'none';
  squeekAudio.setBgmSuppressed(false);
  parkStage();
}

function renderSpectatorText() {
  const sp = S.spectator;
  const sub = $('spectatorSubtitle');
  if (sub) sub.innerHTML = sp
    ? L(`Your match <b>#${sp.arenaId}</b>, replayed from the data on ${netName()}. Your hamster is in <b style="color:#ff4d6a">red</b>.`,
        `Trận <b>#${sp.arenaId}</b> của bạn, tái tạo từ dữ liệu trên ${netName()}. Hamster của bạn có tên <b style="color:#ff4d6a">màu đỏ</b>.`)
    : '';
  const btnClose = $('btnToggleSpectator');
  if (btnClose) btnClose.textContent = L('✕ Close', '✕ Đóng');
}

function initSpectatorStage() {
  const stage = $('spectatorStageCard');
  stageHome = { parent: stage.parentElement, next: stage.nextElementSibling };
  stage.style.display = 'none';
  $('btnToggleSpectator').onclick = closeStage;
  renderSpectatorText();
}

/**
 * Replay one of the player's own matches. from 'arena': under that arena's card;
 * from 'history': above the Match History table. Matches the wallet did not play are refused.
 */
export function watchArenaInHub(arenaId) { return openMatch(arenaId); }

function watchArenaInHubOld(arenaId, from = 'arena') {
  if (!playedIn(arenaId)) { say(L('You can only replay matches you played.', 'Chỉ xem lại được trận bạn đã tham gia.'), 'err'); return; }
  S.spectator = { arenaId };
  S.spectatorOpen = true;
  $('spectatorIframeWrap').style.display = 'block';
  const stage = $('spectatorStageCard');
  if (from === 'history') {
    const table = $('matchHistoryBody').closest('table');
    const wrap = table.parentElement.classList.contains('play-section') ? table : table.parentElement;
    stage.classList.remove('inline');
    wrap.parentElement.insertBefore(stage, wrap);
  } else placeStageUnder(arenaId);
  loadSpectator();
  stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------------ wallet
/** Ask MetaMask to switch to Sepolia. True when the wallet is on Sepolia afterwards. */
async function ensureChain() {
  try {
    await switchChain(S.chainId);
    S.wallet = await connectWallet();
  } catch (e) { say(`${L('Could not switch network', 'Không chuyển được mạng')}: ${errorText(e)}`, 'err'); }
  renderAccount();
  return onSepolia();
}

/**
 * Before any transaction: make sure MetaMask is on Sepolia, switching it if needed, so a
 * click on Mint/Join/Claim on the wrong network asks to switch instead of doing nothing.
 */
async function readyToWrite() {
  if (!S.wallet) { await connect(); if (!S.wallet) return false; }
  if (!deploymentOf(S.chainId)) { say(L('The contracts are not live on Sepolia yet.', 'Contract chưa được triển khai trên Sepolia.'), 'err'); return false; }
  if (onSepolia()) return true;
  say(L('MetaMask is on another network — approve the switch to Sepolia in MetaMask…', 'MetaMask đang ở mạng khác — hãy chấp nhận chuyển sang Sepolia trong MetaMask…'));
  return ensureChain();
}

// "Disconnect" is remembered: the page then stops reconnecting by itself until Connect is pressed.
const WALLET_OFF = 'squeek_wallet_off';
const walletOff = () => { try { return localStorage.getItem(WALLET_OFF) === '1'; } catch { return false; } };

async function connect() {
  try {
    S.wallet = await connectWallet();
    try { localStorage.removeItem(WALLET_OFF); } catch { /* private mode */ }
    if (S.wallet.chainId !== S.chainId) await ensureChain();
    renderAccount();
    applyGate();
    await refresh();
  } catch (e) { say(errorText(e), 'err'); }
}

/** MetaMask account/network changed: follow it silently, lock the hub if access was revoked. */
async function followWallet() {
  S.wallet = walletOff() ? null : await tryReconnect();
  S.hamsters = []; S.token = null;
  renderAccount();
  applyGate();
  if (S.wallet) await refresh();
}

/**
 * Header: connected -> only the account pill "0xc785…1012 · Sepolia testnet" (click it for
 * Disconnect); not connected -> only "Connect MetaMask"; wrong network -> pill + "Switch".
 */
function renderAccount() {
  const w = S.wallet;
  $('netPill').textContent = netName();
  $('acctWrap').style.display = w ? '' : 'none';
  if (!w) {
    closeAcctMenu();
    renderNetWarn(true);
    $('btnConnect').style.display = '';
    $('btnConnect').textContent = L('🦊 Connect MetaMask', '🦊 Kết nối MetaMask');
    return;
  }
  const right = w.chainId === S.chainId;
  renderNetWarn(right);
  $('acct').textContent = `${shortAddr(w.address)} · ${right ? netName() : L(`wrong network (chain ${w.chainId})`, `sai mạng (chain ${w.chainId})`)}`;
  $('acct').className = `pill acct-pill ${right ? 'ok' : 'bad'}`;
  $('acct').title = L('Account', 'Tài khoản');
  $('acctFull').textContent = w.address;
  $('btnConnect').style.display = right ? 'none' : '';
  $('btnConnect').textContent = L('🦊 Switch to Sepolia', '🦊 Chuyển sang Sepolia');
}

function closeAcctMenu() {
  $('acctMenu').hidden = true;
  $('acct').setAttribute('aria-expanded', 'false');
}

async function disconnect() {
  closeAcctMenu();
  try { localStorage.setItem(WALLET_OFF, '1'); } catch { /* private mode */ }
  // MetaMask also forgets this site (where supported), so the next Connect asks again
  try { await window.ethereum?.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }); }
  catch { /* older wallets: the flag above is enough */ }
  S.wallet = null; S.hamsters = []; S.token = null;
  renderAccount();
  applyGate();
  say(L('Wallet disconnected.', 'Đã ngắt kết nối ví.'));
}

/** A clear banner (not just a pill) when MetaMask is connected to the wrong network. */
function renderNetWarn(right) {
  let el = $('netWarn');
  if (!el) {
    el = document.createElement('div');
    el.id = 'netWarn';
    el.className = 'play-no-deploy';
    $('noDeploy').after(el);
  }
  if (right || !S.wallet) { el.style.display = 'none'; return; }
  const other = { 1: 'Ethereum Mainnet', 31337: L('a local network', 'mạng local'), 1337: L('a local network', 'mạng local') }[S.wallet.chainId] || `chain ${S.wallet.chainId}`;
  el.style.display = 'flex';
  el.style.cssText += ';align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap';
  el.innerHTML = `<span>⚠️ ${L(`MetaMask is connected to <b>${other}</b>. Minting, joining and claiming happen on <b>Sepolia</b>.`,
    `MetaMask đang kết nối <b>${other}</b>. Mint, tham gia trận và nhận thưởng diễn ra trên <b>Sepolia</b>.`)}</span>
    <button class="btn btn-sm btn-primary" type="button" id="btnNetSwitch">🦊 ${L('Switch MetaMask to Sepolia', 'Chuyển MetaMask sang Sepolia')}</button>`;
  $('btnNetSwitch').onclick = async () => { if (await ensureChain()) { applyGate(); await refresh(); } };
}

const onSepolia = () => Boolean(S.wallet && S.wallet.chainId === S.chainId);
// Write buttons show whenever a wallet is connected; readyToWrite() switches network on click.
const canWrite = () => Boolean(S.wallet && deploymentOf(S.chainId));
const writer = () => contracts(S.chainId, S.wallet.signer);

// ------------------------------------------------------------------ reconcile a settled arena
async function loadAndVerifySettledArena(arenaId) {
  const d = await loadArena(S.chainId, arenaId);
  const a = d.arena;
  if (a.hasStats) {
    // contract 1.4: rank + kills are posted with the result and read back from that transaction —
    // on-chain data, never re-simulated nor guessed; Confirmed = settled, root-checked, delay over
    d.entries.forEach((e) => { e.isWinner = e.rank === 1; });
    d.strictlyConfirmed = Boolean(a.status === 'Settled' && a.confirmed === true);
    return d;
  }
  const cacheKey = `${S.chainId}:${arenaId}:${a.resultHash}`;
  let simInfo = simCache.get(cacheKey);

  if (!simInfo && a.confirmed) {
    try {
      const sim = await simulateLoaded(S.chainId, arenaId, d);
      // The deterministic simulation must match the on-chain resultHash AND points.
      const hashMatches = sim.resultHash.toLowerCase() === a.resultHash.toLowerCase();
      const pointsMatch = sim.points.length === d.entries.length
        && sim.points.every((p, idx) => Number(p) === Number(d.entries[idx].points));
      if (hashMatches && pointsMatch) {
        const byBot = {};
        sim.result.standings.forEach((st, rankZero) => {
          byBot[st.botId] = { rank: rankZero + 1, kills: Number(st.kills ?? 0), score: Number(st.score ?? 0) };
        });
        simInfo = { verifiedSim: true, byBot, winnerId: sim.result.winnerId };
        simCache.set(cacheKey, simInfo);
      }
    } catch (e) {
      console.warn(`Arena #${arenaId} simulation check warning:`, e);
    }
  }

  const sortedByPoints = [...d.entries].sort((x, y) => (y.points - x.points) || (x.index - y.index));
  const rankMap = new Map();
  sortedByPoints.forEach((e, idx) => rankMap.set(e.index, idx + 1));
  d.entries.forEach((e) => {
    const botStats = simInfo?.byBot?.[e.index];
    e.rank = botStats ? botStats.rank : rankMap.get(e.index) || 1;
    // exact kills when the re-simulation matched; otherwise a conservative lower bound
    e.kills = botStats ? botStats.kills : Math.max(0, Math.floor(e.points / 95));
    e.isWinner = e.rank === 1;
  });

  // Confirmed only when Settled on the contract and (if re-simulated) the result matches.
  d.strictlyConfirmed = Boolean(a.status === 'Settled' && a.confirmed === true && (!simInfo || simInfo.verifiedSim === true));
  return d;
}

// ------------------------------------------------------------------ arenas: details on demand, mine, pages
const PAGE = 30;
/** Entries (and, once settled, points / rank / kills from the result transaction) of one arena. */
async function loadDetail(c, a) {
  try {
    if (a.status === 'Settled') {
      const d = await loadAndVerifySettledArena(a.id);
      S.arenaDetails[a.id] = d;
      S.arenaEntries[a.id] = d.entries;
      a.confirmed = d.strictlyConfirmed;
      a.settledTxHash = d.arena.settledTxHash;
    } else {
      const raw = await c.arena.getEntries(a.id);
      const entries = normaliseEntries(raw[0], raw[1]);
      S.arenaEntries[a.id] = entries;
      S.arenaDetails[a.id] = { arena: a, entries, strictlyConfirmed: false };
      a.confirmed = false;
    }
  } catch (err) {
    console.warn(`Arena #${a.id} read warning:`, err);
    S.arenaEntries[a.id] = [];
    a.confirmed = false;
  }
}
/** Load arenas not in the detailed set yet (a page further down, a match page) and add them. */
let loadingDetails = null;
async function loadDetails(ids) {
  const c = contracts(S.chainId);
  const todo = ids.filter((id) => S.headers[id] && !S.arenas.some((a) => a.id === id));
  if (!c || !todo.length) return;
  const fresh = todo.map((id) => ({ ...S.headers[id] }));
  await Promise.all(fresh.map((a) => loadDetail(c, a)));
  S.arenas.push(...fresh.filter((a) => !S.arenas.some((x) => x.id === a.id)));
}

/** Arenas the wallet has entries in: Joined minus Left events (both indexed by player), scanned incrementally. */
async function myArenaIds(c) {
  const me = S.wallet && S.wallet.address;
  if (!me) return [];
  const head = S.clock.number;
  const key = `${c.dep.arena}:${me}`;
  if (!S.mineScan || S.mineScan.key !== key) S.mineScan = { key, to: Number(c.dep.fromBlock || 0) - 1, counts: new Map() };
  const scan = S.mineScan;
  try {
    for (let b = scan.to + 1; b <= head; b += 20000) {
      const to = Math.min(head, b + 19999);
      const [joined, left] = await Promise.all([
        c.arena.queryFilter(c.arena.filters.Joined(null, me), b, to), c.arena.queryFilter(c.arena.filters.Left(null, me), b, to)]);
      for (const e of joined) scan.counts.set(Number(e.args[0]), (scan.counts.get(Number(e.args[0])) || 0) + 1);
      for (const e of left) scan.counts.set(Number(e.args[0]), (scan.counts.get(Number(e.args[0])) || 0) - 1);
      scan.to = to;
    }
  } catch (err) { console.warn('my matches scan:', err); }
  return [...scan.counts].filter(([, k]) => k > 0).map(([id]) => id);
}

/** The arenas of a tab, sorted: Open soonest first, Finished latest first, the rest nearest to now first. */
function tabList(tab) {
  const H = S.headers || [], head = S.clock ? S.clock.number : 0, mine = new Set(S.mine || []);
  const dist = (a) => Math.abs(a.closeBlock - head);
  if (tab === 'upcoming') return H.filter((a) => a.phase === 'Open').sort((x, y) => x.closeBlock - y.closeBlock);
  if (tab === 'registered') return H.filter((a) => mine.has(a.id)).sort((x, y) => dist(x) - dist(y));
  if (tab === 'completed') return H.filter((a) => a.status === 'Settled' || a.status === 'Cancelled').sort((x, y) => y.closeBlock - x.closeBlock);
  return [...H].sort((x, y) => dist(x) - dist(y));
}
function pageIds() {
  const tab = S.activeTab || 'upcoming', p = S.page[tab] || 0;
  return tabList(tab).slice(p * PAGE, p * PAGE + PAGE).map((a) => a.id);
}

// ------------------------------------------------------------------ data refresh
let refreshing = null;
function refresh() {
  if (!connected()) return Promise.resolve();
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function doRefresh() {
  renderAccount();
  const c = contracts(S.chainId);
  if (!c) {
    S.arenas = []; S.hamsters = [];
    $('noDeploy').style.display = 'block';
    $('noDeploy').innerHTML = L(`The arena contracts are not live on <b>${netName()}</b> yet. Please check back soon.`,
                                `Hợp đồng đấu trường chưa được triển khai trên <b>${netName()}</b>. Vui lòng quay lại sau.`);
    $('btnMint').disabled = true;
    S.loaded = true;
    renderAll();
    return;
  }
  $('noDeploy').style.display = 'none';
  try {
    const p = readProvider(S.chainId);
    const [head, count, owner, operator, fee, mintPrice, bt] = await Promise.all([
      p.getBlock('latest'), c.arena.arenaCount(), c.arena.owner(), c.arena.operator(), c.arena.entryFee(), c.hamster.mintPrice(),
      blockTime(S.chainId)]);
    S.head = head;
    S.clock = { number: head.number, timestamp: head.timestamp, blockTime: bt };
    S.skew = Math.max(0, head.timestamp - Date.now() / 1000);
    S.owner = owner.toLowerCase(); S.operator = operator.toLowerCase();
    S.fee = fee; S.mintPrice = mintPrice;

    // newest first, at most 50
    const n = Number(count);
    S.arenaCount = n;
    // every arena's header, 100 per call (view calls, free): the tabs sort and page over these
    const hdr = [];
    for (let from = 0; from < n; from += 100) hdr.push(...(await c.arena.getArenas(from, 100)));
    S.headers = hdr.map((h, id) => ({ id, ...withClock(normaliseArena(h), S.clock) }));
    S.mine = await myArenaIds(c);
    // entries + points only where they are shown: the 30 nearest to now, my matches, the page on screen
    const near = [...S.headers].sort((x, y) => Math.abs(x.closeBlock - head.number) - Math.abs(y.closeBlock - head.number))
      .slice(0, 30).map((a) => a.id);
    const ids = [...new Set([...near, ...S.mine, ...pageIds(), ...(S.match !== null ? [S.match] : [])])].filter((id) => id < n);
    S.arenas = ids.map((id) => ({ ...S.headers[id] }));
    await Promise.all(S.arenas.map((a) => loadDetail(c, a)));

    $('btnMint').disabled = !canWrite();
    await loadMyHamsters(c);
    S.loaded = true;
    renderAll();
  } catch (e) {
    console.error(e);
    say(`${L(`Could not read ${netName()}`, `Không đọc được dữ liệu ${netName()}`)}: ${errorText(e)}`, 'err');
  }
}

async function loadArenaSummary(c, id) { return withClock(normaliseArena(await c.arena.getArena(id)), S.clock); }

async function loadMyHamsters(c) {
  if (!S.wallet || S.wallet.chainId !== S.chainId) { S.hamsters = []; return; }
  // contract 1.4: a hamster plays only while deposited in the arena contract — list both
  const own = await hamstersOf(S.chainId, S.wallet.address);
  const ids = [...own.deposited, ...own.wallet];
  const dnas = await Promise.all(ids.map((id) => c.hamster.dnaOf(id)));
  S.hamsters = ids.map((id, i) => {
    const t = traitsOf(dnas[i]);
    return { id, dna: t.dna, traits: t, name: dnaName(t.dna), appearance: appearanceOfTraits(t, Number(id)),
             deposited: i < own.deposited.length };
  });
  await assets.loadHamsterLayers(S.hamsters.map((h) => h.appearance));
  if (!S.hamsters.some((h) => h.id === S.token)) S.token = S.hamsters.length ? S.hamsters[0].id : null;
}

function renderAll() {
  if (!connected()) return;
  renderAccount();
  renderSpectatorText();
  renderMintInfo();
  renderArenas();
  renderHamsters();
  renderLeaderboard();
  renderMatchHistory();
  renderOnchainRecords();
  renderMatch();
}

function renderMintInfo() {
  if (!contracts(S.chainId)) { $('mintInfo').innerHTML = ''; return; }
  $('mintInfo').innerHTML = L(
    `Mint price: ${S.mintPrice > 0n ? fmtEth(S.mintPrice) + ' ETH' : '<b>free</b> (gas only)'} · Arena entry fee: <b>${fmtEth(S.fee)} ETH</b> (90% goes to the prize pool, shared by points). A hamster must be deposited in the arena contract to play — the first join does it for you.`,
    `Phí Mint: ${S.mintPrice > 0n ? fmtEth(S.mintPrice) + ' ETH' : '<b>Miễn phí</b> (chỉ tốn gas)'} · Phí tham gia Arena: <b>${fmtEth(S.fee)} ETH</b> (90% vào quỹ thưởng chia theo điểm). Hamster phải được ký gửi vào contract đấu trường để thi đấu — lần tham gia đầu tiên sẽ tự ký gửi.`);
}

// ------------------------------------------------------------------ arena categorisation
function categoriseArenas() {
  const me = S.wallet && S.wallet.address;
  const upcoming = [], registered = [], completed = [];
  for (const a of S.arenas) {
    const entries = S.arenaEntries[a.id] || [];
    const myEntries = me ? entries.filter((e) => e.player === me) : [];
    a._myEntries = myEntries;
    a._entries = entries;
    // "Registered" = every match of mine, finished ones included, so my games are easy to find
    if (myEntries.length > 0) registered.push(a);
    if (a.status === 'Settled' || a.status === 'Cancelled') completed.push(a);
    else if (a.phase === 'Open' || (a.status === 'Seeded' && myEntries.length === 0)) upcoming.push(a);
  }
  return { upcoming, registered, completed, all: S.arenas };
}

// ------------------------------------------------------------------ render: arenas (module 1)
const countdown = (t) => {
  const s = t - nowChain();
  if (s <= 0) return L('closed', 'đã đóng');
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

const statusClass = (st) => ({ Open: 'open', Closed: 'locked', Revealed: 'seeded', Seeded: 'seeded', Confirming: 'settled', Settled: 'settled', Cancelled: 'cancelled' }[st] || '');
const feeOf = (a) => a.fee ?? S.fee;

function renderArenaCard(a) {
  const myEntries = a._myEntries || [];
  const entries = a._entries || [];
  const open = a.phase === 'Open';
  const slotPct = a.maxEntrants > 0 ? Math.round((a.entrantCount / a.maxEntrants) * 100) : 0;
  const isFull = a.entrantCount >= a.maxEntrants;

  let html = `<div class="arena-card status-${statusClass(a.phase)}" data-arena-id="${a.id}">`;
  html += `<div class="arena-card-top">
    <span class="arena-card-id">Match #${a.id}<small>${PRESET_IDS[a.preset] || 'standard'}</small></span>
    <span class="arena-card-status status-pill-${statusClass(a.phase)}">${a.confirmed ? '✓ CONFIRMED' : statusLabel(a.phase)}</span>
  </div>`;

  html += `<div class="arena-card-info">
    <div class="arena-info-item">
      <span class="arena-info-label">${L('Fighters', 'Chiến binh')}</span>
      <span class="arena-info-value ${isFull ? 'highlight' : ''}">${a.entrantCount}/${a.maxEntrants}</span>
    </div>
    <div class="arena-info-item">
      <span class="arena-info-label">${open ? L('Time left', 'Còn lại') : L('Closes at', 'Đóng ở')}</span>
      <span class="arena-info-value">${open
        ? `<span class="arena-countdown ${nowChain() > a.closeTime - 120 ? 'urgent' : ''}" data-start="${a.closeTime}">${countdown(a.closeTime)}</span>`
        : `block ${a.closeBlock}`}</span>
    </div>
    <div class="arena-info-item">
      <span class="arena-info-label">${L('Prize pool', 'Quỹ thưởng')}</span>
      <span class="arena-info-value highlight">${fmtEth(a.pot)} ETH</span>
    </div>
  </div>`;

  html += `<div class="slot-bar"><div class="slot-bar-fill ${isFull ? 'full' : ''}" style="width:${slotPct}%"></div></div>`;

  for (const e of myEntries) {
    html += `<div class="arena-my-entry">
      <span class="my-badge">${L('Registered', 'Đã đăng ký')}</span>
      <span>#${e.tokenId} <b>${dnaName(e.dna)}</b></span>
      ${a.confirmed ? `<span style="margin-left:auto;color:var(--gold);font-weight:800;">#${e.rank}/${entries.length} · ${e.points} ${L('pts', 'điểm')}</span>` : ''}
    </div>`;
  }

  if (a.confirmed && entries.length > 0) {
    const winner = entries.find((e) => e.rank === 1) || [...entries].sort((x, y) => y.points - x.points)[0];
    const rw = rewardsOf(a, entries);
    html += `<div class="arena-result-strip">
      <span class="arena-result-chip winner">🏆 Winner: #${winner.tokenId} ${dnaName(winner.dna)}</span>
      <span class="arena-result-chip">${entries.length} hamsters</span>
      <span class="arena-result-chip">90% Pool: ${fmtEth(a.rewardPool)} ETH</span>
    </div>`;
    if (myEntries.length > 0) {
      const myReward = myEntries.reduce((sum, e) => sum + rw[e.index], 0n);
      const myBestRank = Math.min(...myEntries.map((e) => e.rank || 999));
      if (myReward > 0n) {
        html += `<div class="arena-my-entry" style="border-color:rgba(76,217,123,.35);background:rgba(76,217,123,.08);">
          <span class="my-badge" style="background:var(--green);color:#0a1f14;">${L('Rank', 'Hạng')} #${myBestRank}/${entries.length}</span>
          <span>${L('Reward', 'Thưởng')}: <b style="color:var(--gold);">${fmtEth(myReward)} ETH</b></span>
          ${myEntries.some((e) => !e.claimed)
            ? `<span style="color:var(--crimson);margin-left:auto;">${L('not claimed', 'chưa claim')}</span>`
            : `<span style="color:var(--green);margin-left:auto;">✓ ${L('claimed', 'đã claim')}</span>`}
        </div>`;
      }
    }
  }

  if (a.phase === 'Confirming' && a.claimableAt) {
    const rw = rewardsOf(a, entries);
    const mine = myEntries.reduce((sum, e) => sum + (rw[e.index] || 0n), 0n);
    html += `<div class="arena-my-entry" style="border-color:rgba(248,200,77,.35);background:rgba(248,200,77,.07);">
      <span>⏳ ${L('Result posted — rewards claimable from', 'Đã có kết quả — nhận thưởng từ')} <b>${claimOpensText(a)}</b>${mine > 0n ? ` · ${L('yours', 'của bạn')}: <b style="color:var(--gold)">${fmtEth(mine)} ETH</b>` : ''}</span>
    </div>`;
  }

  html += `<div class="arena-card-actions">`;
  // which of my hamsters can still enter this arena (one entry per hamster; several per wallet)
  const inArena = new Set(entries.map((e) => String(e.tokenId)));
  const candidates = S.hamsters.filter((h) => !inArena.has(String(h.id)))
    .sort((x, y) => Number(y.deposited) - Number(x.deposited));                 // deposited ones first
  let joinPanel = '';
  if (open && canWrite() && !isFull && candidates.length > 0) {
    if (S.joinOpen !== a.id) {
      html += `<button class="btn btn-sm btn-join" type="button" data-join-open="${a.id}">⚔️ ${L('Join', 'Tham gia')} · ${fmtEth(feeOf(a))} ETH</button>`;
    } else {
      // Join pressed: pick the hamster by its NFT picture (deposited ones first), then confirm
      const want = S.joinPick[a.id] || S.token;
      const sel = candidates.find((h) => h.id === want) || candidates[0];
      S.joinPick[a.id] = sel.id;
      joinPanel = `<div class="join-panel">
        <div class="join-panel-head">${L(`Pick the hamster that enters Match #${a.id}`, `Chọn hamster vào Match #${a.id}`)}</div>
        <div class="join-pick" data-join-pick="${a.id}">${candidates.map((h) =>
          `<button type="button" class="join-ham ${h.id === sel.id ? 'on' : ''}" data-join-ham="${a.id}:${h.id}" title="#${h.id} ${h.name}">
             <canvas width="128" height="128" data-join-sprite="${h.id}"></canvas>
             <span class="jh-id">#${h.id}</span>
             <span class="jh-st ${h.deposited ? 'dep' : ''}">${h.deposited ? L('deposited', 'đã ký gửi') : L('in wallet', 'ở ví')}</span>
           </button>`).join('')}</div>
        <div class="join-panel-actions">
          <button class="btn btn-sm btn-join" type="button" data-join="${a.id}">⚔️ ${sel.deposited ? L(`Join with #${sel.id}`, `Tham gia với #${sel.id}`) : L(`Deposit #${sel.id} + join`, `Ký gửi #${sel.id} + tham gia`)} · ${fmtEth(feeOf(a))} ETH</button>
          <button class="btn btn-sm btn-outline" type="button" data-join-close="${a.id}">${L('Cancel', 'Huỷ')}</button>
        </div>
      </div>`;
    }
  } else if (open && canWrite() && S.hamsters.length === 0) {
    html += `<button class="btn btn-sm btn-outline" data-go-mint="1">🐹 ${L('Mint a hamster to join', 'Mint Hamster để tham gia')}</button>`;
  } else if (open && isFull) {
    html += `<span class="badge badge-pink">${L('Full', 'Đã đủ chỗ')}</span>`;
  }

  html += `<button class="btn btn-sm btn-outline" type="button" data-share="${a.id}" title="${L('Copy an invite link to this match', 'Copy link mời vào trận này')}">🔗 ${L('Share', 'Chia sẻ')}</button>`;
  if ((a.status === 'Settled' || a.phase === 'Seeded' || a.phase === 'Revealed') && myEntries.length > 0) {
    html += `<button class="btn btn-sm btn-replay" type="button" data-watch-inline="${a.id}">▶ ${L('Watch', 'Xem trận')}</button>`;
  }

  if (a.confirmed && myEntries.length > 0 && canWrite()) {
    const unclaimed = myEntries.filter((e) => !e.claimed);
    if (unclaimed.length > 0) {
      const rw = rewardsOf(a, entries);
      const sum = unclaimed.reduce((s, e) => s + rw[e.index], 0n);
      html += `<button class="btn btn-sm btn-primary" data-claim="${a.id}">💰 Claim ${fmtEth(sum)} ETH</button>`;
    }
  }
  html += `</div>${joinPanel}</div>`;
  return html;
}

/** Deposit the hamster first when it is still in the wallet (contract 1.4), then join. */
async function joinArena(arenaId) {
  if (!(await readyToWrite())) return;
  const tok = S.joinPick[arenaId] || S.token || (S.hamsters.length > 0 ? S.hamsters[0].id : null);
  if (!tok) { say(L('Mint a hamster first.', 'Bạn cần mint hamster trước.'), 'err'); switchModule('my-hamsters'); return; }
  const a = S.arenas.find((x) => x.id === arenaId);
  const fee = a ? feeOf(a) : S.fee;
  const h = S.hamsters.find((x) => x.id === tok);
  if (h && !h.deposited) {
    try {
      say(L(`Depositing hamster #${tok}: confirm in MetaMask…`, `Ký gửi hamster #${tok}: xác nhận trong MetaMask…`));
      await depositHamsters(S.chainId, S.wallet.signer, [tok]);
      h.deposited = true;
    } catch (e) { say(errorText(e), 'err'); return; }
  }
  if (await tx(L('Join arena', 'Tham gia arena'), () => joinTx(writer().arena, arenaId, tok, fee))) {
    S.joinOpen = null;
    renderArenas(); renderMatch();
  }
}

function renderArenas() {
  if (S.roomHint) S.roomHint();
  categoriseArenas();                              // fills a._entries / a._myEntries on the detailed set
  const lists = { upcoming: tabList('upcoming'), registered: tabList('registered'), completed: tabList('completed'), all: tabList('all') };
  const full = lists[S.activeTab] || lists.all;
  const pages = Math.max(1, Math.ceil(full.length / PAGE));
  const pg = Math.min(S.page[S.activeTab] || 0, pages - 1);
  S.page[S.activeTab] = pg;
  const me = S.wallet && S.wallet.address;
  const list = full.slice(pg * PAGE, pg * PAGE + PAGE).map((h) => {
    const a = S.arenas.find((x) => x.id === h.id) || { ...h };
    a._entries = S.arenaEntries[a.id] || [];
    a._myEntries = me ? a._entries.filter((e) => e.player === me) : [];
    return a;
  });
  const missing = list.filter((a) => !S.arenaEntries[a.id]).map((a) => a.id);
  if (missing.length && S.loaded) loadDetails(missing).then(() => { renderArenas(); renderMatchHistory(); renderOnchainRecords(); });
  $('countUpcoming').textContent = lists.upcoming.length;
  $('countRegistered').textContent = lists.registered.length;
  $('countCompleted').textContent = lists.completed.length;
  $('countAll').textContent = lists.all.length;
  renderPager(pg, pages, full.length);
  $('arenaCountBadge').textContent = `${S.arenaCount ?? S.arenas.length} arenas`;

  if (!S.loaded) {
    parkStage();
    $('arenaGrid').innerHTML = `<div class="play-empty-state"><div class="play-empty-icon">🏟️</div><p>${L('Loading arenas…', 'Đang tải danh sách đấu trường…')}</p></div>`;
    return;
  }
  if (list.length === 0) {
    const msgs = {
      upcoming: L('No arena is open for registration right now.', 'Hiện chưa có Arena nào đang mở đăng ký.'),
      registered: L('You have not registered for any arena yet. Pick an open one!', 'Bạn chưa đăng ký Arena nào. Hãy chọn một Arena đang mở!'),
      completed: L('No finished matches on this network yet.', 'Chưa có trận đấu nào hoàn thành trên mạng này.'),
      all: L('No arenas on this network yet.', 'Chưa có Arena nào trên mạng này.'),
    };
    parkStage();
    $('arenaGrid').innerHTML = `<div class="play-empty-state"><div class="play-empty-icon">🏟️</div><p>${msgs[S.activeTab] || msgs.all}</p></div>`;
    return;
  }

  const grid = $('arenaGrid'), stage = $('spectatorStageCard');
  const tmp = document.createElement('div');
  tmp.innerHTML = list.map(renderArenaCard).join('');
  const cards = [...tmp.children];
  for (const el of [...grid.children]) if (el !== stage) el.remove();
  if (stage.parentElement === grid) {
    // keep the playing viewer in place (moving an iframe reloads it): cards up to the watched one before it
    const pos = S.spectator ? cards.findIndex((c) => Number(c.dataset.arenaId) === S.spectator.arenaId) : -1;
    if (pos < 0) { parkStage(); cards.forEach((c) => grid.appendChild(c)); }
    else cards.forEach((c, i) => (i <= pos ? grid.insertBefore(c, stage) : grid.appendChild(c)));
  } else cards.forEach((c) => grid.appendChild(c));
  wireCards($('arenaGrid'));
  if (S.pendingMatch !== null && S.loaded) { const id = S.pendingMatch; S.pendingMatch = null; openMatch(id, false); }
}

/** "‹ Prev  Page x / y (n matches)  Next ›" under the arena grid, 30 matches a page. */
function renderPager(pg, pages, total) {
  const el = $('arenaPager');
  if (!el) return;
  if (pages <= 1) { el.innerHTML = total ? `<span class="muted">${L(`${total} matches`, `${total} trận`)}</span>` : ''; return; }
  el.innerHTML = `<button class="btn btn-sm btn-outline" type="button" data-page="0" ${pg === 0 ? 'disabled' : ''}>«</button>
    <button class="btn btn-sm btn-outline" type="button" data-page="${pg - 1}" ${pg === 0 ? 'disabled' : ''}>‹ ${L('Prev', 'Trước')}</button>
    <span>${L('Page', 'Trang')} <b>${pg + 1}</b> / ${pages} <span class="muted">· ${L(`${total} matches`, `${total} trận`)}</span></span>
    <button class="btn btn-sm btn-outline" type="button" data-page="${pg + 1}" ${pg >= pages - 1 ? 'disabled' : ''}>${L('Next', 'Sau')} ›</button>
    <button class="btn btn-sm btn-outline" type="button" data-page="${pages - 1}" ${pg >= pages - 1 ? 'disabled' : ''}>»</button>`;
  for (const b of el.querySelectorAll('[data-page]')) b.onclick = () => {
    S.page[S.activeTab] = Number(b.dataset.page);
    renderArenas();
    $('arenaTabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

/** Buttons of an arena card (grid or match page); a click anywhere else on a card opens its page. */
function wireCards(root) {
  for (const btn of root.querySelectorAll('[data-join]')) btn.onclick = (e) => { e.stopPropagation(); joinArena(Number(btn.dataset.join)); };
  for (const btn of root.querySelectorAll('[data-join-open]')) btn.onclick = (e) => {
    e.stopPropagation();
    S.joinOpen = Number(btn.dataset.joinOpen);
    renderArenas(); renderMatch();
  };
  for (const btn of root.querySelectorAll('[data-join-close]')) btn.onclick = (e) => {
    e.stopPropagation();
    S.joinOpen = null;
    renderArenas(); renderMatch();
  };
  for (const b of root.querySelectorAll('[data-join-ham]')) b.onclick = (e) => {
    e.stopPropagation();
    const [aid, hid] = b.dataset.joinHam.split(':');
    S.joinPick[Number(aid)] = hid;                                           // survives the 15 s re-render
    renderArenas(); renderMatch();                                           // button label: Join / Deposit + join
  };
  for (const cv of root.querySelectorAll('canvas[data-join-sprite]')) {
    const h = S.hamsters.find((x) => x.id === cv.dataset.joinSprite);
    if (h) cv.getContext('2d').drawImage(assets.spriteFor(h.appearance, false, -1, false), 0, 0);
  }
  for (const b of root.querySelectorAll('[data-share]')) b.onclick = () => shareMatch(Number(b.dataset.share));
  for (const btn of root.querySelectorAll('[data-go-mint]')) btn.onclick = () => switchModule('my-hamsters');
  for (const btn of root.querySelectorAll('[data-watch-inline]')) {
    btn.onclick = (e) => { e.stopPropagation(); openMatch(Number(btn.dataset.watchInline)); };
  }
  for (const btn of root.querySelectorAll('[data-claim]')) {
    btn.onclick = async () => {
      const id = Number(btn.dataset.claim);
      if (!(await readyToWrite())) return;
      const d = S.arenaDetails[id] || await loadArena(S.chainId, id);
      const idx = d.entries.filter((e) => e.player === S.wallet.address && !e.claimed).map((e) => e.index);
      return tx(`Claim Arena #${id}`, () => writer().arena.claimMany(id, ...claimManyArgs(d, idx)));
    };
  }

  for (const card of root.querySelectorAll('.arena-card[data-arena-id]')) card.onclick = (e) => {
    if (e.target.closest('button, a, input, select, canvas, label') || root.id === 'matchCard') return;
    openMatch(Number(card.dataset.arenaId));
  };
}


// ------------------------------------------------------------------ render: My Hamsters (module 2)
function renderHamsters() {
  const el = $('myHamsters');
  if (!S.loaded) {
    el.innerHTML = `<div class="play-empty-state"><div class="play-empty-icon">🐹</div><p>${L('Loading your hamsters…', 'Đang tải hamster của bạn…')}</p></div>`;
    $('hamsterCountBadge').textContent = '…';
    return;
  }
  if (!S.hamsters.length) {
    el.innerHTML = `<div class="muted" style="grid-column:1/-1;padding:28px;text-align:center;">${L(
      `You do not own any Hamster NFT on ${netName()} yet. Press <b>🎲 Mint Hamster</b> to create your first fighter!`,
      `Bạn chưa sở hữu Hamster NFT nào trên ${netName()}. Bấm <b>🎲 Mint Hamster</b> để khởi tạo chiến binh đầu tiên!`)}</div>`;
    $('hamsterCountBadge').textContent = '0 hamsters';
    return;
  }

  $('hamsterCountBadge').textContent = `${S.hamsters.length} hamster${S.hamsters.length > 1 ? 's' : ''}`;
  el.innerHTML = S.hamsters.map((h) => renderNftCardHtml(h, { selectable: true, selected: S.token === h.id })).join('');
  for (const cv of el.querySelectorAll('canvas[data-sprite]')) {
    const h = S.hamsters.find((x) => x.id === cv.dataset.sprite);
    if (h) cv.getContext('2d').drawImage(assets.spriteFor(h.appearance, false, -1, false), 0, 0);
  }
  for (const card of el.querySelectorAll('.ham')) {
    card.onclick = () => {
      S.token = card.dataset.token;
      renderHamsters();
      renderArenas();
    };
    // contract 1.4: deposited = can enter matches (and cannot be transferred); withdraw cancels open entries
    const h = S.hamsters.find((x) => x.id === card.dataset.token);
    if (!h || !canWrite()) continue;
    card.insertAdjacentHTML('beforeend', `<label class="ham-pick"><input type="checkbox" data-pick="${h.id}" ${S.pick.has(h.id) ? 'checked' : ''}> ${L('Select', 'Chọn')}</label>`);
    card.insertAdjacentHTML('beforeend', h.deposited
      ? `<div class="ham-deposit on"><span>✅ ${L('Deposited — can enter matches', 'Đã ký gửi — vào trận được')}</span>
           <button class="btn btn-sm btn-outline" type="button" data-withdraw="${h.id}">📤 ${L('Withdraw', 'Rút về ví')}</button></div>`
      : `<div class="ham-deposit"><span>👛 ${L('In your wallet', 'Đang ở ví')}</span>
           <button class="btn btn-sm btn-cyan" type="button" data-deposit="${h.id}">📥 ${L('Deposit', 'Ký gửi')}</button></div>`);
  }
  for (const c of el.querySelectorAll('[data-pick]')) {
    c.onclick = (e) => e.stopPropagation();
    c.onchange = () => { if (c.checked) S.pick.add(c.dataset.pick); else S.pick.delete(c.dataset.pick); renderBulkBar(); };
  }
  renderBulkBar();
  for (const b of el.querySelectorAll('[data-deposit]')) b.onclick = async (e) => {
    e.stopPropagation();
    if (!(await readyToWrite())) return;
    const id = b.dataset.deposit;
    try {
      say(L(`Depositing hamster #${id}: confirm in MetaMask…`, `Ký gửi hamster #${id}: xác nhận trong MetaMask…`));
      await depositHamsters(S.chainId, S.wallet.signer, [id]);
      say(L(`Hamster #${id} deposited ✓`, `Đã ký gửi hamster #${id} ✓`), 'ok');
      await refresh();
    } catch (err) { say(errorText(err), 'err'); }
  };
  for (const b of el.querySelectorAll('[data-withdraw]')) b.onclick = async (e) => {
    e.stopPropagation();
    if (!(await readyToWrite())) return;
    const id = b.dataset.withdraw;
    if (!confirm(L(`Withdraw hamster #${id} to your wallet?\nIts entries in matches still OPEN for registration are cancelled and refunded; closed matches still count.`,
                   `Rút hamster #${id} về ví?\nCác trận CÒN MỞ ĐĂNG KÝ của hamster này bị huỷ và hoàn phí; trận đã khoá vẫn tính.`))) return;
    await tx(L(`Withdraw hamster #${id}`, `Rút hamster #${id}`), () => writer().arena.withdraw([id]));
  };
}

/**
 * Bulk bar above My Hamsters: deposit the ticked hamsters that are in the wallet (one transaction,
 * plus a one-time approval), or withdraw the ticked deposited ones (one transaction).
 */
function renderBulkBar() {
  let bar = $('hamBulk');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'hamBulk'; bar.className = 'ham-bulk';
    $('myHamsters').before(bar);
  }
  for (const id of [...S.pick]) if (!S.hamsters.some((h) => h.id === id)) S.pick.delete(id);   // sold / gone
  if (!canWrite() || !S.hamsters.length) { bar.innerHTML = ''; return; }
  const picked = S.hamsters.filter((h) => S.pick.has(h.id));
  const toDeposit = picked.filter((h) => !h.deposited), toWithdraw = picked.filter((h) => h.deposited);
  bar.innerHTML = `<span class="muted">${L(`${picked.length} selected`, `Đã chọn ${picked.length}`)}</span>
    <button class="btn btn-sm btn-outline" type="button" data-bulk="wallet">${L('Select all in wallet', 'Chọn tất cả ở ví')}</button>
    <button class="btn btn-sm btn-outline" type="button" data-bulk="deposited">${L('Select all deposited', 'Chọn tất cả đã ký gửi')}</button>
    <button class="btn btn-sm btn-outline" type="button" data-bulk="none">${L('Clear', 'Bỏ chọn')}</button>
    <button class="btn btn-sm btn-cyan" type="button" id="btnBulkDeposit" ${toDeposit.length ? '' : 'disabled'}>📥 ${L(`Deposit ${toDeposit.length} selected`, `Ký gửi ${toDeposit.length} con đã chọn`)}</button>
    <button class="btn btn-sm btn-outline" type="button" id="btnBulkWithdraw" ${toWithdraw.length ? '' : 'disabled'}>📤 ${L(`Withdraw ${toWithdraw.length} selected`, `Rút ${toWithdraw.length} con đã chọn`)}</button>`;
  for (const b of bar.querySelectorAll('[data-bulk]')) b.onclick = () => {
    const k = b.dataset.bulk;
    S.pick = new Set(k === 'none' ? [] : S.hamsters.filter((h) => (k === 'deposited') === !!h.deposited).map((h) => h.id));
    renderHamsters();
  };
  $('btnBulkDeposit').onclick = async () => {
    if (!(await readyToWrite())) return;
    const ids = toDeposit.map((h) => h.id);
    try {
      say(L(`Depositing ${ids.length} hamsters: confirm in MetaMask…`, `Ký gửi ${ids.length} hamster: xác nhận trong MetaMask…`));
      await depositHamsters(S.chainId, S.wallet.signer, ids);
      say(L(`${ids.length} hamsters deposited ✓`, `Đã ký gửi ${ids.length} hamster ✓`), 'ok');
      S.pick.clear();
      await refresh();
    } catch (err) { say(errorText(err), 'err'); }
  };
  $('btnBulkWithdraw').onclick = async () => {
    if (!(await readyToWrite())) return;
    const ids = toWithdraw.map((h) => h.id);
    if (!confirm(L(`Withdraw ${ids.length} hamsters to your wallet?\nTheir entries in matches still OPEN for registration are cancelled and refunded; closed matches still count.`,
                   `Rút ${ids.length} hamster về ví?\nCác trận CÒN MỞ ĐĂNG KÝ của chúng bị huỷ và hoàn phí; trận đã khoá vẫn tính.`))) return;
    if (await tx(L(`Withdraw ${ids.length} hamsters`, `Rút ${ids.length} hamster`), () => writer().arena.withdraw(ids))) S.pick.clear();
  };
}

// ------------------------------------------------------------------ render: Leaderboard (module 3)
function renderLeaderboard() {
  const body = $('leaderboardBody');
  const confirmedArenas = S.arenas.filter((a) => a.confirmed === true);
  const playerMap = new Map();
  let totalPointsAll = 0;
  let totalPoolAll = 0n;

  for (const a of confirmedArenas) {
    const entries = S.arenaEntries[a.id] || [];
    const rw = rewardsOf(a, entries);
    totalPoolAll += a.rewardPool || 0n;
    entries.forEach((e) => {
      const addr = e.player.toLowerCase();
      if (!playerMap.has(addr)) playerMap.set(addr, { wallet: addr, matches: new Set(), wins: 0, kills: 0, points: 0, rewardWei: 0n });
      const p = playerMap.get(addr);
      p.matches.add(a.id);
      if (e.rank === 1) p.wins += 1;
      p.kills += Number(e.kills || 0);
      p.points += Number(e.points || 0);
      p.rewardWei += rw[e.index] || 0n;
      totalPointsAll += Number(e.points || 0);
    });
  }

  const rankings = Array.from(playerMap.values()).sort((a, b) => (b.points - a.points) || (b.wins - a.wins) || (b.kills - a.kills));
  $('lbKpiMatches').textContent = String(confirmedArenas.length);
  $('lbKpiPlayers').textContent = String(rankings.length);
  $('lbKpiPoints').textContent = totalPointsAll.toLocaleString();
  $('lbKpiPool').textContent = `${fmtEth(totalPoolAll)} ETH`;
  $('leaderboardTotalBadge').textContent = L(`${rankings.length} players`, `${rankings.length} người chơi`);

  if (!rankings.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:28px;">${L(
      'No match has reached <b>Confirmed</b> on this network yet.', 'Chưa có trận đấu nào đạt trạng thái <b>Confirmed</b> trên mạng này.')}</td></tr>`;
    return;
  }

  const me = S.wallet?.address?.toLowerCase();
  body.innerHTML = rankings.map((r, idx) => {
    const rankNum = idx + 1;
    const medal = rankNum === 1 ? '🥇 #1' : rankNum === 2 ? '🥈 #2' : rankNum === 3 ? '🥉 #3' : `#${rankNum}`;
    const isMe = me && r.wallet === me;
    return `<tr class="${isMe ? 'me-row' : ''}">
      <td><b style="color:${rankNum <= 3 ? 'var(--gold)' : 'var(--text)'}">${medal}</b></td>
      <td class="mono">${shortAddr(r.wallet)} ${isMe ? `<span class="badge badge-gold">${L('YOU', 'BẠN')}</span>` : ''}</td>
      <td>${r.matches.size}</td>
      <td><b style="color:var(--gold)">${r.wins}</b></td>
      <td class="mono">${r.kills}</td>
      <td class="mono"><b style="color:var(--neon-cyan)">${r.points.toLocaleString()}</b></td>
      <td class="mono" style="color:var(--green);font-weight:700;">${fmtEth(r.rewardWei)} ETH</td>
    </tr>`;
  }).join('');
}

// ------------------------------------------------------------------ render: Match History (module 4)
function renderMatchHistory() {
  const body = $('matchHistoryBody');
  const me = S.wallet?.address?.toLowerCase();
  const confirmedArenas = S.arenas.filter((a) => a.confirmed === true);

  const allRows = [];
  for (const a of confirmedArenas) {
    const entries = S.arenaEntries[a.id] || [];
    const rw = rewardsOf(a, entries);
    for (const e of entries) {
      allRows.push({
        arenaId: a.id, totalEntrants: entries.length, tokenId: e.tokenId, name: dnaName(e.dna),
        wallet: e.player.toLowerCase(), isWin: e.rank === 1, rank: e.rank || 1, kills: e.kills ?? 0,
        points: e.points ?? 0, reward: rw[e.index] || 0n, entryIndex: e.index,
      });
    }
  }

  // only the connected wallet's own games: that is all a player can replay
  const rows = me ? allRows.filter((r) => r.wallet === me) : [];
  $('historyFilterBadge').textContent = me ? L(`Your wallet (${shortAddr(me)})`, `Ví của bạn (${shortAddr(me)})`) : '';

  const wins = rows.filter((r) => r.isWin).length;
  $('mhTotalEntries').textContent = String(rows.length);
  $('mhWinLoss').textContent = `${wins}W - ${rows.length - wins}L`;
  $('mhWinRate').textContent = `${rows.length > 0 ? Math.round((wins / rows.length) * 100) : 0}%`;
  $('mhTotalKills').textContent = String(rows.reduce((s, r) => s + Number(r.kills || 0), 0));

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:28px;">${L(
      'You have no confirmed matches yet. Your games appear here once their result is confirmed on-chain.', 'Bạn chưa có trận nào đã xác nhận. Trận của bạn sẽ hiện ở đây khi kết quả được xác nhận on-chain.')}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r) => {
    const isMe = me && r.wallet === me;
    return `<tr class="${isMe ? 'me-row' : ''}">
      <td class="mono"><b>#${r.arenaId}</b></td>
      <td>#${r.tokenId} <b>${r.name}</b></td>
      <td class="mono">${shortAddr(r.wallet)}</td>
      <td><span class="res-badge ${r.isWin ? 'res-win' : 'res-loss'}">${r.isWin ? 'WIN' : 'LOSS'}</span></td>
      <td class="mono"><b>#${r.rank}/${r.totalEntrants}</b></td>
      <td class="mono">${r.kills}</td>
      <td class="mono" style="color:var(--neon-cyan)"><b>${r.points}</b></td>
      <td class="mono" style="color:var(--gold)">${fmtEth(r.reward)} ETH</td>
      <td><button class="btn btn-sm btn-outline" type="button" data-mh-watch="${r.arenaId}" data-mh-follow="${r.entryIndex}">▶ Replay</button></td>
    </tr>`;
  }).join('');
  for (const btn of body.querySelectorAll('[data-mh-watch]')) {
    btn.onclick = () => watchArenaInHub(Number(btn.dataset.mhWatch), 'history');
  }
}

// ------------------------------------------------------------------ render: On-chain Records & Claim All (module 5)
function renderOnchainRecords() {
  const body = $('onchainRecordsBody');
  const btnClaimAll = $('btnClaimAllRewards');
  const btnQuickBar = $('btnQuickClaimBar');
  const hintEl = $('claimAllHint');
  const onlyMine = $('chkOnlyMyRecords')?.checked;
  const me = S.wallet?.address?.toLowerCase();
  const net = NETWORKS[S.chainId] || {};

  // Everything this wallet can still claim: rewards of confirmed arenas, refunds of cancelled ones.
  const claimable = [];
  let totalWei = 0n;
  if (me && canWrite()) {
    for (const a of S.arenas) {
      const entries = S.arenaEntries[a.id] || [];
      if (a.confirmed && a.status === 'Settled') {
        const rw = rewardsOf(a, entries);
        const mine = entries.filter((e) => e.player === me && !e.claimed && rw[e.index] > 0n);
        if (mine.length) {
          const sum = mine.reduce((s, e) => s + rw[e.index], 0n);
          totalWei += sum;
          claimable.push({ arenaId: a.id, indexes: mine.map((e) => e.index), amount: sum });
        }
      } else if (a.status === 'Cancelled' || (a.status === 'Open' && a.phase !== 'Open' && a.entrantCount < 2)) {
        // cancelled, or a room that started with a single player: the fee comes back in full
        // (for the lone player the claim itself cancels the room — nobody needs to act first)
        const mine = entries.filter((e) => e.player === me && !e.claimed);
        if (mine.length) {
          const sum = feeOf(a) * BigInt(mine.length);
          totalWei += sum;
          claimable.push({ arenaId: a.id, indexes: mine.map((e) => e.index), amount: sum });
        }
      }
    }
  }

  if (!canWrite()) {
    btnClaimAll.disabled = true;
    btnClaimAll.textContent = L('💰 Claim All Rewards', '💰 Nhận Toàn Bộ Thưởng');
    hintEl.textContent = L('The contracts are not live on Sepolia yet.', 'Contract chưa được triển khai trên Sepolia.');
    btnQuickBar.style.display = 'none';
  } else if (!claimable.length) {
    btnClaimAll.disabled = true;
    btnClaimAll.textContent = L('💰 Claim All Rewards (0 ETH available)', '💰 Nhận Toàn Bộ Thưởng (0 ETH khả dụng)');
    // Rewards of results still inside the claim delay: say when they unlock instead of "nothing".
    const pending = me ? S.arenas.filter((a) => a.phase === 'Confirming').map((a) => {
      const entries = S.arenaEntries[a.id] || [];
      const rw = rewardsOf(a, entries);
      return { a, sum: entries.filter((e) => e.player === me && !e.claimed).reduce((t, e) => t + (rw[e.index] || 0n), 0n) };
    }).filter((x) => x.sum > 0n).sort((x, y) => x.a.claimableAt - y.a.claimableAt) : [];
    hintEl.textContent = pending.length
      ? L(`${fmtEth(pending.reduce((t, x) => t + x.sum, 0n))} ETH is waiting for the claim delay — claimable from ${claimOpensText(pending[0].a)}.`,
          `${fmtEth(pending.reduce((t, x) => t + x.sum, 0n))} ETH đang chờ hết thời gian xác nhận — nhận được từ ${claimOpensText(pending[0].a)}.`)
      : L('Nothing to claim right now: all your rewards are claimed, or no new match has finished.', 'Hiện chưa có gì để nhận: thưởng đã nhận hết hoặc chưa có trận mới kết thúc.');
    btnQuickBar.style.display = 'none';
  } else {
    btnClaimAll.disabled = false;
    btnClaimAll.textContent = L(`💰 Claim All Rewards (${fmtEth(totalWei)} ETH from ${claimable.length} matches)`,
                                `💰 Nhận Toàn Bộ Thưởng (${fmtEth(totalWei)} ETH từ ${claimable.length} trận)`);
    hintEl.textContent = L(`Ready to claim from ${claimable.length} confirmed matches!`, `Sẵn sàng nhận thưởng từ ${claimable.length} trận đã Confirmed!`);
    btnQuickBar.style.display = 'inline-flex';
    btnQuickBar.textContent = `💰 ${fmtEth(totalWei)} ETH`;           // short: the nav is one row
    btnQuickBar.title = L(`Claim ${fmtEth(totalWei)} ETH now`, `Nhận ngay ${fmtEth(totalWei)} ETH`);
    btnQuickBar.onclick = () => { switchModule('onchain-records'); claimAllRewards(claimable); };
    btnClaimAll.onclick = () => claimAllRewards(claimable);
  }

  // "Confirmed" ONLY when Settled on the contract and the re-simulated result matches.
  const rows = [];
  for (const a of S.arenas) {
    const entries = S.arenaEntries[a.id] || [];
    const isConfirmed = Boolean(a.status === 'Settled' && a.confirmed === true);
    for (const e of entries) {
      if (onlyMine && me && e.player !== me) continue;
      rows.push({
        matchId: a.id, wallet: e.player, isConfirmed, phase: a.phase,
        result: isConfirmed ? (e.rank === 1 ? 'WIN' : 'LOSS') : '—',
        rank: isConfirmed ? `#${e.rank}/${entries.length}` : `—/${entries.length}`,
        kills: isConfirmed ? String(e.kills ?? 0) : '—',
        txHash: isConfirmed ? a.settledTxHash : null,
      });
    }
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted" style="text-align:center;padding:28px;">${onlyMine
      ? L('No on-chain records for your wallet yet.', 'Chưa có bản ghi on-chain nào cho ví của bạn.')
      : L('No on-chain records yet.', 'Chưa có bản ghi on-chain nào.')}</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((r) => {
    const isMe = me && r.wallet === me;
    const shortTx = r.txHash ? `${r.txHash.slice(0, 6)}...${r.txHash.slice(-4)}` : '—';
    const txCell = r.txHash
      ? (net.explorer
          ? `<a href="${net.explorer}/tx/${r.txHash}" target="_blank" rel="noopener" class="mono">${shortTx} ↗</a>`
          : `<span class="mono" title="${r.txHash}">${shortTx}</span>`)
      : `<span class="muted">${L('Awaiting result', 'Chờ kết quả')}</span>`;
    const resultCell = r.isConfirmed
      ? `<span class="res-badge ${r.result === 'WIN' ? 'res-win' : 'res-loss'}">${r.result}</span>`
      : `<span class="muted">—</span>`;
    const statusCell = r.isConfirmed
      ? `<span class="status-confirmed-badge">✓ Confirmed</span>`
      : `<span class="status-pending-badge">⏳ ${statusLabel(r.phase)}</span>`;
    return `<tr class="${isMe ? 'me-row' : ''}">
      <td class="mono"><b>#${r.matchId}</b></td>
      <td class="mono" title="${r.wallet}">${shortAddr(r.wallet)} ${isMe ? `<span class="badge badge-gold">${L('YOU', 'BẠN')}</span>` : ''}</td>
      <td>${resultCell}</td>
      <td class="mono"><b>${r.rank}</b></td>
      <td class="mono">${r.kills}</td>
      <td>${txCell}</td>
      <td>${statusCell}</td>
    </tr>`;
  }).join('');
}

/** Every reward and refund owed, across all matches, in ONE transaction (claimAcross). */
async function claimAllRewards(claimable) {
  if (!claimable.length || !(await readyToWrite())) return;
  const items = [];
  for (const item of claimable) {
    const d = S.arenaDetails[item.arenaId] && S.arenaDetails[item.arenaId].entries
      ? { ...S.arenaDetails[item.arenaId], arenaId: item.arenaId } : await loadArena(S.chainId, item.arenaId);
    items.push({ d: { ...d, arenaId: item.arenaId }, indexes: item.indexes });
  }
  await tx(`${L('Claim all rewards', 'Nhận toàn bộ thưởng')} (${claimable.length} ${L('matches, 1 transaction', 'trận, 1 giao dịch')})`,
    () => writer().arena.claimAcross(...claimAcrossArgs(items)));
}

// ------------------------------------------------------------------ share a match / open one by id
const matchLink = (id) => `${location.origin}${location.pathname.replace(/play(\.html)?$/, 'play')}?match=${id}`;
async function shareMatch(id) {
  const url = matchLink(id);
  try { await navigator.clipboard.writeText(url); say(L(`Invite link to Match #${id} copied: ${url}`, `Đã copy link mời vào Match #${id}: ${url}`), 'ok'); }
  catch { prompt(L('Copy this invite link:', 'Copy link mời này:'), url); }
}

function initMatchLinks() {
  const q = new URLSearchParams(location.search);
  const m = q.get('match') ?? (location.hash.match(/^#match-(\d+)$/) || [])[1];
  if (m !== undefined && m !== null && /^\d+$/.test(m)) {
    S.pendingMatch = Number(m);
    const t = $('walletGateText');
    if (t) t.insertAdjacentHTML('afterbegin', `<b class="invite">${L(`You are invited to Match #${m}.`, `Bạn được mời vào Match #${m}.`)}</b> `);
  }
  const go = () => {
    const v = String($('matchIdInput').value || '').replace(/[^0-9]/g, '');
    if (!v) return;
    openMatch(Number(v));
  };
  $('btnOpenMatch').onclick = go;
  $('matchIdInput').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

// ------------------------------------------------------------------ the match page (/play?match=<id>)
const MAX_MATCH_S = 240;        // the simulator's hard limit: any match is over this long after it starts

/** Open a match's own page; `push` adds a browser history entry (Back returns to the list). */
function openMatch(id, push = true) {
  if (push && S.match !== id) history.pushState({ match: id }, '', `${location.pathname}?match=${id}`);
  if (S.match !== id) closeStage();
  S.match = id;
  switchModule('match');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderMatch();
}

/** Unix time the match starts playing: the block whose hash is its seed (it exists from then on). */
async function liveStartOf(a) {
  const key = `${a.id}:${a.seedBlock}`;
  if (S.liveStart[key]) return S.liveStart[key];
  const b = await readProvider(S.chainId).getBlock(a.seedBlock).catch(() => null);
  if (!b) return null;
  S.liveStart[key] = b.timestamp;
  return b.timestamp;
}

/** Put the viewer on the match page, playing live (from `live`, a unix time) or as a replay from the start. */
function showStage(id, live) {
  const sp = S.spectator;
  if (sp && sp.arenaId === id && (sp.live || null) === (live || null)) return;     // already playing that
  const stage = $('spectatorStageCard');
  if (stage.parentElement !== $('matchStageSlot')) { stage.classList.remove('inline'); $('matchStageSlot').appendChild(stage); }
  S.spectator = { arenaId: id, live: live || null };
  S.spectatorOpen = true;
  $('spectatorIframeWrap').style.display = 'block';
  loadSpectator();
}

let matchPoll = 0;
async function renderMatch() {
  const id = S.match;
  if (id === null || S.activeModule !== 'match') return;
  $('matchTitle').textContent = `Match #${id}`;
  const a = S.arenas.find((x) => x.id === id);
  if (!a && S.headers[id]) {                          // a match outside the loaded set: fetch it, then draw
    $('matchInfo').innerHTML = `<p class="muted">${L('Loading…', 'Đang tải…')}</p>`;
    loadDetails([id]).then(() => { if (S.match === id) renderMatch(); });
    return;
  }
  if (!a) {
    $('matchInfo').innerHTML = S.loaded ? `<p class="muted">${L(`Match #${id} does not exist on this network.`, `Không có Match #${id} trên mạng này.`)}</p>`
      : `<p class="muted">${L('Loading…', 'Đang tải…')}</p>`;
    $('matchCard').innerHTML = ''; $('matchNote').innerHTML = '';
    return;
  }
  const entries = S.arenaEntries[id] || [];
  const me = S.wallet && S.wallet.address;
  const mine = entries.filter((e) => e.player === me);
  // start = when entries close; for a past match closeTime is clamped to "now", so count back in blocks
  const startTs = S.clock ? S.clock.timestamp + (a.closeBlock - S.clock.number) * S.clock.blockTime : a.closeTime;
  const startStr = new Date(startTs * 1000).toLocaleString(L('en-GB', 'vi-VN'), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  $('matchStatus').textContent = a.confirmed ? '✓ CONFIRMED' : statusLabel(a.phase);
  $('matchStatus').className = `arena-card-status status-pill-${statusClass(a.phase)}`;
  $('matchInfo').innerHTML = `<dl class="match-kv">
    <dt>${L('Starts', 'Bắt đầu')}</dt><dd>${startStr}${a.phase === 'Open' ? ` · <b data-start="${a.closeTime}">${countdown(a.closeTime)}</b>` : ''}</dd>
    <dt>${L('Mode', 'Chế độ')}</dt><dd>${PRESET_IDS[a.preset] || 'standard'}</dd>
    <dt>${L('Hamsters', 'Hamster')}</dt><dd>${a.entrantCount} / ${a.maxEntrants}</dd>
    <dt>${L('Entry fee', 'Phí vào trận')}</dt><dd>${fmtEth(feeOf(a))} ETH</dd>
    <dt>${L('Prize pool', 'Quỹ thưởng')}</dt><dd>${fmtEth(a.status === 'Settled' ? a.rewardPool : (a.pot * BigInt(a.rewardBps || 9000)) / 10000n)} ETH</dd>
    <dt>${L('Your hamsters', 'Hamster của bạn')}</dt><dd>${mine.length ? mine.map((e) => '#' + e.tokenId).join(', ') : '—'}</dd>
  </dl>`;
  $('matchCard').innerHTML = renderArenaCard(a);
  wireCards($('matchCard'));

  // the viewer: live from the start time, a replay once the match is over (own matches only)
  const stageOff = () => { if (S.spectator && S.spectator.arenaId === id) closeStage(); };
  let note = '';
  clearTimeout(matchPoll);
  if (a.status === 'Cancelled') {
    stageOff();
    note = L('This match was cancelled (fewer than 2 hamsters) — every entry gets its fee back.', 'Trận đã huỷ (dưới 2 hamster) — mọi lượt tham gia được hoàn phí.');
  } else if (a.phase === 'Open') {
    stageOff();
    note = L(`The match starts at <b>${startStr}</b>. ${mine.length ? 'It will play here live, right on time.' : 'Join with a hamster to watch it live here.'}`,
             `Trận bắt đầu lúc <b>${startStr}</b>. ${mine.length ? 'Tới giờ trận sẽ phát trực tiếp ngay tại đây.' : 'Cho hamster tham gia để xem trực tiếp tại đây.'}`);
    if (a.closeTime - nowChain() < 90) matchPoll = setTimeout(refresh, 5000);
  } else if (a.phase === 'Closed') {
    stageOff();
    note = L('Entries are closed — the match starts in a few seconds…', 'Đã đóng đăng ký — trận bắt đầu sau vài giây…');
    matchPoll = setTimeout(refresh, 5000);
  } else if (!mine.length) {
    stageOff();
    note = L('Only players with a hamster in this match can watch it.', 'Chỉ người có hamster trong trận mới xem được trận này.');
  } else {
    const t0 = await liveStartOf(a);
    if (S.match !== id) return;
    if (t0 === null) { matchPoll = setTimeout(refresh, 5000); note = L('Starting…', 'Đang bắt đầu…'); }
    else if (Date.now() / 1000 < t0 + MAX_MATCH_S) {
      showStage(id, t0);
      note = `<span class="live-dot">●</span> ${L('LIVE — the match is playing now, in real time.', 'TRỰC TIẾP — trận đang diễn ra theo thời gian thực.')}`;
    } else {
      note = L('This match is over.', 'Trận đã kết thúc.') + ` <button class="btn btn-sm btn-primary" type="button" id="btnMatchReplay">▶ Replay</button>`;
      if (S.spectator && S.spectator.arenaId === id && S.spectator.live) closeStage();   // a live view that ran out
    }
  }
  $('matchNote').innerHTML = note;
  if ($('btnMatchReplay')) $('btnMatchReplay').onclick = () => showStage(id, null);
}

function initMatchPage() {
  $('btnMatchBack').onclick = () => { history.pushState(null, '', `${location.pathname}#battle-arena`); switchModule('battle-arena'); };
  $('btnMatchShare').onclick = () => { if (S.match !== null) shareMatch(S.match); };
  window.addEventListener('popstate', () => {
    const m = new URLSearchParams(location.search).get('match');
    if (m && /^\d+$/.test(m)) openMatch(Number(m), false);
    else switchModule(MODULES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'battle-arena');
  });
}

// ------------------------------------------------------------------ create a room (any player)
const ROOM_MAX = 100, ROOM_MIN_LEAD_S = 120, ROOM_MAX_DAYS = 7;
const toLocalInput = (ms) => { const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
function initRoomForm() {
  const start = $('roomStart');
  start.value = toLocalInput(Date.now() + 30 * 60000);
  start.min = toLocalInput(Date.now() + ROOM_MIN_LEAD_S * 1000);
  start.max = toLocalInput(Date.now() + ROOM_MAX_DAYS * 86400000);
  const hint = () => {
    const secs = Math.round((new Date(start.value).getTime() - Date.now()) / 1000);
    $('roomHint').textContent = !Number.isFinite(secs) ? ''
      : L(`Entries close and the match starts in ~${Math.max(0, Math.round(secs / 60))} min (at a block, ~${S.clock ? S.clock.blockTime : 12} s each). Fee ${fmtEth(S.fee)} ETH per hamster.`,
          `Đóng đăng ký và bắt đầu trận sau ~${Math.max(0, Math.round(secs / 60))} phút (tính theo block, ~${S.clock ? S.clock.blockTime : 12} giây/block). Phí ${fmtEth(S.fee)} ETH mỗi hamster.`);
  };
  start.oninput = hint;
  S.roomHint = hint;                      // re-run once the fee and block time are read from the chain
  hint();
  $('btnCreateRoom').onclick = async () => {
    if (!(await readyToWrite())) return;
    const secs = Math.round((new Date(start.value).getTime() - Date.now()) / 1000);
    const max = Number($('roomMax').value);
    if (!(secs >= ROOM_MIN_LEAD_S)) return say(L('Pick a start at least 2 minutes from now.', 'Chọn giờ bắt đầu cách hiện tại ít nhất 2 phút.'), 'err');
    if (secs > ROOM_MAX_DAYS * 86400) return say(L('A room can start at most 7 days ahead.', 'Phòng chỉ được hẹn tối đa 7 ngày tới.'), 'err');
    if (!(max >= 2 && max <= ROOM_MAX)) return say(L('2 to 100 hamsters per room.', 'Mỗi phòng từ 2 tới 100 hamster.'), 'err');
    const bt = S.clock ? S.clock.blockTime : await blockTime(S.chainId);
    const head = await readProvider(S.chainId).getBlockNumber();
    const startBlock = head + Math.max(6, Math.round(secs / bt));
    const ok = await tx(L('Create room', 'Tạo phòng'), () => writer().arena.createRoom(startBlock, max, Number($('roomPreset').value)));
    if (ok) { S.activeTab = 'upcoming'; renderArenas(); }
  };
}

// ------------------------------------------------------------------ tabs
function initTabs() {
  for (const btn of $('arenaTabs').querySelectorAll('.play-tab')) {
    btn.onclick = () => {
      S.activeTab = btn.dataset.tab;
      S.page[S.activeTab] = 0;
      for (const b of $('arenaTabs').querySelectorAll('.play-tab')) b.classList.toggle('on', b === btn);
      renderArenas();
    };
  }
  $('chkOnlyMyRecords').onchange = renderOnchainRecords;
}

// ------------------------------------------------------------------ boot
$('btnConnect').onclick = connect;
$('btnGateConnect').onclick = connect;
$('acct').onclick = (e) => {
  e.stopPropagation();
  const m = $('acctMenu');
  m.hidden = !m.hidden;
  $('acct').setAttribute('aria-expanded', String(!m.hidden));
};
$('btnDisconnect').onclick = disconnect;
document.addEventListener('click', (e) => { if (!$('acctWrap').contains(e.target)) closeAcctMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAcctMenu(); });
$('btnMint').onclick = async () => {
  const q = Number($('mintQty').value);
  if (!(await readyToWrite())) return;
  await tx(`Mint ${q} hamster`, () => writer().hamster.mint(q, { value: S.mintPrice * BigInt(q) }));
};

if (hasWallet()) {
  window.ethereum.on?.('accountsChanged', followWallet);
  window.ethereum.on?.('chainChanged', followWallet);
}

setInterval(() => {
  for (const el of document.querySelectorAll('[data-start]')) {
    if (el.textContent) el.textContent = countdown(Number(el.dataset.start));
  }
}, 1000);

setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);

window.addEventListener('squeek:lang', (e) => {
  renderAccount(); renderSpectatorText(); renderAll();
  // The embedded viewer is same-origin: switch its language too (its static text is CSS-paired).
  try { const doc = $('spectatorIframe').contentDocument; if (doc) doc.documentElement.lang = e.detail; } catch { /* not loaded */ }
});

initModuleNavigation();
initSpectatorStage();
initTabs();
initRoomForm();
initMatchLinks();
initMatchPage();
squeekAudio.bindButton($('btnAudioToggle'));
squeekAudio.startBgm('hub');
renderAccount();
applyGate();
// Wait for server-published addresses (deployments.json) before the first read.
chainReady.then(() => (walletOff() ? null : tryReconnect())).then(async (w) => {
  if (w) { S.wallet = w; renderAccount(); applyGate(); renderAll(); await refresh(); }
});

window.squeekPlay = { S, refresh, connect, disconnect, switchModule, watchArenaInHub };
