// UI shell: setup -> precompute (worker) -> verify -> replay -> result.
// The UI never simulates and never writes to replay data.
import { ReplayReader, validateReplay } from '../replay/replay.js';
import { AssetLibrary, SPRITE_PX } from '../render/assets.js';
import { Renderer } from '../render/renderer.js';
import { CameraDirector, CAM_AUTO, CAM_FOLLOW, CAM_FREE } from '../render/camera.js';
import { ACTIONS, TICK_HZ, EV } from '../core/constants.js';
import { WEAPONS } from '../core/ruleset.js';
import { canonicalSeed } from '../core/rng.js';
import { STAT_KEYS, STAT_NAMES, HEAD_KEYS, BACK_KEYS, statTotal } from '../core/hamster.js';
import { OUTFIT_BODY } from '../core/appearance.js';
import { squeekAudio } from './audio.js';

const pretty = (k) => k.replace(/_/g, ' ');

// Language: follows the portal's EN/VI choice (<html lang>, set from localStorage at load and
// pushed live by /play when the viewer is embedded). L(en, vi) picks the active one.
const L = (en, vi) => (document.documentElement.lang === 'vi' ? vi : en);
const STAT_NAMES_EN = { str: 'Strength', agi: 'Agility', arm: 'Armor', vit: 'Vitality', per: 'Perception' };
function applyAttrLang() {
  const lang = document.documentElement.lang === 'vi' ? 'vi' : 'en';
  for (const el of document.querySelectorAll('[data-t-en]')) el.textContent = el.getAttribute(`data-t-${lang}`);
  for (const el of document.querySelectorAll('[data-title-en]')) el.setAttribute('title', el.getAttribute(`data-title-${lang}`));
}
applyAttrLang();
new MutationObserver(applyAttrLang).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
/** Equipment + the five stats it grants, as a small HTML block (Inspector). */
function statBlock(def) {
  if (!def.stats) return '';
  const eq = def.equipment || {};
  const bar = (k) => `<div class="score-row"><span style="color:var(--text-muted)">${L(STAT_NAMES_EN[k], STAT_NAMES[k])}</span><span class="score-bar"><i style="width:${Math.min(100, def.stats[k] * 5)}%;background:var(--gold)"></i></span><span class="mono">${def.stats[k]}</span></div>`;
  return `<div style="margin:6px 0 2px;color:var(--text-muted);font-size:.74rem">${L('Gear', 'Trang bị')}: <b>${pretty(OUTFIT_BODY[eq.body] || '-')}</b> · ${pretty(HEAD_KEYS[eq.head] || 'none')} · ${pretty(BACK_KEYS[eq.back] || 'none')}${def.tokenId != null ? ` · NFT #${def.tokenId}` : ''} · ${L('total', 'tổng')} ${statTotal(def.stats)}</div>` +
    STAT_KEYS.map(bar).join('');
}

const $ = (id) => document.getElementById(id);
const screens = { setup: $('setupScreen'), play: $('playScreen'), result: $('resultScreen') };

const app = {
  worker: null,
  replay: null,
  reader: null,
  renderer: null,
  camera: null,
  assets: new AssetLibrary(),
  playing: false,
  speed: 1,
  tickFloat: 0,
  lastFrameMs: 0,
  rafId: 0,
  hideWinner: true,
  computeMs: 0,
};

function show(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('active', k === name);
  if (name === 'play') requestAnimationFrame(() => { app.renderer && app.renderer.resize(); });
}

function setStage(key, state) {
  const el = document.querySelector(`.stage[data-stage="${key}"]`);
  if (!el) return;
  el.classList.remove('active', 'done', 'fail');
  if (state) el.classList.add(state);
}
function resetStages() { for (const k of ['lock', 'precompute', 'verify', 'assets', 'ready']) setStage(k, null); }

