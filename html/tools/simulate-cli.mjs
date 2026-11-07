#!/usr/bin/env node
// Headless runner sharing the exact same core as the browser.
//   node tools/simulate-cli.mjs --seed 20261105 --bots 100 --runs 5 [--json out.json]
import { writeFileSync } from 'node:fs';
import { buildManifest } from '../src/core/manifest.js';
import { simulate } from '../src/core/simulator.js';
import { validateReplay } from '../src/replay/replay.js';
import { EV_NAME } from '../src/core/constants.js';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};

const seed = arg('seed', '20261105');
const botCount = Number(arg('bots', '100'));
const runs = Number(arg('runs', '1'));
const presetId = arg('preset', 'standard');
const jsonOut = arg('json', null);

const { manifest, ruleset } = buildManifest({ seed, botCount, presetId });
console.log('MatchKey      ', manifest.matchKey);
console.log('simulator     ', manifest.simulatorVersion, '| rng', manifest.rngAlgorithmVersion);
console.log('rulesetHash   ', manifest.rulesetHash, '| preset', presetId);
console.log('seed          ', manifest.seedInput, '->', manifest.seed, '| bots', botCount);
console.log('');

let first = null;
let allEqual = true;
let replay = null;
for (let i = 0; i < runs; i++) {
  const t0 = process.hrtime.bigint();
  replay = simulate(manifest, ruleset);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const key = replay.replayHash + '/' + replay.result.resultHash;
  if (first === null) first = key; else if (key !== first) allEqual = false;
  if (i === 0 || i === runs - 1 || runs <= 3) {
    console.log(`run ${String(i + 1).padStart(3)}  ${ms.toFixed(1).padStart(8)} ms  winner ${String(replay.result.winnerId).padStart(4)} ${replay.result.winnerName.padEnd(16)} endTick ${String(replay.result.endTick).padStart(5)}  ${key}`);
  }
}
console.log('');
const verdict = validateReplay(replay);
const counts = {};
for (const ev of replay.events) counts[EV_NAME[ev.type]] = (counts[EV_NAME[ev.type]] || 0) + 1;
console.log('duration      ', replay.result.durationSeconds + 's', '| endReason', replay.result.endReason);
console.log('events        ', replay.events.length, JSON.stringify(counts));
console.log('snapshots     ', replay.snapshots.length);
console.log('crown changes ', replay.result.crownHistory.length);
console.log('validate      ', verdict.ok ? 'OK' : 'FAILED ' + verdict.problems.join('; '));
console.log('determinism   ', runs > 1 ? (allEqual ? `OK (${runs} identical runs)` : 'FAILED — hashes diverged') : 'n/a (single run)');

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ manifest, result: replay.result, replayHash: replay.replayHash }, null, 2));
  console.log('wrote         ', jsonOut);
}
process.exit(verdict.ok && allEqual ? 0 : 1);
