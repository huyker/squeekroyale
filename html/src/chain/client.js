// Browser chain client: networks, MetaMask connection, contract handles, arena reads.
// Reads go through a public JSON-RPC (no wallet needed to watch a match); writes go
// through MetaMask (window.ethereum). Uses the vendored ethers v6 ESM bundle.
import { ethers } from '../vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from './abi.js';
import { DEPLOYMENTS } from './deployments.js';
import { manifestInputFromArena, phaseOf } from './arena-manifest.js';
import { readArena, blockTimeOf } from './arena-read.js';
import { claimArgs } from './proofs.js';

export { ethers };

/** Is this page being served from a developer's own machine? */
export function isLocalPage() {
  if (typeof location === 'undefined') return true;                          // Node
  const h = location.hostname;
  return !h || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

const SEPOLIA = { key: 'sepolia', name: 'Sepolia testnet', rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
                  explorer: 'https://eth-sepolia.blockscout.com', symbol: 'SepoliaETH' };
const HARDHAT = { key: 'localhost', name: 'Hardhat local', rpc: 'http://127.0.0.1:8545', explorer: null, symbol: 'ETH' };

/**
 * May this context use the local dev chain (31337)?
 *
 * The web is Sepolia-only: every page a player or the admin sees lists Sepolia alone, on any
 * host. The dev chain is kept for Node scripts/tools (no `location`), and for the operator
 * tools that are never shipped (admin/, arena, manage, deploy) when they run on localhost
 * and opt in with <meta name="squeek-dev-chain">, or when a local test URL asks for it
 * explicitly with ?chain=31337.
 */
function devChainAllowed() {
  if (typeof location === 'undefined') return true;                          // Node
  if (!isLocalPage()) return false;
  const optIn = typeof document !== 'undefined' && document.querySelector('meta[name="squeek-dev-chain"]');
  return Boolean(optIn) || new URLSearchParams(location.search).get('chain') === '31337';
}

/** The networks a page offers. */
export const NETWORKS = devChainAllowed() ? { 11155111: SEPOLIA, 31337: HARDHAT } : { 11155111: SEPOLIA };
export const DEFAULT_CHAIN = 11155111;

// Deployments come from src/chain/deployments.js (committed) or, for contracts deployed
// from deploy.html, from this browser's localStorage. A browser deployment wins, so a
// fresh deploy is usable at once; deploy.html can clear it again.
const LS_KEY = 'squeek.deployments';
export function browserDeployments() {
  try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY)) || '{}'); } catch { return {}; }
}
export function saveBrowserDeployment(d) {
  const all = browserDeployments(); all[d.chainId] = d; localStorage.setItem(LS_KEY, JSON.stringify(all));
}
export function clearBrowserDeployment(chainId) {
  const all = browserDeployments(); delete all[chainId]; localStorage.setItem(LS_KEY, JSON.stringify(all));
}
/**
 * Addresses published by the server, if any.
 *
 * A container that deploys the contracts has nowhere to put the addresses that the static
 * site would see — `src/chain/deployments.js` is baked into the image. So it writes
 * `deployments.json` next to the pages instead, and the site picks it up at load. Order of
 * preference: what THIS browser deployed, then what the server published, then the repo.
 */
let serverDeployments = {};
export const chainReady = (async () => {
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return;
  try {
    const r = await fetch(new URL('deployments.json', document.baseURI), { cache: 'no-store' });
    if (r.ok) serverDeployments = await r.json();
  } catch { /* no server-published deployment: perfectly normal */ }
})();

export const deploymentOf = (chainId) =>
  browserDeployments()[Number(chainId)] || serverDeployments[Number(chainId)] || DEPLOYMENTS[Number(chainId)] || null;
export const deploymentSource = (chainId) =>
  browserDeployments()[Number(chainId)] ? 'browser'
  : serverDeployments[Number(chainId)] ? 'server'
  : DEPLOYMENTS[Number(chainId)] ? 'repo' : null;