function kv(obj) {
  return Object.entries(obj).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------------------------------------------------------- setup
// Cosmetic/UI randomness only — the seed becomes part of the immutable MatchKey, so the
// match itself stays fully reproducible from it (share links carry ?seed=).
const rollSeed = () => { $('seedInput').value = String(Math.floor(Math.random() * 4294967295)); };
$('btnRandomSeed').onclick = rollSeed;

$('btnGenerate').onclick = () => startMatch();
$('btnCancel').onclick = () => { if (app.worker) app.worker.postMessage({ type: 'cancel' }); };
// Hub live mode (?live=<unix time the match started>): the match runs on the wall clock — a late
// viewer joins at the current moment; a match that is already over shows its result and Replay.
const liveTick = () => Math.floor((Date.now() / 1000 - app.liveStart) * TICK_HZ);
$('btnPlay').onclick = () => {
  app.live = !!(app.hub && app.liveStart);
  document.body.classList.toggle('is-live', app.live);
  if (app.live && liveTick() >= app.reader.endTick) {
    app.live = false; document.body.classList.remove('is-live');
    enterPlay(app.reader.endTick); showResult();
    return;
  }
  enterPlay(app.live ? Math.max(0, liveTick()) : 0);
};
$('btnBackSetup').onclick = () => { stopLoop(); show('setup'); };
$('btnNewMatch').onclick = () => { stopLoop(); rollSeed(); show('setup'); };   // a new match = a new map

/**
 * startMatch(arenaConfig?) — normally from the setup form; an on-chain arena passes its
 * own manifest input (seed + entrants read from the contract) and nothing is editable.
 */
function startMatch(arenaConfig) {
  $('setupError').innerHTML = '';
  resetStages();
  $('btnPlay').disabled = true;
  $('btnGenerate').disabled = true;
  $('btnCancel').disabled = false;
  $('simProgress').value = 0;
  $('simStats').innerHTML = '';
  app.hideWinner = $('hideWinner').checked;

  const config = arenaConfig || {
    seed: $('seedInput').value.trim() || '0',
    botCount: Number($('botCount').value),
    presetId: $('preset').value,
    recordDecisions: Number($('botCount').value) <= 200,
  };

  setStage('lock', 'active');
  if (app.worker) app.worker.terminate();
  app.worker = new Worker(new URL('../workers/simulation.worker.js', import.meta.url), { type: 'module' });
  app.worker.onmessage = (e) => onWorkerMessage(e.data);
  app.worker.onerror = (err) => fail(`Worker error: ${err.message}`);
  app.worker.postMessage({ type: 'simulate', config });
}

function fail(msg) {
  $('setupError').innerHTML = `<div class="err">${msg}</div>`;
  $('btnGenerate').disabled = !!app.arenaInfo;      // watch-only arena: settings stay locked
  $('btnCancel').disabled = true;
}

async function onWorkerMessage(msg) {
  if (msg.type === 'manifest') {
    setStage('lock', 'done');
    setStage('precompute', 'active');
    $('simStats').innerHTML = kv({
      MatchKey: msg.manifest.matchKey,
      simulator: msg.manifest.simulatorVersion,
      rulesetHash: msg.manifest.rulesetHash,
      rng: msg.manifest.rngAlgorithmVersion,
      seed: `${msg.manifest.seedInput} → ${msg.manifest.seed}`,
      bots: msg.manifest.config.botCount,
    });
    return;
  }
  if (msg.type === 'progress') {
    const pct = Math.min(96, (msg.tick / 4800) * 100);
    $('simProgress').value = pct;
    const el = document.querySelector('.stage[data-stage="precompute"] span:last-child');
    if (el) el.textContent = `PRECOMPUTE — tick ${msg.tick} · alive ${msg.alive} · ${(msg.tick / TICK_HZ).toFixed(1)}s sim · ${msg.elapsedMs}ms`;
    return;
  }
  if (msg.type === 'cancelled') {
    setStage('precompute', 'fail');
    fail(L('Precompute cancelled. No replay was created.', 'Đã huỷ precompute. Chưa có replay nào được tạo.'));
    return;
  }
  if (msg.type === 'error') { setStage('precompute', 'fail'); fail(msg.message); return; }
  if (msg.type !== 'done') return;

  setStage('precompute', 'done');
  setStage('verify', msg.verdict.ok ? 'done' : 'fail');
  $('btnCancel').disabled = true;
  app.replay = msg.replay;
  app.computeMs = msg.computeMs;

  if (!msg.verdict.ok) {
    fail(L('VERIFY FAILED — replay rejected:<br>', 'VERIFY FAILED — replay bị từ chối:<br>') + msg.verdict.problems.join('<br>'));
    return;
  }
  if (app.arenaInfo) showArenaCheck(msg.replay);

  setStage('assets', 'active');
  const r = await app.assets.loadForMatch(app.replay.initial.bots, (done, total) => {
    $('simProgress').value = 96 + (done / total) * 4;
    const el = document.querySelector('.stage[data-stage="assets"] span:last-child');
    if (el) el.textContent = `ASSETS — ${done}/${total} layer AGY`;
  });
  setStage('assets', r.missing > 0 ? 'fail' : 'done');

  app.reader = new ReplayReader(app.replay);
  setStage('ready', 'done');
  $('simProgress').value = 100;
  $('btnGenerate').disabled = !!app.arenaInfo;      // watch-only arena: settings stay locked
  $('btnPlay').disabled = false;

  const res = app.replay.result;
  $('simStats').innerHTML = kv({
    MatchKey: app.replay.manifest.matchKey,
    replayHash: app.replay.replayHash,
    resultHash: res.resultHash,
    'match length': `${res.durationSeconds}s (${res.endTick} ticks)`,
    'compute time': `${msg.computeMs} ms`,
    events: res.totalEvents,
    snapshots: app.replay.snapshots.length,
    'end reason': res.endReason,
    winner: app.hideWinner ? L('🔒 locked, hidden until the replay ends', '🔒 đã chốt, ẩn tới khi xem xong') : `#${res.winnerId} ${res.winnerName}`,
    'assets AGY': r.missing > 0 ? L(`${r.loaded} loaded, ${r.missing} MISSING`, `${r.loaded} nạp, ${r.missing} THIẾU`) : `${r.loaded} layer OK`,
  });
}

// ---------------------------------------------------------------- play
function enterPlay(startTick) {
  const canvas = $('gameCanvas');
  app.renderer = new Renderer(canvas, app.reader, app.assets);
  app.camera = new CameraDirector(app.reader);
  app.renderer.resize();
  app.tickFloat = startTick;
  app.prevTick = -1;
  app.playing = true;
  app.speed = 1;
  document.querySelectorAll('.spd').forEach((b) => b.classList.toggle('active', b.dataset.s === '1'));
  document.querySelectorAll('.cam').forEach((b) => b.classList.toggle('active', b.dataset.c === 'auto'));
  $('seek').max = String(app.reader.endTick);
  $('btnPlayPause').textContent = '⏸';
  show('play');
  app.lastFrameMs = performance.now();
  stopLoop();               // cancels any old loop — and clears app.playing, so set it after
  app.playing = true;
  squeekAudio.startBgm('battle');
  squeekAudio.setBgmSuppressed(false);
  app.rafId = requestAnimationFrame(frame);
  applyHubView();
  // Apply ?follow=N URL param: auto-select and follow a specific bot (e.g. user's hamster from Arena Hub)
  if (app.followBotId != null && app.followBotId >= 0) {
    app.renderer.selectedId = app.followBotId;
    app.camera.setMode(CAM_FOLLOW);
    app.camera.followId = app.followBotId;
    document.querySelectorAll('.cam').forEach((b) => b.classList.toggle('active', b.dataset.c === 'follow'));
    $('inspector').classList.add('open');
    document.querySelector('.tgl[data-t="insp"]')?.classList.add('active');
  }
}

/** Hub mode: real-time, every overlay on; the viewer's own hamsters highlighted. */
function applyHubView() {
  const r = app.renderer;
  app.myIds = [];
  if (app.arenaInfo && app.me)                     // entry i = bot i (join order)
    app.myIds = app.arenaInfo.entries.filter((e) => e.player === app.me).map((e) => e.index);
  r.highlightIds = new Set(app.myIds);
  $('btnFollowMe').style.display = app.hub && app.myIds.length ? '' : 'none';
  $('btnFollowMe').classList.remove('active');
  if (!app.hub) return;
  app.speed = 1;
  r.showLabels = true; r.showHpBars = true; r.showVfx = true;
  document.querySelectorAll('.tgl[data-t="labels"], .tgl[data-t="hp"], .tgl[data-t="vfx"]').forEach((b) => b.classList.add('active'));
}

/** "Follow yourself": zoom in close on the viewer's hamster (the next one on each press, living first). */
$('btnFollowMe').onclick = () => {
  if (!app.renderer || !app.myIds || !app.myIds.length) return;
  const alive = app.myIds.filter((id) => app.reader.state.bots[id].alive);
  const pool = alive.length ? alive : app.myIds;
  const cur = pool.indexOf(app.camera.followId);
  const id = pool[(cur + 1) % pool.length];
  app.renderer.selectedId = id;
  app.camera.setMode(CAM_FOLLOW, id, 1.35);
  document.querySelectorAll('.cam').forEach((b) => b.classList.toggle('active', b.dataset.c === 'follow'));
  $('btnFollowMe').classList.add('active');
};

function stopLoop() { if (app.rafId) cancelAnimationFrame(app.rafId); app.rafId = 0; app.playing = false; }

function frame(now) {
  app.rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - app.lastFrameMs) / 1000);
  app.lastFrameMs = now;

  if (app.playing) {
    app.tickFloat += dt * TICK_HZ * app.speed;
    if (app.live) {                                   // stay on the wall clock (tab in the background, slow frames)
      const target = (Date.now() / 1000 - app.liveStart) * TICK_HZ;
      if (Math.abs(target - app.tickFloat) > 10) app.tickFloat = Math.min(target, app.reader.endTick);
    }
    if (app.tickFloat >= app.reader.endTick) {
      app.tickFloat = app.reader.endTick;
      app.playing = false;
      $('btnPlayPause').textContent = '▶';
      setTimeout(showResult, 900);
    }
  }

  const state = app.reader.sampleAt(app.tickFloat);
  const tickInt = Math.floor(app.tickFloat);
  if (app.prevTick !== tickInt) {
    app.renderer.ingestEvents(app.prevTick, tickInt);
    if (app.playing && app.prevTick >= 0 && tickInt > app.prevTick && tickInt - app.prevTick <= 12) {
      squeekAudio.ingestGameplayEvents(
        app.reader,
        app.camera,
        app.renderer.viewW,
        app.renderer.viewH,
        app.prevTick,
        tickInt,
        app.renderer.highlightIds
      );
    }
    app.prevTick = tickInt;
  }
  squeekAudio.battleIntensity = (state.zone.dps >= 16 || state.aliveCount <= 15) ? 1 : 0;
  squeekAudio.setBgmSuppressed(!app.playing);
  app.camera.update(tickInt, state, app.renderer.viewW, app.renderer.viewH, dt);
  app.renderer.draw(state, app.camera, dt);
  updateHud(state, tickInt);
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateHud(state, tick) {
  $('hudAlive').textContent = state.aliveCount;
  const t = tick / TICK_HZ;
  $('hudClock').textContent = fmt(t);
  $('clock').textContent = `${fmt(t)} / ${fmt(app.reader.endTick / TICK_HZ)}`;
  if (!app.seeking) $('seek').value = String(tick);
  const phases = app.replay.initial.zoneSchedule.phases;
  let ph = 0;
  for (let i = 0; i < phases.length; i++) if (tick >= phases[i].start) ph = i;
  $('hudPhase').textContent = state.zone.dps === 0 ? 'LOOT' : `ZONE ${ph} · ${state.zone.dps} dps`;
  const king = state.crownHolder;
  $('hudKing').textContent = king >= 0
    ? `♛ ${app.replay.initial.bots[king].name}`
    : (state.crownGroundX >= 0 ? L('♛ CROWN on the ground', '♛ CROWN rơi trên đất') : L('♛ CROWN: none yet', '♛ CROWN: chưa có'));
  $('hudCam').textContent = 'CAM ' + app.camera.mode.toUpperCase() +
    (app.camera.mode === CAM_FOLLOW && app.camera.followId >= 0 ? ` · ${app.replay.initial.bots[app.camera.followId].name}` : '') +
    (app.camera.mode === CAM_AUTO && app.camera.lastPick ? ` · ${app.camera.lastPick.label}` : '');

  const kf = app.renderer.killFeed.map((k) => {
    const w = k.weapon >= 0 ? WEAPONS[k.weapon].name : 'Bare Paws';
    return `<div class="kf"><b style="color:var(--gold)">${app.replay.initial.bots[k.killer].name}</b> ⚔ ${app.replay.initial.bots[k.victim].name} <span style="color:var(--text-muted)">· ${w}</span></div>`;
  }).join('');
  $('killFeed').innerHTML = kf;

  app.lbFrame = (app.lbFrame || 0) + 1;
  if (app.lbFrame % 8 === 1) {
    // Live score board: live points + K x kill points, the thing every hamster plays for.
    const alive = state.bots.filter((b) => b.alive);
    const sc = alive.map((b) => ({ b, s: scoreAt(b.id, tick) }));
    sc.sort((p, q) => q.s.score - p.s.score || p.b.id - q.b.id);
    $('lbBody').innerHTML = sc.slice(0, 8).map(({ b, s }) =>
      `<div class="lb-row${b.id === app.renderer.selectedId ? ' me' : ''}"><span>${b.crown ? '♛ ' : ''}${app.replay.initial.bots[b.id].name}</span>` +
      `<b title="live ${s.lp} + kill ${s.kp}">${s.score}</b></div>`).join('');
  }

  // The Inspector rebuilds a lot of DOM: ~8 times a second is plenty (every frame caused jank).
  if ($('inspector').classList.contains('open') && app.renderer.selectedId >= 0 && app.lbFrame % 8 === 4) updateInspector(tick);
}

