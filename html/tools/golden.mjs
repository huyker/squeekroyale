#!/usr/bin/env node
// Golden vectors: "this seed always gives exactly this match". A handful of fixed inputs
// (seed-only demos and NFT-style arenas; drop points always random from the seed) and the hashes they must
// reproduce on any machine, in Node or in the browser. tests/run-tests.mjs checks them;
// a mismatch means a result-changing edit, which needs a version bump and a refresh:
//
//   node tools/golden.mjs            # compare
//   node tools/golden.mjs --update   # rewrite tests/golden.json (after a deliberate change)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../src/core/manifest.js';
import { simulate } from '../src/core/simulator.js';
import { demoDna } from '../src/core/hamster.js';
import { SIMULATOR_VERSION } from '../src/core/constants.js';

export const GOLDEN_FILE = fileURLToPath(new URL('../tests/golden.json', import.meta.url));

/** The fixed inputs. Never edit an existing case; add new ones. */
export function goldenCases() {
  const arena = (tag, n, seed) => ({
    name: `arena-${tag}`, seed,
    entrants: Array.from({ length: n }, (_, i) => ({
      dna: demoDna(`golden-${tag}`, i), tokenId: i + 1, owner: null,
    })),
  });
  return [
    { name: 'demo-100-standard', seed: 20261105, botCount: 100, presetId: 'standard' },
    { name: 'demo-50-brawler', seed: 'alpha', botCount: 50, presetId: 'brawler' },
    { name: 'demo-50-sniper', seed: 'golden-sniper', botCount: 50, presetId: 'sniper' },
    arena('small', 8, '0x' + 'ab'.repeat(32)),
    arena('full', 64, '0x5eed000000000000000000000000000000000000000000000000000000000001'),
  ];
}

export function runCase(c) {
  const { manifest, ruleset } = buildManifest({ ...c, recordDecisions: false });
  const r = simulate(manifest, ruleset);
  return {
    matchKey: manifest.matchKey, rulesetHash: manifest.rulesetHash,
    planHash: r.result.planHash, resultHash: r.result.resultHash, replayHash: r.replayHash,
    winnerId: r.result.winnerId, endTick: r.result.endTick,
    scores: r.result.standings.slice().sort((a, b) => a.botId - b.botId).map((s) => s.score),
  };
}

export function computeGolden() {
  return { simulatorVersion: SIMULATOR_VERSION, cases: Object.fromEntries(goldenCases().map((c) => [c.name, runCase(c)])) };
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/golden.mjs');
if (isMain) {
  const now = computeGolden();
  if (process.argv.includes('--update') || !existsSync(GOLDEN_FILE)) {
    writeFileSync(GOLDEN_FILE, JSON.stringify(now, null, 1) + '\n');
    console.log(`wrote ${GOLDEN_FILE}`);
  } else {
    const want = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
    let bad = 0;
    for (const [k, v] of Object.entries(want.cases)) {
      const ok = JSON.stringify(v) === JSON.stringify(now.cases[k]);
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'DIFF'} ${k}  result ${now.cases[k]?.resultHash}  replay ${now.cases[k]?.replayHash}`);
    }
    process.exitCode = bad ? 1 : 0;
  }
  for (const [k, v] of Object.entries(now.cases)) console.log(`  ${k.padEnd(18)} plan ${v.planHash} result ${v.resultHash} winner #${v.winnerId} @${v.endTick}`);
}
