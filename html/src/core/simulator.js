// Headless deterministic simulator. No DOM, no Date, no performance, no Math.random.
// One tick = 11 fixed phases (whitepaper §6.3). Simulate(MatchKey) is a pure function.
import {
  FP, HP_SCALE, TICK_HZ, SNAPSHOT_EVERY, STRATEGIC_EVERY, EV, ANIM,
  SNAP_STRIDE, S_X, S_Y, S_HP, S_FLAGS, S_WEAPON, S_ANIM,
  F_ALIVE, F_FACE_LEFT, F_CROWN, F_DASH, F_STUN, F_ATTACK,
  F_CONSUMING, F_HOT, F_HASTE, F_BAG_SHIFT,
  ACT_ZONE, ACT_FLEE, ACT_ATTACK, ACT_LOOT, ACT_SUPPLY, ACT_HUNT, ACT_ROAM,
  SIMULATOR_VERSION, REPLAY_SCHEMA_VERSION,
} from './constants.js';
import { WEAPONS, UNARMED, CONSUMABLES, specOf } from './ruleset.js';
import { substream } from './rng.js';
import { flen, flen2, fnorm, clamp, trunc } from './fixed.js';
import { generateDecor } from './world.js';
import { zoneAt } from './zone.js';
import { planMatch } from './plan.js';
import { strategicDecision, powerOf } from './ai.js';
import { Recorder } from './recorder.js';
import { hashObject } from './hash.js';

const GRID_CELL = 300; // world units
const ITEM_CELL = 1200; // coarse grid for ground items (world units)

export class Sim {
  constructor(manifest, ruleset) {
    this.manifest = manifest;
    this.ruleset = ruleset;
    this.seed = manifest.seed;
    this.N = manifest.config.botCount;
    this.tick = 0;
    this.ended = false;
    this.winnerId = -1;
    this.endReason = '';

    // --- RNG substreams: one per domain so changes never cross-contaminate.
    this.rngCombat = substream(this.seed, 'combat');
    this.rngLoot = substream(this.seed, 'loot');
    this.rngRoam = substream(this.seed, 'roam');

    // --- world: everything fixed before tick 0 comes from the match plan (plan.js).
    // The sim copies what it mutates; the plan itself is never written to.
    const plan = this.plan = planMatch(manifest, ruleset);
    this.obstacles = plan.obstacles;
    this.maxObstacleR = this.obstacles.reduce((m, o) => Math.max(m, o.r), ruleset.world.obstacleMaxR);
    this.spawns = plan.drops.map(([x, y]) => ({ x, y }));
    this.botDefs = plan.bots;
    this.items = plan.items.map((it) => ({ ...it }));
    this.supplies = [];
    this.supplyPlan = plan.supplies;
    this.chests = plan.chests.map((c) => ({ ...c }));
    this.zoneSchedule = plan.zoneSchedule;

    this.weaponCdTicks = WEAPONS.map((w) => Math.max(1, Math.round(w.cooldown * TICK_HZ)));
    this.unarmedCdTicks = Math.max(1, Math.round(UNARMED.cooldown * TICK_HZ));
    this.cdTicksOf = (w) => (w >= 0 ? this.weaponCdTicks[w] : this.unarmedCdTicks);

    this._initBots();
    this._initObstacleGrid();

    this.projectiles = [];
    this.nextProjectileId = 0;
    this.damageQueue = [];
    this.dmgSeq = 0;

    this.crownHolder = -1;
    this.leaderId = -1;
    this.crownGround = null;      // { x, y } in world units
    this.crownHistory = [];

    this.aliveCount = this.N;
    this.recorder = new Recorder(this.N, manifest.config.recordDecisions);
    this.zone = zoneAt(this.zoneSchedule, ruleset, 0);
    this.zoneSoon = zoneAt(this.zoneSchedule, ruleset, 120);
    this.lastZonePhase = -1;

    for (let i = 0; i < this.N; i++) {
      this.recorder.event(0, EV.SPAWN, i, this.px[i] / FP | 0, this.py[i] / FP | 0, 0, 0);
    }
  }

  _initBots() {
    const N = this.N, rs = this.ruleset;
    const i32 = () => new Int32Array(N);
    this.px = i32(); this.py = i32(); this.vx = i32(); this.vy = i32();
    this.hp = i32(); this.maxHp = i32();
    this.alive = new Uint8Array(N); this.facing = new Int8Array(N);
    this.weapon = new Int8Array(N);
    this.atkCd = i32(); this.windup = i32(); this.windupTarget = i32();
    this.dashCd = i32(); this.dashLeft = i32(); this.dashVx = i32(); this.dashVy = i32();
    this.stun = i32();
    this.kills = i32(); this.dmgDealt = i32(); this.dmgTaken = i32();
    // Score: live points in ticks x multiplier (/TICK_HZ = seconds), kill points (crown kills x2).
    this.liveTicks = i32(); this.killPts = i32();
    this.landTick = Int32Array.from(this.plan.landTicks);     // planned touch-down tick per bot
    this.deathTick = i32(); this.rank = i32(); this.crown = new Uint8Array(N);
    this.action = new Int8Array(N); this.actionUntil = i32(); this.actionStarted = i32(); this.target = i32();
    this.lootTarget = i32(); this.supplyTarget = i32(); this.fleeSince = i32(); this.chestTarget = i32();
    this.anchorX = i32(); this.anchorY = i32(); this.anchorT = i32();          // jam safety net
    this.unstickLeft = i32(); this.unstickVx = i32(); this.unstickVy = i32();
    this.anim = new Int8Array(N); this.animUntil = i32();
    this.roamX = i32(); this.roamY = i32(); this.roamUntil = i32();
    this.lastAttacker = i32(); this.lastAttackedTick = i32();
    this.lastDamageBy = i32(); this.lastDamageTick = i32();
    this.speed = i32(); this.aggression = i32(); this.caution = i32();
    this.aimSkill = i32(); this.dodgeSkill = i32(); this.lootingBias = i32();
    this.awareness = i32(); this.armor = i32(); this.atkCdMul = i32(); this.strMul = i32();
    this.openingSupply = i32(); this.openingTicks = i32();
    // v1.1 status: 3-slot consumable bag, channel, heal-over-time, slow, haste.
    this.bagSlots = rs.loot.bagSlots || 3;
    this.bag = new Int8Array(N * this.bagSlots).fill(-1);
    this.bagCount = new Uint8Array(N);
    this.useLeft = i32(); this.useItem = i32(); this.useSlot = i32();
    this.hotLeft = i32(); this.hotPerTick = i32();
    this.hasteLeft = i32(); this.hastePct = i32();
    this.healed = i32(); this.itemsUsed = i32();

    for (let i = 0; i < N; i++) {
      const b = this.botDefs[i];
      this.px[i] = b.x; this.py[i] = b.y;
      this.hp[i] = b.maxHp; this.maxHp[i] = b.maxHp;
      this.alive[i] = 1; this.facing[i] = 1;
      this.weapon[i] = -1;
      this.target[i] = -1; this.lootTarget[i] = -1; this.supplyTarget[i] = -1; this.chestTarget[i] = -1;
      this.fleeSince[i] = -1; this.lastAttacker[i] = -1; this.lastDamageBy[i] = -1;
      this.deathTick[i] = -1; this.rank[i] = 0;
      this.action[i] = ACT_ROAM;
      this.speed[i] = (b.moveSpeed * FP / TICK_HZ) | 0;
      this.aggression[i] = b.aggression; this.caution[i] = b.caution;
      this.aimSkill[i] = b.aimSkill; this.dodgeSkill[i] = b.dodgeSkill;
      this.lootingBias[i] = b.lootingBias; this.awareness[i] = b.awareness;
      this.armor[i] = b.armor; this.atkCdMul[i] = b.atkCdMul; this.strMul[i] = b.strMul;
      this.openingSupply[i] = -1;
      this.roamUntil[i] = -1;
      this.useItem[i] = -1; this.useSlot[i] = -1;
    }
    this.botRadius = rs.bot.radius;
    this.botRadiusFp = rs.bot.radius * FP;
    this.cols = Math.ceil(rs.world.width / GRID_CELL);
    this.rows = Math.ceil(rs.world.height / GRID_CELL);
    this.cellCount = this.cols * this.rows;
    this.gridCounts = new Int32Array(this.cellCount + 1);
    this.gridOrder = new Int32Array(N);
    this.gridCell = new Int32Array(N);
  }

  _initObstacleGrid() {
    this.obsBuckets = Array.from({ length: this.cellCount }, () => []);
    for (const o of this.obstacles) {
      const minc = Math.max(0, ((o.x - o.r) / GRID_CELL) | 0), maxc = Math.min(this.cols - 1, ((o.x + o.r) / GRID_CELL) | 0);
      const minr = Math.max(0, ((o.y - o.r) / GRID_CELL) | 0), maxr = Math.min(this.rows - 1, ((o.y + o.r) / GRID_CELL) | 0);
      for (let r = minr; r <= maxr; r++) for (let c = minc; c <= maxc; c++) this.obsBuckets[r * this.cols + c].push(o);
    }
  }