/**
 * Score of bot `id` at `tick`, rebuilt from the replay so it can be shown live while seeking:
 * live points (1/s, x crownLiveMul while crowned) + K x kill points (crown kills x crownKillMul).
 * The final numbers are exactly the simulator's (result.standings).
 */
function scoreTrack() {
  if (app.scoreTrack && app.scoreTrack.replay === app.replay) return app.scoreTrack;
  const r = app.replay, N = r.initial.bots.length;
  const sc = r.initial.score || { livePerSecond: 1, crownLiveMul: 2, killPoints: 1, crownKillMul: 2, killValueLP: 0 };
  const death = new Int32Array(N).fill(-1);
  const crown = Array.from({ length: N }, () => []);           // [start, end) tick intervals
  let holder = -1, since = 0;
  const kills = [];
  const take = (who, t) => { if (holder >= 0) crown[holder].push([since, t]); holder = who; since = t; };
  const transferAt = new Map();
  for (const e of r.events) {
    if (e.type === EV.DEATH) death[e.a] = e.t;
    else if (e.type === EV.CROWN_CREATE || e.type === EV.CROWN_PICKUP) take(e.a, e.t + 1);
    else if (e.type === EV.CROWN_TRANSFER) { take(e.b, e.t + 1); transferAt.set(`${e.t}:${e.a}`, 1); }
    else if (e.type === EV.CROWN_DROP) take(-1, e.t + 1);
  }
  if (holder >= 0) crown[holder].push([since, 1 << 30]);
  for (const e of r.events) if (e.type === EV.KILL) kills.push({ t: e.t, a: e.a, pts: sc.killPoints * (transferAt.has(`${e.t}:${e.b}`) ? sc.crownKillMul : 1) });
  app.scoreTrack = { replay: r, sc, death, crown, kills };
  return app.scoreTrack;
}
function scoreAt(id, tick) {
  const { sc, death, crown, kills } = scoreTrack();
  const end = Math.min(tick + 1, death[id] >= 0 ? death[id] : tick + 1);
  let ticks = end * sc.livePerSecond;
  for (const [a, b] of crown[id]) ticks += Math.max(0, Math.min(b, end) - a) * sc.livePerSecond * (sc.crownLiveMul - 1);
  let kp = 0;
  for (const k of kills) { if (k.t > tick) break; if (k.a === id) kp += k.pts; }
  const lp = Math.floor(ticks / TICK_HZ);
  return { lp, kp, score: lp + sc.killValueLP * kp };
}

