#!/usr/bin/env node
// Acceptance tests for whitepaper §10. Run: node tests/run-tests.mjs [--runs 100]
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
// The art pack (src/assets/agy) is optional; its file checks only run when it is present.
const HAS_ART = existsSync('src/assets/agy/manifest.json');
import { join } from 'node:path';
import { buildManifest, canonicaliseConfig } from '../src/core/manifest.js';
import { simulate, Sim } from '../src/core/simulator.js';
import { validateReplay, ReplayReader } from '../src/replay/replay.js';
import { Rng, RNG_TEST_VECTORS, canonicalSeed } from '../src/core/rng.js';
import { isqrt, fnorm, flen, fmul, fdiv } from '../src/core/fixed.js';
import { hashString, canonicalJson } from '../src/core/hash.js';
import { RULESET_HASH, rulesetHashOf, resolveRuleset, WEAPONS, WEAPON_INDEX, CONSUMABLE_INDEX } from '../src/core/ruleset.js';
import { checkMatch, defaultSeeds } from '../tools/runtime-check.mjs';
import { checkCombat } from '../tools/combat-check.mjs';
import { strategicDecision } from '../src/core/ai.js';
import { EV, EV_NAME, HP_SCALE, FP, ACT_FLEE, ACT_ATTACK, ACT_HUNT, ACTIONS, TICK_HZ, F_BAG_SHIFT, F_BAG_MASK } from '../src/core/constants.js';
import { appearanceFor, OUTFIT_BODY, HEADWEAR, OUTFIT_BACK } from '../src/core/appearance.js';
import { OBSTACLE_KIND, PROP_VARIANTS, TREE_VARIANTS, BUILDING_VARIANTS } from '../src/core/world.js';
import { ITEM_STATS, STAT_KEYS, STAT_BASE, HEAD_KEYS, BACK_KEYS, traitsOf, demoDna, dnaWord, combatParams } from '../src/core/hamster.js';
import { planMatch, dropRadiusOf } from '../src/core/plan.js';
import { goldenCases, runCase, GOLDEN_FILE } from '../tools/golden.mjs';
import { SIMULATOR_VERSION } from '../src/core/constants.js';

const argv = process.argv.slice(2);
const RUNS = Number((argv.indexOf('--runs') >= 0 && argv[argv.indexOf('--runs') + 1]) || 100);

let pass = 0, fail = 0;
const t0 = Date.now();
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
}
function group(name) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

// ---------------------------------------------------------------- §6.4 RNG
group('RNG — versioned, reproducible, no Math.random');
{
  const r = new Rng(RNG_TEST_VECTORS.seed);
  const got = Array.from({ length: 8 }, () => r.u32());
  check('xoshiro128** matches frozen test vectors', JSON.stringify(got) === JSON.stringify(RNG_TEST_VECTORS.first8), JSON.stringify(got));
  const a = new Rng(7), b = new Rng(7);
  check('same seed -> same stream', Array.from({ length: 50 }, () => a.u32()).join() === Array.from({ length: 50 }, () => b.u32()).join());
  const c = new Rng(8);
  check('different seed -> different stream', new Rng(7).u32() !== c.u32());
  const r2 = new Rng(99);
  let inRange = true;
  for (let i = 0; i < 5000; i++) { const v = r2.below(7); if (v < 0 || v > 6) inRange = false; }
  check('below(n) stays in [0,n)', inRange);
  check('canonicalSeed is stable for strings', canonicalSeed('alpha') === canonicalSeed('alpha') && canonicalSeed('alpha') !== canonicalSeed('beta'));
}

// ---------------------------------------------------------------- §6.3 fixed point
group('Fixed-point math — exact integers only');
{
  check('isqrt exact on squares', [0, 1, 4, 9, 10000, 123454321].every((n) => isqrt(n) === Math.round(Math.sqrt(n))));
  check('isqrt floors non-squares', isqrt(2) === 1 && isqrt(99) === 9 && isqrt(1e12 + 7) === 1000000);
  check('fnorm length is bounded', (() => {
    for (let i = 1; i < 400; i++) { const [x, y] = fnorm(i * 13, -i * 7, 256); if (flen(x, y) > 258) return false; }
    return true;
  })());
  check('fmul/fdiv truncate toward zero', fmul(-256, 384) === -384 && fdiv(-256, 512) === -128);
  check('canonicalJson sorts keys', canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }) === '{"a":[2,{"c":3,"d":4}],"b":1}');
  check('FNV-1a 64 offset basis', hashString('') === 'cbf29ce484222325');
}

// ---------------------------------------------------------------- §10.1 determinism
group(`Determinism — ${RUNS} identical runs of one MatchKey (§10.1.1)`);
{
  const { manifest, ruleset } = buildManifest({ seed: 20261105, botCount: 100 });
  const first = simulate(manifest, ruleset);
  let allSame = true, firstDiff = null;
  for (let i = 1; i < RUNS; i++) {
    const r = simulate(manifest, ruleset);
    if (r.replayHash !== first.replayHash || r.result.resultHash !== first.result.resultHash ||
        r.result.endTick !== first.result.endTick || r.result.winnerId !== first.result.winnerId) {
      allSame = false; firstDiff = i; break;
    }
  }
  check(`${RUNS} runs produce identical endTick / winnerId / resultHash / replayHash`, allSame, firstDiff !== null ? `diverged at run ${firstDiff}` : '');

  const other = buildManifest({ seed: 20261106, botCount: 100 });
  const r2 = simulate(other.manifest, other.ruleset);
  check('different seed -> different MatchKey', manifest.matchKey !== other.manifest.matchKey);
  check('different seed -> different replay', r2.replayHash !== first.replayHash);

  const tuned = resolveRuleset('standard');
  tuned.bot.maxHp += 1;
  check('one changed balance number -> different rulesetHash', rulesetHashOf(tuned) !== RULESET_HASH);

  const cfgA = canonicaliseConfig({ botCount: 100, presetId: 'standard' });
  const cfgB = canonicaliseConfig({ botCount: '100', presetId: 'nonsense' });
  check('config canonicalisation is stable', JSON.stringify(cfgA) === JSON.stringify(cfgB));

  // §10.1.5 — replay controls cannot change anything.
  const reader = new ReplayReader(first);
  reader.sampleAt(0); reader.sampleAt(first.result.endTick); reader.sampleAt(123.7);
  reader.sampleAt(50.2); reader.sampleAt(900.9); reader.sampleAt(10.5);
  const after = validateReplay(first);
  check('seek/sample does not mutate the replay (hash unchanged)', after.hash === first.replayHash && after.ok);

  // §10.1.6 — export/import integrity, corrupted file rejected.
  const roundTrip = JSON.parse(JSON.stringify({
    manifest: first.manifest, initial: first.initial,
    snapshotTicks: Array.from(first.snapshotTicks),
    snapshots: first.snapshots.map((s) => Array.from(s)),
    zoneFrames: first.zoneFrames, projFrames: first.projFrames.map((p) => Array.from(p)),
    lootFrames: first.lootFrames.map((l) => Array.from(l)), crownFrames: first.crownFrames,
    events: first.events, result: first.result, replayHash: first.replayHash,
  }));
  const rebuilt = {
    ...roundTrip,
    snapshotTicks: Int32Array.from(roundTrip.snapshotTicks),
    snapshots: roundTrip.snapshots.map((s) => Int32Array.from(s)),
    projFrames: roundTrip.projFrames.map((p) => Int32Array.from(p)),
    lootFrames: roundTrip.lootFrames.map((l) => Int32Array.from(l)),
  };
  check('export -> import keeps the same checksum', validateReplay(rebuilt).ok);
  const corrupt = { ...rebuilt, snapshots: rebuilt.snapshots.map((s, i) => (i === 10 ? Int32Array.from(s, (v, k) => (k === 3 ? v + 1 : v)) : s)) };
  check('a tampered replay is rejected', !validateReplay(corrupt).ok);
}