  // ---------------------------------------------------------------- queries
  _buildGrid() {
    const { cols, rows, cellCount } = this;
    this.gridCounts.fill(0);
    for (let i = 0; i < this.N; i++) {
      // Still under the parachute: out of play — nobody can see, hit or bump it yet.
      if (!this.alive[i] || this.tick < this.landTick[i]) { this.gridCell[i] = -1; continue; }
      const c = clamp((this.px[i] / FP / GRID_CELL) | 0, 0, cols - 1);
      const r = clamp((this.py[i] / FP / GRID_CELL) | 0, 0, rows - 1);
      const cell = r * cols + c;
      this.gridCell[i] = cell;
      this.gridCounts[cell + 1]++;
    }
    for (let i = 0; i < cellCount; i++) this.gridCounts[i + 1] += this.gridCounts[i];
    const cursor = this.gridCursor || (this.gridCursor = new Int32Array(cellCount));
    cursor.set(this.gridCounts.subarray(0, cellCount));
    for (let i = 0; i < this.N; i++) {                 // botId order => stable buckets
      const cell = this.gridCell[i];
      if (cell < 0) continue;
      this.gridOrder[cursor[cell]++] = i;
    }
  }

  /** Visit alive bots whose cell overlaps a (xu, yu, radius) query, in deterministic order. */
  forEachNear(xu, yu, radius, fn) {
    const cmin = clamp(((xu - radius) / GRID_CELL) | 0, 0, this.cols - 1);
    const cmax = clamp(((xu + radius) / GRID_CELL) | 0, 0, this.cols - 1);
    const rmin = clamp(((yu - radius) / GRID_CELL) | 0, 0, this.rows - 1);
    const rmax = clamp(((yu + radius) / GRID_CELL) | 0, 0, this.rows - 1);
    for (let r = rmin; r <= rmax; r++) {
      for (let c = cmin; c <= cmax; c++) {
        const cell = r * this.cols + c;
        for (let k = this.gridCounts[cell]; k < this.gridCounts[cell + 1]; k++) fn(this.gridOrder[k]);
      }
    }
  }

