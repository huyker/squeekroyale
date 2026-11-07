// In-browser keeper for scheduled arenas: whenever an arena's entries have closed it does
// what the arena needs, with the operator wallet it was given.
//
//   closed, 0 entrants      nothing (no money in it); remembered as done
//   closed, 1 entrant       pinSeed()  -> cancelled, the player can take a refund
//   past the seed block     simulate locally -> submitResult (seed + Merkle root, 1 tx)
//   seed block > 256 old    rearm()    -> a new seed block (nobody had stored the seed)
//
// Only arenas that can need something are re-read: finished ones and ones whose close
// block is still ahead are skipped from a local cache, so a 7-day schedule of hundreds of
// arenas costs one pass of reads at start and a handful per tick afterwards.
import { normaliseArena } from './arena-manifest.js';
import { loadArena } from './client.js';
import { simulateLoaded } from './settle.js';
import { pool } from './autopilot.js';

export class ArenaKeeper {
  /**
   * @param {object} o
   * @param {number} o.chainId
   * @param {object} o.provider     read provider
   * @param {object} o.arena        SqueekArena connected to the operator signer
   * @param {(text:string, kind?:string)=>void} [o.log]
   * @param {(status:object)=>void} [o.onTick]   after every pass
   */
  constructor({ chainId, provider, arena, log, onTick }) {
    this.chainId = Number(chainId);
    this.provider = provider;
    this.arena = arena;
    this.log = log || (() => {});
    this.onTick = onTick || (() => {});
    this.done = new Set();          // Settled / Cancelled / closed empty
    this.closeOf = new Map();       // id -> closeBlock (never changes)
    this.timer = null;
    this.busy = false;
    this.stats = { settled: 0, cancelled: 0, rearmed: 0, empty: 0 };
  }

  get running() { return !!this.timer; }
  start(ms = 5000) {
    if (this.timer) return;
    this.halt = false;
    const loop = async () => {
      if (!this.timer) return;
      await this.tick().catch((e) => this.log(`lỗi: ${e.shortMessage || e.reason || e.message}`, 'err'));
      if (this.timer) this.timer = setTimeout(loop, ms);
    };
    this.timer = setTimeout(loop, 10);
  }
  stop() { clearTimeout(this.timer); this.timer = null; this.halt = true; }

  /** One pass over every arena that may need something. */
  async tick() {
    if (this.busy) return null;
    this.busy = true;
    try {
      const [head, countB] = await Promise.all([this.provider.getBlockNumber(), this.arena.arenaCount()]);
      const count = Number(countB);
      const due = [];
      for (let id = 0; id < count; id++) {
        if (this.done.has(id)) continue;
        const cb = this.closeOf.get(id);
        if (cb === undefined || head >= cb) due.push(id);
      }
      const heads = await pool(due, 6, async (id) => normaliseArena(await this.arena.getArena(id)));
      const st = { head, count, open: 0, waitingSeed: 0, nextClose: null, sent: 0 };
      for (let k = 0; k < due.length; k++) {
        const id = due[k], a = heads[k];
        this.closeOf.set(id, a.closeBlock);
        if (a.status === 'Settled' || a.status === 'Cancelled') { this.done.add(id); continue; }
        if (a.status === 'Open' && head < a.closeBlock) {
          st.open++;
          if (st.nextClose === null || a.closeBlock < st.nextClose) st.nextClose = a.closeBlock;
          continue;
        }
        if (this.halt) break;                                            // stopped mid-pass
        st.sent += await this._settle(id, a, head, st);
      }
      // arenas skipped from the cache are still open: count them for the status line
      for (const [id, cb] of this.closeOf) if (!this.done.has(id) && head < cb && !due.includes(id)) {
        st.open++;
        if (st.nextClose === null || cb < st.nextClose) st.nextClose = cb;
      }
      st.stats = { ...this.stats };
      this.onTick(st);
      return st;
    } finally { this.busy = false; }
  }

  async _settle(id, a, head, st) {
    if (a.status === 'Open' && a.entrantCount === 0) { this.done.add(id); this.stats.empty++; return 0; }
    if (a.status === 'Open' && a.entrantCount < 2) {
      await (await this.arena.pinSeed(id)).wait();
      this.stats.cancelled++; this.done.add(id);
      this.log(`#${id}: đóng với ${a.entrantCount} người → huỷ, người chơi tự nhận lại phí`, 'warn');
      return 1;
    }
    if (a.status === 'Open' && head <= a.seedBlock) { st.waitingSeed++; return 0; }   // seed block not mined yet
    const d = await loadArena(this.chainId, id);
    if (d.arena.status === 'Open' && d.arena.seedExpired) {
      await (await this.arena.rearm(id)).wait();
      this.stats.rearmed++;
      this.log(`#${id}: block seed đã quá 256 block → chọn block seed mới`, 'warn');
      return 1;
    }
    const r = await simulateLoaded(this.chainId, id, d);
    const rc = await (await this.arena.submitResult(id, r.points, r.stats, r.resultHash, r.replayHash)).wait();
    this.stats.settled++; this.done.add(id);
    this.log(`#${id}: ${d.entries.length} hamster · thắng #${r.result.winnerId} ${r.result.winnerName} · đã công bố (${rc.gasUsed.toLocaleString()} gas)`, 'ok');
    return 1;
  }
}