group('Golden vectors — fixed seeds always give the same match (tests/golden.json)');
{
  const want = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8'));
  check(`golden file is for simulator ${SIMULATOR_VERSION}`, want.simulatorVersion === SIMULATOR_VERSION, want.simulatorVersion);
  for (const c of goldenCases()) {
    const got = runCase(c), exp = want.cases[c.name];
    check(`${c.name}: matchKey / planHash / resultHash / replayHash / every score unchanged`,
      exp && JSON.stringify(got) === JSON.stringify(exp),
      exp ? `result ${got.resultHash} vs ${exp.resultHash}, replay ${got.replayHash} vs ${exp.replayHash}` : 'missing (node tools/golden.mjs --update)');
  }
}

// ---------------------------------------------------------------- §10.1.4 static guard
group('Static guard — core imports no wall clock, no Math.random, no DOM (§10.1.4)');
{
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk('src/core');
  files.push('src/replay/replay.js');
  const banned = [/Math\.random/, /\bDate\.now\b/, /new Date\b/, /performance\.now/,
                  /\bdocument\./, /\bwindow\./, /requestAnimationFrame/, /\bfetch\(/];
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
  const offenders = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const re of banned) if (re.test(src)) offenders.push(`${f}: ${re}`);
  }
  check(`no banned API in ${files.length} core/replay files`, offenders.length === 0, offenders.join(', '));
}

// ---------------------------------------------------------------- §10.2 invariants
group('Game invariants across many seeds (§10.2)');
{
  const seeds = ['20261105', 'alpha', 'bravo', 'charlie', '42', '777', '9001', 'squeek', 'hamster', 'crown', '0', '4294967295'];
  let oneWinner = true, hpOk = true, deadActs = true, itemsOk = true, crownOk = true,
      bounded = true, cooldownOk = true, validAll = true;
  const stats = { duration: [], kills: [], crown: 0, zoneDeaths: 0, fleeShare: [] };
  for (const seed of seeds) {
    const { manifest, ruleset } = buildManifest({ seed, botCount: 100 });
    const rep = simulate(manifest, ruleset);
    const v = validateReplay(rep);
    if (!v.ok) { validAll = false; console.log('      ' + seed + ': ' + v.problems.join('; ')); }

    const last = rep.snapshots[rep.snapshots.length - 1];
    let alive = 0;
    for (let i = 0; i < 100; i++) if (last[i * 6 + 3] & 1) alive++;
    if (alive !== 1) oneWinner = false;
    if (rep.result.winnerId < 0) oneWinner = false;

    for (const f of rep.snapshots) {
      for (let i = 0; i < 100; i++) {
        const hp = f[i * 6 + 2];
        if (hp > rep.initial.bots[i].maxHp || hp < 0) hpOk = false;
      }
    }
    const death = new Map();
    const picked = new Set();
    let holders = 0;
    for (const ev of rep.events) {
      if (ev.type === EV.DEATH) death.set(ev.a, ev.t);
      if (ev.type === EV.PICKUP) { if (picked.has(ev.b)) itemsOk = false; picked.add(ev.b); }
      if ((ev.type === EV.ATTACK || ev.type === EV.PICKUP || ev.type === EV.DASH) && death.has(ev.a) && ev.t > death.get(ev.a)) deadActs = false;
      if (ev.type === EV.CROWN_CREATE || ev.type === EV.CROWN_TRANSFER || ev.type === EV.CROWN_PICKUP) holders++;
      if (ev.type === EV.ZONE_DAMAGE) stats.zoneDeaths += 0;
    }
    for (const f of rep.snapshots) {
      let h = 0;
      for (let i = 0; i < 100; i++) if (f[i * 6 + 3] & 4) h++;
      if (h > 1) crownOk = false;
    }
    if (rep.result.endTick > ruleset.zone.hardLimitTicks + 200) bounded = false;
    stats.duration.push(rep.result.durationSeconds);
    stats.kills.push(rep.result.standings[0].kills);
    stats.crown += rep.result.crownHistory.length;

    // FLEE share of recorded decisions.
    let flee = 0, tot = 0;
    for (let o = 0; o < rep.decisions.length; o += 11) { tot++; if (rep.decisions[o + 2] === ACT_FLEE) flee++; }
    if (tot) stats.fleeShare.push(flee / tot);
  }
  check(`exactly one winner in all ${seeds.length} seeds`, oneWinner);
  check('validateReplay passes for every seed', validAll);
  check('HP never exceeds maxHp and never goes negative', hpOk);
  check('no dead bot acts after its death tick', deadActs);
  check('no item is picked up twice', itemsOk);
  check('never two Crown holders in one snapshot', crownOk);
  check('every match ends inside hardLimitTicks', bounded);

  const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length);
  console.log(`      duration avg ${avg(stats.duration).toFixed(1)}s (min ${Math.min(...stats.duration)}, max ${Math.max(...stats.duration)})`);
  console.log(`      winner kills avg ${avg(stats.kills).toFixed(1)} · crown changes total ${stats.crown}`);
  console.log(`      FLEE share of decisions avg ${(avg(stats.fleeShare) * 100).toFixed(1)}%`);
  check('AI does not spend most of its time fleeing (§10.3)', avg(stats.fleeShare) < 0.25, `${(avg(stats.fleeShare) * 100).toFixed(1)}%`);
  check('matches last long enough to watch (>45s avg)', avg(stats.duration) > 45);
}