  nearestEnemy(i, radius) {
    const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
    let bestId = -1, bestD2 = Infinity;
    this.forEachNear(xu, yu, radius, (j) => {
      if (j === i || !this.alive[j]) return;
      const dx = (this.px[j] - this.px[i]) / FP | 0, dy = (this.py[j] - this.py[i]) / FP | 0;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2 || (d2 === bestD2 && j < bestId)) { bestD2 = d2; bestId = j; }
    });
    return bestId < 0 ? { id: -1, d: 0 } : { id: bestId, d: Math.floor(Math.sqrt(bestD2)) };
  }

  /** Nearest unopened treasure chest within radius: { id, d }. */
  nearestChest(i, radius) {
    const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
    let bestId = -1, bestD2 = radius * radius + 1;
    for (let k = 0; k < this.chests.length; k++) {
      const c = this.chests[k];
      if (c.opened) continue;
      const dx = c.x - xu, dy = c.y - yu, d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestId = k; }
    }
    return bestId < 0 ? { id: -1, d: 0 } : { id: bestId, d: Math.floor(Math.sqrt(bestD2)) };
  }

  /** Would bot i pick this ground item up right now? (weapon upgrade, or bag space for a consumable) */
  wantsItem(i, it) {
    if (it.cons >= 0) return this.bagCount[i] < this.bagSlots;
    const myW = this.weapon[i];
    return myW < 0 || WEAPONS[it.weapon].tier >= WEAPONS[myW].tier + this.ruleset.loot.upgradeHysteresis;
  }

  /**
   * Item ids bucketed by a coarse 1200u grid (items are append-only; taken ones are just
   * skipped). nearestUsefulItem visits ~16 nearby cells instead of every item ever dropped.
   */
  _indexItems() {
    if (!this.itemCells) {
      this.itemCols = Math.ceil(this.ruleset.world.width / ITEM_CELL);
      this.itemRows = Math.ceil(this.ruleset.world.height / ITEM_CELL);
      this.itemCells = Array.from({ length: this.itemCols * this.itemRows }, () => []);
      this.itemsIndexed = 0;
    }
    for (; this.itemsIndexed < this.items.length; this.itemsIndexed++) {
      const it = this.items[this.itemsIndexed];
      const c = clamp((it.x / ITEM_CELL) | 0, 0, this.itemCols - 1), r = clamp((it.y / ITEM_CELL) | 0, 0, this.itemRows - 1);
      this.itemCells[r * this.itemCols + c].push(this.itemsIndexed);
    }
  }

  /** Nearest useful item of one family: consumables=false -> weapons, true -> healing items. */
  nearestUsefulItem(i, radius, consumables = false) {
    this._indexItems();
    const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
    let bestId = -1, bestD2 = Infinity;
    const R2 = radius * radius;
    const cmin = clamp(((xu - radius) / ITEM_CELL) | 0, 0, this.itemCols - 1), cmax = clamp(((xu + radius) / ITEM_CELL) | 0, 0, this.itemCols - 1);
    const rmin = clamp(((yu - radius) / ITEM_CELL) | 0, 0, this.itemRows - 1), rmax = clamp(((yu + radius) / ITEM_CELL) | 0, 0, this.itemRows - 1);
    for (let rr = rmin; rr <= rmax; rr++) {
      for (let cc = cmin; cc <= cmax; cc++) {
        const cell = this.itemCells[rr * this.itemCols + cc];
        for (let n = 0; n < cell.length; n++) {
          const k = cell[n], it = this.items[k];
          if (it.taken || (it.cons >= 0) !== consumables) continue;
          const dx = it.x - xu, dy = it.y - yu;
          const d2 = dx * dx + dy * dy;
          if (d2 > R2 || d2 > bestD2 || (d2 === bestD2 && k > bestId)) continue;
          if (!this.wantsItem(i, it)) continue;
          bestD2 = d2; bestId = k;
        }
      }
    }
    return bestId < 0 ? { id: -1, d: 0 } : { id: bestId, d: Math.floor(Math.sqrt(bestD2)) };
  }

  nearestSupply(i, radius) {
    const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
    let bestId = -1, bestD2 = Infinity;
    for (let k = 0; k < this.supplies.length; k++) {
      const s = this.supplies[k];
      if (s.taken || s.tick > this.tick) continue;
      const dx = s.x - xu, dy = s.y - yu;
      const d2 = dx * dx + dy * dy;
      if (d2 > radius * radius) continue;
      if (d2 < bestD2 || (d2 === bestD2 && k < bestId)) { bestD2 = d2; bestId = k; }
    }
    return bestId < 0 ? { id: -1, d: 0 } : { id: bestId, d: Math.floor(Math.sqrt(bestD2)) };
  }

  // ---------------------------------------------------------------- tick
  step() {
    if (this.ended) return;
    const t = this.tick;
    this._phaseSchedule(t);
    this._buildGrid();
    this._phaseStrategic(t);
    this._phaseTactical(t);
    this._phaseMovement(t);
    this._phaseAttacks(t);
    this._phaseProjectiles(t);
    this._phaseApplyDamage(t);
    this._phaseDeaths(t);
    this._phaseCrownAndLoot(t);
    this._phaseEndCondition(t);
    this._phaseRecord(t);
    this.tick = t + 1;
  }

  // 1) zone + supply schedule, zone damage queued
  _phaseSchedule(t) {
    this.zone = zoneAt(this.zoneSchedule, this.ruleset, t);
    this.zoneSoon = zoneAt(this.zoneSchedule, this.ruleset, t + 120);
    if (this.zone.phase !== this.lastZonePhase) {
      this.lastZonePhase = this.zone.phase;
      this.recorder.event(t, EV.ZONE_PHASE, this.zone.phase, this.zone.cx, this.zone.cy, this.zone.r, this.zone.dps);
    }
    const rs = this.ruleset;
    // Supply crates fall exactly as planned before the match (plan.supplies).
    for (const c of this.supplyPlan) {
      if (c.tick !== t) continue;
      this.supplies.push({ id: c.id, x: c.x, y: c.y, weapon: c.weapon, cons: c.cons, heal: c.heal, taken: false, tick: t });
      this.recorder.event(t, EV.SUPPLY_SPAWN, c.id, c.x, c.y, c.weapon, c.cons);
    }

    // Zone damage at 5 Hz, queued with the environment priority (0).
    if (this.zone.dps > 0 && t % rs.zone.damageEvery === 0) {
      const per = (this.zone.dps * HP_SCALE * rs.zone.damageEvery) / TICK_HZ | 0;
      for (let i = 0; i < this.N; i++) {
        if (!this.alive[i]) continue;
        const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
        const d = flen(xu - this.zone.cx, yu - this.zone.cy);
        if (d > this.zone.r) {
          this.damageQueue.push({ prio: 0, attacker: -1, targetId: i, amount: per, weapon: -1, stun: 0, seq: this.dmgSeq++ });
          this.recorder.event(t, EV.ZONE_DAMAGE, i, per, d - this.zone.r, 0, 0);
        }
      }
    }
  }

  // 2) strategic AI at 5 Hz, staggered by botId (fixed offset, never by scheduler order)
  _phaseStrategic(t) {
    // The leader everyone focuses: the crown holder, else the top killer (2+ kills, lowest id on ties).
    let lead = this.crownHolder;
    if (lead < 0) {
      let best = 1;
      for (let i = 0; i < this.N; i++) if (this.alive[i] && this.kills[i] > best) { best = this.kills[i]; lead = i; }
    }
    this.leaderId = lead;
    // Who is going for whom, as of the start of this tick (read by the AI to share kills).
    this.chaseLists = new Map();
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i] || (this.action[i] !== ACT_ATTACK && this.action[i] !== ACT_HUNT) || this.target[i] < 0) continue;
      const l = this.chaseLists.get(this.target[i]);
      if (l) l.push(i); else this.chaseLists.set(this.target[i], [i]);
    }
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i] || t < this.landTick[i]) continue;
      if ((t % STRATEGIC_EVERY) !== (i % STRATEGIC_EVERY)) continue;
      strategicDecision(this, i, t);
    }
  }

  // 3) tactical intents: desired velocity, facing, attack wish, dash wish
  _phaseTactical(t) {
    const rs = this.ruleset;
    this.wantAttack = this.wantAttack || new Uint8Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.wantAttack[i] = 0;
      if (!this.alive[i]) { this.vx[i] = 0; this.vy[i] = 0; continue; }
      if (t < this.landTick[i]) { this.vx[i] = 0; this.vy[i] = 0; continue; }     // parachuting
      if (t === this.landTick[i]) this.recorder.event(t, EV.LAND, i, this.px[i] / FP | 0, this.py[i] / FP | 0, 0, 0);
      this._tickStatus(i, t);
      if (this.stun[i] > 0) { this.stun[i]--; this.vx[i] = 0; this.vy[i] = 0; continue; }

      const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
      const spd = this._moveSpeed(i);
      let tx = xu, ty = yu, strafe = 0;
      const a = this.action[i];
      const w = this.weapon[i];

      if (a === ACT_ZONE) {
        const z = this.zoneSoon;
        tx = z.cx; ty = z.cy;
      } else if (a === ACT_LOOT && this.chestTarget[i] >= 0 && !this.chests[this.chestTarget[i]].opened) {
        tx = this.chests[this.chestTarget[i]].x; ty = this.chests[this.chestTarget[i]].y;
      } else if (a === ACT_LOOT && this.lootTarget[i] >= 0 && !this.items[this.lootTarget[i]].taken) {
        tx = this.items[this.lootTarget[i]].x; ty = this.items[this.lootTarget[i]].y;
      } else if (a === ACT_SUPPLY && this.supplyTarget[i] >= 0 && !this.supplies[this.supplyTarget[i]].taken) {
        tx = this.supplies[this.supplyTarget[i]].x; ty = this.supplies[this.supplyTarget[i]].y;
      } else if ((a === ACT_ATTACK || a === ACT_HUNT) && this.target[i] >= 0 && this.alive[this.target[i]]) {
        const j = this.target[i];
        const jx = this.px[j] / FP | 0, jy = this.py[j] / FP | 0;
        const d = flen(jx - xu, jy - yu);
        const range = specOf(w).range;
        const band = w >= 0 && WEAPONS[w].type === 'ranged'
          ? (range * this.aiOf(i).kiteBandPermille) / 1000 | 0
          : (range * this.aiOf(i).meleeApproachPermille) / 1000 | 0;
        if (a === ACT_ATTACK && d > 0) {
          const side = (i & 1) ? 1 : -1;
          if (w >= 0 && WEAPONS[w].type === 'ranged') {
            // Hit and run: plant the feet while aiming, fall back while reloading, step
            // back in to firing distance once the next shot is ready.
            const A = this.aiOf(i);
            const fireD = (range * A.kiteFirePermille) / 1000 | 0;
            const backD = (range * A.kiteRetreatPermille) / 1000 | 0;
            if (this.windup[i] > 0) { tx = xu; ty = yu; }
            else if (this.atkCd[i] > 2) {
              if (d < backD) {                               // away, with a sideways slant
                tx = xu - (jx - xu) - ((side * (jy - yu)) >> 1);
                ty = yu - (jy - yu) + ((side * (jx - xu)) >> 1);
              } else { tx = xu; ty = yu; strafe = side; }
            } else if (d > fireD) { tx = jx; ty = jy; }
            else { tx = xu; ty = yu; strafe = side; }
          } else if (d > band) { tx = jx; ty = jy; }
          else { tx = xu; ty = yu; strafe = side; }        // melee: in reach, circle and swing
          this.wantAttack[i] = 1;
        } else { tx = jx; ty = jy; this.wantAttack[i] = d <= range ? 1 : 0; }
        this.facing[i] = jx >= xu ? 1 : -1;
      } else if (a === ACT_FLEE && this.target[i] >= 0) {
        const j = this.target[i];
        const jx = this.px[j] / FP | 0, jy = this.py[j] / FP | 0;
        const z = this.zone;
        tx = xu + (xu - jx) + ((z.cx - xu) >> 2);
        ty = yu + (yu - jy) + ((z.cy - yu) >> 2);
      } else {                                              // ROAM
        // Re-pick on timeout AND on arrival — waiting out the timer at the spot was a
        // multi-second freeze. Points are drawn inside the circle, not its bounding square.
        const rdx = this.roamX[i] - xu, rdy = this.roamY[i] - yu;
        if (t >= this.roamUntil[i] || rdx * rdx + rdy * rdy < 40 * 40) {
          const z = this.zoneSoon;
          const span = Math.max(60, ((z.r * 70) / 100) | 0);
          let rx = z.cx, ry = z.cy;
          for (let tries = 0; tries < 4; tries++) {
            rx = z.cx + this.rngRoam.range(-span, span);
            ry = z.cy + this.rngRoam.range(-span, span);
            if ((rx - z.cx) * (rx - z.cx) + (ry - z.cy) * (ry - z.cy) <= span * span) break;
          }
          [rx, ry] = this._placeItem(clamp(rx, 120, rs.world.width - 120), clamp(ry, 120, rs.world.height - 120),
                                     this.botRadius + 30);
          this.roamX[i] = rx;
          this.roamY[i] = ry;
          this.roamUntil[i] = t + rs.ai.roamRepickTicks;
        }
        tx = this.roamX[i]; ty = this.roamY[i];
      }

      let dx = (tx - xu) * FP, dy = (ty - yu) * FP;
      if (strafe !== 0 && this.target[i] >= 0) {
        const j = this.target[i];
        const px = -(this.py[j] - this.py[i]), py = (this.px[j] - this.px[i]);
        dx = px * strafe; dy = py * strafe;
      }
      let [nvx, nvy] = fnorm(dx, dy, spd);
      if (nvx !== 0 || nvy !== 0) [nvx, nvy] = this._avoidObstacles(i, xu, yu, nvx, nvy);

      // separation from crowding neighbours (steering only; never moves anyone else)
      let sx = 0, sy = 0;
      const sepR = rs.bot.separationRadius;
      this.forEachNear(xu, yu, sepR + 4, (j) => {
        if (j === i || !this.alive[j]) return;
        const ddx = this.px[i] - this.px[j], ddy = this.py[i] - this.py[j];
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 === 0) { sx += (i - j); return; }
        if (d2 < (sepR * FP) * (sepR * FP)) {
          const d = Math.floor(Math.sqrt(d2));
          sx += trunc((ddx * rs.bot.separationForce) / Math.max(1, d));
          sy += trunc((ddy * rs.bot.separationForce) / Math.max(1, d));
        }
      });
      nvx += sx; nvy += sy;
      const lim = flen(nvx, nvy);
      if (lim > spd) { const r = fnorm(nvx, nvy, spd); nvx = r[0]; nvy = r[1]; }

      // Jam safety net: a bot that wants to move but has stayed within 20u for 2s (wedged
      // between a crowd and a rock, two goals cancelling out ...) side-steps for 0.8s.
      // Whatever the AI did to get there, nobody stays frozen.
      if (this.unstickLeft[i] > 0) {
        this.unstickLeft[i]--;
        nvx = this.unstickVx[i]; nvy = this.unstickVy[i];
      } else {
        const mdx = xu - this.anchorX[i], mdy = yu - this.anchorY[i];
        if (mdx * mdx + mdy * mdy > 20 * 20 || (nvx === 0 && nvy === 0) || this.windup[i] > 0) {
          this.anchorX[i] = xu; this.anchorY[i] = yu; this.anchorT[i] = t;
        } else if (t - this.anchorT[i] >= 40) {
          const side = ((i + ((t / 40) | 0)) & 1) ? 1 : -1;
          const [ux, uy] = fnorm(-nvy * side, nvx * side, spd);
          [this.unstickVx[i], this.unstickVy[i]] = this._avoidObstacles(i, xu, yu, ux, uy);
          this.unstickLeft[i] = 16;
          this.anchorT[i] = t;
          nvx = this.unstickVx[i]; nvy = this.unstickVy[i];
        }
      }

      // dash: escape, gap-close or dodge
      if (this.dashCd[i] > 0) this.dashCd[i]--;
      if (this.dashLeft[i] > 0) {
        this.dashLeft[i]--;
        nvx = this.dashVx[i]; nvy = this.dashVy[i];
      } else if (this.dashCd[i] === 0 && (nvx !== 0 || nvy !== 0)) {
        let want = false;
        if (a === ACT_FLEE) want = true;
        else if (a === ACT_ZONE && flen(xu - this.zone.cx, yu - this.zone.cy) > this.zone.r) want = true;
        else if (a === ACT_ATTACK && this.target[i] >= 0 && this.alive[this.target[i]]) {
          const j = this.target[i];
          const d = flen((this.px[j] - this.px[i]) / FP | 0, (this.py[j] - this.py[i]) / FP | 0);
          want = d > 180 && this.rngCombat.chance(this.aggression[i] >> 3);
        }
        if (!want && this._incomingThreat(i)) want = this.rngCombat.chance(this.dodgeSkill[i]);
        if (want) {
          const mul = rs.bot.dashSpeedMul;
          this.dashVx[i] = (nvx * mul) / 100 | 0;
          this.dashVy[i] = (nvy * mul) / 100 | 0;
          this.dashLeft[i] = rs.bot.dashTicks;
          this.dashCd[i] = rs.bot.dashCooldownTicks;
          nvx = this.dashVx[i]; nvy = this.dashVy[i];
          this.recorder.event(t, EV.DASH, i, xu, yu, 0, 0);
        }
      }

      this.vx[i] = nvx; this.vy[i] = nvy;
      if (this.useLeft[i] > 0) this.wantAttack[i] = 0;      // hands full: eating, not swinging
      if (this.wantAttack[i] === 0) {
        if (nvx > FP / 3) this.facing[i] = 1;
        else if (nvx < -FP / 3) this.facing[i] = -1;
      }
    }
  }

  /**
   * AI tuning for bot i. Normally the ruleset's; tools/tune-ai.mjs installs two parameter
   * sets (aiSets + aiGroup) to pit a candidate rule set against the baseline in one match.
   */
  aiOf(i) { return this.aiSets ? this.aiSets[this.aiGroup[i]] : this.ruleset.ai; }

  /** Effective move speed this tick: base, then haste and channel modifiers. */
  _moveSpeed(i) {
    let s = this.speed[i];
    if (this.hasteLeft[i] > 0) s = (s * (100 + this.hastePct[i])) / 100 | 0;
    if (this.useLeft[i] > 0) s = (s * 60) / 100 | 0;
    return Math.max(1, s);
  }

  /** Timers, heal-over-time, the consumable channel, and the decision to start one. */
  _tickStatus(i, t) {
    if (this.hasteLeft[i] > 0) this.hasteLeft[i]--;
    if (this.hotLeft[i] > 0) {
      this.hotLeft[i]--;
      const before = this.hp[i];
      this.hp[i] = Math.min(this.maxHp[i], this.hp[i] + this.hotPerTick[i]);
      this.healed[i] += this.hp[i] - before;
    }
    if (this.stun[i] > 0) return;
    if (this.useLeft[i] > 0) {
      if (--this.useLeft[i] === 0) this._finishConsume(i, t);
      return;
    }
    if (this.windup[i] > 0 || this.bagCount[i] === 0) return;
    const slot = this._pickConsumable(i, t);
    if (slot < 0) return;
    const c = this.bag[i * this.bagSlots + slot];
    this.useSlot[i] = slot; this.useItem[i] = c;
    this.useLeft[i] = Math.max(1, CONSUMABLES[c].useTicks);
    this.recorder.event(t, EV.CONSUME, i, c, this.useLeft[i], 0, 0);
  }

  /**
   * Which bag slot to use now, or -1. Heal when below a caution-scaled threshold; never
   * waste a big item on a scratch; never start an interruptible drink while under fire;
   * below the emergency line, use the biggest thing that will actually complete.
   */
  _pickConsumable(i, t) {
    const ai = this.ruleset.ai;
    const hpPm = (this.hp[i] * 1000 / this.maxHp[i]) | 0;
    const threshold = ai.healHpPermille + ((this.caution[i] * 120) / 1000 | 0);
    if (hpPm >= threshold) return -1;
    const emergency = hpPm < ai.healEmergencyPermille;
    const underFire = this.lastAttacker[i] >= 0 && t - this.lastAttackedTick[i] < ai.healSafeTicks;
    const missing = ((this.maxHp[i] - this.hp[i]) / HP_SCALE) | 0;
    let crowded = -1;                       // lazily: is anyone within healSafeRange?
    let best = -1, bestVal = -1;
    for (let s = 0; s < this.bagCount[i]; s++) {
      const c = CONSUMABLES[this.bag[i * this.bagSlots + s]];
      if (c.interrupt && underFire) continue;
      if (c.interrupt) {
        if (crowded < 0) crowded = this.nearestEnemy(i, ai.healSafeRange).id >= 0 ? 1 : 0;
        if (crowded) continue;
      }
      if (c.hotHp > 0 && this.hotLeft[i] > 0) continue;
      const val = c.heal + c.hotHp;
      if (!emergency && val > missing + 10) continue;            // would mostly overheal
      if (val > bestVal) { bestVal = val; best = s; }
    }
    return best;
  }

  _finishConsume(i, t) {
    const slot = this.useSlot[i], ci = this.useItem[i];
    this.useSlot[i] = -1; this.useItem[i] = -1;
    if (slot < 0 || ci < 0) return;
    const c = CONSUMABLES[ci];
    // remove from the bag, keeping slot order (lowest slots first)
    const base = i * this.bagSlots;
    for (let s = slot; s < this.bagCount[i] - 1; s++) this.bag[base + s] = this.bag[base + s + 1];
    this.bag[base + this.bagCount[i] - 1] = -1;
    this.bagCount[i]--;
    const before = this.hp[i];
    this.hp[i] = Math.min(this.maxHp[i], this.hp[i] + c.heal * HP_SCALE);
    this.healed[i] += this.hp[i] - before;
    if (c.hotHp > 0 && c.hotTicks > 0) {
      this.hotLeft[i] = c.hotTicks;
      this.hotPerTick[i] = Math.max(1, ((c.hotHp * HP_SCALE) / c.hotTicks) | 0);
    }
    if (c.hasteTicks > 0) { this.hasteLeft[i] = c.hasteTicks; this.hastePct[i] = c.hastePct; }
    this.itemsUsed[i]++;
    this.recorder.event(t, EV.CONSUME, i, ci, 0, 1, 0);
    this.recorder.event(t, EV.HEAL, i, ci, this.hp[i] - before, this.hp[i], 0);
  }

  _bagAdd(i, ci) {
    if (this.bagCount[i] >= this.bagSlots) return false;
    this.bag[i * this.bagSlots + this.bagCount[i]] = ci;
    this.bagCount[i]++;
    return true;
  }

  /**
   * Obstacle steering. Collision only pushes a bot radially out of a rock, so a bot
   * walking straight at a rock's centre used to stand pinned against it forever.
   * When the heading would clip the nearest rock ahead, bend it along the rock's
   * tangent, on the side the goal lies. Rocks are >= obstacleMinGap apart, so
   * circling one always clears it. Integer-only, so still bit-identical everywhere.
   */
  _avoidObstacles(i, xu, yu, vx, vy) {
    const R = this.botRadius, LOOK = 70;
    const reach = R + LOOK + this.maxObstacleR;
    const cmin = clamp(((xu - reach) / GRID_CELL) | 0, 0, this.cols - 1);
    const cmax = clamp(((xu + reach) / GRID_CELL) | 0, 0, this.cols - 1);
    const rmin = clamp(((yu - reach) / GRID_CELL) | 0, 0, this.rows - 1);
    const rmax = clamp(((yu + reach) / GRID_CELL) | 0, 0, this.rows - 1);
    const hl = flen(vx, vy);
    if (hl === 0) return [vx, vy];
    let best = null, bestGap = LOOK + 1, bestCross = 0;
    for (let rr = rmin; rr <= rmax; rr++) {
      for (let cc = cmin; cc <= cmax; cc++) {
        const bucket = this.obsBuckets[rr * this.cols + cc];
        for (let k = 0; k < bucket.length; k++) {
          const o = bucket[k];
          const cx = o.x - xu, cy = o.y - yu;
          const dot = cx * vx + cy * vy;
          if (dot <= 0) continue;                                  // behind us
          const cross = cx * vy - cy * vx;
          const lateral = trunc(Math.abs(cross) / hl);
          if (lateral >= o.r + R + 4) continue;                    // heading clears it
          const gap = flen(cx, cy) - o.r - R;
          if (gap > LOOK) continue;
          if (gap < bestGap || (gap === bestGap && best && o.id < best.id)) { best = o; bestGap = gap; bestCross = cross; }
        }
      }
    }
    if (!best) return [vx, vy];
    const cx = best.x - xu, cy = best.y - yu;
    // Tangent on the goal side: (-cy, cx) points that way when cross(c, v) > 0.
    const side = bestCross > 0 ? 1 : bestCross < 0 ? -1 : ((i & 1) ? 1 : -1);
    const speed = hl;
    const [tx, ty] = fnorm(-cy * side, cx * side, speed);
    const w = clamp(LOOK - Math.max(0, bestGap), 0, LOOK);          // closer => more tangent
    const mx = trunc((vx * (LOOK - w) + tx * w) / LOOK), my = trunc((vy * (LOOK - w) + ty * w) / LOOK);
    if (mx === 0 && my === 0) return [tx, ty];
    return fnorm(mx, my, speed);
  }

  /**
   * Nudge a point out of any rock so it can always be reached: dropped items (margin 6,
   * still inside pickup reach of a bot touching the rock) and roam goals (margin = body
   * + slack, otherwise a bot parks against the rock waiting for an unreachable point).
   */
  _placeItem(x, y, margin = 6) {
    const W = this.ruleset.world.width, H = this.ruleset.world.height;
    x = clamp(x, 60, W - 60); y = clamp(y, 60, H - 60);
    const c = clamp((x / GRID_CELL) | 0, 0, this.cols - 1), r = clamp((y / GRID_CELL) | 0, 0, this.rows - 1);
    const bucket = this.obsBuckets[r * this.cols + c];
    for (let k = 0; k < bucket.length; k++) {
      const o = bucket[k];
      const dx = x - o.x, dy = y - o.y;
      const minD = o.r + margin;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD) continue;
      if (d2 === 0) { x = o.x + minD; continue; }
      const d = flen(dx, dy);
      x = o.x + trunc((dx * minD) / Math.max(1, d));
      y = o.y + trunc((dy * minD) / Math.max(1, d));
    }
    return [clamp(x, 60, W - 60), clamp(y, 60, H - 60)];
  }

  /** Is a projectile closing on bot i within ~0.5s? */
  _incomingThreat(i) {
    for (let k = 0; k < this.projectiles.length; k++) {
      const p = this.projectiles[k];
      if (!p.alive || p.owner === i) continue;
      const dx = this.px[i] - p.x, dy = this.py[i] - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > (420 * FP) * (420 * FP)) continue;
      if (dx * p.vx + dy * p.vy > 0) return true;   // moving toward us
    }
    return false;
  }

  // 4) movement + obstacle/world collision
  _phaseMovement() {
    const rs = this.ruleset;
    const W = rs.world.width, H = rs.world.height, R = this.botRadius;
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      let nx = this.px[i] + this.vx[i], ny = this.py[i] + this.vy[i];
      let xu = nx / FP | 0, yu = ny / FP | 0;
      const cmin = clamp(((xu - R - 80) / GRID_CELL) | 0, 0, this.cols - 1);
      const cmax = clamp(((xu + R + 80) / GRID_CELL) | 0, 0, this.cols - 1);
      const rmin = clamp(((yu - R - 80) / GRID_CELL) | 0, 0, this.rows - 1);
      const rmax = clamp(((yu + R + 80) / GRID_CELL) | 0, 0, this.rows - 1);
      for (let rr = rmin; rr <= rmax; rr++) {
        for (let cc = cmin; cc <= cmax; cc++) {
          const bucket = this.obsBuckets[rr * this.cols + cc];
          for (let k = 0; k < bucket.length; k++) {
            const o = bucket[k];
            const dx = xu - o.x, dy = yu - o.y;
            const minD = o.r + R;
            const d2 = dx * dx + dy * dy;
            if (d2 >= minD * minD || d2 === 0) continue;
            const d = Math.max(1, Math.floor(Math.sqrt(d2)));
            xu = o.x + trunc((dx * minD) / d);
            yu = o.y + trunc((dy * minD) / d);
            nx = xu * FP; ny = yu * FP;
            this.dashLeft[i] = 0;                       // a dash cannot punch through cover
          }
        }
      }
      nx = clamp(nx, R * FP, (W - R) * FP);
      ny = clamp(ny, R * FP, (H - R) * FP);
      this.px[i] = nx; this.py[i] = ny;
    }
  }

  // 5) attack windup / resolve; melee resolves here, ranged spawns a projectile
  _phaseAttacks(t) {
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i]) continue;
      if (this.atkCd[i] > 0) this.atkCd[i]--;
      if (this.windup[i] > 0) {
        this.windup[i]--;
        if (this.windup[i] === 0) this._resolveAttack(i, t);
        continue;
      }
      if (this.stun[i] > 0 || this.useLeft[i] > 0) continue;
      const w = this.weapon[i];
      if (this.atkCd[i] > 0 || !this.wantAttack[i]) continue;
      const spec = specOf(w);
      const j = this.target[i];
      if (j < 0 || !this.alive[j]) continue;
      const d = flen((this.px[j] - this.px[i]) / FP | 0, (this.py[j] - this.py[i]) / FP | 0);
      if (d > spec.range) continue;
      this.windup[i] = spec.windup;
      this.windupTarget[i] = j;
      this.atkCd[i] = Math.max(1, (this.cdTicksOf(w) * this.atkCdMul[i]) / 100 | 0);
      this._setAnim(i, spec.type === 'melee' ? ANIM.attack_melee : ANIM.attack_ranged,
                    t + this.ruleset.combat.attackAnimTicks);
      this.recorder.event(t, EV.ATTACK, i, j, w, d, 0);
    }
  }

  _resolveAttack(i, t) {
    const w = this.weapon[i];
    const j = this.windupTarget[i];
    if (j < 0 || !this.alive[j] || !this.alive[i]) return;
    const spec = specOf(w);
    const dxu = (this.px[j] - this.px[i]) / FP | 0, dyu = (this.py[j] - this.py[i]) / FP | 0;

    if (spec.type === 'melee') {
      const d = flen(dxu, dyu);
      const reach = spec.range + this.botRadius;
      if (d > reach) { this.recorder.event(t, EV.MISS, i, j, w, d, 1); return; }

      const pattern = spec.pattern || 'straight';
      if (pattern === 'cone') {
        this._coneAttack(i, j, w, spec, dxu, dyu, d, t);
      } else if (pattern === 'circle') {
        this._circleAttack(i, j, w, spec, dxu, dyu, d, t);
      } else if (pattern === 'line') {
        this._lineAttack(i, j, w, spec, dxu, dyu, d, t);
      } else {
        // 'straight' — single-target melee (dagger, unarmed)
        this._meleeStrike(i, j, w, spec, d, t);
      }
    } else {
      // Lead the target by its current velocity, degraded by aim skill.
      const lead = this.ruleset.combat.predictLeadPermille;
      const travel = Math.max(1, (flen(dxu, dyu) * TICK_HZ) / Math.max(1, spec.projectileSpeed) | 0);
      let aimX = this.px[j] + ((this.vx[j] * travel * lead) / 1000 | 0);
      let aimY = this.py[j] + ((this.vy[j] * travel * lead) / 1000 | 0);
      const err = (this.ruleset.combat.rangedSpreadBase * (1000 - this.aimSkill[i])) / 1000 | 0;
      if (err > 0) {
        aimX += this.rngCombat.range(-err, err) * FP;
        aimY += this.rngCombat.range(-err, err) * FP;
      }
      const vel = fnorm(aimX - this.px[i], aimY - this.py[i], (spec.projectileSpeed * FP / TICK_HZ) | 0);
      const p = { id: this.nextProjectileId++, owner: i, weapon: w, x: this.px[i], y: this.py[i] - 10 * FP,
                  vx: vel[0], vy: vel[1], traveled: 0, maxRange: spec.range * FP + 40 * FP, alive: true };
      this.projectiles.push(p);
      this.recorder.event(t, EV.PROJECTILE_SPAWN, i, j, w, this.px[i] / FP | 0, this.py[i] / FP | 0);
    }
  }

  /** One melee blow: the target rolls a dodge. */
  _meleeStrike(i, j, w, spec, d, t) {
    let dodge = (this.ruleset.combat.meleeDodgeBase * this.dodgeSkill[j]) / Math.max(1, this.aimSkill[i] + 200) | 0;
    if (this.dashLeft[j] > 0) dodge += 150;
    dodge = clamp(dodge, 0, 520);
    if (this.rngCombat.chance(dodge)) { this.recorder.event(t, EV.MISS, i, j, w, d, 0); return; }
    this.damageQueue.push({ prio: 1, attacker: i, targetId: j, amount: spec.damage * HP_SCALE,
                            weapon: w, stun: spec.stun, seq: this.dmgSeq++ });
    this.recorder.event(t, EV.HIT, i, j, w, spec.damage, 0);
  }

  /** Cone cleave (sword, axe): hit all enemies within reach and inside a cone facing the target. */
  _coneAttack(i, j, w, spec, dxu, dyu, d, t) {
    const reach = spec.range + this.botRadius;
    const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
    // Direction vector toward primary target.
    const dirLen = Math.max(1, d);
    // coneAngle is permille of 180°: half-angle in degrees = coneAngle * 180 / 1000 / 2
    const halfDeg = (spec.coneAngle * 180) / 2000;
    const cosThreshold = Math.cos(halfDeg * Math.PI / 180);
    const cosPermille = (cosThreshold * 1000) | 0;

    let hitCount = 0;
    this.forEachNear(xu, yu, reach + 4, (k) => {
      if (k === i || !this.alive[k]) return;
      const edx = (this.px[k] - this.px[i]) / FP | 0, edy = (this.py[k] - this.py[i]) / FP | 0;
      const eDist = flen(edx, edy);
      if (eDist > reach) return;
      // Dot product for cone check
      const dot = edx * dxu + edy * dyu;
      if (dot < 0) return;   // behind the attacker
      const dotPermille = eDist > 0 ? (dot * 1000) / (dirLen * eDist) | 0 : 1000;
      if (dotPermille < cosPermille) return;
      this._meleeStrike(i, k, w, spec, eDist, t);
      hitCount++;
    });
    if (hitCount === 0) {
      this.recorder.event(t, EV.MISS, i, j, w, d, 0);
    }
  }

  /** Circle ground-pound (hammer): hit all enemies within aoeRadius of the impact point. */
  _circleAttack(i, j, w, spec, dxu, dyu, d, t) {
    const aoeR = spec.aoeRadius || spec.range;
    const reach = spec.range + this.botRadius;
    const impactD = Math.min(d, reach);
    const dirLen = Math.max(1, flen(dxu, dyu));
    const impactX = (this.px[i] / FP | 0) + trunc((dxu * impactD) / dirLen);
    const impactY = (this.py[i] / FP | 0) + trunc((dyu * impactD) / dirLen);

    let hitCount = 0;
    this.forEachNear(impactX, impactY, aoeR + 4, (k) => {
      if (k === i || !this.alive[k]) return;
      const edx = (this.px[k] / FP | 0) - impactX, edy = (this.py[k] / FP | 0) - impactY;
      const eDist = flen(edx, edy);
      if (eDist > aoeR + this.botRadius) return;
      this._meleeStrike(i, k, w, spec, eDist, t);
      hitCount++;
    });
    if (hitCount === 0) {
      this.recorder.event(t, EV.MISS, i, j, w, d, 0);
    }
  }

  /** Line pierce (spear): hit all enemies in a line from the attacker through the target. */
  _lineAttack(i, j, w, spec, dxu, dyu, d, t) {
    const reach = spec.range + this.botRadius;
    const halfWidth = (spec.lineWidth || 18) + this.botRadius;
    const xu = this.px[i] / FP | 0, yu = this.py[i] / FP | 0;
    const dirLen = Math.max(1, flen(dxu, dyu));

    let hitCount = 0;
    this.forEachNear(xu, yu, reach + 4, (k) => {
      if (k === i || !this.alive[k]) return;
      const edx = (this.px[k] - this.px[i]) / FP | 0, edy = (this.py[k] - this.py[i]) / FP | 0;
      // Project onto the attack direction: dot must be positive (in front) and within reach.
      const dot = edx * dxu + edy * dyu;
      if (dot < 0) return;   // behind the attacker
      const along = trunc(dot / dirLen);
      if (along > reach) return;
      // Perpendicular distance: |cross(dir, enemy)| / |dir|
      const cross = dxu * edy - dyu * edx;
      const lateral = Math.abs(trunc(cross / dirLen));
      if (lateral > halfWidth) return;
      const eDist = flen(edx, edy);
      this._meleeStrike(i, k, w, spec, eDist, t);
      hitCount++;
    });
    if (hitCount === 0) {
      this.recorder.event(t, EV.MISS, i, j, w, d, 0);
    }
  }

  // 6) projectile movement + collision
  _phaseProjectiles(t) {
    const R = this.botRadius + this.ruleset.combat.projectileRadius;
    const W = this.ruleset.world.width, H = this.ruleset.world.height;
    for (let k = 0; k < this.projectiles.length; k++) {
      const p = this.projectiles[k];
      if (!p.alive) continue;
      p.x += p.vx; p.y += p.vy;
      p.traveled += flen(p.vx, p.vy);
      const xu = p.x / FP | 0, yu = p.y / FP | 0;
      if (p.traveled > p.maxRange || xu < 0 || yu < 0 || xu > W || yu > H) {
        p.alive = false;
        continue;
      }
      // obstacles block shots
      const cc = clamp((xu / GRID_CELL) | 0, 0, this.cols - 1), rr = clamp((yu / GRID_CELL) | 0, 0, this.rows - 1);
      const bucket = this.obsBuckets[rr * this.cols + cc];
      let blocked = false;
      for (let b = 0; b < bucket.length; b++) {
        const o = bucket[b];
        const dx = xu - o.x, dy = yu - o.y;
        if (dx * dx + dy * dy < o.r * o.r) { blocked = true; break; }
      }
      if (blocked) {
        p.alive = false;
        this.recorder.event(t, EV.MISS, p.owner, -1, p.weapon, xu, 2);
        continue;
      }
      let hit = -1;
      this.forEachNear(xu, yu, R + 4, (j) => {
        if (hit >= 0 || j === p.owner || !this.alive[j]) return;
        const dx = (this.px[j] - p.x) / FP | 0, dy = (this.py[j] - p.y) / FP | 0;
        if (dx * dx + dy * dy <= R * R) hit = j;
      });
      if (hit >= 0) {
        const spec = WEAPONS[p.weapon];
        let dodge = (this.ruleset.combat.meleeDodgeBase * this.dodgeSkill[hit]) / Math.max(1, this.aimSkill[p.owner] + 600) | 0;
        if (this.dashLeft[hit] > 0) dodge += 120;
        dodge = clamp(dodge, 0, 380);
        p.alive = false;
        if (this.rngCombat.chance(dodge)) {
          this.recorder.event(t, EV.MISS, p.owner, hit, p.weapon, xu, 3);
          continue;
        }
        this.damageQueue.push({ prio: 2, attacker: p.owner, targetId: hit, amount: spec.damage * HP_SCALE,
                                weapon: p.weapon, stun: spec.stun, seq: this.dmgSeq++ });
        this.recorder.event(t, EV.HIT, p.owner, hit, p.weapon, spec.damage, 1);
      }
    }
    if (this.projectiles.length > 64) this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  // 7) damage / status apply, in the published priority order
  _phaseApplyDamage(t) {
    if (this.damageQueue.length === 0) return;
    this.damageQueue.sort((a, b) =>
      a.prio - b.prio || a.attacker - b.attacker || a.targetId - b.targetId || a.seq - b.seq);
    for (let k = 0; k < this.damageQueue.length; k++) {
      const d = this.damageQueue[k];
      const j = d.targetId;
      if (!this.alive[j]) continue;
      let amount = d.amount;
      if (d.attacker >= 0) amount = (amount * this.strMul[d.attacker]) / 100 | 0;     // STR
      if (d.attacker >= 0 && this.armor[j] > 0) amount = (amount * (100 - this.armor[j])) / 100 | 0;
      if (amount <= 0) continue;
      this.hp[j] = Math.max(0, this.hp[j] - amount);
      this.dmgTaken[j] += amount;
      if (d.attacker >= 0) {
        this.dmgDealt[d.attacker] += amount;
        this.lastDamageBy[j] = d.attacker;
        this.lastDamageTick[j] = t;
        this.lastAttacker[j] = d.attacker;
        this.lastAttackedTick[j] = t;
        if (d.stun > 0) {
          this.stun[j] = Math.max(this.stun[j], d.stun);
          this.recorder.event(t, EV.STUN, d.attacker, j, d.stun, 0, 0);
        }
        // A hit breaks an interruptible drink; the item stays in the bag.
        if (this.useLeft[j] > 0 && this.useItem[j] >= 0 && CONSUMABLES[this.useItem[j]].interrupt) {
          this.recorder.event(t, EV.CONSUME, j, this.useItem[j], this.useLeft[j], 2, 0);
          this.useLeft[j] = 0; this.useItem[j] = -1; this.useSlot[j] = -1;
        }
        this._setAnim(j, ANIM.hit, t + this.ruleset.combat.hitAnimTicks);
      } else {
        this.lastDamageBy[j] = -1;
        this.lastDamageTick[j] = t;
      }
      this.recorder.event(t, EV.DAMAGE, d.attacker, j, amount, this.hp[j], d.weapon);
    }
    this.damageQueue.length = 0;
  }

  // 8) deaths + kill credit
  _phaseDeaths(t) {
    for (let i = 0; i < this.N; i++) {
      if (!this.alive[i] || this.hp[i] > 0) continue;
      const killer = (this.lastDamageBy[i] >= 0 && t - this.lastDamageTick[i] <= 40) ? this.lastDamageBy[i] : -1;
      this.alive[i] = 0;
      this.deathTick[i] = t;
      this.rank[i] = this.aliveCount;
      this.aliveCount--;
      this.vx[i] = 0; this.vy[i] = 0;
      this._setAnim(i, ANIM.death, t + this.ruleset.combat.deathAnimTicks);
      this.recorder.event(t, EV.DEATH, i, killer, this.rank[i], this.weapon[i], 0);
      if (killer >= 0 && this.alive[killer]) {
        this.kills[killer]++;
        const sc = this.ruleset.score;
        if (sc) this.killPts[killer] += sc.killPoints * (this.crown[i] ? sc.crownKillMul : 1);
        this.recorder.event(t, EV.KILL, killer, i, this.kills[killer], this.weapon[killer], 0);
      }
      // the victim's weapon falls to the ground as loot
      if (this.weapon[i] >= 0) {
        const [ix, iy] = this._placeItem(this.px[i] / FP | 0, this.py[i] / FP | 0);
        const it = { id: this.items.length, weapon: this.weapon[i], cons: -1, x: ix, y: iy, taken: false, fromSupply: false };
        this.items.push(it);
        this.recorder.event(t, EV.DROP, i, it.id, it.weapon, it.x, it.y);
        this.weapon[i] = -1;
      }
      // ...and so does whatever was left in the bag, scattered around the body.
      const OFF = [[-22, 14], [22, 14], [0, -24]];
      for (let s = 0; s < this.bagCount[i]; s++) {
        const ci = this.bag[i * this.bagSlots + s];
        const [cx2, cy2] = this._placeItem((this.px[i] / FP | 0) + OFF[s % 3][0], (this.py[i] / FP | 0) + OFF[s % 3][1]);
        const it = { id: this.items.length, weapon: -1, cons: ci, x: cx2, y: cy2, taken: false, fromSupply: false };
        this.items.push(it);
        this.recorder.event(t, EV.DROP, i, it.id, -1 - ci, it.x, it.y);   // c < 0 => consumable (-1 - index)
        this.bag[i * this.bagSlots + s] = -1;
      }
      this.bagCount[i] = 0;
      this.useLeft[i] = 0; this.useItem[i] = -1; this.useSlot[i] = -1; this.hotLeft[i] = 0;
      this._deadThisTick = this._deadThisTick || [];
      this._deadThisTick.push({ id: i, killer });
    }
  }

  // 9) Crown resolution, then loot/supply pickup
  _phaseCrownAndLoot(t) {
    const rs = this.ruleset;
    const dead = this._deadThisTick || [];

    // Crown transfer / drop from this tick's deaths (botId order).
    for (const d of dead) {
      if (!this.crown[d.id]) continue;
      this.crown[d.id] = 0;
      if (this.crownHolder === d.id) this.crownHolder = -1;
      if (d.killer >= 0 && this.alive[d.killer]) {
        this.crownHolder = d.killer;
        this.crown[d.killer] = 1;
        this.hp[d.killer] = (this.maxHp[d.killer] * rs.crown.healOnTransferPercent) / 100 | 0;
        this.crownHistory.push({ tick: t, from: d.id, to: d.killer, reason: 'kill' });
        this._setAnim(d.killer, ANIM.crown_receive, t + 6);
        this.recorder.event(t, EV.CROWN_TRANSFER, d.id, d.killer, this.hp[d.killer], 0, 0);
      } else {
        this.crownGround = { x: this.px[d.id] / FP | 0, y: this.py[d.id] / FP | 0 };
        this.crownHistory.push({ tick: t, from: d.id, to: -1, reason: 'environment' });
        this.recorder.event(t, EV.CROWN_DROP, d.id, this.crownGround.x, this.crownGround.y, 0, 0);
      }
    }
    this._deadThisTick = null;

    // First bot to reach killsToCrown takes a fresh Crown (lowest botId breaks ties).
    if (this.crownHolder === -1 && !this.crownGround) {
      for (let i = 0; i < this.N; i++) {
        if (!this.alive[i] || this.kills[i] < rs.crown.killsToCrown) continue;
        this.crownHolder = i; this.crown[i] = 1;
        this.crownHistory.push({ tick: t, from: -1, to: i, reason: 'threeKills' });
        this._setAnim(i, ANIM.crown_receive, t + 6);
        this.recorder.event(t, EV.CROWN_CREATE, i, this.kills[i], 0, 0, 0);
        break;
      }
    }

    // Crown lying on the ground: lowest alive botId within radius takes it + full heal.
    if (this.crownGround) {
      const g = this.crownGround;
      let taker = -1;
      this.forEachNear(g.x, g.y, rs.crown.dropPickupRadius + 4, (j) => {
        if (taker >= 0 || !this.alive[j]) return;
        const dx = (this.px[j] / FP | 0) - g.x, dy = (this.py[j] / FP | 0) - g.y;
        if (dx * dx + dy * dy <= rs.crown.dropPickupRadius * rs.crown.dropPickupRadius) taker = j;
      });
      if (taker >= 0) {
        this.crownHolder = taker; this.crown[taker] = 1; this.crownGround = null;
        this.hp[taker] = (this.maxHp[taker] * rs.crown.healOnTransferPercent) / 100 | 0;
        this.crownHistory.push({ tick: t, from: -1, to: taker, reason: 'pickup' });
        this._setAnim(taker, ANIM.crown_receive, t + 6);
        this.recorder.event(t, EV.CROWN_PICKUP, taker, g.x, g.y, this.hp[taker], 0);
      }
    }

    // Ground loot — item order, then botId order: exactly one owner, never duplicated.
    const pr = rs.bot.pickupRadius;
    for (let k = 0; k < this.items.length; k++) {
      const it = this.items[k];
      if (it.taken) continue;
      let taker = -1;
      this.forEachNear(it.x, it.y, pr + 4, (j) => {
        if (taker >= 0 || !this.alive[j] || this.stun[j] > 0) return;
        const dx = (this.px[j] / FP | 0) - it.x, dy = (this.py[j] / FP | 0) - it.y;
        if (dx * dx + dy * dy > pr * pr) return;
        if (!this.wantsItem(j, it)) return;
        taker = j;
      });
      if (taker < 0) continue;
      it.taken = true;
      if (it.cons >= 0) {
        this._bagAdd(taker, it.cons);
        this._setAnim(taker, ANIM.pickup, t + rs.combat.pickupAnimTicks);
        this.recorder.event(t, EV.CONSUMABLE_PICKUP, taker, it.id, it.cons, it.x, it.y);
        continue;
      }
      const old = this.weapon[taker];
      this.weapon[taker] = it.weapon;
      this._setAnim(taker, ANIM.pickup, t + rs.combat.pickupAnimTicks);
      this.recorder.event(t, EV.PICKUP, taker, it.id, it.weapon, it.x, it.y);
      if (old >= 0) {
        const [dx2, dy2] = this._placeItem(it.x + 18, it.y + 18);
        const drop = { id: this.items.length, weapon: old, cons: -1, x: dx2, y: dy2, taken: false, fromSupply: false };
        this.items.push(drop);
        this.recorder.event(t, EV.DROP, taker, drop.id, old, drop.x, drop.y);
      }
    }

    // Treasure chests — botId order; touching one while hurt opens it and the cheese heals.
    const cr = rs.loot.chestRadius || 34;
    for (let k = 0; k < this.chests.length; k++) {
      const c = this.chests[k];
      if (c.opened) continue;
      let taker = -1;
      this.forEachNear(c.x, c.y, cr + 4, (j) => {
        if (!this.alive[j] || this.hp[j] >= this.maxHp[j] || (taker >= 0 && j > taker)) return;
        const dx = (this.px[j] / FP | 0) - c.x, dy = (this.py[j] / FP | 0) - c.y;
        if (dx * dx + dy * dy <= cr * cr) taker = j;
      });
      if (taker < 0) continue;
      c.opened = true;
      const before = this.hp[taker];
      this.hp[taker] = Math.min(this.maxHp[taker], this.hp[taker] + rs.loot.chestHeal * HP_SCALE);
      this.healed[taker] += this.hp[taker] - before;
      this._setAnim(taker, ANIM.pickup, t + rs.combat.pickupAnimTicks);
      this.recorder.event(t, EV.CHEST_OPEN, taker, c.id, this.hp[taker] - before, c.x, c.y);
      this.recorder.event(t, EV.HEAL, taker, -4, this.hp[taker] - before, this.hp[taker], 0);
    }

    // Supply crates — bot-first so a bot standing between two crates keeps opening one
    // of them instead of restarting its dwell every tick.
    const SUPPLY_REACH = 46;
    for (let taker = 0; taker < this.N; taker++) {
      if (!this.alive[taker] || this.stun[taker] > 0) { this.openingSupply[taker] = -1; continue; }
      const bx = this.px[taker] / FP | 0, by = this.py[taker] / FP | 0;
      let k = -1;
      const cur = this.openingSupply[taker];
      if (cur >= 0 && !this.supplies[cur].taken) {        // stay on the crate already being opened
        const dx = bx - this.supplies[cur].x, dy = by - this.supplies[cur].y;
        if (dx * dx + dy * dy <= SUPPLY_REACH * SUPPLY_REACH) k = cur;
      }
      if (k < 0) {
        for (let m = 0; m < this.supplies.length; m++) {
          const c = this.supplies[m];
          if (c.taken || c.tick > t) continue;
          const dx = bx - c.x, dy = by - c.y;
          if (dx * dx + dy * dy <= SUPPLY_REACH * SUPPLY_REACH) { k = m; break; }
        }
      }
      if (k < 0) { this.openingSupply[taker] = -1; this.openingTicks[taker] = 0; continue; }
      const s = this.supplies[k];
      if (this.openingSupply[taker] !== k) { this.openingSupply[taker] = k; this.openingTicks[taker] = 0; }
      this.openingTicks[taker]++;
      if (this.openingTicks[taker] < rs.loot.supplyOpenTicks) continue;
      s.taken = true;
      this.openingSupply[taker] = -1;
      const old = this.weapon[taker];
      if (old < 0 || WEAPONS[s.weapon].tier >= WEAPONS[old].tier) {
        this.weapon[taker] = s.weapon;
        if (old >= 0) {
          const [dx2, dy2] = this._placeItem(s.x + 20, s.y + 20);
          const drop = { id: this.items.length, weapon: old, cons: -1, x: dx2, y: dy2, taken: false, fromSupply: false };
          this.items.push(drop);
          this.recorder.event(t, EV.DROP, taker, drop.id, old, drop.x, drop.y);
        }
      }
      const before = this.hp[taker];
      this.hp[taker] = Math.min(this.maxHp[taker], this.hp[taker] + s.heal * HP_SCALE);
      this.healed[taker] += this.hp[taker] - before;
      this._setAnim(taker, ANIM.pickup, t + rs.combat.pickupAnimTicks);
      this.recorder.event(t, EV.SUPPLY_OPEN, taker, s.id, s.weapon, this.hp[taker], s.cons);
      if (this.hp[taker] > before) this.recorder.event(t, EV.HEAL, taker, -3, this.hp[taker] - before, this.hp[taker], 0);
      // Every crate also holds one healing item: into the bag, or onto the ground if full.
      if (s.cons >= 0 && !this._bagAdd(taker, s.cons)) {
        const [cx2, cy2] = this._placeItem(s.x - 20, s.y + 20);
        const it = { id: this.items.length, weapon: -1, cons: s.cons, x: cx2, y: cy2, taken: false, fromSupply: true };
        this.items.push(it);
        this.recorder.event(t, EV.DROP, taker, it.id, -1 - s.cons, it.x, it.y);
      }
    }
  }

  // 10) end condition + deterministic tie-breaks
  _phaseEndCondition(t) {
    const rs = this.ruleset;
    if (this.aliveCount === 1) {
      for (let i = 0; i < this.N; i++) if (this.alive[i]) { this._finish(i, t, 'lastSurvivor'); return; }
    }
    if (this.aliveCount === 0) {
      const w = this._tieBreak(t);
      this.alive[w] = 1; this.hp[w] = HP_SCALE; this.aliveCount = 1;
      this.deathTick[w] = -1; this.rank[w] = 0;
      this.recorder.event(t, EV.TIEBREAK, w, 0, 0, 0, 0);   // SIMULTANEOUS_FINAL_TIEBREAK
      this._finish(w, t, 'simultaneousFinalTiebreak');
      return;
    }
    if (t >= rs.zone.hardLimitTicks) {
      const w = this._tieBreak(t);
      for (let i = 0; i < this.N; i++) {
        if (i === w || !this.alive[i]) continue;
        this.alive[i] = 0; this.hp[i] = 0; this.deathTick[i] = t; this.rank[i] = this.aliveCount;
        this.aliveCount--;
        this.recorder.event(t, EV.DEATH, i, -1, this.rank[i], this.weapon[i], 1);
      }
      this.recorder.event(t, EV.TIEBREAK, w, 1, 0, 0, 0);   // HARD_TIMEOUT_TIEBREAK
      this._finish(w, t, 'hardTimeoutTiebreak');
    }
  }

  /** (hp before this tick's damage, damage dealt, kills, lowest botId) — fully deterministic. */
  _tieBreak(t) {
    const pool = [];
    for (let i = 0; i < this.N; i++) {
      if (this.alive[i] || this.deathTick[i] === t) pool.push(i);
    }
    if (pool.length === 0) for (let i = 0; i < this.N; i++) pool.push(i);
    pool.sort((a, b) =>
      (this.dmgTaken[a] - this.dmgTaken[b]) ||
      (this.dmgDealt[b] - this.dmgDealt[a]) ||
      (this.kills[b] - this.kills[a]) ||
      (a - b));
    return pool[0];
  }

  _finish(winnerId, t, reason) {
    this.ended = true;
    this.winnerId = winnerId;
    this.endTick = t;
    this.endReason = reason;
    this.rank[winnerId] = 1;
    this.recorder.event(t, EV.MATCH_END, winnerId, t, this.kills[winnerId], this.crownHolder, 0);
  }

  _setAnim(i, anim, until) {
    if (this.anim[i] === ANIM.death) return;
    this.anim[i] = anim; this.animUntil[i] = until;
  }

  // 11) record snapshot
  _phaseRecord(t) {
    // Live points: every tick alive (crown holder x crownLiveMul). Counted before the
    // snapshot gate so every tick scores.
    const sc = this.ruleset.score;
    if (sc) for (let i = 0; i < this.N; i++) if (this.alive[i]) this.liveTicks[i] += sc.livePerSecond * (this.crown[i] ? sc.crownLiveMul : 1);
    if (t % SNAPSHOT_EVERY !== 0 && !this.ended) return;
    const N = this.N;
    const frame = new Int32Array(N * SNAP_STRIDE);
    for (let i = 0; i < N; i++) {
      const o = i * SNAP_STRIDE;
      frame[o + S_X] = this.px[i] / FP | 0;
      frame[o + S_Y] = this.py[i] / FP | 0;
      frame[o + S_HP] = this.hp[i];
      let flags = 0;
      if (this.alive[i]) flags |= F_ALIVE;
      if (this.facing[i] < 0) flags |= F_FACE_LEFT;
      if (this.crown[i]) flags |= F_CROWN;
      if (this.dashLeft[i] > 0) flags |= F_DASH;
      if (this.stun[i] > 0) flags |= F_STUN;
      if (this.windup[i] > 0) flags |= F_ATTACK;
      if (this.useLeft[i] > 0) flags |= F_CONSUMING;
      if (this.hotLeft[i] > 0) flags |= F_HOT;
      if (this.hasteLeft[i] > 0) flags |= F_HASTE;
      flags |= (this.bagCount[i] & 3) << F_BAG_SHIFT;
      frame[o + S_FLAGS] = flags;
      frame[o + S_WEAPON] = this.weapon[i];
      let anim = this.anim[i];
      if (!this.alive[i]) anim = ANIM.death;
      else if (t >= this.animUntil[i]) anim = (this.vx[i] | this.vy[i]) !== 0 ? ANIM.run : ANIM.stand;
      frame[o + S_ANIM] = anim;
    }
    const proj = [];
    for (let k = 0; k < this.projectiles.length; k++) {
      const p = this.projectiles[k];
      if (!p.alive) continue;
      proj.push(p.x / FP | 0, p.y / FP | 0, p.vx, p.vy, p.weapon, p.owner);
    }
    const loot = [];
    for (let k = 0; k < this.items.length; k++) {
      const it = this.items[k];
      if (it.taken) continue;
      if (it.cons >= 0) loot.push(it.x, it.y, it.cons, 2);          // kind 2: healing item
      else loot.push(it.x, it.y, it.weapon, 0);
    }
    for (let k = 0; k < this.supplies.length; k++) {
      const s = this.supplies[k];
      if (!s.taken && s.tick <= t) loot.push(s.x, s.y, s.weapon, 1);
    }
    // Ground loot rarely changes between snapshots: when it did not, reuse the previous
    // frame object (same content, so the replay hash is unchanged) — this used to be half
    // of a replay's bytes, copied to the page and kept in memory once per snapshot.
    let lootFrame = this._lastLoot;
    if (!lootFrame || lootFrame.length !== loot.length || loot.some((v, k) => v !== lootFrame[k])) {
      lootFrame = Int32Array.from(loot);
      this._lastLoot = lootFrame;
    }
    this.recorder.snapshot(t, frame,
      [this.zone.cx, this.zone.cy, this.zone.r, this.zone.dps],
      Int32Array.from(proj), lootFrame,
      [this.crownHolder, this.crownGround ? this.crownGround.x : -1, this.crownGround ? this.crownGround.y : -1]);
  }

  /** Live points (whole seconds, crown-weighted), kill points and the combined score. */
  scoreOf(i) {
    const sc = this.ruleset.score || { killValueLP: 0 };
    const livePoints = Math.floor(this.liveTicks[i] / TICK_HZ);
    const killPoints = this.killPts[i];
    return { livePoints, killPoints, score: livePoints + sc.killValueLP * killPoints };
  }

  // ---------------------------------------------------------------- result
  buildResult() {
    const standings = [];
    for (let i = 0; i < this.N; i++) {
      standings.push({
        botId: i,
        name: this.botDefs[i].name,
        tokenId: this.botDefs[i].tokenId,
        rank: this.rank[i] || this.N,
        kills: this.kills[i],
        damage: Math.round(this.dmgDealt[i] / HP_SCALE),
        damageTaken: Math.round(this.dmgTaken[i] / HP_SCALE),
        deathTick: this.deathTick[i],
        weapon: this.weapon[i] >= 0 ? WEAPONS[this.weapon[i]].id : null,
        healed: Math.round(this.healed[i] / HP_SCALE),
        itemsUsed: this.itemsUsed[i],
        personality: this.botDefs[i].personality,
        ...this.scoreOf(i),
      });
    }
    standings.sort((a, b) => a.rank - b.rank || a.botId - b.botId);
    const result = {
      winnerId: this.winnerId,
      winnerName: this.winnerId >= 0 ? this.botDefs[this.winnerId].name : null,
      planHash: this.plan.planHash,
      endTick: this.endTick,
      endReason: this.endReason,
      durationSeconds: Math.round((this.endTick / TICK_HZ) * 10) / 10,
      botCount: this.N,
      totalEvents: this.recorder.events.length,
      crownHistory: this.crownHistory,
      standings,
    };
    result.resultHash = hashObject({
      planHash: result.planHash,
      winnerId: result.winnerId, endTick: result.endTick, endReason: result.endReason,
      standings: result.standings.map((s) => [s.botId, s.rank, s.kills, s.damage, s.deathTick, s.livePoints, s.killPoints]),
      crownHistory: result.crownHistory.map((c) => [c.tick, c.from, c.to, c.reason]),
    });
    return result;
  }
}

