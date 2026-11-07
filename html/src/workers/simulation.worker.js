// Precompute worker. The UI thread never simulates; it only receives the finished,
// immutable replay. Progress messages are observational and cannot affect the result.
import { buildManifest } from '../core/manifest.js';
import { simulate } from '../core/simulator.js';
import { validateReplay } from '../replay/replay.js';

let cancelled = false;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'cancel') { cancelled = true; return; }
  if (msg.type !== 'simulate') return;
  cancelled = false;
  try {
    const { manifest, ruleset } = buildManifest(msg.config);
    self.postMessage({ type: 'manifest', manifest });
    const startedAt = Date.now();          // telemetry only — never read by the core
    const replay = simulate(manifest, ruleset,
      (tick, alive) => self.postMessage({ type: 'progress', tick, alive, elapsedMs: Date.now() - startedAt }),
      () => cancelled);
    if (!replay) { self.postMessage({ type: 'cancelled' }); return; }
    const verdict = validateReplay(replay);
    const payload = {
      type: 'done',
      replay,
      verdict,
      computeMs: Date.now() - startedAt,
    };
    // Frames may share one buffer (unchanged loot is reused): transfer each buffer once.
    const transfer = new Set();
    for (const s of replay.snapshots) transfer.add(s.buffer);
    for (const p of replay.projFrames) transfer.add(p.buffer);
    for (const l of replay.lootFrames) transfer.add(l.buffer);
    transfer.add(replay.snapshotTicks.buffer);
    if (replay.decisions && replay.decisions.buffer) transfer.add(replay.decisions.buffer);
    self.postMessage(payload, [...transfer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.stack || err) });
  }
};
