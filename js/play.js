// Notula: playback with a built-in Web Audio synth. Nothing is downloaded; works offline.
import { U, beatSizeFor } from './score.js';

/* ---------- timelines (units: 48 per quarter) ---------- */

// the notes as engraved: ties merged back into one sounding note
export function engravedTimeline(score, midi, shiftU) {
  const notes = [];
  let last = null;
  for (const m of score.measures) {
    for (const it of m.items) {
      if (it.kind !== 'note') continue;
      const u = m.start + it.pos;
      if (it.tieFrom && last && last.p === it.pitch && Math.abs(last.u + last.d - u) < 1e-6) { last.d += it.dur; continue; }
      last = { u, d: it.dur, p: it.pitch };
      notes.push(last);
    }
  }
  return finish(notes, score, midi, shiftU);
}

// the notes as they are in the MIDI file (no quantizing), same transpose and shift
export function originalTimeline(score, midi, trackIndex, transpose, shiftU) {
  const t = midi.tracks[trackIndex];
  const notes = [];
  if (t) for (const n of t.notes) {
    const p = n.p + transpose;
    if (p < 0 || p > 127) continue;
    const u = n.t * U / midi.ppq + shiftU, d = n.d * U / midi.ppq;
    if (u + d <= 0) continue;
    notes.push({ u: Math.max(0, u), d, p });
  }
  return finish(notes, score, midi, shiftU);
}

function finish(notes, score, midi, shiftU) {
  const tempo = midi.tempos.map((e) => ({ u: Math.max(0, e.t * U / midi.ppq + shiftU), bpm: e.bpm })).sort((a, b) => a.u - b.u);
  const clicks = [];
  let startU = 0, endU = 0;
  score.measures.forEach((m, i) => {
    if (i === 0) startU = m.start;
    const nb = m.multi || 1;
    const beat = beatSizeFor(m.ts);
    const per = Math.max(1, Math.round(m.len / beat));
    for (let b = 0; b < nb; b++) for (let k = 0; k < per; k++) clicks.push({ u: m.start + b * m.len + k * beat, accent: k === 0 });
    endU = Math.max(endU, m.start + nb * m.len);
  });
  for (const n of notes) endU = Math.max(endU, n.u + n.d);
  notes.sort((a, b) => a.u - b.u);
  return { notes, clicks, tempo, startU, endU };
}

export function baseBpm(tl) { return tl.tempo.length ? Math.max(10, tl.tempo[0].bpm) : 120; }

/* ---------- tempo map: units <-> seconds, with a speed factor f ---------- */
export function makeTempoMap(events, f = 1) {
  const ev = events.length && events[0].u <= 0 ? events.slice() : [{ u: 0, bpm: events.length ? events[0].bpm : 120 }, ...events];
  const pts = [];
  let sec = 0;
  for (const e of ev) {
    const bpm = Math.max(10, e.bpm);
    if (pts.length) {
      const p = pts[pts.length - 1];
      if (e.u <= p.u) { p.bpm = bpm; continue; }
      sec += (e.u - p.u) / U * 60 / (p.bpm * f);
    }
    pts.push({ u: e.u, sec, bpm });
  }
  const at = (key, v) => { let lo = 0, hi = pts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid][key] <= v) lo = mid; else hi = mid - 1; } return pts[lo]; };
  return {
    toSec(u) { const p = at('u', u); return p.sec + (u - p.u) / U * 60 / (p.bpm * f); },
    toUnit(s) { const p = at('sec', s); return p.u + (s - p.sec) * (p.bpm * f) * U / 60; },
  };
}

/* ---------- the player ---------- */
const NOTE_HARMONICS = [0, 1, 0.42, 0.22, 0.1, 0.06, 0.03];

export class Player {
  constructor() { this.ctx = null; this.run = null; this.timer = null; this.vol = 0.7; this.wave = null; }

  get playing() { return !!this.run; }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('This browser has no Web Audio.');
      this.ctx = new AC();
      const real = new Float32Array(NOTE_HARMONICS.length), imag = Float32Array.from(NOTE_HARMONICS);
      this.wave = this.ctx.createPeriodicWave(real, imag);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.vol = v;
    if (this.run) this.run.master.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.02);
  }

  // tl: timeline, fromU: start position, f: speed factor, click: bool, onEnd: called when the end is reached
  play(tl, fromU, f, click, onEnd) {
    this.stop();
    this.ensure();
    const ctx = this.ctx;
    const tm = makeTempoMap(tl.tempo, f);
    const master = ctx.createGain();
    master.gain.value = this.vol * 0.5;
    master.connect(ctx.destination);
    const run = {
      tm, master, t0: ctx.currentTime + 0.12, s0: tm.toSec(fromU), fromU, endU: tl.endU, onEnd,
      notes: tl.notes.filter((n) => n.u >= fromU - 0.5), ni: 0,
      clicks: click ? tl.clicks.filter((c) => c.u >= fromU - 1e-6) : [], ci: 0, ended: false,
    };
    this.run = run;
    const pump = () => {
      const r = this.run; if (r !== run) return;
      const horizon = ctx.currentTime + 1.0;
      const at = (u) => r.t0 + r.tm.toSec(u) - r.s0;
      while (r.ni < r.notes.length) {
        const n = r.notes[r.ni];
        const st = at(Math.max(n.u, r.fromU));
        if (st > horizon) break;
        const en = at(n.u + n.d);
        this.voice(r.master, Math.max(st, ctx.currentTime), Math.max(0.05, en - st), n.p);
        r.ni++;
      }
      while (r.ci < r.clicks.length) {
        const c = r.clicks[r.ci];
        const st = at(c.u);
        if (st > horizon) break;
        this.click(r.master, Math.max(st, ctx.currentTime), c.accent);
        r.ci++;
      }
      if (!r.ended && this.currentUnit() >= r.endU) {
        r.ended = true;
        setTimeout(() => { if (this.run === run) { this.stop(); if (onEnd) onEnd(); } }, 350);
      }
    };
    this.timer = setInterval(pump, 150);
    pump();
  }

  // a short note so you hear what you just placed
  blip(midi) {
    try {
      this.ensure();
      const g = this.ctx.createGain();
      g.gain.value = this.vol * 0.5;
      g.connect(this.ctx.destination);
      this.voice(g, this.ctx.currentTime + 0.01, 0.35, midi);
      setTimeout(() => { try { g.disconnect(); } catch (e) { /* gone */ } }, 1000);
    } catch (e) { /* no audio */ }
  }

  currentUnit() {
    const r = this.run;
    if (!r) return null;
    const s = this.ctx.currentTime - r.t0 + r.s0;
    return Math.max(r.fromU, r.tm.toUnit(s));
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    const r = this.run;
    this.run = null;
    if (r) {
      const t = this.ctx.currentTime;
      r.master.gain.cancelScheduledValues(t);
      r.master.gain.setTargetAtTime(0, t, 0.025);
      setTimeout(() => { try { r.master.disconnect(); } catch (e) { /* already gone */ } }, 300);
    }
  }

  voice(dest, t, dur, midi) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.wave);
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    const peak = 0.4;
    const end = t + dur;
    const dEnd = t + 0.012 + Math.min(0.7, Math.max(0.02, dur - 0.012));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(peak * 0.55, dEnd);
    g.gain.setValueAtTime(peak * 0.55, Math.max(dEnd, end - 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(dEnd, end) + 0.12);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(Math.max(dEnd, end) + 0.15);
  }

  click(dest, t, accent) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.22 : 0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.06);
  }
}