/**
 * Simulate(MatchKey) -> immutable replay + result. Pure: same input, same bytes.
 * `onProgress(tick, aliveCount)` is observational only and can never affect the run.
 */
export function simulate(manifest, ruleset, onProgress, shouldCancel) {
  const sim = new Sim(manifest, ruleset);
  const limit = ruleset.zone.hardLimitTicks + 200;
  let guard = 0;
  while (!sim.ended && guard++ < limit) {
    sim.step();
    if (onProgress && (sim.tick & 63) === 0) onProgress(sim.tick, sim.aliveCount);
    if (shouldCancel && (sim.tick & 63) === 0 && shouldCancel()) return null;
  }
  if (!sim.ended) {                                   // absolute backstop; must not happen
    const w = sim._tieBreak(sim.tick);
    sim.recorder.event(sim.tick, EV.TIEBREAK, w, 2, 0, 0, 0);
    sim._finish(w, sim.tick, 'guardTiebreak');
    sim._phaseRecord(sim.tick);
  }
  sim.recorder.finalise();
  const result = sim.buildResult();
  const replay = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    simulatorVersion: SIMULATOR_VERSION,
    manifest,
    initial: {
      world: { width: ruleset.world.width, height: ruleset.world.height },
      obstacles: sim.obstacles,
      decor: generateDecor(sim.seed, ruleset, sim.obstacles),
      chests: sim.chests.map((c) => ({ id: c.id, x: c.x, y: c.y, opened: false })),
      planHash: sim.plan.planHash,
      supplyPlan: sim.supplyPlan,
      score: ruleset.score,
      bots: sim.botDefs.map((b) => ({
        id: b.id, name: b.name, appearance: b.appearance, personality: b.personality,
        tokenId: b.tokenId, dna: b.dna, equipment: b.equipment, stats: b.stats, strMul: b.strMul,
        maxHp: b.maxHp, moveSpeed: b.moveSpeed, aggression: b.aggression, caution: b.caution,
        aimSkill: b.aimSkill, dodgeSkill: b.dodgeSkill, lootingBias: b.lootingBias,
        awareness: b.awareness, armor: b.armor, spawnX: b.x / FP | 0, spawnY: b.y / FP | 0,
        landTick: sim.landTick[b.id],
      })),
      zoneSchedule: sim.zoneSchedule,
      snapshotEvery: SNAPSHOT_EVERY,
      tickHz: TICK_HZ,
    },
    snapshotTicks: sim.recorder.snapshotTickArray,
    snapshots: sim.recorder.snapshots,
    zoneFrames: sim.recorder.zoneFrames,
    projFrames: sim.recorder.projFrames,
    lootFrames: sim.recorder.lootFrames,
    crownFrames: sim.recorder.crownFrames,
    events: sim.recorder.events,
    decisions: sim.recorder.decisions,
    result,
  };
  replay.replayHash = sim.recorder.hash();
  replay.result.replayHash = replay.replayHash;
  return replay;
}