function updateInspector(tick) {
  const id = app.renderer.selectedId;
  const def = app.replay.initial.bots[id];
  const d = app.reader.decisionAt(id, tick);
  const b = app.reader.state.bots[id];
  $('insName').textContent = `#${id} ${def.name}`;
  let html = `<div style="color:var(--text-muted);margin-bottom:6px">${def.personality} · HP ${b.hp.toFixed(0)}/${(def.maxHp / 100).toFixed(0)} · ${b.weapon >= 0 ? WEAPONS[b.weapon].name : 'Bare Paws'} · ${L('bag', 'túi')} ${b.bag}/3${b.consuming ? ` · <b style="color:#5ee08a">${L('eating', 'đang ăn')}</b>` : ''}${b.hot ? ` · ${L('regenerating', 'hồi dần')}` : ''}${b.haste ? ` · ${L('hasted', 'tăng tốc')}` : ''}${b.alive ? '' : ' · <b style="color:var(--crimson)">DEAD</b>'}</div>`;
  if (!d) html += `<div style="color:var(--text-muted)">${L('No decision trace (enabled when botCount ≤ 200).', 'Không có decision trace (bật khi botCount ≤ 200).')}</div>`;
  else {
    html += ACTIONS.map((a, k) =>
      `<div class="score-row${k === d.action ? ' sel' : ''}"><span style="color:${k === d.action ? 'var(--gold)' : 'var(--text-muted)'}">${a}</span><span class="score-bar"><i style="width:${d.scores[k]}%"></i></span><span class="mono">${d.scores[k]}</span></div>`).join('');
    html += `<div style="margin-top:6px;color:var(--text-muted)">chosen <b style="color:var(--gold)">${ACTIONS[d.action]}</b>${d.target >= 0 ? ` → ${app.replay.initial.bots[d.target].name}` : ''} · tick ${d.tick}</div>`;
  }
  html += statBlock(def);
  html += `<div style="margin-top:6px;color:var(--text-muted);font-size:.72rem">aggr ${def.aggression} · caution ${def.caution} · aim ${def.aimSkill} · dodge ${def.dodgeSkill} · loot ${def.lootingBias} · armor ${def.armor}%</div>`;
  $('insBody').innerHTML = html;
}