// ---------------------------------------------------------------- §4.9 tie-breaks
group('Deterministic tie-breaks (§4.9)');
{
  // Everyone dies on the same tick -> SIMULTANEOUS_FINAL_TIEBREAK restores exactly one.
  const { manifest, ruleset } = buildManifest({ seed: 1234, botCount: 50 });
  const sim = new Sim(manifest, ruleset);
  for (let k = 0; k < 40; k++) sim.step();
  for (let i = 0; i < sim.N; i++) {
    if (!sim.alive[i]) continue;
    sim.alive[i] = 0; sim.hp[i] = 0; sim.deathTick[i] = sim.tick; sim.rank[i] = sim.aliveCount; sim.aliveCount--;
  }
  sim._phaseEndCondition(sim.tick);
  let aliveAfter = 0;
  for (let i = 0; i < sim.N; i++) if (sim.alive[i]) aliveAfter++;
  check('all-dead tick restores exactly one winner', sim.ended && aliveAfter === 1 && sim.winnerId >= 0);
  check('tie-break is reported as an event', sim.recorder.events.some((e) => e.type === EV.TIEBREAK && e.b === 0));
  check('restored winner has 1 HP and reason SIMULTANEOUS', sim.hp[sim.winnerId] === HP_SCALE && sim.endReason === 'simultaneousFinalTiebreak');

  // Two independent Sims reaching the same all-dead state pick the same winner.
  const mk = () => { const s = new Sim(manifest, ruleset); for (let k = 0; k < 40; k++) s.step();
    for (let i = 0; i < s.N; i++) { if (!s.alive[i]) continue; s.alive[i] = 0; s.hp[i] = 0; s.deathTick[i] = s.tick; s.rank[i] = s.aliveCount; s.aliveCount--; }
    s._phaseEndCondition(s.tick); return s.winnerId; };
  check('all-dead tie-break is reproducible', mk() === mk() && mk() === sim.winnerId);

  // Hard timeout with many bots still alive -> HARD_TIMEOUT_TIEBREAK leaves one.
  const sim2 = new Sim(buildManifest({ seed: 55, botCount: 50 }).manifest, ruleset);
  for (let k = 0; k < 30; k++) sim2.step();
  sim2._phaseEndCondition(ruleset.zone.hardLimitTicks);
  let alive2 = 0;
  for (let i = 0; i < sim2.N; i++) if (sim2.alive[i]) alive2++;
  check('hard timeout leaves exactly one winner', sim2.ended && alive2 === 1 && sim2.endReason === 'hardTimeoutTiebreak');
}

// ---------------------------------------------------------------- gameplay rules
group('Gameplay rules wired to the whitepaper');
{
  const { manifest, ruleset } = buildManifest({ seed: 20261105, botCount: 100 });
  const rep = simulate(manifest, ruleset);
  // Checked on the initial state, before a single tick runs.
  const fresh = new Sim(manifest, ruleset);
  let armedAtSpawn = 0, onTopOfLoot = 0;
  for (let i = 0; i < fresh.N; i++) {
    if (fresh.weapon[i] >= 0) armedAtSpawn++;
    for (const it of fresh.items) {
      if (it.cons >= 0) continue;                 // healing items may sit near a spawn
      const dx = (fresh.px[i] / 256 | 0) - it.x, dy = (fresh.py[i] / 256 | 0) - it.y;
      if (dx * dx + dy * dy < ruleset.bot.pickupRadius * ruleset.bot.pickupRadius) { onTopOfLoot++; break; }
    }
  }
  check('all 100 bots spawn unarmed (§4.1 / D06)', armedAtSpawn === 0);
  check('no bot spawns standing on a weapon', onTopOfLoot === 0, `${onTopOfLoot} bots`);
  const first = rep.snapshots[0];
  let armedTick0 = 0;
  for (let i = 0; i < 100; i++) if (first[i * 6 + 4] >= 0) armedTick0++;
  check('nobody is armed at the end of tick 0 either', armedTick0 === 0, `${armedTick0} armed`);
  check('9 weapons: the 8 of §4.3 + Seed Sling (v1.1, disabled)', WEAPONS.length === 9 && WEAPONS[8].id === 'seed_sling' && WEAPONS[8].disabled &&
    ['dagger', 'sword', 'axe', 'spear', 'hammer', 'bow', 'crossbow', 'magic_staff'].every((id, k) => WEAPONS[k].id === id));
  check('every weapon id is unique', new Set(WEAPONS.map((w) => w.id)).size === WEAPONS.length);

  const create = rep.events.find((e) => e.type === EV.CROWN_CREATE);
  check('Crown is created at the 3rd kill (§4.5)', !create || create.b === ruleset.crown.killsToCrown, create ? `kills=${create.b}` : 'no crown this seed');

  // A Crown transfer must fully heal the new King on the same tick.
  const transfer = rep.events.find((e) => e.type === EV.CROWN_TRANSFER);
  if (transfer) {
    const maxHp = rep.initial.bots[transfer.b].maxHp;
    check('killing the King grants the Crown + 100% heal', transfer.c === maxHp, `hp=${transfer.c} max=${maxHp}`);
  } else check('killing the King grants the Crown + 100% heal', true, '(no transfer in this seed)');

  const a = appearanceFor(20261105, 7), b = appearanceFor(20261105, 7);
  check('cosmetic recipe is deterministic per (seed, botId)', JSON.stringify(a) === JSON.stringify(b));
  check('cosmetics do not leak into the result hash', (() => {
    const r2 = simulate(manifest, ruleset);
    return r2.result.resultHash === rep.result.resultHash;
  })());

  const types = new Set(rep.events.map((e) => EV_NAME[e.type]));
  const required = ['SPAWN', 'PICKUP', 'ATTACK', 'HIT', 'DAMAGE', 'DEATH', 'KILL', 'ZONE_PHASE', 'DASH', 'MATCH_END'];
  check('event log covers the required types (§6.5)', required.every((t) => types.has(t)), [...types].join(','));
}


