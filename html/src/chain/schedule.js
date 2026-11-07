// Multi-game schedule: many arenas, one every N minutes, up to 7 days ahead, created in
// batches with SqueekArena.createArenas (100 per transaction at most). Entries close at a
// block, so minutes are turned into blocks with the chain's measured block time.
export const MAX_DAYS = 7;
export const BATCH = 100;                    // arenas per transaction = the contract's MAX_BATCH
export const GAS_PER_ARENA = 27_300;         // createArenas, measured (gas-report: 2,727,423 for 100)
export const GAS_PER_TX = 25_000;            // base cost of each batch transaction

/** Gas the whole plan costs the operator, before anything is sent. */
export const planGas = (plan) => plan.count * GAS_PER_ARENA + plan.batches * GAS_PER_TX;

/**
 * The plan, before anything is sent.
 *   clock: { number, timestamp, blockTime }   (client.chainClock)
 *   firstInMin: the first game closes this many minutes from now
 *   everyMin:   minutes between two games
 *   days:       how far ahead (≤ 7)
 */
export function planSchedule({ clock, firstInMin, everyMin, days, preset = 0, cycle = false }) {
  everyMin = Math.max(1, Number(everyMin) || 30);
  days = Math.min(MAX_DAYS, Math.max(0, Number(days) || 0));
  firstInMin = Math.max(1, Number(firstInMin) || 10);
  const bt = clock.blockTime;
  const everyBlocks = Math.max(1, Math.round((everyMin * 60) / bt));
  const firstClose = clock.number + Math.max(2, Math.ceil((firstInMin * 60) / bt));
  // every game whose close time falls inside the window (the first one included)
  const count = Math.max(1, Math.floor(((days * 1440) - firstInMin) / everyMin) + 1);
  const games = [];
  for (let i = 0; i < count; i++) {
    const closeBlock = firstClose + i * everyBlocks;
    games.push({ i, closeBlock, closeTime: Math.round(clock.timestamp + (closeBlock - clock.number) * bt),
                 preset: cycle ? (preset + i) % 3 : preset });
  }
  return { firstClose, everyBlocks, count, games, batches: Math.ceil(count / BATCH), blockTime: bt };
}

/**
 * Send the plan: ceil(count / BATCH) createArenas transactions.
 * `arena` is a SqueekArena contract connected to an operator/owner signer.
 */
export async function createSchedule(arena, plan, { maxEntrants, preset = 0, cycle = false, onProgress = () => {}, shouldStop = () => false }) {
  const ids = [];
  for (let start = 0; start < plan.count; start += BATCH) {
    if (shouldStop()) break;
    const n = Math.min(BATCH, plan.count - start);
    const first = plan.firstClose + start * plan.everyBlocks;
    const p0 = cycle ? (preset + start) % 3 : preset;
    const tx = await arena.createArenas(first, plan.everyBlocks, n, maxEntrants, p0, cycle);
    const rc = await tx.wait();
    const created = rc.logs.map((l) => { try { return arena.interface.parseLog(l); } catch { return null; } })
      .filter((x) => x && x.name === 'ArenaCreated').map((x) => Number(x.args.arenaId));
    ids.push(...created);
    onProgress({ done: start + n, total: plan.count, ids: created, gas: rc.gasUsed, block: rc.blockNumber });
  }
  return ids;
}