// --- playback controls -------------------------------------------------------
$('btnPlayPause').onclick = () => {
  if (app.tickFloat >= app.reader.endTick) app.tickFloat = 0;
  app.playing = !app.playing;
  $('btnPlayPause').textContent = app.playing ? '⏸' : '▶';
};
$('btnRestart').onclick = () => { seekTo(0); };
$('btnNextKill').onclick = () => {
  const t = app.reader.nextKillAfter(Math.floor(app.tickFloat));
  if (t !== null) seekTo(Math.max(0, t - 30));
};
function seekTo(tick) {
  if (app.hub) return;                               // the Hub plays in real time: no seeking
  app.tickFloat = Math.max(0, Math.min(app.reader.endTick, tick));
  app.prevTick = -1;
  app.lbFrame = 0;
  app.renderer.effects.length = 0;
  app.renderer.killFeed.length = 0;
  app.camera.shotUntilTick = -1;
}
$('seek').addEventListener('input', (e) => { app.seeking = true; seekTo(Number(e.target.value)); });
$('seek').addEventListener('change', () => { app.seeking = false; });

document.querySelectorAll('.spd').forEach((b) => b.onclick = () => {
  app.speed = Number(b.dataset.s);
  document.querySelectorAll('.spd').forEach((x) => x.classList.toggle('active', x === b));
});
document.querySelectorAll('.cam').forEach((b) => b.onclick = () => {
  const m = b.dataset.c;
  app.camera.setMode(m === 'follow' ? CAM_FOLLOW : m === 'free' ? CAM_FREE : CAM_AUTO,
                     m === 'follow' ? (app.renderer.selectedId >= 0 ? app.renderer.selectedId : 0) : -1);
  document.querySelectorAll('.cam').forEach((x) => x.classList.toggle('active', x === b));
  $('btnFollowMe').classList.remove('active');
});
document.querySelectorAll('.tgl').forEach((b) => b.onclick = () => {
  const t = b.dataset.t;
  if (t === 'labels') app.renderer.showLabels = !app.renderer.showLabels;
  if (t === 'hp') app.renderer.showHpBars = !app.renderer.showHpBars;
  if (t === 'vfx') app.renderer.showVfx = !app.renderer.showVfx;
  if (t === 'insp') $('inspector').classList.toggle('open');
  b.classList.toggle('active');
});
$('btnCloseInsp').onclick = () => {
  $('inspector').classList.remove('open');
  document.querySelector('.tgl[data-t="insp"]').classList.remove('active');
};
squeekAudio.bindButton($('btnAudioToggle'));

