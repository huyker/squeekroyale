#!/usr/bin/env node
// Real-browser runtime check: serves the repo, drives headless Chrome over the DevTools
// protocol, plays whole matches from setup -> precompute -> replay -> result screen, and
// fails on any uncaught exception, console error, missing asset, or a replay that
// stops advancing before the end.
//   node tools/browser-check.mjs [--seeds 20261105,alpha] [--bots 100] [--presets standard,brawler,sniper]
//                                [--speed 16] [--shots <dir> [--views [--views-at 0.3]]] [--chrome <path>]
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, extname, resolve, dirname } from 'node:path';
// Without the optional art pack (src/assets/agy) its files 404 by design: the game draws dots instead.
import { tmpdir } from 'node:os';
const artMissing = (u) => String(u || '').includes('/src/assets/') && !existsSync(new URL('../src/assets/agy/manifest.json', import.meta.url));
import { fileURLToPath } from 'node:url';

import { ensureWebSocket } from './lib/browser.mjs';

ensureWebSocket(import.meta.url);           // Node 20 keeps WebSocket behind a flag

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const seeds = arg('seeds', '20261105,alpha').split(',');
const bots = Number(arg('bots', '100'));
const presets = arg('presets', 'standard,brawler,sniper').split(',');
const speed = Number(arg('speed', '16'));
const shots = arg('shots', null);
// --views: once mid-match, pause and capture close-up / storm-edge / whole-map shots (needs --shots).
const views = argv.includes('--views');
const viewsAt = Number(arg('views-at', '0.3'));
// --perf: before the speed-up, measure frame time + per-layer draw cost at 1x in 4 camera setups.
const perf = argv.includes('--perf');
const perfOff = arg('perf-off', '').split(',').filter(Boolean);   // e.g. props,storm,decor,ground
const CHROME_CANDIDATES = [
  arg('chrome', ''),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/plain' };

function serve() {
  const missing = [];
  const srv = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = resolve(ROOT, '.' + (path === '/' ? '/viewer.html' : path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(body);
    } catch { missing.push(path); res.writeHead(404).end(); }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port, missing })));
}

