/**
 * SQUEEK ROYALE — PROCEDURAL WEB AUDIO ENGINE (BGM & SPATIAL GAMEPLAY SFX)
 * Zero external audio assets required: synthesizes polyphonic chiptune/synthwave BGM
 * for Landing (/), Player Hub (/play), and Battle Royale Gameplay (viewer.html),
 * plus spatialized combat sound effects for all weapons, hits, dodges, chests, and Crown events.
 */

import { EV } from '../core/constants.js';
import { WEAPONS } from '../core/ruleset.js';

const STORAGE_KEY = 'squeek_audio_muted';

// Musical note helper: MIDI note number -> frequency in Hz
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Scale & Progression definitions for the 3 BGM themes
const THEMES = {
  // 1. Landing Page (/): Heroic Fantasy Adventure (D minor / F major, 112 BPM)
  portal: {
    bpm: 112,
    bass: [38, 38, 50, 38, 41, 41, 53, 41, 46, 46, 58, 46, 45, 45, 49, 45],
    arp: [
      62, 65, 69, 74, 62, 65, 69, 74,
      65, 69, 72, 77, 65, 69, 72, 77,
      70, 74, 77, 82, 70, 74, 77, 82,
      69, 73, 76, 81, 69, 76, 73, 69,
    ],
    lead: [
      74, 0, 77, 76, 74, 0, 69, 0,
      72, 0, 77, 76, 72, 0, 69, 0,
      70, 74, 77, 0, 82, 81, 77, 74,
      76, 0, 73, 0, 69, 0, 0, 0,
    ],
  },
  // 2. Player Hub (/play): Cyber Arena Pre-Battle Tension (E minor / C / G / B7, 118 BPM)
  hub: {
    bpm: 118,
    bass: [40, 40, 52, 40, 36, 36, 48, 36, 43, 43, 55, 43, 35, 35, 47, 35],
    arp: [
      64, 67, 71, 76, 71, 67, 64, 67,
      60, 64, 67, 72, 67, 64, 60, 64,
      67, 71, 74, 79, 74, 71, 67, 71,
      59, 63, 66, 71, 75, 71, 66, 63,
    ],
    lead: [
      76, 0, 0, 79, 78, 76, 71, 0,
      72, 0, 0, 76, 74, 72, 67, 0,
      79, 0, 78, 76, 74, 0, 71, 0,
      75, 0, 71, 0, 66, 0, 0, 0,
    ],
  },
  // 3. Battle Royale Gameplay (viewer.html): High-Octane Combat Theme (138 BPM)
  battle: {
    bpm: 138,
    bass: [38, 50, 38, 50, 41, 53, 41, 53, 43, 55, 43, 55, 45, 57, 46, 45],
    arp: [
      62, 69, 74, 69, 65, 69, 74, 69,
      65, 72, 77, 72, 69, 72, 77, 72,
      67, 74, 79, 74, 70, 74, 79, 74,
      69, 76, 81, 76, 73, 76, 81, 85,
    ],
    lead: [
      74, 74, 77, 74, 81, 0, 79, 77,
      76, 76, 79, 76, 72, 0, 74, 76,
      79, 79, 82, 79, 86, 0, 84, 82,
      81, 0, 85, 0, 86, 85, 81, 76,
    ],
  },
};

class SqueekAudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch (_) {}

    this.currentTheme = null;
    this.bgmSuppressed = false; // e.g. when /play embeds viewer.html iframe
    this.stepIdx = 0;
    this.bgmTimer = null;
    this.battleIntensity = 0; // 0..1 based on storm phase / alive count
    this.lastSfxAt = new Map();
    this.buttons = new Set();
    this._unlocked = false;

    if (typeof window !== 'undefined') {
      this._bindGlobalUnlock();
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
          this.muted = e.newValue === '1';
          this._applyGain();
          this._syncButtons();
        }
      });
    }
  }

  _ensureCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();

      this.bgmGain.gain.value = 0.24;
      this.sfxGain.gain.value = 0.48;
      this._applyGain();

      this.bgmGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx && this.ctx.state === 'suspended' && !this.muted) {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _applyGain() {
    if (!this.masterGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const target = this.muted ? 0.0001 : 0.85;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.03);
    if (this.bgmGain) {
      const bgmTarget = (this.muted || this.bgmSuppressed) ? 0.0001 : 0.24;
      this.bgmGain.gain.cancelScheduledValues(now);
      this.bgmGain.gain.setTargetAtTime(bgmTarget, now, 0.06);
    }
  }

  _bindGlobalUnlock() {
    const unlock = () => {
      if (this._unlocked && this.ctx && this.ctx.state === 'running') return;
      this._unlocked = true;
      const c = this._ensureCtx();
      if (c && c.state === 'suspended' && !this.muted) {
        c.resume().then(() => {
          this._syncButtons();
        }).catch(() => {});
      }
      if (this.currentTheme && !this.bgmTimer) {
        this._startSequencer();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  /** Toggle mute/unmute and persist across pages/iframes. */
  toggleMute() {
    this.setMuted(!this.muted);
    if (!this.muted) {
      this.playSfx('heal', { vol: 0.45 });
    }
    return this.muted;
  }

  setMuted(m) {
    this.muted = !!m;
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch (_) {}
    this._ensureCtx();
    this._applyGain();
    if (!this.muted && this.currentTheme && !this.bgmTimer) {
      this._startSequencer();
    }
    this._syncButtons();
  }

  /** Suppress BGM on /play while the match viewer iframe is open so two tracks don't overlap. */
  setBgmSuppressed(suppressed) {
    this.bgmSuppressed = !!suppressed;
    this._applyGain();
  }

  /** Start or switch the background music theme ('portal' | 'hub' | 'battle'). */
  startBgm(themeName = 'portal') {
    if (!THEMES[themeName]) return;
    if (this.currentTheme === themeName && this.bgmTimer) return;
    this.currentTheme = themeName;
    this.stepIdx = 0;
    this._startSequencer();
  }

  stopBgm() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  _startSequencer() {
    if (this.bgmTimer) clearInterval(this.bgmTimer);
    const theme = THEMES[this.currentTheme];
    if (!theme) return;
    const stepMs = (60 / theme.bpm / 4) * 1000; // 16th-note step
    this.bgmTimer = setInterval(() => this._tickBgm(), stepMs);
  }

  _tickBgm() {
    if (this.muted || this.bgmSuppressed || document.hidden) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const theme = THEMES[this.currentTheme];
    if (!theme) return;
    const now = ctx.currentTime;
    const step = this.stepIdx % 32;
    const step16 = this.stepIdx % 16;
    this.stepIdx++;

    const dur = 60 / theme.bpm / 4;

    // 1. Bassline (every 8th note, i.e., even steps)
    if (step % 2 === 0) {
      const bassNote = theme.bass[(step >> 1) % theme.bass.length];
      if (bassNote > 0) {
        this._synthNote({
          freq: mtof(bassNote),
          type: this.currentTheme === 'battle' ? 'sawtooth' : 'triangle',
          start: now,
          dur: dur * 1.75,
          gain: this.currentTheme === 'battle' ? 0.22 : 0.18,
          cutoff: this.currentTheme === 'battle' ? 520 + this.battleIntensity * 350 : 380,
          dest: this.bgmGain,
        });
      }
    }

    // 2. Arpeggio (every 16th note)
    const arpNote = theme.arp[step % theme.arp.length];
    if (arpNote > 0) {
      this._synthNote({
        freq: mtof(arpNote),
        type: 'sine',
        start: now,
        dur: dur * 0.85,
        gain: 0.08,
        cutoff: 1800,
        dest: this.bgmGain,
      });
    }

    // 3. Lead Melody
    const leadNote = theme.lead[step % theme.lead.length];
    if (leadNote > 0) {
      this._synthNote({
        freq: mtof(leadNote),
        type: this.currentTheme === 'portal' ? 'triangle' : 'square',
        start: now,
        dur: dur * 1.9,
        gain: 0.095,
        cutoff: this.currentTheme === 'battle' ? 1650 + this.battleIntensity * 600 : 1350,
        dest: this.bgmGain,
      });
    }

    // 4. Percussion groove
    if (step16 % 4 === 0) {
      // Kick drum on quarter notes
      this._synthKick(now, this.currentTheme === 'battle' ? 0.24 : 0.15);
    } else if (this.currentTheme === 'battle' && step16 % 4 === 2) {
      // Snare on backbeats in battle
      this._synthSnare(now, 0.12);
    } else if (step16 % 2 === 1) {
      // Soft off-beat hi-hat
      this._synthHat(now, this.currentTheme === 'battle' ? 0.05 : 0.03);
    }
  }

  _synthNote({ freq, type = 'triangle', start, dur, gain = 0.12, cutoff = 1400, dest, pan = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const flt = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(cutoff, start);

    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(flt);
    flt.connect(env);
    this._connectWithPan(env, dest || this.sfxGain, pan);

    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  _synthKick(start, gain = 0.2) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, start);
    osc.frequency.exponentialRampToValueAtTime(36, start + 0.11);
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
    osc.connect(env);
    env.connect(this.bgmGain);
    osc.start(start);
    osc.stop(start + 0.14);
  }

  _synthSnare(start, gain = 0.12) {
    this._synthNoise({ start, dur: 0.09, gain, cutoff: 2600, filterType: 'bandpass', dest: this.bgmGain });
  }

  _synthHat(start, gain = 0.04) {
    this._synthNoise({ start, dur: 0.04, gain, cutoff: 6500, filterType: 'highpass', dest: this.bgmGain });
  }

  _synthNoise({ start, dur = 0.1, gain = 0.15, cutoff = 1800, filterType = 'bandpass', dest, pan = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this._noiseBuf) {
      const len = ctx.sampleRate * 0.5;
      this._noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;

    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.setValueAtTime(cutoff, start);

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(flt);
    flt.connect(env);
    this._connectWithPan(env, dest || this.sfxGain, pan);

    src.start(start);
    src.stop(start + dur + 0.01);
  }

  _connectWithPan(node, dest, pan = 0) {
    const ctx = this.ctx;
    if (ctx && ctx.createStereoPanner && Math.abs(pan) > 0.02) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      node.connect(p);
      p.connect(dest);
    } else {
      node.connect(dest);
    }
  }

  /**
   * Play a synthesized gameplay or UI sound effect.
   * Throttled per SFX key so simultaneous 100-bot events never clip.
   */
  playSfx(kind, { vol = 1, pan = 0 } = {}) {
    if (this.muted || document.hidden) return;
    const ctx = this._ensureCtx();
    if (!ctx || ctx.state !== 'running') return;

    const nowMs = performance.now();
    const minGap = kind === 'hit' || kind === 'paw' || kind === 'dagger' ? 55 : 40;
    if ((this.lastSfxAt.get(kind) || 0) + minGap > nowMs) return;
    this.lastSfxAt.set(kind, nowMs);

    const t = ctx.currentTime;
    const v = Math.max(0.05, Math.min(1.2, vol));

    switch (kind) {
      case 'click': {
        this._synthSweep({ f0: 880, f1: 1320, dur: 0.045, type: 'triangle', gain: 0.12 * v, pan });
        break;
      }
      case 'paw': {
        this._synthNoise({ start: t, dur: 0.07, gain: 0.14 * v, cutoff: 1400, filterType: 'bandpass', pan });
        this._synthSweep({ f0: 420, f1: 180, dur: 0.07, type: 'triangle', gain: 0.14 * v, pan });
        break;
      }
      case 'dagger': {
        this._synthSweep({ f0: 1300, f1: 2450, dur: 0.065, type: 'sawtooth', gain: 0.13 * v, cutoff: 3800, pan });
        break;
      }
      case 'sword': {
        this._synthNoise({ start: t, dur: 0.11, gain: 0.16 * v, cutoff: 2800, filterType: 'bandpass', pan });
        this._synthSweep({ f0: 920, f1: 380, dur: 0.11, type: 'sawtooth', gain: 0.16 * v, cutoff: 2600, pan });
        break;
      }
      case 'axe': {
        this._synthNoise({ start: t, dur: 0.14, gain: 0.2 * v, cutoff: 1100, filterType: 'lowpass', pan });
        this._synthSweep({ f0: 340, f1: 105, dur: 0.15, type: 'sawtooth', gain: 0.22 * v, cutoff: 1200, pan });
        break;
      }
      case 'spear': {
        this._synthSweep({ f0: 1150, f1: 480, dur: 0.09, type: 'square', gain: 0.15 * v, cutoff: 2400, pan });
        break;
      }
      case 'hammer': {
        // Seismic ground-slam boom + shockwave crack
        this._synthSweep({ f0: 135, f1: 34, dur: 0.28, type: 'sine', gain: 0.36 * v, cutoff: 400, pan });
        this._synthNoise({ start: t, dur: 0.22, gain: 0.26 * v, cutoff: 900, filterType: 'lowpass', pan });
        break;
      }
      case 'bow':
      case 'crossbow': {
        const isXbow = kind === 'crossbow';
        this._synthSweep({
          f0: isXbow ? 540 : 680,
          f1: isXbow ? 1480 : 1220,
          dur: 0.08,
          type: 'triangle',
          gain: 0.15 * v,
          cutoff: 2800,
          pan,
        });
        break;
      }
      case 'magic_staff': {
        this._synthSweep({ f0: 523, f1: 1046, dur: 0.14, type: 'sine', gain: 0.16 * v, cutoff: 2400, pan });
        this._synthSweep({ f0: 784, f1: 1568, dur: 0.12, type: 'triangle', gain: 0.1 * v, cutoff: 3000, pan });
        break;
      }
      case 'hit': {
        this._synthSweep({ f0: 210, f1: 72, dur: 0.075, type: 'triangle', gain: 0.2 * v, cutoff: 900, pan });
        this._synthNoise({ start: t, dur: 0.055, gain: 0.14 * v, cutoff: 1500, filterType: 'bandpass', pan });
        break;
      }
      case 'heavy_hit': {
        this._synthSweep({ f0: 165, f1: 45, dur: 0.14, type: 'sawtooth', gain: 0.28 * v, cutoff: 850, pan });
        this._synthNoise({ start: t, dur: 0.11, gain: 0.22 * v, cutoff: 1300, filterType: 'bandpass', pan });
        break;
      }
      case 'dodge':
      case 'dash': {
        this._synthNoise({ start: t, dur: 0.09, gain: 0.12 * v, cutoff: 2200, filterType: 'bandpass', pan });
        this._synthSweep({ f0: 360, f1: 820, dur: 0.08, type: 'sine', gain: 0.1 * v, pan });
        break;
      }
      case 'stun': {
        this._synthSweep({ f0: 980, f1: 440, dur: 0.16, type: 'sawtooth', gain: 0.18 * v, cutoff: 2600, pan });
        break;
      }
      case 'heal': {
        [659.25, 783.99, 1046.5].forEach((freq, idx) => {
          this._synthNote({ freq, type: 'triangle', start: t + idx * 0.055, dur: 0.14, gain: 0.14 * v, cutoff: 2400, pan });
        });
        break;
      }
      case 'chest': {
        [587.33, 739.99, 880, 1174.66].forEach((freq, idx) => {
          this._synthNote({ freq, type: 'triangle', start: t + idx * 0.05, dur: 0.16, gain: 0.16 * v, cutoff: 2800, pan });
        });
        break;
      }
      case 'kill': {
        this._synthNote({ freq: mtof(62), type: 'sawtooth', start: t, dur: 0.12, gain: 0.2 * v, cutoff: 1800, pan });
        this._synthNote({ freq: mtof(69), type: 'sawtooth', start: t + 0.07, dur: 0.18, gain: 0.22 * v, cutoff: 2200, pan });
        break;
      }
      case 'crown': {
        // Royal Crown Fanfare chord
        [62, 66, 69, 74].forEach((note, idx) => {
          this._synthNote({
            freq: mtof(note),
            type: 'sawtooth',
            start: t + idx * 0.055,
            dur: 0.32,
            gain: 0.2 * v,
            cutoff: 2400,
            pan,
          });
        });
        break;
      }
      case 'victory': {
        // Match Winner Triumphant Fanfare
        const notes = [
          { m: 62, dt: 0.0, d: 0.14 },
          { m: 62, dt: 0.15, d: 0.14 },
          { m: 62, dt: 0.30, d: 0.14 },
          { m: 69, dt: 0.46, d: 0.36 },
          { m: 65, dt: 0.84, d: 0.24 },
          { m: 69, dt: 1.10, d: 0.24 },
          { m: 74, dt: 1.36, d: 0.65 },
        ];
        for (const n of notes) {
          this._synthNote({ freq: mtof(n.m), type: 'sawtooth', start: t + n.dt, dur: n.d, gain: 0.22 * v, cutoff: 2500 });
          this._synthNote({ freq: mtof(n.m - 12), type: 'triangle', start: t + n.dt, dur: n.d, gain: 0.16 * v, cutoff: 1200 });
        }
        break;
      }
      default:
        break;
    }
  }

  _synthSweep({ f0, f1, dur = 0.1, type = 'triangle', gain = 0.15, cutoff = 2200, pan = 0 }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    const flt = ctx.createBiquadFilter();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + dur);

    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(cutoff, start);

    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    osc.connect(flt);
    flt.connect(env);
    this._connectWithPan(env, this.sfxGain, pan);

    osc.start(start);
    osc.stop(start + dur + 0.015);
  }

  /**
   * Ingest replay events between `fromTick` and `toTick` and trigger spatialized combat SFX
   * based on proximity to the camera viewport.
   */
  ingestGameplayEvents(reader, camera, viewW, viewH, fromTick, toTick, highlightIds = null) {
    if (this.muted || !reader || toTick <= fromTick || toTick - fromTick > 25) return;
    const ctx = this._ensureCtx();
    if (!ctx || ctx.state !== 'running') return;

    const evs = reader.eventsBetween(fromTick, toTick);
    if (!evs.length) return;

    const zoom = (camera && camera.zoom) || 1;
    const cx = (camera && camera.x) || 5400;
    const cy = (camera && camera.y) || 5400;
    const halfW = Math.max(450, (viewW || 960) / zoom / 2);
    const halfH = Math.max(350, (viewH || 540) / zoom / 2);
    const maxDist = Math.hypot(halfW, halfH) * 1.35;

    const spatial = (x, y, actorId = -1) => {
      const isMine = highlightIds && highlightIds.has(actorId);
      const dx = x - cx, dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (!isMine && dist > maxDist) return null;
      const vol = isMine ? 1.0 : Math.max(0.18, 1 - (dist / maxDist) * 0.78);
      const pan = Math.max(-0.8, Math.min(0.8, dx / halfW));
      return { vol, pan };
    };

    for (const ev of evs) {
      switch (ev.type) {
        case EV.CROWN_CREATE:
        case EV.CROWN_TRANSFER:
        case EV.CROWN_PICKUP: {
          this.playSfx('crown', { vol: 0.95 });
          break;
        }
        case EV.KILL: {
          const pos = reader.botPosAt(ev.t, ev.a);
          const sp = spatial(pos.x, pos.y, ev.a) || { vol: 0.45, pan: 0 };
          this.playSfx('kill', sp);
          break;
        }
        case EV.ATTACK: {
          const pos = reader.botPosAt(ev.t, ev.a);
          const sp = spatial(pos.x, pos.y, ev.a);
          if (!sp) break;
          if (ev.c < 0) {
            this.playSfx('paw', sp);
          } else {
            const spec = WEAPONS[ev.c];
            if (spec && spec.type === 'melee') {
              this.playSfx(spec.id, sp);
            }
          }
          break;
        }
        case EV.PROJECTILE_SPAWN: {
          const sp = spatial(ev.d, ev.e, ev.a);
          if (!sp) break;
          const spec = WEAPONS[ev.c];
          if (spec) this.playSfx(spec.id, sp);
          break;
        }
        case EV.DAMAGE: {
          if (ev.a < 0) break;
          const pos = reader.botPosAt(ev.t, ev.b);
          const sp = spatial(pos.x, pos.y, ev.b);
          if (!sp) break;
          const dmg = Math.round(ev.c / 100);
          this.playSfx(dmg >= 28 ? 'heavy_hit' : 'hit', sp);
          break;
        }
        case EV.MISS: {
          if (ev.e === 0 || ev.e === 3) {
            const pos = reader.botPosAt(ev.t, ev.b);
            const sp = spatial(pos.x, pos.y, ev.b);
            if (sp) this.playSfx('dodge', sp);
          }
          break;
        }
        case EV.STUN: {
          const pos = reader.botPosAt(ev.t, ev.b);
          const sp = spatial(pos.x, pos.y, ev.b);
          if (sp) this.playSfx('stun', sp);
          break;
        }
        case EV.DASH: {
          const sp = spatial(ev.b, ev.c, ev.a);
          if (sp) this.playSfx('dash', { vol: sp.vol * 0.65, pan: sp.pan });
          break;
        }
        case EV.HEAL: {
          if (ev.c < 1500) break;
          const pos = reader.botPosAt(ev.t, ev.a);
          const sp = spatial(pos.x, pos.y, ev.a);
          if (sp) this.playSfx('heal', { vol: sp.vol * 0.75, pan: sp.pan });
          break;
        }
        case EV.CHEST_OPEN:
        case EV.SUPPLY_OPEN: {
          const pos = reader.botPosAt(ev.t, ev.a);
          const sp = spatial(pos.x, pos.y, ev.a);
          if (sp) this.playSfx('chest', sp);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Bind a toggle button element (`#btnAudioToggle` or `#btnSfxToggle`) to this engine. */
  bindButton(btn) {
    if (!btn || this.buttons.has(btn)) return;
    this.buttons.add(btn);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleMute();
    });
    this._renderButton(btn);
  }

  _syncButtons() {
    for (const btn of this.buttons) this._renderButton(btn);
  }

  _renderButton(btn) {
    const isVi = document.documentElement.lang === 'vi';
    const compact = btn.dataset.compact === '1';
    if (this.muted) {
      btn.innerHTML = compact
        ? '🔇 <span data-en>Muted</span><span data-vi>Tắt tiếng</span>'
        : '🔇 <span data-en>Sound: OFF</span><span data-vi>Âm thanh: TẮT</span>';
      btn.classList.remove('active');
      btn.style.opacity = '0.78';
      btn.title = isVi ? 'Bật nhạc nền & hiệu ứng âm thanh' : 'Unmute background music & sound effects';
    } else {
      btn.innerHTML = compact
        ? '🔊 <span data-en>Audio</span><span data-vi>Âm thanh</span>'
        : '🔊 <span data-en>Sound: ON</span><span data-vi>Âm thanh: BẬT</span>';
      btn.classList.add('active');
      btn.style.opacity = '1';
      btn.title = isVi ? 'Tắt nhạc nền & hiệu ứng âm thanh' : 'Mute background music & sound effects';
    }
  }
}

export const squeekAudio = new SqueekAudioEngine();
if (typeof window !== 'undefined') {
  window.squeekAudio = squeekAudio;
}
