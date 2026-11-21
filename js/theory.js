// Notula: keys, pitch spelling and key detection.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const NAT_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B (letter indexes)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];  // B E A D G C F

const MAJOR_SF = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const MINOR_SF = [-3, 4, -1, 6, 1, -4, 3, -2, 5, 0, -5, 2];
// Display names (tonic) for UI
const MAJOR_NAME = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR_NAME = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
// Note: MINOR_SF[3] chosen as 6 sharps would be D#m; we show E♭ minor (6 flats) instead:
MINOR_SF[3] = -6;

export function sfFor(tonic, minor) { return (minor ? MINOR_SF : MAJOR_SF)[((tonic % 12) + 12) % 12]; }
export function keyName(k) { return (k.minor ? MINOR_NAME : MAJOR_NAME)[k.tonic] + (k.minor ? ' minor' : ' major'); }
export function keyFromSf(sf, minor) {
  const maj = (((sf * 7) % 12) + 12) % 12;
  const tonic = minor ? (maj + 9) % 12 : maj;
  return { tonic, minor: !!minor, sf };
}
export function makeKey(tonic, minor) { tonic = ((tonic % 12) + 12) % 12; return { tonic, minor: !!minor, sf: sfFor(tonic, minor) }; }
export function transposeKey(k, semis) {
  if (!semis) return { ...k };
  return makeKey(k.tonic + semis, k.minor);
}

const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function detectKey(notes) {
  // notes: [{p, d}] duration weighted pitch-class histogram, Krumhansl-Schmuckler
  const h = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) { h[n.p % 12] += Math.max(1, n.d); total += Math.max(1, n.d); }
  if (!total) return makeKey(0, false);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : 0;
  };
  let best = null, bs = -2;
  for (let t = 0; t < 12; t++) {
    const rot = h.map((_, i) => h[(i + t) % 12]);
    const sM = corr(rot, KS_MAJ), sm = corr(rot, KS_MIN);
    if (sM > bs) { bs = sM; best = makeKey(t, false); }
    if (sm > bs + 0.02) { bs = sm; best = makeKey(t, true); } // slight bias to major on ties
  }
  return best;
}

// key signature accidental per letter index: -1, 0, +1
export function keyAccidentals(sf) {
  const a = [0, 0, 0, 0, 0, 0, 0];
  if (sf > 0) for (let i = 0; i < sf; i++) a[SHARP_ORDER[i]] = 1;
  if (sf < 0) for (let i = 0; i < -sf; i++) a[FLAT_ORDER[i]] = -1;
  return a;
}

// Spell a midi pitch in a key signature. Returns {letter, alt, oct, dia}
export function spell(pitch, sf) {
  const pc = ((pitch % 12) + 12) % 12;
  const ka = keyAccidentals(sf);
  let letter = -1, alt = 0, dia = false;
  for (let l = 0; l < 7; l++) {
    if ((((NAT_PC[l] + ka[l]) % 12) + 12) % 12 === pc) { letter = l; alt = ka[l]; dia = true; break; }
  }
  if (letter < 0) {
    // chromatic note: natural sign against the key, then the key's own direction, then the other direction
    const tries = sf >= 0
      ? [[0, 1], [1, 0], [-1, 0], [1, 1], [0, -1], [-1, 1], [-1, -1], [1, -1]]
      : [[0, -1], [-1, 0], [1, 0], [-1, -1], [0, 1], [1, 1], [1, -1], [-1, 1]];
    // tries are [alt, requiredKeyAcc]: use alt `a` on a letter whose key accidental is `k`
    for (const [a, k] of tries) {
      for (let l = 0; l < 7; l++) {
        if (ka[l] === k && ((((NAT_PC[l] + a) % 12) + 12) % 12) === pc) { letter = l; alt = a; break; }
      }
      if (letter >= 0) break;
    }
    // keep Bb in sharp-side/C keys where it reads better
    if (sf === 0 && pc === 10) { letter = 6; alt = -1; }
  }
  const oct = Math.floor((pitch - NAT_PC[letter] - alt) / 12) - 1;
  return { letter, alt, oct, dia };
}

export function diatonicIndex(sp) { return sp.oct * 7 + sp.letter; }
