// Determinism test: same seed must always produce the same result.
// Run: node --experimental-vm-modules scratch/test-determinism.mjs
// (from the repo root)
import { buildManifest } from '../src/core/manifest.js';
import { simulate } from '../src/core/simulator.js';
import { WEAPONS, specOf } from '../src/core/ruleset.js';

// Create a minimal manifest input with a fixed seed
const SEED = '0x' + 'ab'.repeat(32);
const input = {
  chainId: 31337,
  contract: '0x' + '00'.repeat(20),
  arenaId: 0,
  seed: SEED,
  presetId: 'standard',
  botCount: 20,
  entries: [],
};

// Build the manifest
const { manifest, ruleset } = buildManifest(input);

console.log('=== Weapon Pattern Config ===');
for (const w of WEAPONS) {
  if (w.disabled) continue;
  console.log(`  ${w.name}: type=${w.type}, pattern=${w.pattern || 'N/A'}, damage=${w.damage}, range=${w.range}`);
  if (w.coneAngle) console.log(`    coneAngle=${w.coneAngle} permille`);
  if (w.aoeRadius) console.log(`    aoeRadius=${w.aoeRadius}u`);
  if (w.lineWidth) console.log(`    lineWidth=${w.lineWidth}u`);
}
console.log(`  Unarmed: pattern=${specOf(-1).pattern}`);

console.log('\n=== Determinism Test: 3 runs with the same seed ===');
const hashes = [];
const results = [];

for (let run = 0; run < 3; run++) {
  const replay = simulate(manifest, ruleset);
  if (!replay) { console.error(`Run ${run}: simulation returned null!`); process.exit(1); }
  hashes.push(replay.result.resultHash);
  results.push(replay.result);

  // Count weapon-specific events
  let meleeHits = 0, rangedHits = 0, misses = 0, totalDamage = 0;
  let coneHits = 0, circleHits = 0, lineHits = 0, straightHits = 0;
  for (const ev of replay.events) {
    if (ev.type === 5) { // HIT
      const w = ev.c;
      const spec = specOf(w);
      if (spec.type === 'melee') {
        meleeHits++;
        const pat = spec.pattern || 'straight';
        if (pat === 'cone') coneHits++;
        else if (pat === 'circle') circleHits++;
        else if (pat === 'line') lineHits++;
        else straightHits++;
      } else {
        rangedHits++;
      }
    }
    if (ev.type === 6) misses++; // MISS
    if (ev.type === 7) totalDamage += ev.c; // DAMAGE
  }

  console.log(`\nRun ${run + 1}:`);
  console.log(`  Winner: bot #${replay.result.winnerId} (${replay.result.winnerName})`);
  console.log(`  End tick: ${replay.result.endTick}, reason: ${replay.result.endReason}`);
  console.log(`  Duration: ${replay.result.durationSeconds}s`);
  console.log(`  Result hash: ${replay.result.resultHash}`);
  console.log(`  Replay hash: ${replay.replayHash}`);
  console.log(`  Events: ${replay.events.length}`);
  console.log(`  Melee hits: ${meleeHits} (cone=${coneHits}, circle=${circleHits}, line=${lineHits}, straight=${straightHits})`);
  console.log(`  Ranged hits: ${rangedHits}`);
  console.log(`  Misses: ${misses}`);
  console.log(`  Total kills: ${replay.result.standings.reduce((s, x) => s + x.kills, 0)}`);
}

// Verify all hashes are identical
const allSame = hashes.every(h => h === hashes[0]);
console.log(`\n=== DETERMINISM: ${allSame ? 'PASS ✓' : 'FAIL ✗'} ===`);
if (!allSame) {
  console.error('Hashes differ!', hashes);
  process.exit(1);
}

// Verify detailed results match
for (let i = 1; i < results.length; i++) {
  const a = results[0], b = results[i];
  if (a.winnerId !== b.winnerId || a.endTick !== b.endTick || a.endReason !== b.endReason) {
    console.error(`Result mismatch between run 0 and ${i}!`);
    process.exit(1);
  }
  for (let j = 0; j < a.standings.length; j++) {
    const sa = a.standings[j], sb = b.standings[j];
    if (sa.rank !== sb.rank || sa.kills !== sb.kills || sa.damage !== sb.damage) {
      console.error(`Standing mismatch at position ${j} between run 0 and ${i}!`);
      process.exit(1);
    }
  }
}
console.log('All result details match across runs. ✓');

// Extra check: multi-hit weapons should show AoE effects
if (coneHits > 0) console.log('✓ Cone attacks (sword/axe) registered hits');
if (circleHits > 0) console.log('✓ Circle attacks (hammer) registered hits');
if (lineHits > 0) console.log('✓ Line attacks (spear) registered hits');
if (straightHits > 0) console.log('✓ Straight attacks (dagger/unarmed) registered hits');