const readers = new Map();
export function readProvider(chainId) {
  chainId = Number(chainId);
  if (!readers.has(chainId)) {
    const n = NETWORKS[chainId];
    if (!n) throw new Error(`mạng ${chainId} không được hỗ trợ`);
    // A deployment record may name its own endpoint — that is how a host points the site at
    // a private RPC, or at its own same-origin /rpc proxy, without rebuilding anything.
    const rpc = deploymentOf(chainId)?.rpc || n.rpc;
    // cacheTimeout -1: pages poll arena status; a cached RPC answer would freeze them.
    const p = new ethers.JsonRpcProvider(rpc, chainId, { staticNetwork: true, cacheTimeout: -1 });
    // ethers waits 4 s between receipt polls by default. On a local chain that is the
    // slowest part of anything that sends many transactions, so follow the block rate.
    p.pollingInterval = chainId === 31337 ? 400 : 4000;
    readers.set(chainId, p);
  }
  return readers.get(chainId);
}

export function contracts(chainId, runner) {
  const d = deploymentOf(chainId);
  if (!d) return null;
  runner = runner || readProvider(chainId);
  return { hamster: new ethers.Contract(d.hamster, HAMSTER_ABI, runner), arena: new ethers.Contract(d.arena, ARENA_ABI, runner), dep: d };
}

/** Read one arena + its entries (join order = bot ids). */
export async function loadArena(chainId, arenaId) {
  const c = contracts(chainId);
  if (!c) throw new Error(`chưa deploy contract trên chain ${chainId}`);
  const [{ arena, entries, head, now }, clock] = await Promise.all([
    readArena(c.arena, readProvider(chainId), { chainId: Number(chainId), arenaId }), chainClock(chainId)]);
  withClock(arena, { ...clock, number: Math.max(clock.number, head), timestamp: Math.max(clock.timestamp, now || 0) });
  return { arenaId: Number(arenaId), arena, entries, head, clock, contract: c.dep.arena };
}