// --- canvas interaction ------------------------------------------------------
$('gameCanvas').addEventListener('click', (e) => {
  if (!app.renderer) return;
  if (suppressClick) { suppressClick = false; return; }  // end of a drag, not a click
  const r = $('gameCanvas').getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const mm = app.renderer.minimapRect;
  if (mm && sx >= mm.x0 && sx <= mm.x0 + mm.size && sy >= mm.y0 && sy <= mm.y0 + mm.size) {
    app.camera.setMode(CAM_FREE);
    app.camera.targetX = (sx - mm.x0) / mm.k; app.camera.targetY = (sy - mm.y0) / mm.k;
    document.querySelectorAll('.cam').forEach((x) => x.classList.toggle('active', x.dataset.c === 'free'));
    return;
  }
  const [wx, wy] = app.camera.screenToWorld(sx, sy, app.renderer.viewW, app.renderer.viewH);
  let best = -1, bestD = 70;
  for (const b of app.reader.state.bots) {
    const d = Math.hypot(b.x - wx, b.y - wy);
    if (d < bestD) { bestD = d; best = b.id; }
  }
  app.renderer.selectedId = best;
  if (best >= 0) {
    $('inspector').classList.add('open');
    document.querySelector('.tgl[data-t="insp"]').classList.add('active');
    if (app.camera.mode === CAM_FOLLOW) app.camera.followId = best;
    updateInspector(Math.floor(app.tickFloat));
  }
});
$('gameCanvas').addEventListener('wheel', (e) => {
  if (!app.camera) return;
  e.preventDefault();
  app.camera.setMode(CAM_FREE);
  document.querySelectorAll('.cam').forEach((x) => x.classList.toggle('active', x.dataset.c === 'free'));
  app.camera.targetZoom = Math.max(0.05, Math.min(1.8, app.camera.targetZoom * (e.deltaY > 0 ? 0.88 : 1.14)));
}, { passive: false });
// Drag to pan. Any drag switches the camera to Free (otherwise Auto/Follow would yank
// the view back every frame), the map follows the pointer 1:1, and a drag never counts
// as a click (which used to select a bot and open the Inspector on release).
let dragging = null, suppressClick = false;
$('gameCanvas').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  dragging = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
});
window.addEventListener('pointerup', () => { if (dragging && dragging.moved > 4) suppressClick = true; dragging = null; });
window.addEventListener('pointermove', (e) => {
  if (!dragging || !app.camera || !app.renderer) return;
  const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
  dragging.x = e.clientX; dragging.y = e.clientY;
  dragging.moved += Math.abs(dx) + Math.abs(dy);
  if (dragging.moved <= 4) return;                       // still a click, not a drag
  if (app.camera.mode !== CAM_FREE) {
    try { $('gameCanvas').setPointerCapture(dragging.id); } catch (_) { /* pointer already gone */ }
    app.camera.setMode(CAM_FREE);
    document.querySelectorAll('.cam').forEach((x) => x.classList.toggle('active', x.dataset.c === 'free'));
  }
  app.camera.panBy(dx, dy, app.renderer.viewW, app.renderer.viewH);
});
window.addEventListener('resize', () => { if (app.renderer) app.renderer.resize(); });
window.addEventListener('keydown', (e) => {
  if (!screens.play.classList.contains('active')) return;
  if (e.code === 'Space') { e.preventDefault(); $('btnPlayPause').click(); }
  if (app.hub) return;
  if (e.code === 'ArrowRight') seekTo(app.tickFloat + 40);
  if (e.code === 'ArrowLeft') seekTo(app.tickFloat - 40);
});

// ---------------------------------------------------------------- result
$('btnToResult').onclick = showResult;
$('btnReplayAgain').onclick = () => { app.live = false; document.body.classList.remove('is-live'); enterPlay(0); };

