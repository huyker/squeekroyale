// Utility AI — layer 1 (strategic, 5 Hz). Scores the seven whitepaper actions 0..100,
// applies stickiness / minimum commitment / hysteresis, and records the full trace.
import { ACT_ZONE, ACT_FLEE, ACT_ATTACK, ACT_LOOT, ACT_SUPPLY, ACT_HUNT, ACT_ROAM, FP } from './constants.js';
import { WEAPONS, specOf } from './ruleset.js';
import { flen, clamp } from './fixed.js';

const scratch = new Int32Array(7);

/** Effective combat power of bot i (integer, arbitrary scale). Used for win-probability. */
export function powerOf(sim, i) {
  const w = sim.weapon[i];
  const spec = specOf(w);
  const perSwing = spec.damage;
  const dps = ((perSwing * sim.strMul[i]) / Math.max(1, sim.cdTicksOf(w))) | 0;     // STR scales damage
  const hpFrac = (sim.hp[i] * 100 / sim.maxHp[i]) | 0;          // 0..100
  const armorMul = 100 + sim.armor[i];
  const reach = spec.range;
  return (((dps + 24) * (hpFrac + 20) * armorMul) / 10000 | 0) + (reach >> 3) + (sim.aimSkill[i] / 60 | 0);
}

/** powerOf, cached per tick (it only reads per-bot state that a decision never changes). */
function powerNow(sim, i) {
  if (!sim._powTick || sim._powTick.length !== sim.N) { sim._powTick = new Int32Array(sim.N).fill(-1); sim._pow = new Int32Array(sim.N); }
  if (sim._powTick[i] !== sim.tick) { sim._pow[i] = powerOf(sim, i); sim._powTick[i] = sim.tick; }
  return sim._pow[i];
}

/** Win probability of i against j, per-mille. */
export function winProb(sim, i, j) {
  const pi = powerNow(sim, i), pj = powerNow(sim, j);
  const tot = pi + pj;
  return tot <= 0 ? 500 : clamp(((pi * 1000) / tot) | 0, 0, 1000);
}

