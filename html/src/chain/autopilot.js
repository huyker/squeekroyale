// Autopilot: the whole arena life cycle, start to finish, from one call.
//
//   deploy → fund bots → mint hamsters → open arena
//   → PHASE 1 enter: every bot joins with its hamster (a slot is held open for the human);
//     nobody picks a position — drop points are drawn from the seed in phase 2
//   → entries close at a block by themselves → PHASE 2 reveal: the seed block's hash IS
//     the seed (no transaction) → PHASE 3: one submitResult stores seed + Merkle root
//   → PHASE 3 render: simulate locally, post the points, everyone claims
//   → repeat
//
// It is the same code in the browser (src/ui/arena.js) and on the command line
// (contracts/scripts/autopilot.mjs): the browser supplies a localStorage-backed deployment
// store, Node supplies a file-backed one. Nothing here touches the DOM.
//
// Everything after the close block is already decided: phase 2 fixes the seed, and (seed, entries)
// is the entire input of the deterministic simulator. Phase 3 posts numbers anyone can
// recompute — it never invents them.
import { ethers } from '../vendor/ethers.min.js';
import { HAMSTER_ABI, ARENA_ABI } from './abi.js';
import { HAMSTER_BYTECODE, ARENA_BYTECODE } from './bytecode.js';
import { runnerWallet, botWallets, assertTestnet, fundingShortfall } from './wallets.js';
import { normaliseArena, manifestInputFromArena, pointsFromResult, statsFromResult, rewardsOf, PRESET_IDS } from './arena-manifest.js';
import { readArena, blockTimeOf } from './arena-read.js';
import { pointsTree, hashToBytes8, encodeStats } from './proofs.js';