// ---------------------------------------------------------------- v1.1 weapons + healing
group('v1.1 — weapon signatures and healing items');
{
  // A controlled duel: bot 0 holds the weapon under test, the others stand in reach.
  const duel = (weaponId, { botCount = 2, setup, seed = 'duel-' + weaponId } = {}) => {
    const { manifest, ruleset } = buildManifest({ seed, botCount: 100 });
    manifest.config = { ...manifest.config, botCount, recordDecisions: false };
    const sim = new Sim(manifest, ruleset);
    sim.items.forEach((it) => { it.taken = true; });
    for (let i = 0; i < sim.N; i++) {
      sim.px[i] = (5400 + i * 40) * FP; sim.py[i] = 5400 * FP;
      sim.dodgeSkill[i] = 0; sim.aimSkill[i] = 950; sim.armor[i] = 0;
    }
    sim.weapon[0] = WEAPON_INDEX[weaponId];
    if (setup) setup(sim);
    for (let t = 0; t < 400 && !sim.ended; t++) {
      for (let i = 0; i < sim.N; i++) if (sim.alive[i]) sim.speed[i] = 1;
      sim.action[0] = ACT_ATTACK; sim.target[0] = 1; sim.actionUntil[0] = 1e9; sim.actionStarted[0] = sim.tick;
      sim.step();
    }
    return { sim, events: sim.recorder.events };
  };

  {
    // fixed seed with open ground at the duel spot (on some seeds a prop pushes the pair apart)
    const { events } = duel('dagger', { seed: 'duel-melee-a', setup: (s) => { s.px[1] = s.px[0] + 24 * FP; } });
    const atk = events.filter((e) => e.type === EV.ATTACK && e.a === 0);
    const blows = events.filter((e) => (e.type === EV.HIT || (e.type === EV.MISS && e.e === 0)) && e.a === 0 && e.b === 1);
    check('melee: every swing resolves exactly one blow', atk.length > 0 && Math.abs(blows.length - atk.length) <= 1, `swings ${atk.length} blows ${blows.length}`);
  }
  {
    // v1.3.1: Twin Claws, Thorn Whip, Cheese Bomb and Reaper Scythe are gone, with their mechanics.
    const gone = ['twin_claws', 'thorn_whip', 'cheese_bomb', 'reaper_scythe'];
    check('removed weapons are gone: no id, no stats, no art',
      gone.every((id) => WEAPON_INDEX[id] === undefined && !existsSync(`src/assets/agy/weapons/icon_${id}.png`) && !existsSync(`src/assets/agy/weapons/weapon_${id}_right.png`)));
    check('no weapon carries a signature mechanic any more (hits / slow / splash / cleave / lifesteal)',
      WEAPONS.every((w) => !w.hits && !w.slowTicks && !w.splashR && !w.cleave && !w.lifesteal));
    const files = HAS_ART ? readdirSync('src/assets/agy/weapons') : [];
    if (HAS_ART) check('weapon art is right-facing only (left = the same image mirrored in game)',
      WEAPONS.every((w) => files.includes(`weapon_${w.id}_right.png`)) && !files.some((f) => /_left\.png$/.test(f)), files.filter((f) => /_left/.test(f)).join(','));
  }

  // Healing: a hurt bot with a bag eats/drinks; HP rises; the bag empties.
  {
    const { manifest, ruleset } = buildManifest({ seed: 'heal-test', botCount: 100 });
    manifest.config = { ...manifest.config, botCount: 2, recordDecisions: false };
    const sim = new Sim(manifest, ruleset);
    sim.px[1] = sim.px[0] + 4000 * FP;                               // nobody near: safe to drink
    sim.hp[0] = 60 * HP_SCALE;
    sim._bagAdd(0, CONSUMABLE_INDEX.honey_milk);
    sim._bagAdd(0, CONSUMABLE_INDEX.sunflower_seed);
    for (let t = 0; t < 60; t++) sim.step();
    const ev = sim.recorder.events;
    check('a hurt bot uses a healing item from its bag', ev.some((e) => e.type === EV.CONSUME && e.a === 0 && e.d === 1));
    check('healing raises HP and never above maxHp', sim.hp[0] > 60 * HP_SCALE && sim.hp[0] <= sim.maxHp[0], `hp ${sim.hp[0] / HP_SCALE}`);
    check('used items leave the bag', sim.bagCount[0] < 2);
  }
  {
    // Honey Milk is interruptible: a hit during the channel cancels it and keeps the item.
    const { manifest, ruleset } = buildManifest({ seed: 'heal-interrupt', botCount: 100 });
    manifest.config = { ...manifest.config, botCount: 2, recordDecisions: false };
    const sim = new Sim(manifest, ruleset);
    sim.px[1] = sim.px[0] + 4000 * FP;
    sim.hp[0] = 60 * HP_SCALE;
    sim._bagAdd(0, CONSUMABLE_INDEX.honey_milk);
    let started = false;
    for (let t = 0; t < 40 && !started; t++) { sim.step(); started = sim.useLeft[0] > 0; }
    sim.damageQueue.push({ prio: 1, attacker: 1, targetId: 0, amount: 5 * HP_SCALE, weapon: 0, stun: 0, seq: 0 });
    sim._phaseApplyDamage(sim.tick);
    check('Honey Milk channel is interrupted by a hit (item kept)', started && sim.useLeft[0] === 0 && sim.bagCount[0] === 1 &&
      sim.recorder.events.some((e) => e.type === EV.CONSUME && e.d === 2));
  }
  {
    // Full matches: consumables are picked up, used, dropped on death; bags never overflow.
    let picked = 0, used = 0, dropped = 0, bagOk = true, disabledSeen = 0;
    for (const seed of ['20261105', 'alpha', 'bravo', 'charlie']) {
      const { manifest, ruleset } = buildManifest({ seed, botCount: 100 });
      const rep = simulate(manifest, ruleset);
      for (const e of rep.events) {
        if (e.type === EV.CONSUMABLE_PICKUP) picked++;
        if (e.type === EV.CONSUME && e.d === 1) used++;
        if (e.type === EV.DROP && e.c < 0) dropped++;
        // The v1.1 weapons are temporarily switched off: they must never reach a paw.
        if ((e.type === EV.PICKUP || e.type === EV.SUPPLY_SPAWN || e.type === EV.SUPPLY_OPEN) && WEAPONS[e.type === EV.SUPPLY_SPAWN ? e.d : e.c]?.disabled) disabledSeen++;
        if (e.type === EV.KILL && WEAPONS[e.d]?.disabled) disabledSeen++;
      }
      for (const f of rep.snapshots) for (let i = 0; i < 100; i++) {
        if (((f[i * 6 + 3] >> F_BAG_SHIFT) & F_BAG_MASK) > ruleset.loot.bagSlots) bagOk = false;
      }
    }
    check('healing items get picked up and used in real matches', picked > 100 && used > 100, `picked ${picked} used ${used}`);
    check('a dead bot drops its bag as ground loot', dropped > 0, `${dropped} dropped`);
    check('bag never holds more than bagSlots items', bagOk);
    check('disabled weapons never spawn, get picked up or kill', disabledSeen === 0, `${disabledSeen} sightings`);
    check('every loot table gives disabled weapons weight 0', ['standard', 'brawler', 'sniper'].every((id) => {
      const rs = resolveRuleset(id);
      return WEAPONS.every((w, k) => !w.disabled || (!rs.loot.tierWeights[k] && !rs.loot.supplyTierWeights[k]));
    }));
  }
}

