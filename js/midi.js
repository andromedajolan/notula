// Notula: MIDI reader and minimal writer. No dependencies.
// parseMidi(bytes) -> { format, ppq, tracks[], tempos[], timeSigs[], keySigs[], endTick }
// track: { id, name, channel, program, drum, notes:[{t,d,p,v,ch}] } (ticks)

export function parseMidi(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[pos + i]); pos += n; return s; };

  // Some tools wrap MIDI in a RIFF/RMID container; find the MThd chunk.
  let start = 0;
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49) {
    for (let i = 0; i < bytes.length - 4; i++) {
      if (bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) { start = i; break; }
    }
  }
  pos = start;
  if (str(4) !== 'MThd') throw new Error('Not a MIDI file (no MThd header).');
  const hlen = dv.getUint32(pos); pos += 4;
  const format = dv.getUint16(pos);
  const ntrks = dv.getUint16(pos + 2);
  let division = dv.getUint16(pos + 4);
  pos += hlen;
  let ppq = division;
  if (division & 0x8000) {
    // SMPTE time: approximate as ticks per quarter at 120 bpm
    const fps = 256 - (division >> 8);
    const tpf = division & 0xff;
    ppq = Math.max(1, Math.round(fps * tpf / 2));
  }
  if (ppq <= 0) ppq = 480;

  const tempos = [], timeSigs = [], keySigs = [];
  const tracks = [];
  let endTick = 0;
  let trackNo = 0;

  while (pos + 8 <= bytes.length && trackNo < ntrks + 4) {
    const type = str(4);
    const len = dv.getUint32(pos); pos += 4;
    const end = Math.min(bytes.length, pos + len);
    if (type !== 'MTrk') { pos = end; continue; }
    trackNo++;
    let t = 0, running = 0, name = '';
    const open = new Map();
    const notes = [];
    const programs = {};
    const readVar = () => {
      let v = 0, b, n = 0;
      do { b = bytes[pos++]; v = (v << 7) | (b & 0x7f); n++; } while ((b & 0x80) && pos < end && n < 5);
      return v;
    };
    try {
      while (pos < end) {
        t += readVar();
        let status = bytes[pos];
        if (status === undefined) break;
        if (status < 0x80) { status = running; if (!status) { pos++; continue; } }
        else { pos++; if (status < 0xf0) running = status; }
        if (status === 0xff) {
          const mt = bytes[pos++];
          const ml = readVar();
          const mstart = pos;
          if (mt === 0x03 && !name) { name = ''; for (let i = 0; i < ml; i++) name += String.fromCharCode(bytes[mstart + i]); }
          else if (mt === 0x51 && ml >= 3) {
            const us = (bytes[mstart] << 16) | (bytes[mstart + 1] << 8) | bytes[mstart + 2];
            if (us > 0) tempos.push({ t, bpm: 60000000 / us });
          } else if (mt === 0x58 && ml >= 2) {
            timeSigs.push({ t, num: bytes[mstart], den: 1 << bytes[mstart + 1] });
          } else if (mt === 0x59 && ml >= 2) {
            let sf = bytes[mstart]; if (sf > 127) sf -= 256;
            keySigs.push({ t, sf, minor: bytes[mstart + 1] === 1 });
          }
          pos = mstart + ml;
          if (mt === 0x2f) break;
        } else if (status === 0xf0 || status === 0xf7) {
          const sl = readVar(); pos += sl;
        } else {
          const hi = status & 0xf0, ch = status & 0x0f;
          if (hi === 0xc0 || hi === 0xd0) {
            const d1 = bytes[pos++];
            if (hi === 0xc0) programs[ch] = d1;
          } else {
            const d1 = bytes[pos++], d2 = bytes[pos++];
            if (hi === 0x90 && d2 > 0) {
              const k = ch * 128 + d1;
              if (!open.has(k)) open.set(k, []);
              open.get(k).push({ t, v: d2 });
            } else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
              const k = ch * 128 + d1;
              const q = open.get(k);
              if (q && q.length) {
                const s = q.shift();
                notes.push({ t: s.t, d: Math.max(1, t - s.t), p: d1, v: s.v, ch });
              }
            }
          }
        }
      }
    } catch (e) { /* truncated track: keep what we have */ }
    for (const [k, q] of open) for (const s of q) {
      notes.push({ t: s.t, d: Math.max(1, t - s.t), p: k % 128, v: s.v, ch: Math.floor(k / 128) });
    }
    endTick = Math.max(endTick, t);
    pos = end;

    // split a track holding several channels into one entry per channel
    const byCh = new Map();
    for (const n of notes) { if (!byCh.has(n.ch)) byCh.set(n.ch, []); byCh.get(n.ch).push(n); }
    if (byCh.size === 0) continue;
    for (const [ch, list] of [...byCh.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => a.t - b.t || b.p - a.p);
      const label = (name || ('Track ' + trackNo)) + (byCh.size > 1 ? ' (ch ' + (ch + 1) + ')' : '');
      tracks.push({
        id: tracks.length, name: label, channel: ch, program: programs[ch] ?? null,
        drum: ch === 9, notes: list
      });
    }
  }
  tempos.sort((a, b) => a.t - b.t);
  timeSigs.sort((a, b) => a.t - b.t);
  keySigs.sort((a, b) => a.t - b.t);
  return { format, ppq, tracks, tempos, timeSigs, keySigs, endTick };
}

// Minimal Format 0 writer: notes [{t,d,p,v}] in ticks.
export function writeMidi({ ppq = 480, bpm = 120, num = 4, den = 4, notes = [], name = 'Notula', channel = 0, program = 0 }) {
  const out = [];
  const push = (...a) => { for (const x of a) out.push(x & 0xff); };
  const varlen = (v) => { const b = [v & 0x7f]; v >>= 7; while (v > 0) { b.unshift((v & 0x7f) | 0x80); v >>= 7; } return b; };
  const ev = [];
  const us = Math.round(60000000 / bpm);
  ev.push({ t: 0, o: 0, b: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  ev.push({ t: 0, o: 0, b: [0xff, 0x58, 4, num, Math.log2(den), 24, 8] });
  const nb = [...name].map((c) => c.charCodeAt(0) & 127);
  ev.push({ t: 0, o: 0, b: [0xff, 0x03, nb.length, ...nb] });
  ev.push({ t: 0, o: 0, b: [0xc0 | channel, program] });
  for (const n of notes) {
    ev.push({ t: Math.round(n.t), o: 2, b: [0x90 | channel, n.p, n.v || 90] });
    ev.push({ t: Math.round(n.t + n.d), o: 1, b: [0x80 | channel, n.p, 0] });
  }
  ev.sort((a, b) => a.t - b.t || a.o - b.o);
  const trk = [];
  let last = 0;
  for (const e of ev) { trk.push(...varlen(e.t - last), ...e.b); last = e.t; }
  trk.push(0, 0xff, 0x2f, 0);
  push(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq);
  push(0x4d, 0x54, 0x72, 0x6b, trk.length >>> 24, trk.length >>> 16, trk.length >>> 8, trk.length);
  for (const b of trk) out.push(b);
  return new Uint8Array(out);
}

export function bytesToBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