async function launchChrome() {
  const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error('no Chrome/Edge found; pass --chrome <path>');
  const profile = await mkdtemp(join(tmpdir(), 'squeek-chrome-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Kill Chrome and drop its throwaway profile when the check exits; without this every run
  // left a ~60 MB squeek-* folder in %TEMP% (114 of them had piled up to 6.6 GB).
  process.once('exit', () => {
    // On Windows proc.kill() only ends the parent; its GPU/renderer children keep the profile
    // locked, so take down the whole tree before deleting.
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); else proc.kill(); } catch {}
    // The tree takes a moment to release its file locks (rmSync's own maxRetries does not cover it).
    for (let t = Date.now(); existsSync(profile) && Date.now() - t < 5000;) {
      try { rmSync(profile, { recursive: true, force: true }); } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
    }
  });
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    const to = setTimeout(() => fail(new Error('Chrome did not expose DevTools')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(to); ok(m[1]); }
    });
  });
  return { proc, wsUrl };
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(cdp, port, seed, preset) {
  const errors = [];
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const onEvent = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`exception: ${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon.ico/.test(msg.params.entry.url || '') && !artMissing(msg.params.entry.url)) {
      errors.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  };
  cdp.handlers.push(onEvent);
  await S('Runtime.enable'); await S('Log.enable'); await S('Page.enable');
  // Background tabs get no requestAnimationFrame in headless Chrome: keep this one focused.
  await S('Page.bringToFront');
  await S('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Belt and braces: collect page errors in-page too (some rAF errors never reach CDP).
  await S('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errs = []; addEventListener('error', (e) => __errs.push(String(e.message) + ' @' + e.filename + ':' + e.lineno)); addEventListener('unhandledrejection', (e) => __errs.push('rejection: ' + String(e.reason && (e.reason.stack || e.reason))));" });
  await S('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const url = `http://127.0.0.1:${port}/viewer.html?seed=${encodeURIComponent(seed)}&bots=${bots}&preset=${preset}&autostart=1&play=1&reveal=1`;
  await S('Page.navigate', { url });

  const evalJs = async (expr) => (await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const STATE = `(() => {
    const act = ['setupScreen','playScreen','resultScreen'].find((id) => document.getElementById(id)?.classList.contains('active'));
    const c = document.getElementById('clock')?.textContent || '';
    return { screen: act, clock: c, seek: Number(document.getElementById('seek')?.value || 0), max: Number(document.getElementById('seek')?.max || 0) };
  })()`;

  const t0 = Date.now();
  let st = null, lastSeek = -1, stuckSince = Date.now(), sped = false, seekTested = false, shotsTaken = 0, viewsTaken = false, dragTested = false;
  const log = [];
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await sleep(400);
    st = await evalJs(STATE);
    if (!st) continue;
    if (st.screen === 'resultScreen') break;
    if (st.screen !== 'playScreen' || !st.max) continue;
    if (!sped && !dragTested) {
      // Real pointer drag on the canvas: must switch to the Free camera, move the view,
      // and must not count as a click (no bot selected, Inspector stays closed).
      dragTested = true;
      const before = await evalJs(`(() => { const c = squeek.camera; return { x: c.x, y: c.y }; })()`);
      const M = (type, x, y) => S('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
      await M('mousePressed', 700, 450);
      for (let k = 1; k <= 12; k++) { await M('mouseMoved', 700 - k * 25, 450 - k * 10); await sleep(16); }
      await M('mouseReleased', 400, 330);
      await sleep(200);
      const after = await evalJs(`(() => { const c = squeek.camera; return { mode: c.mode, x: c.x, y: c.y,
        insp: document.getElementById('inspector').classList.contains('open'), sel: squeek.renderer.selectedId }; })()`);
      const moved = Math.hypot(after.x - before.x, after.y - before.y);
      if (after.mode !== 'free' || moved < 50 || after.insp) errors.push(`drag-to-pan failed: ${JSON.stringify({ before, after })}`);
      else log.push('drag-tested');
      await evalJs(`(() => { squeek.camera.setMode('auto'); return 1; })()`);
    }
    if (perf && !sped) {
      const PERF = `(async () => {
        const R = squeek.renderer, P = Object.getPrototypeOf(R), acc = {};
        const OFF = ${JSON.stringify(perfOff)};
        const noop = { props: '_drawObstacle', storm: '_drawStorm', decor: '_drawDecor', ground: '_drawGround', loot: '_drawLoot', minimap: '_drawMinimap' };
        for (const k of OFF) if (noop[k]) P[noop[k]] = function () {};
        if (OFF.includes('bots')) P._drawBotBody = function () {};
        for (const k of ['_drawGround', '_drawDecor', '_drawLoot', '_drawCrownOnGround', '_drawBots', '_drawProjectiles', '_drawEffects', '_drawStorm', '_drawMinimap', 'draw']) {
          const f = P[k]; acc[k] = 0;
          R[k] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc[k] += performance.now() - t; return r; };
        }
        const out = [];
        const s = document.getElementById('seek');
        const VIEWS = ${JSON.stringify(arg('perf-views', 'auto,1,0.5,0.25,0.12'))}.split(',').map((v) => v === 'auto' ? ['auto', 0.25, 0] : ['zoom' + v, 0.25, Number(v)]);
        for (const [name, frac, zoom] of VIEWS) {
          s.value = String(Math.floor(Number(s.max) * frac)); s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change'));
          const c = squeek.camera;
          if (zoom) { const z = squeek.state().zone; c.setMode('free'); c.x = c.targetX = z.cx; c.y = c.targetY = z.cy; c.zoom = c.targetZoom = zoom; } else c.setMode('auto');
          await new Promise((r) => setTimeout(r, 400));
          for (const k in acc) acc[k] = 0;
          let frames = 0; const t0 = performance.now();
          await new Promise((r) => { const step = () => { frames++; if (performance.now() - t0 < 2500) requestAnimationFrame(step); else r(); }; requestAnimationFrame(step); });
          const dt = performance.now() - t0;
          const row = { view: name, fps: +(frames * 1000 / dt).toFixed(1), drawMs: +(acc.draw / frames).toFixed(2) };
          for (const k in acc) if (k !== 'draw') row[k.replace('_draw', '')] = +(acc[k] / frames).toFixed(2);
          out.push(row);
        }
        // Zoom sweep: zoom in and out continuously (0.12 <-> 1.0) for 3 s — catches hitches
        // (worst frame) and ground drift (pattern origin vs the map origin, device px).
        {
          const c = squeek.camera, z = squeek.state().zone;
          c.setMode('free'); c.x = c.targetX = z.cx; c.y = c.targetY = z.cy;
          for (const k in acc) acc[k] = 0;
          let frames = 0, worst = 0, last = performance.now(), drift = 0;
          const t0 = performance.now();
          await new Promise((r) => { const step = () => {
            const now = performance.now(); worst = Math.max(worst, now - last); last = now; frames++;
            const zz = 0.12 + 0.88 * (0.5 + 0.5 * Math.sin((now - t0) / 500));
            c.zoom = c.targetZoom = zz;
            if (now - t0 < 3000) requestAnimationFrame(step); else r(); };
            requestAnimationFrame(step); });
          const dt = performance.now() - t0;
          out.push({ view: 'zoom-sweep', fps: +(frames * 1000 / dt).toFixed(1), worstFrameMs: +worst.toFixed(1),
                     drawMs: +(acc.draw / frames).toFixed(2), Ground: +(acc._drawGround / frames).toFixed(2), groundMips: R.groundMips ? R.groundMips.size : 0 });
        }
        // Pan sweep: drag-like camera motion across the map at two zooms (targetX moves every
        // frame, as a pointer drag does). Reports worst frame and frames over 25 ms (jank).
        for (const zz of [0.5, 0.25]) {
          const c = squeek.camera, z = squeek.state().zone;
          c.setMode('free'); c.zoom = c.targetZoom = zz; c.x = c.targetX = z.cx - 2000; c.y = c.targetY = z.cy;
          await new Promise((r) => setTimeout(r, 300));
          for (const k in acc) acc[k] = 0;
          let frames = 0, worst = 0, jank = 0, last = performance.now();
          const t0 = performance.now();
          await new Promise((r) => { const step = () => {
            const now = performance.now(); const ft = now - last; last = now; frames++;
            if (frames > 1) { worst = Math.max(worst, ft); if (ft > 25) jank++; }
            c.targetX += 14 / zz; c.targetY += Math.sin((now - t0) / 300) * 6 / zz;
            if (now - t0 < 3000) requestAnimationFrame(step); else r(); };
            requestAnimationFrame(step); });
          const dt = performance.now() - t0;
          out.push({ view: 'pan-sweep@' + zz, fps: +(frames * 1000 / dt).toFixed(1), worstFrameMs: +worst.toFixed(1), jankFrames: jank,
                     drawMs: +(acc.draw / frames).toFixed(2), Bots: +(acc._drawBots / frames).toFixed(2), Decor: +(acc._drawDecor / frames).toFixed(2) });
        }
        squeek.camera.setMode('auto');
        return out;
      })()`;
      const rows = await evalJs(PERF);
      console.log(`perf ${preset} ${seed}`);
      for (const r of rows || []) console.log('  ' + JSON.stringify(r));
      stuckSince = Date.now(); lastSeek = -1;
    }
    if (!sped) {
      await evalJs(`(() => { const b = document.querySelector('.spd[data-s="4"]'); b.dataset.s = '${speed}'; b.click(); return 1; })()`);
      sped = true;
    }
    const frac = st.seek / st.max;
    // Seek back and forward once mid-match: the replay must keep playing afterwards.
    if (!seekTested && frac > 0.4) {
      await evalJs(`(() => { const s = document.getElementById('seek');
        for (const v of [0.1, 0.9, 0.42]) { s.value = String(Math.floor(${st.max} * v)); s.dispatchEvent(new Event('input')); }
        s.dispatchEvent(new Event('change')); return 1; })()`);
      seekTested = true; lastSeek = -1; log.push('seek-tested');
      continue;
    }
    if (shots && views && !viewsTaken && frac > viewsAt) {
      viewsTaken = true;
      await evalJs(`document.getElementById('btnPlayPause').click(), 1`);
      const VIEWS = [
        ['close', `(() => { const s = squeek.state(); const b = s.bots.filter((q) => q.alive).sort((p, q) => p.id - q.id)[0]; return { x: b.x, y: b.y, zoom: 1.0 }; })()`],
        ['storm', `(() => { const z = squeek.state().zone; return { x: z.cx + z.r * 0.92, y: z.cy - z.r * 0.25, zoom: 0.42 }; })()`],
        ['mid', `(() => { const z = squeek.state().zone; return { x: z.cx, y: z.cy, zoom: 0.26 }; })()`],
        ['map', `({ x: 5400, y: 5400, zoom: 0.1 })`],
      ];
      // Parachute drop: seek to tick 25 (everybody still in the air) and frame the first bot.
      await evalJs(`(() => { const s = document.getElementById('seek'); s.value = '25'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); return 1; })()`);
      await sleep(300);
      VIEWS.unshift(['drop', `(() => { const b = squeek.replay.initial.bots[0]; return { x: b.spawnX, y: b.spawnY - 120, zoom: 0.8 }; })()`]);
      VIEWS.push(['back', `(() => { const s = document.getElementById('seek'); s.value = '${Math.floor(st.max * viewsAt)}'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); return { x: 5400, y: 5400, zoom: 0.3 }; })()`]);
      for (const [name, expr] of VIEWS) {
        if (name === 'close') {   // back to the mid-match moment for the other views
          await evalJs(`(() => { const s = document.getElementById('seek'); s.value = '${Math.floor(st.max * viewsAt)}'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); return 1; })()`);
          await sleep(300);
        }
        if (name === 'back') { await evalJs(`${expr}, 1`); continue; }
        await evalJs(`(() => { const v = ${expr}; const c = squeek.camera; c.setMode('free');
          c.x = c.targetX = v.x; c.y = c.targetY = v.y; c.zoom = c.targetZoom = v.zoom; return 1; })()`);
        await sleep(900);
        const { data } = await S('Page.captureScreenshot', { format: 'png' });
        await mkdir(shots, { recursive: true });
        await writeFile(join(shots, `${preset}-${seed}-view-${name}.png`), Buffer.from(data, 'base64'));
      }
      await evalJs(`(() => { squeek.camera.setMode('auto'); document.getElementById('btnPlayPause').click(); return 1; })()`);
      stuckSince = Date.now(); lastSeek = -1;
      continue;
    }
    if (shots && shotsTaken < 3 && frac > [0.15, 0.5, 0.8][shotsTaken]) {
      const { data } = await S('Page.captureScreenshot', { format: 'png' });
      await mkdir(shots, { recursive: true });
      await writeFile(join(shots, `${preset}-${seed}-${shotsTaken}.png`), Buffer.from(data, 'base64'));
      shotsTaken++;
    }
    if (st.seek !== lastSeek) { lastSeek = st.seek; stuckSince = Date.now(); }
    else if (Date.now() - stuckSince > 6000) {
      const diag = await evalJs(`Promise.race([new Promise((r) => requestAnimationFrame(() => r('raf ok t=' + Math.round(performance.now())))), new Promise((r) => setTimeout(() => r('raf blocked'), 1500))])
        .then(async (raf) => { const a = await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => setTimeout(r, 400)); const b = await new Promise((r) => requestAnimationFrame(r)); return raf + ' · rafTs ' + Math.round(a) + '->' + Math.round(b) + ' perf ' + Math.round(performance.now()); }).then((raf) => raf + ' · play button ' + JSON.stringify(document.getElementById('btnPlayPause')?.textContent))`);
      errors.push(`replay stopped advancing at tick ${st.seek}/${st.max} (${st.clock}) — ${diag}`); break;
    }
  }
  const pageErrs = await evalJs('(window.__errs || []).slice(0, 5)');
  for (const e of pageErrs || []) errors.push('page: ' + e);
  if (!st || st.screen !== 'resultScreen') errors.push(`never reached the result screen (last: ${JSON.stringify(st)})`);
  const verdict = await evalJs(`(() => { try { const v = window.squeek.validate(); return { ok: v.ok, problems: v.problems.slice(0, 3),
      winner: window.squeek.replay.result.winnerName, end: window.squeek.replay.result.endTick, hash: window.squeek.replay.replayHash }; } catch (e) { return { ok: false, problems: [String(e)] }; } })()`);
  if (!verdict.ok) errors.push('in-browser validateReplay failed: ' + verdict.problems.join('; '));
  cdp.handlers.splice(cdp.handlers.indexOf(onEvent), 1);
  await cdp.send('Target.closeTarget', { targetId });
  return { seed, preset, errors, verdict, seconds: ((Date.now() - t0) / 1000).toFixed(1), log };
}

const { srv, port, missing } = await serve();
const { proc, wsUrl } = await launchChrome();
const ws = new WebSocket(wsUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
const cdp = new Cdp(ws);
let bad = 0;
try {
  for (const preset of presets) {
    for (const seed of seeds) {
      const before = missing.length;
      const r = await runOne(cdp, port, seed, preset);
      const miss = missing.slice(before).filter((p) => !p.endsWith('favicon.ico') && !artMissing(p));
      if (miss.length) r.errors.push('404: ' + [...new Set(miss)].slice(0, 5).join(', '));
      const ok = r.errors.length === 0;
      if (!ok) bad++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${preset.padEnd(8)} seed ${seed.padEnd(10)} bots ${bots}  winner ${r.verdict.winner} @${r.verdict.end} replayHash ${r.verdict.hash}  ${r.seconds}s ${r.log.join(',')}`);
      for (const e of r.errors.slice(0, 6)) console.log('      ' + e);
    }
  }
} finally {
  ws.close(); proc.kill(); srv.close();
}
console.log(bad === 0 ? '\nbrowser runtime: all matches played to the result screen with no errors' : `\nbrowser runtime: ${bad} failing`);
process.exit(bad === 0 ? 0 : 1);