// ---------------------------------------------------------------- map
group('Map — landmarks, props and decoration from the AGY map pack');
{
  const { manifest, ruleset } = buildManifest({ seed: '20261105', botCount: 100 });
  const rep = simulate(manifest, ruleset);
  const obs = rep.initial.obstacles;
  const count = (k) => obs.filter((o) => o.kind === k).length;
  const L = ruleset.world.landmarks;
  check('buildings and trees are placed as solid landmarks', count(OBSTACLE_KIND.building) === L.buildings && count(OBSTACLE_KIND.tree) === L.trees,
    `${count(OBSTACLE_KIND.building)} buildings, ${count(OBSTACLE_KIND.tree)} trees`);
  check('all four small prop kinds appear (rock, crate, bush, stump), no reserved walls', [0, 1, 2, 3].every((k) => count(k) > 100) && count(OBSTACLE_KIND.wall) === 0);
  check('every obstacle maps to an art variant', obs.every((o) => Number.isInteger(o.v) && o.v >= 0 &&
    o.v < [PROP_VARIANTS, PROP_VARIANTS, PROP_VARIANTS, PROP_VARIANTS, PROP_VARIANTS, TREE_VARIANTS, BUILDING_VARIANTS][o.kind]));
  let gapOk = true;
  for (let i = 0; i < obs.length && gapOk; i++) for (let j = i + 1; j < obs.length; j++) {
    const a = obs[i], b = obs[j], m = a.r + b.r + ruleset.world.obstacleMinGap;
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 < m * m) { gapOk = false; break; }
  }
  check('every obstacle keeps obstacleMinGap from every other (steering relies on it)', gapOk);
  check('ids are the index into the obstacle list', obs.every((o, i) => o.id === i));
  const d = rep.initial.decor;
  check('decor: ponds (with lilies, some bridged) and flower patches', d && d.ponds.length > 10 && d.flowers.length > 100 &&
    d.ponds.some((p) => p.bridge) && d.ponds.every((p) => p.lilies.length >= 2));
  // Decoration is cosmetic: generating it again must not change the match.
  const again = simulate(manifest, ruleset);
  check('decor is deterministic and outside the result', JSON.stringify(again.initial.decor) === JSON.stringify(d) && again.replayHash === rep.replayHash);
  const art = (dir, n) => existsSync(join('src/assets/agy', `${dir}.png`)) ? 0 : 1;
  const missing = [
    ...['rock', 'crate', 'bush', 'stump'].flatMap((f) => Array.from({ length: 10 }, (_, i) => `map/${f}_${String(i + 1).padStart(2, '0')}`)),
    'map/tree_green_large', 'map/tree_autumn_large', 'map/tree_green_medium', 'map/tree_autumn_medium',
    'map/building_cheese_windmill', 'map/building_hamster_cottage',
    'map/chest_paw_closed', 'map/chest_paw_open', 'map/foliage_daisy_patch', 'map/terrain_wooden_bridge',
    ...['meadow_green', 'forest_moss', 'autumn_gold', 'sandy_dirt', 'cobblestone', 'sunset_clay', 'lavender_twilight',
        'snow_frost', 'cheese_cream', 'dark_slate'].map((g) => `map/ground_${g}`),
    ...Array.from({ length: 4 }, (_, i) => `storm/storm_cloud_0${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `storm/cat_eyes_0${i + 1}`),
    ...Array.from({ length: 6 }, (_, i) => `storm/cat_tail_0${i + 1}`),
  ].filter((k) => art(k));
  if (HAS_ART) check('every map + storm PNG the renderer asks for exists', missing.length === 0, missing.slice(0, 4).join(', '));
  const layers = [];
  for (const id of OUTFIT_BODY) layers.push(`hamster/outfits/body_${id}`);
  for (const id of HEADWEAR) layers.push(`hamster/outfits/head_${id}`);
  for (const id of OUTFIT_BACK) layers.push(`hamster/accessories/back_${id}`);
  const missingLayers = layers.flatMap((l) => ['left', 'right'].map((f) => `${l}_${f}`)).filter((k) => art(k));
  if (HAS_ART) check('every outfit in the cosmetic catalogue has left + right art', missingLayers.length === 0, missingLayers.slice(0, 4).join(', '));
}

// ---------------------------------------------------------------- runtime liveness
// ---------------------------------------------------------------- v1.2 rules
group('v1.2 — score, first-blood Crown, parachute drop, treasure chests');
{
  const seeds = ['20261105', 'alpha', 'bravo'];
  let scoreOk = true, crownOk = true, landOk = true, chestOk = true, chestsOpened = 0, crownKills = 0;
  for (const seed of seeds) {
    const { manifest, ruleset } = buildManifest({ seed, botCount: 100 });
    const rep = simulate(manifest, ruleset);
    const K = ruleset.score.killValueLP;
    const ev = rep.events;
    for (const st of rep.result.standings) {
      if (st.score !== st.livePoints + K * st.killPoints || st.killPoints < st.kills) scoreOk = false;
      const lived = (st.deathTick >= 0 ? st.deathTick : rep.result.endTick) / TICK_HZ;
      if (st.livePoints < Math.floor(lived) - 1) scoreOk = false;           // >= 1 point per second alive
    }
    const firstKill = ev.find((e) => e.type === EV.KILL);
    const create = ev.find((e) => e.type === EV.CROWN_CREATE);
    if (!firstKill || !create || create.t !== firstKill.t || create.a !== firstKill.a) crownOk = false;
    crownKills += ev.filter((e) => e.type === EV.CROWN_TRANSFER).length;
    // Parachute: every bot lands exactly once, at its landTick, and does nothing before it.
    const landed = new Map();
    for (const e of ev) if (e.type === EV.LAND) landed.set(e.a, e.t);
    rep.initial.bots.forEach((b) => { if (landed.get(b.id) !== b.landTick) landOk = false; });
    for (const e of ev) {
      if ((e.type === EV.ATTACK || e.type === EV.PICKUP || e.type === EV.DASH || e.type === EV.CONSUMABLE_PICKUP) &&
          e.t < rep.initial.bots[e.a].landTick) landOk = false;
    }
    // Chests: each opens at most once, only for a hurt hamster, healing at most chestHeal.
    const opened = new Set();
    for (const e of ev) {
      if (e.type !== EV.CHEST_OPEN) continue;
      chestsOpened++;
      if (opened.has(e.b) || e.c <= 0 || e.c > ruleset.loot.chestHeal * HP_SCALE) chestOk = false;
      opened.add(e.b);
    }
  }
  check('score = live points + K x kill points, >= 1 live point per second alive', scoreOk);
  check('first blood takes the Crown (same tick, same bot)', crownOk);
  check('Crown changes hands by killing its holder in real matches', crownKills > 0, `${crownKills} crown kills`);
  check('every hamster parachutes in and acts only after landing', landOk);
  check('treasure chests open once, for a hurt hamster, healing <= chestHeal', chestOk && chestsOpened > 10, `${chestsOpened} opened`);
}

group('v1.2 — engagement rules (fight, chase the weak, answer attackers, hit and run)');
{
  // A hand-placed skirmish: bot 0 decides; bots are already on the ground.
  const setup = (n, place) => {
    const { manifest, ruleset } = buildManifest({ seed: 'engage-test', botCount: 100 });
    manifest.config = { ...manifest.config, botCount: n, recordDecisions: false };
    const sim = new Sim(manifest, ruleset);
    sim.tick = 800;
    for (let i = 0; i < n; i++) {
      sim.landTick[i] = 0; sim.weapon[i] = WEAPON_INDEX.sword; sim.caution[i] = 500; sim.aggression[i] = 500;
      sim.px[i] = 5400 * FP; sim.py[i] = 5400 * FP;
    }
    place(sim);
    sim._buildGrid();
    return sim;
  };
  {
    const sim = setup(3, (s) => { s.px[1] += 150 * FP; s.px[2] -= 240 * FP; s.hp[2] = (s.maxHp[2] * 20) / 100 | 0; });
    strategicDecision(sim, 0, 800);
    check('kill steal: a nearly dead enemy passing by is taken over a healthy nearer one', sim.action[0] === ACT_ATTACK && sim.target[0] === 2,
      `${ACTIONS[sim.action[0]]} -> ${sim.target[0]}`);
  }
  {
    const sim = setup(3, (s) => { s.px[1] += 140 * FP; s.px[2] -= 260 * FP; s.crown[2] = 1; s.crownHolder = 2; s.leaderId = 2; });
    strategicDecision(sim, 0, 800);
    check('the Crown holder (leader) is focused before an equal nearer enemy', sim.target[0] === 2, `${ACTIONS[sim.action[0]]} -> ${sim.target[0]}`);
  }
  {
    const sim = setup(3, (s) => {
      s.px[1] += 120 * FP; s.px[2] -= 380 * FP; s.hp[2] = (s.maxHp[2] * 50) / 100 | 0;
      s.action[0] = ACT_HUNT; s.target[0] = 2; s.actionUntil[0] = 9999;          // mid-chase, committed
      s.action[1] = ACT_ATTACK; s.target[1] = 0;                                 // bot 1 comes for bot 0
    });
    strategicDecision(sim, 0, 800);
    check('chasing, a closer enemy attacks: turn and fight it at once', sim.action[0] === ACT_ATTACK && sim.target[0] === 1,
      `${ACTIONS[sim.action[0]]} -> ${sim.target[0]}`);
  }
  {
    const sim = setup(2, (s) => {
      s.px[1] += 150 * FP; s.hp[0] = (s.maxHp[0] * 40) / 100 | 0; s.caution[0] = 900; s.weapon[1] = WEAPON_INDEX.hammer;
      s.action[1] = ACT_ATTACK; s.target[1] = 0;
    });
    strategicDecision(sim, 0, 800);
    check('a chaser with more HP: the weaker bot runs', sim.action[0] === ACT_FLEE && sim.target[0] === 1, `${ACTIONS[sim.action[0]]} -> ${sim.target[0]}`);
  }
  {
    // Hit and run: a bow user falls back while reloading.
    const sim = setup(2, (s) => { s.weapon[0] = WEAPON_INDEX.bow; s.weapon[1] = -1; s.px[1] += 140 * FP; s.stun[1] = 100000; });
    let fired = 0, reload = 0, away = 0;
    const backD = (WEAPONS[WEAPON_INDEX.bow].range * sim.ruleset.ai.kiteRetreatPermille) / 1000;
    for (let t = 0; t < 200 && sim.alive[1]; t++) {
      const before = Math.hypot(sim.px[0] - sim.px[1], sim.py[0] - sim.py[1]) / FP;
      const reloading = sim.atkCd[0] > 2 && sim.windup[0] === 0 && before < backD;
      sim.step();
      if (sim.recorder.events.some((e) => e.type === EV.ATTACK && e.a === 0 && e.t === sim.tick - 1)) fired++;
      if (reloading && sim.action[0] === ACT_ATTACK) {
        reload++;
        const after = Math.hypot(sim.px[0] - sim.px[1], sim.py[0] - sim.py[1]) / FP;
        if (after > before) away++;
      }
    }
    check('ranged hit and run: shoots, then backs off while reloading', fired >= 2 && reload > 10 && away >= reload * 0.8, `${fired} shots, ${away}/${reload} reload ticks moving away`);
  }
  {
    // Shared kills: two hamsters already chase the Crown holder and are closer to it.
    const sim = setup(4, (s) => {
      s.crown[3] = 1; s.crownHolder = 3; s.leaderId = 3;
      s.px[3] += 300 * FP; s.px[1] += 220 * FP; s.px[2] += 200 * FP; s.py[2] += 60 * FP; s.py[0] += 400 * FP;
      for (const k of [1, 2]) { s.action[k] = ACT_HUNT; s.target[k] = 3; }
    });
    sim._phaseStrategic(sim.tick);              // builds the chase lists, then decides (bot 0 on its turn)
    strategicDecision(sim, 0, 800);
    check('two closer hamsters already chase the Crown: a third does not join', sim.target[0] !== 3, `${ACTIONS[sim.action[0]]} -> ${sim.target[0]}`);
  }
  {
    // Never turn your back: chasing someone far away while an enemy walks right next to us.
    const sim = setup(3, (s) => {
      s.px[2] += 700 * FP; s.hp[2] = (s.maxHp[2] * 40) / 100 | 0;              // weak prey, far
      s.px[1] -= 110 * FP;                                                        // equal enemy, adjacent
      s.action[0] = ACT_HUNT; s.target[0] = 2;
    });
    strategicDecision(sim, 0, 800);
    check('an enemy right next to us is fought before a far target', sim.action[0] === ACT_ATTACK && sim.target[0] === 1,
      `${ACTIONS[sim.action[0]]} -> ${sim.target[0]}`);
  }
  {
    let contacts = 0, passive = 0, escorts = 0, maxChasers = 0;
    for (const seed of ['20261105', 'alpha']) {
      const r = checkCombat({ seed, botCount: 100 });
      contacts += r.contacts; passive += r.passive; escorts += r.escorts; maxChasers = Math.max(maxChasers, r.maxChasers);
    }
    check('hamsters in contact fight: < 12% of 1s+ contacts with nobody fighting', passive < contacts * 0.12,
      `${passive}/${contacts} passive (${((passive * 100) / Math.max(1, contacts)).toFixed(1)}%)`);
    check('no escorts: < 8% of contacts are side-by-side chasers of one target', escorts < contacts * 0.08,
      `${escorts}/${contacts} escort pairs, max ${maxChasers} chasers on one target`);
  }
}

group('v1.2.1 — round arena, ~2-minute matches');
{
  let inside = true, roundStart = true, durations = [];
  for (const seed of ['20261105', 'alpha', 'bravo']) {
    const { manifest, ruleset } = buildManifest({ seed, botCount: 100 });
    const sim = new Sim(manifest, ruleset);
    const cx = ruleset.world.width >> 1, cy = ruleset.world.height >> 1, R = ruleset.zone.lootRadius;
    const inR = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
    for (const it of sim.items) if (!inR(it.x, it.y)) inside = false;
    for (const c of sim.chests) if (!inR(c.x, c.y)) inside = false;
    for (let i = 0; i < sim.N; i++) if (!inR(sim.px[i] / FP | 0, sim.py[i] / FP | 0)) inside = false;
    if (ruleset.zone.startRadius > Math.min(ruleset.world.width, ruleset.world.height) / 2) roundStart = false;
    durations.push(simulate(manifest, ruleset).result.endTick / TICK_HZ);
  }
  check('the arena is round from tick 0: the Cat Storm already covers the corners', roundStart);
  check('weapons, healing items, chests and landing spots are all inside the round arena', inside);
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  check('a match lasts about two minutes (90-150 s)', avg >= 90 && avg <= 150, `avg ${avg.toFixed(0)} s`);
}

// ---------------------------------------------------------------- v1.3 genome + match plan
group('v1.3 / v1.4 — hamster stats from equipment, random drop points, pre-planned map');
{
  const sum = (o) => STAT_KEYS.reduce((a, k) => a + o[k], 0);
  check('every body piece is worth 10 stat points', Object.values(ITEM_STATS.body).every((o) => sum(o) === 10));
  check('every hat / back piece is worth 6, an empty slot 4',
    ['head', 'back'].every((s) => Object.entries(ITEM_STATS[s]).every(([k, o]) => sum(o) === (k === 'none' ? 4 : 6))));
  check('every catalogue item has a stat entry',
    OUTFIT_BODY.every((k) => ITEM_STATS.body[k]) && HEADWEAR.every((k) => ITEM_STATS.head[k]) && OUTFIT_BACK.every((k) => ITEM_STATS.back[k]));

  const dnas = Array.from({ length: 40 }, (_, i) => demoDna('genome', i));
  const t0 = traitsOf(dnas[0]);
  check('traitsOf is a pure function of DNA', JSON.stringify(traitsOf(dnas[0])) === JSON.stringify(t0));
  check('stats = base 6 + the three equipped items', dnas.every((d) => {
    const t = traitsOf(d);
    const items = [ITEM_STATS.body[OUTFIT_BODY[t.body]], ITEM_STATS.head[HEAD_KEYS[t.head]], ITEM_STATS.back[BACK_KEYS[t.back]]];
    return STAT_KEYS.every((k) => t.stats[k] === STAT_BASE + items[0][k] + items[1][k] + items[2][k]);
  }));
  check('DNA words decode exactly (word k = bits 16k..16k+15)', dnaWord('0x' + '0'.repeat(56) + '00030002', 0) === 2 && dnaWord('0x' + '0'.repeat(56) + '00030002', 1) === 3);
  const lo = combatParams({ str: 6, agi: 6, arm: 6, vit: 6, per: 6 }), hi = combatParams({ str: 18, agi: 20, arm: 19, vit: 17, per: 21 });
  check('stats drive the match: STR dmg, AGI speed/dodge/attack rate, ARM, VIT HP, PER aim/awareness',
    hi.strMul > lo.strMul && hi.moveSpeed > lo.moveSpeed && hi.dodgeSkill > lo.dodgeSkill && hi.atkCdMul < lo.atkCdMul &&
    hi.armor > lo.armor && hi.maxHpUnits > lo.maxHpUnits && hi.aimSkill > lo.aimSkill && hi.awareness > lo.awareness,
    JSON.stringify({ lo, hi }));

  // NFT-style arena (v1.4): entrants are just hamsters — nobody chooses a drop point.
  const ents = Array.from({ length: 24 }, (_, i) => ({ dna: demoDna('nft', i), tokenId: 100 + i }));
  let refused = 0;
  for (const bad of [{ drop: [5400, 5400] }, { drop: { x: 1, y: 2 } }, { cell: 650 }]) {
    try { buildManifest({ seed: '0xfeedbeef', entrants: ents.map((e, i) => (i === 3 ? { ...e, ...bad } : e)) }); } catch { refused++; }
  }
  check('choosing a drop point is refused (drop or cell on any entrant throws)', refused === 3, `${refused}/3 refused`);
  const A = buildManifest({ seed: '0xfeedbeef', entrants: ents });
  const runs = [0, 1, 2].map(() => simulate(A.manifest, A.ruleset));
  check('entrant match: 3 runs give identical replayHash / resultHash / planHash',
    runs.every((r) => r.replayHash === runs[0].replayHash && r.result.resultHash === runs[0].result.resultHash && r.result.planHash === runs[0].result.planHash));
  check('entrant match replay validates (landing + supply plan checks)', validateReplay(runs[0]).ok, JSON.stringify(validateReplay(runs[0]).problems));
  const plan = planMatch(A.manifest, A.ruleset);
  check('planHash can be rebuilt before the match from (seed, entrants) alone', plan.planHash === runs[0].result.planHash);
  const B = buildManifest({ seed: '0xfeedbeef', entrants: [ents[1], ents[0], ...ents.slice(2)] });
  check('entrant order is part of the MatchKey', B.manifest.matchKey !== A.manifest.matchKey);
  const C = buildManifest({ seed: '0xfeedbeee', entrants: ents });
  check('a different seed gives a different plan', planMatch(C.manifest, C.ruleset).planHash !== plan.planHash);

  const bots = runs[0].initial.bots;
  check('same DNA = same hamster in any match (stats/equipment ignore the seed)',
    JSON.stringify(planMatch(C.manifest, C.ruleset).bots.map((b) => [b.stats, b.equipment, b.maxHp, b.strMul])) === JSON.stringify(plan.bots.map((b) => [b.stats, b.equipment, b.maxHp, b.strMul])));
  const R = dropRadiusOf(A.ruleset), cx = A.ruleset.world.width / 2, gap = A.ruleset.world.spawnMinGap;
  check('every random drop point lies inside the drop circle', bots.every((b) => (b.spawnX - cx) ** 2 + (b.spawnY - cx) ** 2 <= R * R));
  check('random drop points keep the spawn gap (no two hamsters stacked)',
    bots.every((a2, i) => bots.every((b2, j) => i >= j || (a2.spawnX - b2.spawnX) ** 2 + (a2.spawnY - b2.spawnY) ** 2 >= gap * gap)));
  check('no drop point inside a prop', bots.every((b) => plan.obstacles.every((o) => (o.x - b.spawnX) ** 2 + (o.y - b.spawnY) ** 2 >= (o.r + 34) ** 2)));
  {
    const pC = planMatch(C.manifest, C.ruleset);
    const moved = pC.drops.filter((d, i) => d[0] !== plan.drops[i][0] || d[1] !== plan.drops[i][1]).length;
    check('drop points come from the seed: same entrants, another seed -> they land elsewhere', moved >= ents.length - 1, `${moved}/${ents.length} moved`);
    check('same seed + same entrants -> the very same drop points', JSON.stringify(planMatch(A.manifest, A.ruleset).drops) === JSON.stringify(plan.drops));
  }
  const lands = runs[0].events.filter((e) => e.type === EV.LAND);
  check('every hamster lands exactly on its planned point at its planned tick',
    lands.length === ents.length && lands.every((e) => e.b === plan.drops[e.a][0] && e.c === plan.drops[e.a][1] && e.t === plan.landTicks[e.a]));
  const sim = new Sim(A.manifest, A.ruleset);
  check('ground loot and chests start exactly where the plan put them',
    JSON.stringify(sim.items.map((i) => [i.id, i.x, i.y, i.weapon, i.cons])) === JSON.stringify(plan.items.map((i) => [i.id, i.x, i.y, i.weapon, i.cons])) &&
    JSON.stringify(sim.chests.map((c) => [c.x, c.y])) === JSON.stringify(plan.chests.map((c) => [c.x, c.y])));
  const sup = runs[0].events.filter((e) => e.type === EV.SUPPLY_SPAWN);
  check('supply crates fall exactly where and when planned', sup.length > 0 && sup.every((e) => {
    const c = plan.supplies[e.a]; return c.tick === e.t && c.x === e.b && c.y === e.c; }));

  // STR and ARM in the damage formula.
  sim.damageQueue.push({ prio: 1, attacker: 0, targetId: 1, amount: 1000, weapon: -1, stun: 0, seq: 0 });
  const hp0 = sim.hp[1];
  sim._phaseApplyDamage(0);
  const want = ((((1000 * sim.strMul[0]) / 100) | 0) * (100 - sim.armor[1])) / 100 | 0;
  check('damage = base x attacker STR% x (100 - target armor)%', hp0 - sim.hp[1] === want, `${hp0 - sim.hp[1]} vs ${want}`);
  const tokenIds = runs[0].result.standings.map((s) => s.tokenId).sort();
  check('standings carry the NFT tokenId of every entrant', tokenIds.length === 24 && tokenIds.every((t) => t !== null));
}

// ---------------------------------------------------------------- NFT arena glue
group('NFT arena — on-chain arena -> manifest -> points (src/chain/arena-manifest.js)');
{
  const glue = await import('../src/chain/arena-manifest.js');
  const arena = glue.normaliseArena({ closeBlock: 40n, seedBlock: 42n, seededAt: 2n, maxEntrants: 50n, entrantCount: 4n, claimedCount: 0n,
    preset: 1n, status: 2n, pot: 400000000000000n, seed: '0x' + '3c'.repeat(32), pointsRoot: '0x' + '0'.repeat(64),
    rewardPool: 0n, totalPoints: 0n, paidOut: 0n, resultHash: '0x0000000000000000', replayHash: '0x0000000000000000', settledBlock: 0n });
  const raw = [0, 1, 2, 3].map((i) => ({ tokenId: BigInt(10 + i), player: '0xAbC' + i, claimed: false }));
  const dnas = [0, 1, 2, 3].map((i) => BigInt(demoDna('glue', i)));
  const entries = glue.normaliseEntries(raw, dnas);
  check('status / preset / entries decode from contract structs', arena.status === 'Seeded' && arena.seedPinned && entries[2].tokenId === '12' && entries[0].dna.length === 66);
  {
    const open = { ...arena, status: 'Open' };
    check('phaseOf: entries close at a block, the seed exists once the seed block is mined',
      glue.phaseOf(open, 39) === 'Open' && glue.phaseOf(open, 40) === 'Closed' && glue.phaseOf(open, 42) === 'Closed' && glue.phaseOf(open, 43) === 'Revealed'
      && glue.phaseOf({ ...open, entrantCount: 1 }, 50) === 'Closed' && glue.phaseOf(arena, 50) === 'Seeded');
  }
  {
    const proofs = await import('../src/chain/proofs.js');
    const pts = [7, 120, 0, 55, 3];
    const t = proofs.pointsTree(pts);
    const verify = (i, p, proof) => { let h = proofs.leafOf(i, p); for (const sib of proof) h = BigInt(h) < BigInt(sib) ? keccakPair(h, sib) : keccakPair(sib, h); return h.toLowerCase() === t.root; };
    const { ethers } = await import('../src/vendor/ethers.min.js');
    function keccakPair(a, b) { return ethers.keccak256(ethers.concat([a, b])); }
    check('Merkle proofs: every entry verifies, a wrong points value or index does not',
      pts.every((p, i) => verify(i, p, t.proof(i))) && !verify(0, 8, t.proof(0)) && !verify(1, 7, t.proof(0)) && t.total === 185);
    check('bytes8 hashes round-trip through the contract format', glue.bytes32ToHash(proofs.hashToBytes8('0123456789abcdef')) === '0123456789abcdef');
  }
  const input = glue.manifestInputFromArena({ chainId: 31337, contract: '0xC0', arenaId: 7, arena, entries });
  check('an on-chain entry carries no position; the manifest gets none either',
    entries.every((e) => !('x' in e) && !('cell' in e)) && input.entrants.every((e) => !('drop' in e) && !('cell' in e)));
  {
    const planA = glue.planOfArena({ chainId: 31337, contract: '0xC0', arenaId: 7, arena, entries });
    check('planOfArena: the seeded arena gives every entry a drop point; no seed, no plan',
      planA && planA.drops.length === 4 && glue.planOfArena({ chainId: 31337, contract: '0xC0', arenaId: 7, arena: { ...arena, seed: '0x' + '0'.repeat(64) }, entries }) === null);
  }
  const M1 = buildManifest(input), M2 = buildManifest(glue.manifestInputFromArena({ chainId: 31337, contract: '0xc0', arenaId: 7, arena, entries }));
  check('same arena -> same MatchKey (provenance is not part of it)', M1.manifest.matchKey === M2.manifest.matchKey && M1.manifest.config.presetId === 'brawler');
  const r = simulate(M1.manifest, M1.ruleset);
  const pts = glue.pointsFromResult(r.result);
  check('points are listed in join order and equal each hamster\'s score',
    pts.length === 4 && r.result.standings.every((s) => pts[s.botId] === s.score && s.tokenId === entries[s.botId].tokenId));
  check('bytes32 <-> 64-bit hash round trip', glue.bytes32ToHash(glue.hashToBytes32(r.result.resultHash)) === r.result.resultHash);
  const settled = { ...arena, status: 'Settled', rewardPool: 360000000000000n, totalPoints: BigInt(pts.reduce((a, b) => a + b, 0)) };
  const rw = glue.rewardsOf(settled, entries.map((e, i) => ({ ...e, points: pts[i] })));
  check('rewards = 90 % pool x points / total, never more than the pool', rw.reduce((a, b) => a + b, 0n) <= settled.rewardPool && settled.rewardPool - rw.reduce((a, b) => a + b, 0n) < 4n);
  let threw = false; try { glue.manifestInputFromArena({ chainId: 1, contract: '0x', arenaId: 0, arena: { ...arena, seed: '0x' + '0'.repeat(64) }, entries }); } catch { threw = true; }
  check('an arena without a seed cannot be simulated', threw);
}

group('Runtime liveness — no hamster freezes mid-match (every preset, many bot counts)');
{
  const seeds = defaultSeeds(Number((argv.indexOf('--liveness-seeds') >= 0 && argv[argv.indexOf('--liveness-seeds') + 1]) || 4));
  const counts = [2, 3, 8, 50, 100];
  let matches = 0, stalls = 0, errors = 0, unfinished = 0;
  const firstBad = [];
  for (const presetId of ['standard', 'brawler', 'sniper']) {
    for (const botCount of counts) {
      for (const seed of seeds) {
        const r = checkMatch({ seed, botCount, presetId });
        matches++;
        stalls += r.stallCount;
        if (r.error) errors++;
        if (!r.ended || r.winnerId < 0) unfinished++;
        if ((r.stallCount || r.error || !r.ended) && firstBad.length < 3) firstBad.push(`${presetId}/${botCount}/${seed}: ${r.error || ''} ${JSON.stringify(r.stalls[0] || {})}`);
      }
    }
  }
  console.log(`      ${matches} matches · ${stalls} stalls · ${errors} errors · ${unfinished} unfinished`);
  check('every match runs to a single winner without throwing', errors === 0 && unfinished === 0, firstBad.join(' | '));
  check('no alive hamster stands still doing nothing for 3s+', stalls === 0, firstBad.join(' | '));
}

// ---------------------------------------------------------------- scale
group('Scale check — 200 bots still deterministic and valid (§9)');
{
  const { manifest, ruleset } = buildManifest({ seed: 20261105, botCount: 200 });
  const s0 = Date.now();
  const r1 = simulate(manifest, ruleset);
  const ms = Date.now() - s0;
  const r2 = simulate(manifest, ruleset);
  check('200 bots: two runs give the same hash', r1.replayHash === r2.replayHash);
  check('200 bots: replay validates', validateReplay(r1).ok);
  console.log(`      200 bots simulated in ${ms} ms, ${r1.result.durationSeconds}s match, ${r1.events.length} events`);
}

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m  (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
process.exit(fail === 0 ? 0 : 1);