export const DEFAULTS = {
  slots: 100,              // entrants per arena, human included
  reserveHuman: true,      // hold one slot open until just before entries close
  commitSeconds: 60,       // length of phase 1
  topUpLeadSeconds: 12,    // before the close: if the human never came, one more bot takes the slot
  preset: 0,
  perBotEth: '0.002',      // top-up target for a bot wallet
  runnerReserveEth: '0.05',
  entryFeeEth: '0.0001',
  mintPriceEth: '0',
  resultTimeoutHours: 24,
  concurrency: 12,         // parallel transactions (RPC-friendly on public testnets)
  pollMs: 2000,
  autoClaim: true,         // false: stop after settling and leave claiming to a button
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send many transactions from ONE wallet as fast as the chain allows.
 *
 * They cannot go out in parallel: a Hardhat node with automine refuses a transaction whose
 * nonce is ahead of the next one ("transactions can't be queued when automining"), and
 * parallel sends from a single wallet arrive in whatever order the event loop produces.
 * So the sends are serialised — but only the *send*, not the receipt. One send is a single
 * RPC round trip, so 100 of them take a second or two even on a public testnet, and the
 * receipts are then awaited together while the chain mines them in a handful of blocks.
 */
export async function sendSerial(makers) {
  const sent = [];
  for (const make of makers) sent.push(await make());
  return Promise.all(sent.map((tx) => tx.wait()));
}

/**
 * Put a Hardhat node into interval mining.
 *
 * With automine every transaction gets its own block, and Hardhat moves block.timestamp
 * forward by at least a second per block. One hundred players joining would therefore push
 * the chain's clock 100 seconds into the future and phase 1 would close on top of itself
 * (`TooLate`). Interval mining batches whatever arrived into one block every `ms`, which
 * is both what a real chain does and much faster to drive.
 *
 * Harmless on a node that does not implement these methods: it warns and carries on.
 */
export async function prepareLocalChain(provider, ms = 500) {
  try {
    await provider.send('evm_setAutomine', [false]);
    await provider.send('evm_setIntervalMining', [ms]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Name of the custom error behind a failed call, or ''.
 *
 * A reverted estimateGas comes back as raw error data with no ABI attached, so ethers can
 * only say "unknown custom error". The autopilot has to branch on the exact error — a
 * full arena is a shrug, a closed phase 1 is a timing problem, anything else is a bug — so
 * the four-byte selector is decoded here against both ABIs.
 */
export function revertName(e) {
  if (e?.revert?.name) return e.revert.name;
  const seen = new Set();
  const stack = [e];
  while (stack.length) {
    const v = stack.pop();
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    for (const k of ['data', 'error', 'info', 'cause', 'value']) if (v[k]) stack.push(v[k]);
    for (const d of [v.data, v.value]) {
      if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) {
        for (const abi of [ARENA_ABI, HAMSTER_ABI]) {
          try { const p = new ethers.Interface(abi).parseError(d); if (p) return p.name; } catch { /* other ABI */ }
        }
      }
    }
  }
  return '';
}

/** Human text for a failed transaction: the custom error name when there is one. */
export const failText = (e) => revertName(e) || e?.shortMessage || e?.message || String(e);

/**
 * Deploy the pair with whatever signer you hand it, and build the deployment record.
 *
 * Kept out of the Autopilot class because deploying is the one step that is useful on its
 * own: the admin page lets you pick which wallet signs — MetaMask, the burner runner, or
 * any bot — and that wallet becomes the owner and the operator of what it deploys.
 */
export async function deployPair(signer, { ownerAddress, mintPriceEth = '0', entryFeeEth = '0.0001',
                                           resultTimeoutHours = 24, claimDelaySeconds, chainId, onStep = () => {} } = {}) {
  const owner = ownerAddress || (await signer.getAddress());
  // a result is final after this long (the owner may void it until then): 1 hour on a public
  // chain; a short one on the local dev chain so a demo round can be claimed right away
  const claimDelay = claimDelaySeconds ?? (Number(chainId) === 31337 ? 20 : 3600);
  const mintPrice = ethers.parseEther(String(mintPriceEth));
  const entryFee = ethers.parseEther(String(entryFeeEth));
  const timeout = Math.round(Number(resultTimeoutHours) * 3600);

  onStep('hamster', 'start', `Deploy SqueekHamster từ ${owner}…`);
  const hamster = await new ethers.ContractFactory(HAMSTER_ABI, HAMSTER_BYTECODE, signer).deploy(owner, mintPrice);
  const hTx = hamster.deploymentTransaction();
  const hRc = await hTx.wait();
  const hAddr = await hamster.getAddress();
  onStep('hamster', 'done', `SqueekHamster ${hAddr} (block ${hRc.blockNumber})`);

  onStep('arena', 'start', 'Deploy SqueekArena…');
  const arena = await new ethers.ContractFactory(ARENA_ABI, ARENA_BYTECODE, signer).deploy(owner, hAddr, entryFee, timeout, claimDelay);
  const aTx = arena.deploymentTransaction();
  const aRc = await aTx.wait();
  const aAddr = await arena.getAddress();
  onStep('arena', 'done', `SqueekArena ${aAddr} (block ${aRc.blockNumber})`);

  return {
    chainId: Number(chainId), network: Number(chainId) === 31337 ? 'localhost' : 'sepolia',
    deployedAt: new Date().toISOString(), fromBlock: hRc.blockNumber,
    owner, hamster: hAddr, arena: aAddr,
    entryFeeWei: entryFee.toString(), mintPriceWei: mintPrice.toString(), resultTimeout: timeout, claimDelay,
    deployedFrom: 'admin', txs: { hamster: hTx.hash, arena: aTx.hash },
  };
}

/** Thrown by `cancel()`; the runner treats it as a clean stop, not a failure. */
export class Cancelled extends Error { constructor() { super('đã dừng'); this.name = 'Cancelled'; } }

/** Run `fn` over `items` with at most `limit` in flight. Results keep the input order. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export class Autopilot {
  /**
   * @param {object} o
   * @param {object} o.provider      ethers provider for the chain
   * @param {object} o.keystore      from src/chain/wallets.js
   * @param {number} o.chainId
   * @param {object} o.store         { get(chainId), set(deployment) } — where addresses live
   * @param {function} [o.onEvent]   ({ kind, phase, text, data }) => void
   * @param {object} [o.options]     overrides of DEFAULTS
   */
  constructor({ provider, keystore, chainId, store, onEvent, options }) {
    assertTestnet(chainId);
    this.provider = provider;
    this.chainId = Number(chainId);
    this.store = store;
    this.opt = { ...DEFAULTS, ...(options || {}) };
    this.onEvent = onEvent || (() => {});
    // Every signer is wrapped in a NonceManager. ethers' JsonRpcProvider caches
    // eth_getTransactionCount for a few hundred ms, so two transactions sent from the same
    // wallet inside that window would otherwise be handed the same nonce — which is exactly
    // what the autopilot does (two deploys back to back, 100 parallel funding transfers).
    const raw = runnerWallet(keystore, provider);
    this.runnerAddress = raw.address;
    this.runner = new ethers.NonceManager(raw);
    this.botAddresses = [];
    this.bots = botWallets(keystore, this.opt.slots, provider).map((w) => {
      this.botAddresses.push(w.address);
      return new ethers.NonceManager(w);
    });
    this.stopped = false;
    this.round = 0;
  }

  stop() { this.stopped = true; }
  _check() { if (this.stopped) throw new Cancelled(); }
  log(text, kind = 'info', data) { this.onEvent({ kind, phase: this.phase || '', text, data }); }
  setPhase(phase, text) { this.phase = phase; this.onEvent({ kind: 'phase', phase, text: text || phase }); }

  /**
   * The chain's own clock. Never Date.now(): a dev chain that has been mining for a while
   * runs ahead of the wall clock (Hardhat never lets a block's timestamp go backwards), and
   * every time-based deadline in this contract — `resultTimeout` — is measured in chain
   * seconds. Waiting on the wrong clock either closes phase 1 early or hangs for minutes.
   */
  async chainNow() { return (await this.provider.getBlock('latest')).timestamp; }

  /** Wait for `fn()` to return truthy, re-checking every pollMs. */
  async until(fn, label, timeoutMs = 20 * 60_000) {
    const t0 = Date.now();
    for (;;) {
      this._check();
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`quá hạn chờ: ${label}`);
      await sleep(this.opt.pollMs);
    }
  }

  contracts(runnerOrSigner) {
    const d = this.store.get(this.chainId);
    if (!d) throw new Error(`chain ${this.chainId} chưa có contract`);
    const r = runnerOrSigner || this.provider;
    return { hamster: new ethers.Contract(d.hamster, HAMSTER_ABI, r), arena: new ethers.Contract(d.arena, ARENA_ABI, r), dep: d };
  }

  // ---------------------------------------------------------------- step 0: contracts
  /** Deploy both contracts from the runner unless this chain already has them. */
  async ensureDeployment({ redeploy = false } = {}) {
    const have = this.store.get(this.chainId);
    if (have && !redeploy) {
      const code = await this.provider.getCode(have.arena);
      if (code && code !== '0x') { this.log(`Đã có contract: Arena ${have.arena}`, 'ok'); return have; }
      this.log('Địa chỉ đã lưu không có code trên chain này — deploy lại.', 'warn');
    }
    this.setPhase('deploy', 'Triển khai contract');
    const d = await deployPair(this.runner, {
      ownerAddress: this.runnerAddress, chainId: this.chainId,
      mintPriceEth: this.opt.mintPriceEth, entryFeeEth: this.opt.entryFeeEth,
      resultTimeoutHours: this.opt.resultTimeoutHours,
      onStep: (_k, state, text) => { this._check(); this.log(text, state === 'done' ? 'ok' : 'info'); },
    });
    d.deployedFrom = 'autopilot';
    this.store.set(d);
    this.log('Đã lưu địa chỉ vào storage.', 'ok', d);
    return d;
  }

  // ---------------------------------------------------------------- step 1: funding
  /** Top every playing bot up to perBotEth out of the runner's balance. */
  async fundBots(count) {
    this.setPhase('fund', 'Nạp gas cho ví bot');
    const perBot = ethers.parseEther(this.opt.perBotEth);
    const reserve = ethers.parseEther(this.opt.runnerReserveEth);
    const playing = this.botAddresses.slice(0, count);
    const [runnerBalance, ...botBalances] = await Promise.all(
      [this.runnerAddress, ...playing].map((a) => this.provider.getBalance(a)));
    const { need, tops, short } = fundingShortfall({ runnerBalance, botBalances, perBot, reserve });
    if (short > 0n)
      throw new Error(`Ví runner ${this.runnerAddress} thiếu tiền: có ${ethers.formatEther(runnerBalance)} ETH, `
        + `cần ${ethers.formatEther(need)} ETH (thiếu ${ethers.formatEther(short)}). Nạp thêm rồi bấm lại.`);
    if (!tops.length) { this.log('Mọi ví bot đã đủ gas.', 'ok'); return; }

    this.log(`Chuyển gas cho ${tops.length} ví (tổng ${ethers.formatEther(tops.reduce((s, t) => s + t.amount, 0n))} ETH)…`);
    await sendSerial(tops.map((t) => () => this.runner.sendTransaction({ to: playing[t.i], value: t.amount })));
    this.log(`Đã nạp gas cho ${tops.length} ví.`, 'ok');
  }

  /** Hamsters of a wallet: still in it, and deposited in the arena (contract 1.4). */
  async hamstersOf(address) {
    const { hamster, arena } = this.contracts();
    const [wallet, deposited] = await Promise.all([hamster.tokensOfOwner(address), arena.depositsOf(address)]);
    return { wallet: [...wallet], deposited: [...deposited] };
  }

  /**
   * Every playing bot must have a hamster DEPOSITED in the arena (only deposited hamsters
   * can enter): mint for the ones that have none, then deposit what sits in the wallet.
   */
  async ensureHamsters(count) {
    this.setPhase('mint', 'Mint + ký gửi hamster cho ví bot');
    const playing = this.bots.slice(0, count);
    const owned = await pool(this.botAddresses.slice(0, count), this.opt.concurrency, (a) => this.hamstersOf(a));
    const need = playing.map((b, i) => ({ b, i })).filter(({ i }) => !owned[i].wallet.length && !owned[i].deposited.length);
    if (!need.length) { this.log(`Cả ${count} ví đã có hamster.`, 'ok'); }
    else {
      const price = BigInt(this.contracts().dep.mintPriceWei || '0');
      this.log(`Mint hamster cho ${need.length} ví…`);
      const txs = await pool(need, this.opt.concurrency, ({ b }) =>
        new ethers.Contract(this.contracts().dep.hamster, HAMSTER_ABI, b).mint(1, { value: price }));
      await Promise.all(txs.map((t) => t.wait()));          // send first, collect receipts together
      this.log(`Đã mint ${need.length} hamster.`, 'ok');
    }
    let after = await pool(this.botAddresses.slice(0, count), this.opt.concurrency, (a) => this.hamstersOf(a));
    const dep = this.contracts().dep;
    const todo = after.map((h, i) => ({ i, h })).filter(({ h }) => !h.deposited.length);
    if (todo.length) {
      this.log(`Ký gửi hamster vào contract cho ${todo.length} ví (một lần, rồi chơi mọi trận)…`);
      const txs = await pool(todo, this.opt.concurrency, async ({ i, h }) => {
        const send = new ethers.Contract(dep.hamster, HAMSTER_ABI, playing[i])['safeTransferFrom(address,address,uint256)'];
        const args = [this.botAddresses[i], dep.arena, h.wallet[0]];
        // headroom: the arena's onERC721Received only gets 63/64 of what is left, so an exact
        // estimate fails as soon as other deposits land first (ERC721InvalidReceiver)
        return send(...args, { gasLimit: ((await send.estimateGas(...args)) * 13n) / 10n });
      });
      await Promise.all(txs.map((t) => t.wait()));
      this.log(`Đã ký gửi ${todo.length} hamster.`, 'ok');
      after = await pool(this.botAddresses.slice(0, count), this.opt.concurrency, (a) => this.hamstersOf(a));
    } else this.log(`Cả ${count} ví đã có hamster ký gửi.`, 'ok');
    return after.map((h) => h.deposited[0]);
  }

  // ---------------------------------------------------------------- step 2: open arena
  /** Blocks for `seconds` on this chain (a dev chain is measured, Sepolia is 12 s/block). */
  async blocksFor(seconds) {
    this.blockTime = this.blockTime || await blockTimeOf(this.provider, this.chainId);
    return Math.max(2, Math.ceil(seconds / this.blockTime));
  }

  async createArena() {
    this.setPhase('open', 'Mở arena mới');
    const { arena } = this.contracts(this.runner);
    const head = await this.provider.getBlockNumber();
    const closeBlock = head + await this.blocksFor(this.opt.commitSeconds);
    const tx = await arena.createArena(closeBlock, this.opt.slots, this.opt.preset);
    const rc = await tx.wait();
    const id = Number(await arena.arenaCount()) - 1;
    this.log(`Arena #${id}: ${this.opt.slots} chỗ, preset ${PRESET_IDS[this.opt.preset]}, `
      + `phase 1 đóng ở block ${closeBlock} (~${this.opt.commitSeconds}s, ${this.blockTime}s/block; tạo ở block ${rc.blockNumber})`, 'ok',
      { arenaId: id, closeBlock });
    return { arenaId: id, closeBlock };
  }

  // ---------------------------------------------------------------- PHASE 1
  /** Fill the arena to `target` entrants: each bot joins with its hamster, nothing else. */
  async commit(arenaId, tokenIds, target) {
    const { arena, dep } = this.contracts();
    const a = normaliseArena(await arena.getArena(arenaId));
    const fee = a.fee ?? BigInt(dep.entryFeeWei);                 // the arena's own fee (contract 1.4)
    const already = a.entrantCount;
    const free = Math.max(0, target - already);
    if (!free) { this.log(`Arena đã đủ ${already}/${target}, không cần bot vào thêm.`, 'ok'); return []; }

    // Which bots are not in this arena yet (a human entry never belongs to a bot wallet).
    const mine = new Set((await arena.getEntries(arenaId))[0].map((e) => String(e.player).toLowerCase()));
    const candidates = this.bots.map((b, i) => ({ b, i, addr: this.botAddresses[i] }))
      .filter(({ addr }) => !mine.has(addr.toLowerCase())).slice(0, free);

    this.log(`Phase 1 · ${candidates.length} ví bot vào arena (đang có ${already}/${target})…`);
    const joined = [];
    // Send first, wait afterwards. Each bot is its own wallet with its own nonce, so the
    // sends are independent; what is NOT independent is the connection budget — a browser
    // allows only a handful of requests per host at a time, and waiting for a receipt
    // inside the loop holds one of those open for a whole block. Sending all of them and
    // then collecting the receipts together keeps phase 1 to a few seconds at 100 players.
    const sent = await pool(candidates, this.opt.concurrency, async ({ b, i, addr }) => {
      const c = new ethers.Contract(dep.arena, ARENA_ABI, b);
      this._check();
      try {
        // headroom: these joins land together, and a join into a non-empty arena costs more
        // than the empty-arena estimate they were all made against
        const gas = await c.join.estimateGas(arenaId, tokenIds[i], { value: fee });
        const tx = await c.join(arenaId, tokenIds[i], { value: fee, gasLimit: (gas * 125n) / 100n });
        joined.push({ bot: i, address: addr });
        return tx;
      } catch (e) {
        const name = revertName(e);
        if (name === 'ArenaFull') { this.log(`Arena đầy trước khi ví #${i} kịp vào.`, 'warn'); return null; }
        if (name === 'TooLate') throw new Error(
          'Phase 1 đóng trước khi mọi ví kịp vào. Tăng thời lượng phase 1 hoặc giảm số chỗ.');
        throw new Error(`ví bot #${i} không join được: ${failText(e)}`);
      }
    });
    await Promise.all(sent.filter(Boolean).map((tx) => tx.wait()));
    this.log(`Phase 1 · ${joined.length} ví đã vào arena (điểm rơi sẽ bốc ngẫu nhiên từ seed).`, 'ok', { joined: joined.length });
    return joined;
  }

  /** If the reserved slot was never used by a human, let one more bot take it. */
  async topUpReservedSlot(arenaId, tokenIds, closeBlock) {
    if (!this.opt.reserveHuman) return;
    const { arena } = this.contracts();
    const deadline = closeBlock - await this.blocksFor(this.opt.topUpLeadSeconds);
    let joinedByHuman = false;
    await this.until(async () => {
      const [h, a] = await Promise.all([this.provider.getBlockNumber(), arena.getArena(arenaId)]);
      if (Number(a.entrantCount) >= this.opt.slots) { joinedByHuman = true; return true; }
      return h >= deadline;
    }, 'hết hạn giữ chỗ cho người chơi');
    if (joinedByHuman) { this.log('Người chơi đã vào — đủ chỗ, không thêm bot.', 'ok'); return; }
    const a = normaliseArena(await arena.getArena(arenaId));
    if (a.status !== 'Open') return;
    this.log(`Chỗ dành cho người chơi chưa dùng (${a.entrantCount}/${this.opt.slots}) — cho thêm bot vào.`);
    await this.commit(arenaId, tokenIds, this.opt.slots);
  }

  /**
   * Phase 1 ends by itself at closeBlock — no transaction. An arena that closed with fewer
   * than 2 hamsters is cancelled (pinSeed does that) so everyone can take a refund.
   */
  async close(arenaId, closeBlock) {
    this.setPhase('lock', 'Đóng phase 1');
    await this.until(async () => (await this.provider.getBlockNumber()) >= closeBlock, `block ${closeBlock}`);
    const { arena } = this.contracts(this.runner);
    let a = normaliseArena(await arena.getArena(arenaId));
    if (a.entrantCount < 2) {
      await (await arena.pinSeed(arenaId)).wait();
      a = normaliseArena(await arena.getArena(arenaId));
    }
    this.log(`Phase 1 đã đóng ở block ${closeBlock}: ${a.entrantCount} người tham gia, seed = hash của block ${a.seedBlock}.`, 'ok', a);
    return a;
  }

  // ---------------------------------------------------------------- PHASE 2
  /**
   * The seed is the hash of the seed block: nothing to send, just wait for that block.
   * If it slipped out of the 256-block window before settling, rearm() names a new one.
   */
  async reveal(arenaId) {
    this.setPhase('reveal', 'Phase 2 · seed = hash block');
    const { arena } = this.contracts(this.runner);
    for (let attempt = 0; attempt < 6; attempt++) {
      const a0 = normaliseArena(await arena.getArena(arenaId));
      await this.until(async () => (await this.provider.getBlockNumber()) > a0.seedBlock, `block ${a0.seedBlock + 1}`);
      const { arena: a } = await readArena(arena, this.provider, { chainId: this.chainId, arenaId });
      if (a.seedExpired) {
        await (await arena.rearm(arenaId)).wait();
        this.log('Lỡ cửa sổ 256 block, chọn seed block mới.', 'warn');
        continue;
      }
      this.log(`Seed = ${a.seed} (hash block ${a.seedBlock} — chưa cần giao dịch nào)`, 'ok', a);
      this.log('Từ giây này kết quả đã cố định: seed + danh sách người chơi = toàn bộ đầu vào của simulator.', 'ok');
      return a;
    }
    throw new Error('không lấy được seed sau 6 lần thử');
  }

  // ---------------------------------------------------------------- PHASE 3
  /** Re-run the match locally and post the points. Returns the simulator result. */
  async settle(arenaId) {
    this.setPhase('settle', 'Phase 3 · mô phỏng và công bố');
    const [{ buildManifest }, { simulate }, { validateReplay }] = await Promise.all([
      import('../core/manifest.js'), import('../core/simulator.js'), import('../replay/replay.js')]);
    const { arena, dep } = this.contracts();
    const { arena: a, entries } = await readArena(arena, this.provider, { chainId: this.chainId, arenaId });
    const input = manifestInputFromArena({ chainId: this.chainId, contract: dep.arena, arenaId, arena: a, entries });
    const { manifest, ruleset } = buildManifest({ ...input, recordDecisions: false });
    const t0 = Date.now();
    const replay = simulate(manifest, ruleset);
    const v = validateReplay(replay);
    if (!v.ok) throw new Error('replay không hợp lệ: ' + v.problems.join('; '));
    const r = replay.result;
    this.log(`Mô phỏng xong trong ${Date.now() - t0} ms: ${entries.length} hamster, ${r.endTick} tick `
      + `(${(r.endTick / 20).toFixed(0)}s), người thắng #${r.winnerId} ${r.winnerName}`, 'ok');

    const points = pointsFromResult(r);
    const stats = encodeStats(statsFromResult(r));
    const w = this.contracts(this.runner).arena;
    const rc = await (await w.submitResult(arenaId, points, stats, hashToBytes8(r.resultHash), hashToBytes8(replay.replayHash))).wait();
    this.log(`Đã công bố trong 1 giao dịch (seed + Merkle root điểm + hạng/kill, ${rc.gasUsed} gas): resultHash ${r.resultHash}, replayHash ${replay.replayHash} (block ${rc.blockNumber})`, 'ok',
      { resultHash: r.resultHash, replayHash: replay.replayHash });
    return { result: r, replayHash: replay.replayHash, entries, points, manifest };
  }

  /**
   * Every bot entry takes what it is owed: its share of a settled arena (with a Merkle
   * proof), or its entry fee back from a cancelled one. Human entries are left for the human.
   * Returns [{ bot, index, address, points, amount }] for the entries claimed now.
   */
  async claimAll(arenaId) {
    this.setPhase('claim', 'Nhận thưởng');
    const { arena, dep } = this.contracts();
    const { arena: a, entries } = await readArena(arena, this.provider, { chainId: this.chainId, arenaId });
    const cancelled = a.status === 'Cancelled';
    if (!cancelled && a.status !== 'Settled') throw new Error(`arena #${arenaId} chưa công bố kết quả (${a.status})`);
    if (!cancelled && a.claimableAt) {
      const wait = a.claimableAt - (await this.chainNow());
      if (wait > 0) {
        this.log(`Kết quả đang chờ xác nhận — claim mở sau ~${wait}s (giờ chain), owner còn có thể huỷ kết quả sai trong lúc này.`);
        await this.until(async () => (await this.chainNow()) >= a.claimableAt, 'hết thời gian chờ xác nhận', (wait + 600) * 1000);
      }
    }
    const byBot = new Map(this.botAddresses.map((x, i) => [x.toLowerCase(), i]));
    const points = entries.map((e) => e.points);
    const tree = cancelled ? null : pointsTree(points);
    const rewards = cancelled ? entries.map(() => BigInt(dep.entryFeeWei)) : rewardsOf(a, entries);
    const todo = [];
    entries.forEach((e) => {
      const i = byBot.get(e.player);
      if (i !== undefined && !e.claimed && (cancelled || e.points > 0))
        todo.push({ i, index: e.index, address: e.player, points: e.points, amount: rewards[e.index] });
    });
    if (!todo.length) { this.log('Không có gì để nhận.', 'ok'); return []; }
    const total = todo.reduce((s, t) => s + t.amount, 0n);
    await pool(todo, this.opt.concurrency, async ({ i, index }) => {
      const c = new ethers.Contract(dep.arena, ARENA_ABI, this.bots[i]);
      const proof = cancelled ? [] : tree.proof(index);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Gas is estimated against the state of the moment, but these claims execute
          // interleaved: whichever one lands last also sweeps the rounding dust into the
          // treasury, an extra storage write the estimate never saw. Without headroom that
          // last claim runs out of gas and the arena keeps a reward nobody can take.
          const gas = await c.claim.estimateGas(arenaId, index, points[index], proof);
          await (await c.claim(arenaId, index, points[index], proof, { gasLimit: gas + 80_000n })).wait();
          return;
        } catch (e) {
          if (revertName(e) === 'AlreadyClaimed') return;      // someone already triggered it
          this.bots[i].reset();
          if (attempt === 2) throw new Error(`nhận thưởng cho entry ${index} thất bại: ${failText(e)}`);
        }
      }
    });
    this.log(cancelled ? `${todo.length} ví đã nhận lại phí, tổng ${ethers.formatEther(total)} ETH.`
      : `${todo.length} ví đã nhận thưởng (kèm Merkle proof), tổng ${ethers.formatEther(total)} ETH.`, 'ok');
    return todo.map(({ i, index, address, points: p, amount }) => ({ bot: i, index, address, points: p, amount }));
  }

  // ---------------------------------------------------------------- one full round
  async runRound() {
    this.round += 1;
    const slots = this.opt.slots;
    const botTarget = this.opt.reserveHuman ? slots - 1 : slots;
    this.log(`──────── Vòng ${this.round} ────────`, 'round');

    // Prepare every wallet, including the spare that only plays when the human does not:
    // it has to be funded and holding a hamster before the reserved slot expires.
    await this.fundBots(slots);
    const tokenIds = await this.ensureHamsters(slots);
    const { arenaId, closeBlock } = await this.createArena();

    this.setPhase('commit', 'Phase 1 · đăng ký');
    if (this.opt.reserveHuman)
      this.log(`Giữ 1 chỗ cho anh tới ~${this.opt.topUpLeadSeconds}s trước khi đóng — vào thì ${botTarget} bot chơi cùng, không vào thì bot thứ ${slots} lấp.`);
    await this.commit(arenaId, tokenIds, botTarget);
    await this.topUpReservedSlot(arenaId, tokenIds, closeBlock);

    const locked = await this.close(arenaId, closeBlock);
    if (locked.status === 'Cancelled') { this.log('Arena bị huỷ (dưới 2 người) — mọi người được hoàn phí.', 'warn'); return { arenaId, cancelled: true }; }

    await this.reveal(arenaId);
    const settled = await this.settle(arenaId);
    if (this.opt.autoClaim) await this.claimAll(arenaId);
    else this.log('Đã công bố điểm — thưởng nằm chờ trong contract. Bấm “Claim cho mọi ví bot” để từng ví tự nhận.', 'ok');

    this.setPhase('done', 'Xong vòng');
    this.log(`Vòng ${this.round} hoàn tất · arena #${arenaId} · xem lại: viewer.html?chain=${this.chainId}&arena=${arenaId}`, 'ok',
      { arenaId, ...settled });
    return { arenaId, ...settled };
  }

  /** Run rounds back to back until stop() is called (or `rounds` of them). */
  async run({ rounds = Infinity, redeploy = false } = {}) {
    const out = [];
    try {
      await this.ensureDeployment({ redeploy });
      for (let n = 0; n < rounds && !this.stopped; n++) out.push(await this.runRound());
    } catch (e) {
      if (e instanceof Cancelled) this.log('Đã dừng theo yêu cầu.', 'warn');
      else { this.log(failText(e), 'err'); throw e; }
    }
    return out;
  }
}