function showResult() {
  stopLoop();
  squeekAudio.setBgmSuppressed(true);
  squeekAudio.playSfx('victory');
  const res = app.replay.result;
  const bots = app.replay.initial.bots;
  $('winnerName').textContent = `#${res.winnerId} ${res.winnerName}`;
  const w = res.standings[0];
  $('winnerMeta').innerHTML =
    `${bots[res.winnerId].personality} · <b>${w.kills}</b> kills · <b>${w.damage}</b> ${L('damage dealt', 'damage gây ra')} · ${L('survived', 'sống sót')} ${res.durationSeconds}s<br>` +
    `${L('Last weapon', 'Vũ khí cuối')}: ${w.weapon ? WEAPONS.find((x) => x.id === w.weapon).name : 'Bare Paws'} · ${L('ended by', 'kết thúc')}: ${res.endReason}`;

  const cv = $('winnerCanvas');
  const cx = cv.getContext('2d');
  cx.clearRect(0, 0, cv.width, cv.height);
  const sprite = app.assets.spriteFor(bots[res.winnerId].appearance, false,
    w.weapon ? WEAPONS.findIndex((x) => x.id === w.weapon) : -1, true);
  cx.drawImage(sprite, 0, 0, SPRITE_PX, SPRITE_PX, 0, 0, cv.width, cv.height);

  $('resultHashes').innerHTML = kv({
    MatchKey: app.replay.manifest.matchKey,
    seed: `${app.replay.manifest.seedInput} → ${app.replay.manifest.seed}`,
    simulatorVersion: app.replay.manifest.simulatorVersion,
    rulesetHash: app.replay.manifest.rulesetHash,
    rngAlgorithm: app.replay.manifest.rngAlgorithmVersion,
    assetVersion: app.replay.manifest.assetVersion,
    resultHash: res.resultHash,
    replayHash: app.replay.replayHash,
    'compute time': `${app.computeMs} ms`,
    'events / snapshots': `${res.totalEvents} / ${app.replay.snapshots.length}`,
  });

  $('crownTimeline').innerHTML = res.crownHistory.length === 0
    ? `<span style="color:var(--text-muted)">${L('No first blood — the Crown never appeared.', 'Không có first blood — Crown không xuất hiện.')}</span>`
    : res.crownHistory.map((c) => {
        const to = c.to >= 0 ? bots[c.to].name : L('(dropped on the ground)', '(rơi xuống đất)');
        const from = c.from >= 0 ? bots[c.from].name : '—';
        const label = c.reason === 'threeKills' ? L('takes the Crown (first to 3 kills)', 'nhận Crown (first blood)')
          : c.reason === 'kill' ? L(`steals the Crown from ${from}`, `cướp Crown từ ${from}`)
          : c.reason === 'pickup' ? L('picks up the dropped Crown', 'nhặt Crown rơi') : L(`Crown dropped by ${from}`, `Crown rơi khỏi ${from}`);
        return `<div style="padding:3px 0;border-bottom:1px solid rgba(74,53,96,.4)"><span class="mono" style="color:var(--gold)">${fmt(c.tick / TICK_HZ)}</span> — <b>${to}</b> ${label}</div>`;
      }).join('');

  const topScore = Math.max(...res.standings.map((s) => s.score || 0));
  $('standingsBody').innerHTML = res.standings.map((s) =>
    `<tr${s.rank === 1 ? ' style="color:var(--gold);font-weight:700"' : ''}>
      <td>${s.rank}</td><td>${s.name}</td><td style="color:var(--text-muted)">${s.personality}</td>
      <td${s.score === topScore ? ' style="color:var(--gold)"' : ''}><b>${s.score ?? '—'}</b></td>
      <td>${s.livePoints ?? '—'}</td><td>${s.killPoints ?? '—'}</td>
      <td>${s.kills}</td><td>${s.damage}</td><td style="color:var(--text-muted)">${s.damageTaken}</td>
      <td style="color:#5ee08a">${s.healed || 0}</td>
      <td>${s.deathTick < 0 ? '—' : (s.deathTick / TICK_HZ).toFixed(1)}</td>
      <td>${s.weapon ? WEAPONS.find((x) => x.id === s.weapon).name : '—'}</td></tr>`).join('');

  show('result');
}

function download(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

$('btnExportResult').onclick = () => {
  download(`squeek-${app.replay.manifest.seed}-result.json`, JSON.stringify({
    manifest: app.replay.manifest, result: app.replay.result, replayHash: app.replay.replayHash,
  }, null, 2));
};

$('btnExportReplay').onclick = () => {
  const r = app.replay;
  download(`squeek-${r.manifest.seed}-replay.json`, JSON.stringify({
    schemaVersion: r.schemaVersion, simulatorVersion: r.simulatorVersion,
    manifest: r.manifest, initial: r.initial,
    snapshotTicks: Array.from(r.snapshotTicks),
    snapshots: r.snapshots.map((s) => Array.from(s)),
    zoneFrames: r.zoneFrames, projFrames: r.projFrames.map((p) => Array.from(p)),
    lootFrames: r.lootFrames.map((l) => Array.from(l)), crownFrames: r.crownFrames,
    events: r.events, decisions: Array.from(r.decisions || []),
    result: r.result, replayHash: r.replayHash,
  }));
};

// --- shareable match links ---------------------------------------------------
// ?seed=...&bots=100&preset=standard&autostart=1&play=1 reproduces the exact same
// match on any machine, because the URL carries the whole MatchKey input.
(function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  // The viewer is part of /play, not a page of its own: opened directly on the public site it
  // sends the visitor to /play. (On localhost it still opens standalone, for development.)
  if (window.top === window.self && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
    location.replace('/play');
    return;
  }
  // ?hub=1 (Arena Hub embed): broadcast mode — no settings, no seeking, effects always on.
  // ?me=<address>: the viewer's wallet; its hamsters are highlighted and "Follow yourself" is offered.
  app.hub = q.get('hub') === '1';
  app.me = (q.get('me') || '').toLowerCase();
  app.liveStart = q.has('live') ? Number(q.get('live')) : null;
  if (app.hub) { document.body.classList.add('hub'); app.autoPlay = true; }
  if (q.has('follow')) app.followBotId = Number(q.get('follow'));  // camera follows this bot (from Arena Hub replay links)
  if (q.has('arena')) { openArena(Number(q.get('chain') || 11155111), Number(q.get('arena'))); return; }
  if (q.has('seed')) $('seedInput').value = q.get('seed');
  else rollSeed();                                   // every visit starts on a fresh random map
  if (q.has('bots')) $('botCount').value = q.get('bots');
  if (q.has('preset')) $('preset').value = q.get('preset');
  if (q.has('reveal')) $('hideWinner').checked = false;
  app.autoPlay = app.hub || q.get('play') === '1';
  if (q.get('autostart') === '1') startMatch();
})();