/** Seconds per block on this chain (for countdowns to a closeBlock), cached for a minute. */
const _bt = new Map();
export async function blockTime(chainId) {
  const hit = _bt.get(chainId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = await blockTimeOf(readProvider(chainId), chainId);
  _bt.set(chainId, { v, at: Date.now() });
  return v;
}

/** The chain's clock: latest block number + timestamp, and seconds per block. */
export async function chainClock(chainId) {
  const [b, bt] = await Promise.all([readProvider(chainId).getBlock('latest'), blockTime(chainId)]);
  return { number: b.number, timestamp: b.timestamp, blockTime: bt };
}

/**
 * Add `phase` (Open / Closed / Revealed / Seeded / Settled / Cancelled, see phaseOf) and
 * `closeTime` — the estimated unix time of closeBlock — to a normalised arena, so pages can
 * keep counting down in seconds although entries close at a block.
 */
export function withClock(arena, clock) {
  arena.phase = phaseOf(arena, clock.number, clock.timestamp);
  arena.closeTime = Math.round(clock.timestamp + Math.max(0, arena.closeBlock - clock.number) * clock.blockTime);
  return arena;
}

/** closeBlock for an arena that should close `seconds` from now on this chain. */
export async function closeBlockIn(chainId, seconds) {
  const c = await chainClock(chainId);
  return c.number + Math.max(2, Math.ceil(seconds / c.blockTime));
}

/**
 * Which arena ids a page should list, newest first. With a schedule (admin tab 5) the
 * newest arenas close days from now, so "the last 20" would hide the game that is open
 * right now. Instead: binary-search the first arena whose entries close at or after the
 * head block (a schedule creates arenas in close order), take `around` on either side of
 * it, and add the `newest` few (a one-off arena created after a schedule closes sooner).
 */
export async function arenaIdsNear(arenaContract, head, count, { around = 10, newest = 5 } = {}) {
  count = Number(count);
  if (count <= 2 * around + newest) return Array.from({ length: count }, (_, i) => count - 1 - i);
  const closeOf = async (i) => Number((await arenaContract.getArena(i)).closeBlock);
  let lo = 0, hi = count;
  while (lo < hi) { const m = (lo + hi) >> 1; if ((await closeOf(m)) < head) lo = m + 1; else hi = m; }
  const ids = new Set();
  for (let i = Math.max(0, lo - around); i < Math.min(count, lo + around); i++) ids.add(i);
  for (let i = count - newest; i < count; i++) ids.add(i);
  return [...ids].sort((a, b) => b - a);
}

/** The arena a player most likely wants: the open one closing soonest, else the newest. */
export function currentArena(arenas) {
  const open = arenas.filter((a) => a.phase === 'Open').sort((x, y) => x.closeBlock - y.closeBlock);
  return open[0] || arenas[0] || null;
}

/** claimMany(arenaId, ...args) for `indexes` of a loaded (settled or cancelled) arena. */
export function claimManyArgs(d, indexes) {
  if (d.arena.status === 'Cancelled') return [indexes, indexes.map(() => 0), indexes.map(() => [])];
  const a = claimArgs(d.entries.map((e) => e.points), indexes);
  return [a.entryIndexes, a.points, a.proofs];
}

/**
 * claimAcross(...args): everything owed to some entries across many loaded arenas, in ONE
 * transaction. items = [{ d (from loadArena), indexes }].
 */
export function claimAcrossArgs(items) {
  const ids = [], idx = [], pts = [], proofs = [];
  for (const { d, indexes } of items) {
    const [i, p, pr] = claimManyArgs(d, indexes);
    i.forEach((x, k) => { ids.push(d.arenaId ?? d.id); idx.push(x); pts.push(p[k]); proofs.push(pr[k]); });
  }
  return [ids, idx, pts, proofs];
}

// ------------------------------------------------------------------ deposits (contract 1.4)
/**
 * A hamster plays only while deposited in the arena contract. { wallet, deposited }: token
 * ids in the wallet itself, and those it has deposited (still its own, but locked in play).
 */
export async function hamstersOf(chainId, address) {
  const c = contracts(chainId);
  const [wallet, deposited] = await Promise.all([
    c.hamster.tokensOfOwner(address), c.arena.depositsOf ? c.arena.depositsOf(address) : []]);
  return { wallet: wallet.map(String), deposited: deposited.map(String) };
}

/**
 * Deposit hamsters from `signer`'s wallet: one hamster = one safeTransferFrom (no approval);
 * several = setApprovalForAll once (if missing) + deposit(ids). Returns the receipts.
 */
export async function depositHamsters(chainId, signer, ids, onStep = () => {}) {
  const c = contracts(chainId, signer);
  const me = await signer.getAddress();
  const out = [];
  if (ids.length === 1) {
    onStep('deposit');
    // headroom: the arena's onERC721Received only gets 63/64 of the gas left, so a tight
    // estimate can fail with ERC721InvalidReceiver when the state moved since estimating
    const send = c.hamster['safeTransferFrom(address,address,uint256)'];
    const gas = await send.estimateGas(me, c.dep.arena, ids[0]);
    out.push(await (await send(me, c.dep.arena, ids[0], { gasLimit: (gas * 13n) / 10n })).wait());
    return out;
  }
  if (!(await c.hamster.isApprovedForAll(me, c.dep.arena))) {
    onStep('approve');
    out.push(await (await c.hamster.setApprovalForAll(c.dep.arena, true)).wait());
  }
  onStep('deposit');
  const gas = await c.arena.deposit.estimateGas(ids);
  out.push(await (await c.arena.deposit(ids, { gasLimit: (gas * 12n) / 10n })).wait());
  return out;
}

/**
 * join() with gas headroom. A join into an arena that already has players costs a few
 * thousand gas more than into an empty one, so an exact estimate made before someone else's
 * join lands in the same block runs out of gas. 25 % on top costs nothing unless used.
 */
export async function joinTx(arenaContract, arenaId, tokenId, fee) {
  const gas = await arenaContract.join.estimateGas(arenaId, tokenId, { value: fee });
  return arenaContract.join(arenaId, tokenId, { value: fee, gasLimit: (gas * 125n) / 100n });
}

/** buildManifest() input for a seeded arena, straight from the chain. */
export async function arenaManifestInput(chainId, arenaId) {
  const { arena, entries, contract } = await loadArena(chainId, arenaId);
  return { input: manifestInputFromArena({ chainId, contract, arenaId, arena, entries }), arena, entries };
}

// ------------------------------------------------------------------ wallet
export function hasWallet() { return typeof window !== 'undefined' && !!window.ethereum; }

export async function connectWallet() {
  if (!hasWallet()) throw new Error('Không tìm thấy MetaMask. Cài MetaMask rồi tải lại trang.');
  const browser = new ethers.BrowserProvider(window.ethereum, 'any');
  await browser.send('eth_requestAccounts', []);
  const signer = await browser.getSigner();
  const { chainId } = await browser.getNetwork();
  return { browser, signer, address: (await signer.getAddress()).toLowerCase(), chainId: Number(chainId) };
}

/** Reconnect silently if this site was already authorised in MetaMask (no popup). */
export async function tryReconnect() {
  if (!hasWallet()) return null;
  try {
    const accs = await window.ethereum.request({ method: 'eth_accounts' });
    if (!accs || !accs.length) return null;
    const browser = new ethers.BrowserProvider(window.ethereum, 'any');
    const signer = await browser.getSigner();
    const { chainId } = await browser.getNetwork();
    return { browser, signer, address: (await signer.getAddress()).toLowerCase(), chainId: Number(chainId) };
  } catch { return null; }
}

/** Explorer link for an address or a tx hash (null on chains without one). */
export function explorerUrl(chainId, kind, id) {
  const n = NETWORKS[chainId];
  return n && n.explorer ? `${n.explorer}/${kind}/${id}` : null;
}

/** Ask MetaMask to switch to (and if needed add) a supported network. */
export async function switchChain(chainId) {
  const hex = '0x' + Number(chainId).toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (e && (e.code === 4902 || /Unrecognized chain/i.test(e.message || ''))) {
      const n = NETWORKS[chainId];
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
        chainId: hex, chainName: n.name, rpcUrls: [n.rpc], nativeCurrency: { name: n.symbol, symbol: 'ETH', decimals: 18 },
        blockExplorerUrls: n.explorer ? [n.explorer] : undefined }] });
    } else throw e;
  }
}