export function strategicDecision(sim, i, tick) {
  const s = scratch;
  s.fill(0);
  const rs = sim.ruleset;
  const ai = sim.aiOf(i);
  const xu = sim.px[i] / FP | 0, yu = sim.py[i] / FP | 0;
  const hpPermille = (sim.hp[i] * 1000 / sim.maxHp[i]) | 0;

  // --- ZONE ----------------------------------------------------------------
  const zoneNow = sim.zone;
  const zoneSoon = sim.zoneSoon;                       // 6s lookahead
  const dNow = flen(xu - zoneNow.cx, yu - zoneNow.cy);
  const dSoon = flen(xu - zoneSoon.cx, yu - zoneSoon.cy);
  const outsideNow = Math.max(0, dNow - zoneNow.r);
  const outsideSoon = Math.max(0, dSoon - zoneSoon.r);
  let zoneScore = 0;
  if (outsideNow > 0) {
    // Lethality: how much of our HP the walk back would cost.
    const ticksBack = (outsideNow * 20 * FP) / Math.max(1, sim.speed[i] * 20) | 0;
    const cost = (zoneNow.dps * ticksBack) / 20 | 0;
    zoneScore = clamp(ai.scoreZoneBase + ((cost * 1000) / Math.max(1, sim.hp[i] / 100)) | 0, ai.scoreZoneBase, 100);
  } else if (outsideSoon > 0) {
    zoneScore = clamp(34 + ((outsideSoon * 40) / Math.max(1, zoneSoon.r)) | 0, 34, 86);
  } else if (dNow > (zoneNow.r * 820) / 1000) {
    zoneScore = 18;
  }
  s[ACT_ZONE] = zoneScore;
  // A goal outside the circle-to-be is a trip into the storm and straight back out. Without
  // this discount a bot at the edge flip-flops: SUPPLY walks it out, ZONE (an emergency)
  // walks it back in, and once inside SUPPLY wins again — standing still for good.
  const stormPenalty = (gx, gy) => {
    if (zoneSoon.dps <= 0 && zoneNow.dps <= 0) return 0;
    const out = flen(gx - zoneSoon.cx, gy - zoneSoon.cy) - zoneSoon.r;
    return out <= 0 ? 0 : 18 + Math.min(60, (out * 80) / Math.max(1, zoneSoon.r) | 0);
  };

  // --- threat / target scan -------------------------------------------------
  // Late game the survivors are further apart than their awareness radius, so the scan
  // widens with the closing zone — otherwise the last few bots never find each other.
  const scanR = sim.aliveCount <= 16
    ? Math.max(sim.awareness[i] + 140, Math.min(2800, sim.zone.r + 260))
    : sim.awareness[i] + 140;
  const threat = sim.lastAttacker[i] >= 0 && sim.alive[sim.lastAttacker[i]] &&
                 tick - sim.lastAttackedTick[i] < 60 ? sim.lastAttacker[i] : -1;
  const myW = sim.weapon[i];

  // Rivals: other hamsters already going for j (ATTACK/HUNT, as of the start of this tick)
  // that are closer to j than we are. Kill points go only to the one who lands the last
  // blow, so our expected share of that kill is 1 / (1 + rivals); at maxRivals we leave j
  // to them. The closest chaser always sees 0, so it keeps going and nobody flip-flops.
  const distTo = (a, b) => flen((sim.px[a] - sim.px[b]) / FP | 0, (sim.py[a] - sim.py[b]) / FP | 0);
  const rivalsOn = (j) => {
    const list = j >= 0 && sim.chaseLists ? sim.chaseLists.get(j) : null;
    if (!list) return 0;
    const mine = distTo(i, j);
    let n = 0;
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      if (c !== i && sim.alive[c] && distTo(c, j) < mine) n++;
    }
    return n;
  };

  // --- one pass over the neighbours: nearest enemy, closest attacker, best prey ---------
  // (Same results as sim.nearestEnemy + a second scan, at half the cost.)
  let nearId = -1, nearD2 = Infinity;
  let attacker = -1, attackerD = 1 << 30;      // closest enemy actively going for me
  let prey = -1, preyScore = -(1 << 30), preyD = 0, preyKs = false;
  const reach2 = (scanR + 1) * (scanR + 1);
  sim.forEachNear(xu, yu, scanR, (j) => {
    if (j === i || !sim.alive[j]) return;
    const dx = (sim.px[j] - sim.px[i]) / FP | 0, dy = (sim.py[j] - sim.py[i]) / FP | 0;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearD2 || (d2 === nearD2 && j < nearId)) { nearD2 = d2; nearId = j; }
    if (d2 >= reach2) return;
    const d = flen(dx, dy);
    if (d > scanR) return;
    const onMe = j === threat ||
      (sim.target[j] === i && (sim.action[j] === ACT_ATTACK || sim.action[j] === ACT_HUNT) && d < ai.engageRange + 120);
    if (onMe && (d < attackerD || (d === attackerD && j < attacker))) { attacker = j; attackerD = d; }
    if (myW < 0) return;
    // Prey: an enemy with less HP than us, one we clearly out-gun, a nearly dead one
    // passing by (kill steal), or the leader (crown holder / most kills).
    const hpDiff = ((sim.hp[i] - sim.hp[j]) * 100 / sim.maxHp[i]) | 0;          // % of our max HP
    const ks = (sim.hp[j] * 100 / sim.maxHp[j] | 0) < ai.ksHpPercent;
    const leader = j === sim.leaderId;
    const wpj = winProb(sim, i, j);
    if (hpDiff <= 0 && !ks && !(leader && wpj >= ai.leaderMinWinProbPermille) && wpj < ai.preyWinProbPermille) return;
    const rivals = rivalsOn(j);
    if (rivals >= ai.maxRivals) return;                       // already taken care of by others
    const sc = Math.max(0, hpDiff) - ((d * 60) / scanR | 0) + (j === sim.target[i] ? 25 : 0) +
               (ks ? ai.ksBonus : 0) + (leader ? ai.leaderBonus : 0) - rivals * ai.rivalPenalty;
    if (sc > preyScore || (sc === preyScore && j < prey)) { prey = j; preyScore = sc; preyD = d; preyKs = ks && d < ai.ksRange; }
  });
  const enemy = nearId < 0 ? { id: -1, d: 0 } : { id: nearId, d: Math.floor(Math.sqrt(nearD2)) };
  // Set when we are losing to the nearest enemy (the FLEE gate minus its distance check).
  let feared = -1;

  if (enemy.id >= 0) {
    const wp = winProb(sim, i, enemy.id);
    if (hpPermille < ai.fleeHpPermille && wp < ai.fleeWinProbPermille) feared = enemy.id;
    const distPen = (enemy.d * 100) / Math.max(1, ai.engageRange) | 0;

    // --- ATTACK -------------------------------------------------------------
    if (myW >= 0 || enemy.d < 90) {
      let v = 34 + ((sim.aggression[i] * 34) / 1000 | 0) + (((wp - 500) * 46) / 500 | 0) - (distPen >> 1);
      if (enemy.d > ai.engageRange) v -= 28;
      if (myW < 0) v -= 22;                                  // bare paws: engage, but prefer looting
      if (sim.crownHolder === enemy.id) v += rs.crown.huntBonus >> 1;
      s[ACT_ATTACK] = clamp(v, 0, 100);
    }

    // --- HUNT ---------------------------------------------------------------
    let hv = 16 + ((sim.aggression[i] * 26) / 1000 | 0) + (((wp - 500) * 24) / 500 | 0) - (distPen >> 2);
    if (myW < 0) hv -= 30;
    if (sim.crownHolder >= 0 && sim.crownHolder !== i) {
      const ck = sim.crownHolder;
      const cd = flen((sim.px[ck] - sim.px[i]) / FP | 0, (sim.py[ck] - sim.py[i]) / FP | 0);
      const kr = rivalsOn(ck);
      if (cd < rs.crown.huntRange && kr < ai.maxRivals) {
        const kwp = winProb(sim, i, ck);
        hv += (((rs.crown.huntBonus * (rs.crown.huntRange - cd)) / rs.crown.huntRange | 0) / (1 + kr) | 0)
            + (((kwp - 500) * 20) / 500 | 0);
      }
    }
    // Finish the wounded — kill-steal pressure, risk adjusted.
    if (sim.hp[enemy.id] * 100 / sim.maxHp[enemy.id] < 40 && enemy.d < ai.engageRange) hv += 18;
    s[ACT_HUNT] = clamp(hv, 0, 100);

    // --- FLEE (gated: HP < 50% AND win probability < 40%) -------------------
    if (hpPermille < ai.fleeHpPermille && wp < ai.fleeWinProbPermille && enemy.d < ai.engageRange) {
      let fv = 42 + ((sim.caution[i] * 28) / 1000 | 0) + (((500 - hpPermille) * 30) / 500 | 0);
      // Anti-coward: after fleeMaxTicks of running without breaking contact, make a stand.
      if (sim.fleeSince[i] >= 0 && tick - sim.fleeSince[i] > ai.fleeMaxTicks && enemy.d < 240) {
        fv -= 60; s[ACT_ATTACK] = clamp(s[ACT_ATTACK] + 30, 0, 100);
      }
      s[ACT_FLEE] = clamp(fv, 0, 100);
    }
  }
  if (threat >= 0 && s[ACT_ATTACK] < 20 && myW >= 0) s[ACT_ATTACK] = 20;

  // --- combat picture: who is coming for me, who is worth chasing ------------
  // Targets per action; by default the nearest enemy, overridden by the rules below.
  let atkT = enemy.id, huntT = enemy.id, fleeT = enemy.id >= 0 ? enemy.id : threat;

  // Rule: an armed enemy in our face gets fought, whatever we were doing.
  if (enemy.id >= 0 && myW >= 0 && enemy.d < ai.contactRange) {
    s[ACT_ATTACK] = clamp(s[ACT_ATTACK] + ai.contactBonus, 0, 100);
  }
  // Rule 2: prefer chasing a weaker enemy (less HP than us).
  if (prey >= 0) {
    const pv = 50 + ((sim.aggression[i] * 18) / 1000 | 0) + clamp(preyScore >> 1, 0, 25) - ((preyD * 20) / Math.max(1, scanR) | 0);
    if (preyD <= ai.engageRange) {
      if (pv + 6 > s[ACT_ATTACK]) { s[ACT_ATTACK] = clamp(pv + 6, 0, 100); atkT = prey; }
    } else if (pv > s[ACT_HUNT]) { s[ACT_HUNT] = clamp(pv, 0, 100); huntT = prey; }
  }
  // Rules 2.1 / 2.2: someone closer is coming for us — turn and fight, or run if they
  // have more HP than we do and the odds are against us.
  if (attacker >= 0) {
    const wa = winProb(sim, i, attacker);
    const curD = atkT >= 0 ? flen((sim.px[atkT] - sim.px[i]) / FP | 0, (sim.py[atkT] - sim.py[i]) / FP | 0) : 1 << 30;
    if ((myW >= 0 || attackerD < 90) && (attackerD <= curD || s[ACT_ATTACK] < 40)) {
      const rv = 62 + ((sim.aggression[i] * 20) / 1000 | 0) + (((wa - 500) * 30) / 500 | 0) - (myW < 0 ? 20 : 0);
      s[ACT_ATTACK] = Math.max(s[ACT_ATTACK], clamp(rv, 0, 100));
      atkT = attacker;
      s[ACT_HUNT] = Math.max(0, s[ACT_HUNT] - 30);           // stop chasing someone further away
    }
    if (sim.hp[attacker] > sim.hp[i] && wa < ai.fleeVsChaserPermille) {
      const fv = 46 + ((sim.caution[i] * 30) / 1000 | 0) + (((sim.hp[attacker] - sim.hp[i]) * 30) / sim.maxHp[i] | 0) +
                 (myW < 0 && sim.weapon[attacker] >= 0 ? 20 : 0);
      if (fv > s[ACT_FLEE]) { s[ACT_FLEE] = clamp(fv, 0, 100); fleeT = attacker; }
    }
  }

  // Discount for a goal that is a bad trip: into the storm, or within reach of the enemy we
  // are running from. The latter used to flip-flop at the edge of engageRange: FLEE carried
  // the bot just out of range, LOOT walked it straight back toward the enemy, repeat.
  const goalPenalty = (gx, gy) => {
    let p = stormPenalty(gx, gy);
    if (feared >= 0) {
      const fd = flen(gx - (sim.px[feared] / FP | 0), gy - (sim.py[feared] / FP | 0));
      if (fd < ai.engageRange) p += 34;
    }
    return p;
  };

  // --- LOOT (weapon upgrade OR a healing item, whichever scores higher) -----
  let item = sim.nearestUsefulItem(i, ai.lootMaxRange, false);
  let lv = 0;
  if (item.id >= 0) {
    const distPen = (item.d * 46) / ai.lootMaxRange | 0;
    if (myW < 0) lv = 74 + ((sim.lootingBias[i] * 18) / 1000 | 0) - distPen;
    else {
      const gain = WEAPONS[sim.items[item.id].weapon].tier - WEAPONS[myW].tier;
      lv = 22 + gain * 9 + ((sim.lootingBias[i] * 14) / 1000 | 0) - distPen;
    }
    lv -= goalPenalty(sim.items[item.id].x, sim.items[item.id].y);
  }
  const food = sim.nearestUsefulItem(i, (ai.lootMaxRange * 2) / 3 | 0, true);
  if (food.id >= 0) {
    // Worth more when hurt and when the bag is empty; never outranks arming up from bare paws.
    const missingPm = 1000 - hpPermille;
    const distPen = (food.d * 50) / ai.lootMaxRange | 0;
    let fv = ai.consumableLootBase + ((missingPm * 40) / 1000 | 0) + (sim.bagSlots - sim.bagCount[i]) * 4 +
             ((sim.lootingBias[i] * 10) / 1000 | 0) - distPen;
    if (myW < 0) fv -= 20;
    fv -= goalPenalty(sim.items[food.id].x, sim.items[food.id].y);
    if (fv > lv) { lv = fv; item = food; }
  }
  // Treasure chest: the cheese inside heals at once, no bag slot needed — only worth a
  // detour when hurt.
  let chest = { id: -1, d: 0 };
  const missingPm = 1000 - hpPermille;
  if (missingPm >= 150) {
    const c = sim.nearestChest(i, (ai.lootMaxRange * 2) / 3 | 0);
    if (c.id >= 0) {
      const cv = ai.consumableLootBase + 6 + ((missingPm * 55) / 1000 | 0) + ((sim.lootingBias[i] * 10) / 1000 | 0) -
                 ((c.d * 50) / ai.lootMaxRange | 0) - goalPenalty(sim.chests[c.id].x, sim.chests[c.id].y) - (myW < 0 ? 20 : 0);
      if (item.id < 0 || cv > lv) { lv = cv; chest = c; }
    }
  }
  if (item.id >= 0 || chest.id >= 0) {
    if (enemy.id >= 0 && enemy.d < 200) lv -= 24;             // not while someone is on top of us
    s[ACT_LOOT] = clamp(lv, 0, 100);
  }

  // --- SUPPLY ---------------------------------------------------------------
  const sup = sim.nearestSupply(i, ai.supplyMaxRange);
  if (sup.id >= 0) {
    const distPen = (sup.d * 40) / ai.supplyMaxRange | 0;
    let sv = 36 + ((sim.lootingBias[i] * 16) / 1000 | 0) - distPen;
    if (myW < 0) sv += 20;
    if (hpPermille < 600) sv += 14;                            // crates heal
    if (enemy.id >= 0 && enemy.d < 260) sv -= (sim.caution[i] * 24) / 1000 | 0;
    sv -= goalPenalty(sim.supplies[sup.id].x, sim.supplies[sup.id].y);
    s[ACT_SUPPLY] = clamp(sv, 0, 100);
  }

  // --- ROAM -----------------------------------------------------------------
  s[ACT_ROAM] = ai.scoreRoamBase + ((sim.aggression[i] * 6) / 1000 | 0);

  // Phase shaping: gear up while the circle is wide, commit once it is the final few.
  // Never turn your back on an enemy right next to you: if the target we would go for is
  // clearly further away than an armed-or-not enemy within contactRange, that neighbour is
  // fought first. Two hamsters walking side by side after the same third one end up
  // fighting each other instead of escorting each other.
  if (enemy.id >= 0 && myW >= 0 && enemy.d < ai.contactRange) {
    const farther = (j) => j >= 0 && j !== enemy.id && distTo(i, j) > enemy.d + ai.backTurnMargin;
    const huntFar = s[ACT_HUNT] > 0 && farther(huntT);
    if (farther(atkT) || huntFar) {
      atkT = enemy.id;
      s[ACT_ATTACK] = Math.max(s[ACT_ATTACK], ai.adjacentFightScore + ((sim.aggression[i] * 20) / 1000 | 0));
      if (huntFar) s[ACT_HUNT] = Math.max(0, s[ACT_HUNT] - 40);
    }
  }

  // Cornered: the one we would run from is already in our face and hitting us. In a crowd
  // running only hands out free hits (and jams the bot in place) — turn and fight.
  if (s[ACT_FLEE] > 0 && fleeT >= 0 && fleeT === threat && sim.alive[fleeT]) {
    const fd = flen((sim.px[fleeT] - sim.px[i]) / FP | 0, (sim.py[fleeT] - sim.py[i]) / FP | 0);
    if (fd < ai.corneredRange) {
      s[ACT_FLEE] = Math.max(0, s[ACT_FLEE] - 40);
      if (s[ACT_ATTACK] < 60) { s[ACT_ATTACK] = 60; atkT = fleeT; }
    }
  }

  // --- the goal: score = live points + K x kill points --------------------------
  // Fighting j is worth  P(win) x K x killMul(j)  and risks  P(lose) x the live points we
  // still expect to earn by staying alive. That one trade-off is what makes a hamster
  // fight the weak, run from the strong, focus the Crown (killMul 2) and play safer while
  // wearing it (live points x2).
  const sc = rs.score;
  if (sc && sc.killValueLP > 0) {
    const lastEnd = rs.zone.phases[rs.zone.phases.length - 1].end;
    const liveRate = sc.livePerSecond * (sim.crown[i] ? sc.crownLiveMul : 1);
    const remainS = Math.max(ai.minRemainSeconds, ((lastEnd - tick) / 20) | 0);
    const R = Math.max(1, (remainS * liveRate * ai.lifeValuePermille) / 1000 | 0);   // live points at stake
    const ev = (j) => {
      if (j < 0) return 0;
      const wp = winProb(sim, i, j);
      // a kill shared with closer rivals is worth 1 / (1 + rivals) to us
      const gain = (wp * sc.killValueLP * sc.killPoints * (sim.crown[j] ? sc.crownKillMul : 1)) / (1000 * (1 + rivalsOn(j))) | 0;
      const loss = ((1000 - wp) * R) / 1000 | 0;
      return clamp(((gain - loss) * 100) / Math.max(1, gain + loss), -100, 100);    // -100..100
    };
    if (s[ACT_ATTACK] > 0) s[ACT_ATTACK] = clamp(s[ACT_ATTACK] + ((ev(atkT) * ai.evWeight) / 100 | 0), 0, 100);
    if (s[ACT_HUNT] > 0) s[ACT_HUNT] = clamp(s[ACT_HUNT] + ((ev(huntT) * ai.evWeight) / 100 | 0), 0, 100);
    if (s[ACT_FLEE] > 0) s[ACT_FLEE] = clamp(s[ACT_FLEE] - ((ev(fleeT) * ai.evWeight) / 100 | 0), 0, 100);
  }

  // (Fights already on top of us are never discounted — only long chases wait.)
  if (tick < ai.lootPhaseTicks) {
    s[ACT_HUNT] = Math.max(0, s[ACT_HUNT] - ai.lootPhaseAttackPenalty);
    if (attacker < 0 && enemy.d > ai.contactRange) s[ACT_ATTACK] = Math.max(0, s[ACT_ATTACK] - (ai.lootPhaseAttackPenalty >> 1));
  }
  if (sim.aliveCount <= ai.endgameAlive) {
    if (s[ACT_ATTACK] > 0) s[ACT_ATTACK] = clamp(s[ACT_ATTACK] + ai.endgameAggro, 0, 100);
    if (s[ACT_HUNT] > 0) s[ACT_HUNT] = clamp(s[ACT_HUNT] + ai.endgameAggro, 0, 100);
    s[ACT_SUPPLY] = Math.max(0, s[ACT_SUPPLY] - 20);
    s[ACT_ROAM] = Math.max(0, s[ACT_ROAM] - 6);
  }

  // --- selection ------------------------------------------------------------
  const cur = sim.action[i];
  const emergency = outsideNow > 0 ||
    (cur === ACT_ATTACK && (sim.target[i] < 0 || !sim.alive[sim.target[i]])) ||
    (cur === ACT_HUNT && (sim.target[i] < 0 || !sim.alive[sim.target[i]])) ||
    (cur === ACT_LOOT && (sim.chestTarget[i] >= 0 ? sim.chests[sim.chestTarget[i]].opened
                                                   : (sim.lootTarget[i] < 0 || sim.items[sim.lootTarget[i]].taken))) ||
    (cur === ACT_SUPPLY && (sim.supplyTarget[i] < 0 || sim.supplies[sim.supplyTarget[i]].taken)) ||
    (tick - sim.actionStarted[i]) > ai.maxActionTicks ||
    // Rule 2.1 reacts now, not after the commitment window: a new attacker closes in.
    (attacker >= 0 && sim.target[i] !== attacker && attackerD < ai.engageRange) ||
    // Kill steal: a nearly dead enemy walks past — grab it now.
    (preyKs && myW >= 0 && prey !== sim.target[i]);
  // Below 25% HP every decision may change course (to run, to heal) — but keeps a little
  // inertia, unlike the hard emergencies above (dead target, timeout, out of the zone).
  const lowHp = hpPermille < 250;

  let best = ACT_ROAM, bestScore = -1;
  for (let a = 0; a < 7; a++) {
    let v = s[a];
    // Inertia for the current action, if it is still worth anything. A hard emergency gets
    // none; low HP keeps a little — with none, a bot at < 25% HP flip-flopped ATTACK <-> LOOT
    // forever as its prey alternately fled and came back for the same item.
    if (a === cur && s[a] > 0 && !emergency) v += lowHp ? ai.hysteresis * 2 : ai.stickiness;
    if (v > bestScore) { bestScore = v; best = a; }           // ties resolve to lowest action id
  }
  if (!emergency && !lowHp && tick < sim.actionUntil[i]) best = cur;     // minimum commitment
  if (!emergency && best !== cur && s[cur] > 0 && s[best] < s[cur] + ai.hysteresis) best = cur;

  // --- bind the chosen action to a concrete target --------------------------
  let target = -1;
  if (best === ACT_ATTACK || best === ACT_HUNT) {
    target = best === ACT_ATTACK ? atkT : huntT;
    if (best === ACT_HUNT && huntT !== prey && sim.crownHolder >= 0 && sim.crownHolder !== i) {
      const ck = sim.crownHolder;
      const cd = flen((sim.px[ck] - sim.px[i]) / FP | 0, (sim.py[ck] - sim.py[i]) / FP | 0);
      if (cd < rs.crown.huntRange && (enemy.id < 0 || cd < enemy.d * 2) && rivalsOn(ck) < ai.maxRivals) target = ck;
    }
    if (target < 0) best = ACT_ROAM;
  } else if (best === ACT_FLEE) {
    target = fleeT;
    if (target < 0) best = ACT_ROAM;
  }

  sim.action[i] = best;
  sim.target[i] = target;
  sim.lootTarget[i] = best === ACT_LOOT && chest.id < 0 ? item.id : -1;
  sim.chestTarget[i] = best === ACT_LOOT && chest.id >= 0 ? chest.id : -1;
  sim.supplyTarget[i] = best === ACT_SUPPLY ? sup.id : -1;
  if (best !== cur || (tick - sim.actionStarted[i]) > ai.maxActionTicks) {
    sim.actionUntil[i] = tick + ai.minCommitTicks;
    sim.actionStarted[i] = tick;
  }
  sim.fleeSince[i] = best === ACT_FLEE ? (cur === ACT_FLEE && sim.fleeSince[i] >= 0 ? sim.fleeSince[i] : tick) : -1;

  sim.recorder.decision(tick, i, best, target, s);
  return best;
}