// --- on-chain arena: watch-only --------------------------------------------------
// ?arena=<id>&chain=<chainId> reads the arena's seed and entrants from SqueekArena and
// re-simulates the match locally. The viewer cannot change anything: the seed came from
// a block hash, the entrants and their drop points were fixed on-chain before the start.
async function openArena(chainId, arenaId) {
  for (const id of ['seedInput', 'btnRandomSeed', 'botCount', 'preset', 'btnGenerate']) $(id).disabled = true;
  const banner = $('arenaBanner');
  banner.style.display = 'block';
  banner.innerHTML = `<div class="note">${L(`Reading Arena #${arenaId} from chain ${chainId}…`, `Đang đọc Arena #${arenaId} từ chain ${chainId}…`)}</div>`;
  try {
    const { arenaManifestInput, NETWORKS } = await import('../chain/client.js');
    const { input, arena, entries } = await arenaManifestInput(chainId, arenaId);
    app.arenaInfo = { chainId, arenaId, arena, entries };
    $('seedInput').value = input.seed;
    $('preset').value = input.presetId;
    banner.innerHTML = `<div class="note" style="border-color:var(--gold)"><b style="color:var(--gold)">Arena #${arenaId}</b> · ${NETWORKS[chainId]?.name || chainId}
      · ${entries.length} hamster NFT · ${L('status', 'trạng thái')} <b>${arena.phase || arena.status}</b><br>${L(
        `View only: seed = hash of a block after registration closed (${arena.seedPinned ? 'pinned on-chain' : 'derived from the block, no transaction needed'}), players locked on-chain, drop points drawn from the seed.`,
        `Chế độ chỉ xem: seed = hash của một block sau khi đóng đăng ký (${arena.seedPinned ? 'đã ghi on-chain' : 'tính từ block, chưa cần giao dịch'}), người chơi đã khoá on-chain, điểm rơi bốc từ seed.`)}
      <a class="inspector-link" href="/play#battle-arena" target="_top">← ${L('back to the Arenas', 'về Đấu Trường')}</a></div>`;
    startMatch(input);
  } catch (e) {
    banner.innerHTML = '';
    fail(`${L('Could not read the arena', 'Không đọc được arena')}: ${e.shortMessage || e.message}`);
  }
}

/** After the local re-simulation: does it match what the operator posted on-chain? */
async function showArenaCheck(replay) {
  const { arena } = app.arenaInfo;
  const { bytes32ToHash } = await import('../chain/arena-manifest.js');
  const extra = {};
  if (arena.status === 'Settled') {
    const posted = bytes32ToHash(arena.resultHash);
    const ok = posted === replay.result.resultHash;
    extra['on-chain resultHash'] = `${posted} ${ok ? `<b style="color:var(--green)">✓ ${L('matches the simulation', 'khớp mô phỏng')}</b>` : `<b style="color:var(--crimson)">✗ ${L('DIFFERS from the simulation', 'KHÁC mô phỏng')}</b>`}`;
  } else extra['on-chain'] = L('result not posted yet', 'chưa công bố kết quả');
  extra.planHash = replay.result.planHash;
  $('simStats').insertAdjacentHTML('beforeend', kv(extra));
}

const _origPlayEnable = $('btnPlay');
new MutationObserver(() => {
  if (app.autoPlay && !_origPlayEnable.disabled) { app.autoPlay = false; _origPlayEnable.click(); }
}).observe(_origPlayEnable, { attributes: true, attributeFilter: ['disabled'] });

// Expose a tiny console API for determinism spot-checks from the browser.
window.squeek = {
  get replay() { return app.replay; },
  // Debug / tooling hooks (tools/browser-check.mjs --views drives the camera through these).
  get camera() { return app.camera; },
  get renderer() { return app.renderer; },
  state: () => (app.reader ? app.reader.sampleAt(app.tickFloat) : null),
  validate: () => validateReplay(app.replay),
  canonicalSeed,
};