/** Human message from an ethers / MetaMask error (custom errors decoded via the ABI). */
export function errorText(e) {
  if (!e) return 'Lỗi không xác định';
  if (e.code === 'ACTION_REJECTED' || e.code === 4001) return 'Bạn đã từ chối giao dịch trong MetaMask.';
  let name = e.revert && e.revert.name;
  if (!name) {                                       // estimateGas errors arrive undecoded
    const data = [e.data, e.info?.error?.data, e.error?.data, e.info?.error?.data?.data].find((d) => typeof d === 'string' && d.startsWith('0x') && d.length >= 10);
    for (const abi of data ? [ARENA_ABI, HAMSTER_ABI] : []) {
      try { const p = new ethers.Interface(abi).parseError(data); if (p) { name = p.name; break; } } catch { /* not this ABI */ }
    }
  }
  const MAP = {
    WrongFee: 'Sai phí tham gia (phải đúng phí của arena).', NotTokenOwner: 'Bạn không sở hữu hamster này.',
    NotDepositor: 'Hamster chưa được ký gửi vào contract bởi ví này — ký gửi trước rồi mới đăng ký trận.',
    TooManyOpen: 'Hamster này đã đăng ký đủ 50 trận đang mở — chờ bớt trận rồi đăng ký tiếp.',
    BadSetting: 'Thông số không hợp lệ.', NotHamster: 'Chỉ nhận NFT Squeek Hamster.',
    AlreadyJoined: 'Hamster này đã tham gia arena.', ArenaFull: 'Arena đã đủ người.',
    TooLate: 'Đã quá thời điểm cho phép.', TooEarly: 'Chưa tới thời điểm này (kết quả đang chờ xác nhận, hoặc chờ thêm block).',
    SeedExpired: 'Block seed đã quá 256 block: bấm "Chọn lại block seed" (rearm).', BadProof: 'Bằng chứng điểm (Merkle proof) không khớp.',
    WrongStatus: 'Arena không ở trạng thái phù hợp.', NotOperator: 'Chỉ operator / owner mới làm được việc này.',
    AlreadyClaimed: 'Đã nhận rồi.', BadQuantity: 'Số lượng mint không hợp lệ (1–10).',
    WrongPayment: 'Sai số tiền mint.', BadArena: 'Thông số arena không hợp lệ.', BadPoints: 'Danh sách điểm không khớp số người tham gia.',
  };
  if (name && MAP[name]) return MAP[name];
  if (name) return `Contract từ chối: ${name}`;
  return e.shortMessage || e.reason || e.message || String(e);
}

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const fmtEth = (wei, dp = 6) => {
  const s = ethers.formatEther(wei);
  const [i, f = ''] = s.split('.');
  const t = f.slice(0, dp).replace(/0+$/, '');
  return t ? `${i}.${t}` : i;
};
