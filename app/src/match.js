// Earth matcher (ROADMAP 4.9): scores EVERY Earth search cell against the card of the clicked
// Mars / Moon cell, in the browser, with the same formula as src/analogs/similarity.py:
//
//   note_k = max(0, 1 − |target_k − earth_k| / tolerance_k)
//   index  = 100 · Σ w_k · note_k / Σ w_k      (only variables present on both sides)
//
// Data: data/tierra/match.json + match.bin.gz (src/analogs/earth_grid.py, write_match_table):
// only the analog search cells (deserts, polar ice, arid open land; ~1.4 M H3 res-6 cells) and only
// the compared columns, in ascending H3 order, ids as two uint32 blocks (high, low).
import { cellToLatLng, greatCircleDistance } from 'h3-js';
import { zoneContains, zoneSizeKm } from './zones.js';

const BASE = `${import.meta.env.BASE_URL}data/tierra/`;
const NODATA = { u1: 255, u2: 65535 };

async function gunzip(buffer) {
  const u8 = new Uint8Array(buffer);
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return buffer;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export class EarthMatcher {
  constructor() {
    this.ready = null;
  }

  /** Download and decode the match table once (~3.5 MB). */
  load() {
    if (!this.ready) {
      this.ready = (async () => {
        const meta = await (await fetch(`${BASE}match.json`)).json();
        const raw = await gunzip(await (await fetch(`${BASE}match.bin.gz`)).arrayBuffer());
        const n = meta.n_cells;
        let off = 0;
        const hi = new Uint32Array(raw.slice(off, off + 4 * n)); off += 4 * n;
        const lo = new Uint32Array(raw.slice(off, off + 4 * n)); off += 4 * n;
        const cols = {};
        for (const c of meta.columns) {
          const bytes = c.dtype === 'u1' ? 1 : 2;
          cols[c.name] = { ...c, arr: c.dtype === 'u1' ? new Uint8Array(raw, off, n) : new Uint16Array(raw.slice(off, off + 2 * n)) };
          off += bytes * n;
        }
        this.meta = meta;
        this.n = n;
        this.hi = hi;
        this.lo = lo;
        this.cols = cols;
        return this;
      })();
    }
    return this.ready;
  }

  h3(i) {
    return this.hi[i].toString(16) + this.lo[i].toString(16).padStart(8, '0');
  }

  /** Centre lat/lon of every search cell (computed once, on the first zone search; ~11 MB). */
  coords() {
    if (!this.lat) {
      const lat = new Float32Array(this.n);
      const lon = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) {
        const [la, lo] = cellToLatLng([this.lo[i], this.hi[i]]); // h3-js accepts [low, high] uint32 pairs
        lat[i] = la;
        lon[i] = lo;
      }
      this.lat = lat;
      this.lon = lon;
    }
    return { lat: this.lat, lon: this.lon };
  }

  /** 1 for the search cells inside the zone (cached per zone). */
  zoneMask(zone) {
    const id = `${zone.south},${zone.north},${zone.west},${zone.east}`;
    if (this._zone?.id !== id) {
      const { lat, lon } = this.coords();
      const mask = new Uint8Array(this.n);
      let count = 0;
      for (let i = 0; i < this.n; i++) {
        if (zoneContains(zone, lat[i], lon[i])) {
          mask[i] = 1;
          count++;
        }
      }
      this._zone = { id, mask, count };
    }
    return this._zone;
  }

  value(name, i) {
    const c = this.cols[name];
    const q = c.arr[i];
    return q === NODATA[c.dtype] ? NaN : q * c.scale + c.offset;
  }

  /**
   * Which variables can be compared for this target card, and with which weight.
   * prueba = key of configs/pruebas.yaml or '' for "all shared variables, equal weight".
   */
  plan(targetValues, bodyKey, prueba) {
    const { variables, pruebas, zero_on_target: zero } = this.meta;
    const target = {};
    for (const name of Object.keys(variables)) {
      let v = targetValues[name];
      if (!Number.isFinite(v) && zero?.[name]?.includes(bodyKey)) v = 0; // no rain on Mars or the Moon
      if (Number.isFinite(v) && this.cols[name]) target[name] = v;
    }
    let weights = Object.fromEntries(Object.keys(target).map((k) => [k, 1]));
    let note = 'all shared variables, equal weight';
    if (prueba && pruebas[prueba]) {
      const w = Object.fromEntries(Object.entries(pruebas[prueba].weights).filter(([k, x]) => k in target && x > 0));
      if (Object.keys(w).length) {
        weights = w;
        note = pruebas[prueba].label;
      } else {
        note = `${pruebas[prueba].label}: none of its variables exist here, so all shared variables are used`;
      }
    }
    return { target, weights, note };
  }

  /** Note (0–1) of every compared variable for Earth cell i. */
  notes(plan, i) {
    const out = {};
    for (const [name, t] of Object.entries(plan.target)) {
      if (!(name in plan.weights)) continue;
      const e = this.value(name, i);
      const tol = this.meta.variables[name].tolerance;
      out[name] = { target: t, earth: e, note: Number.isFinite(e) ? Math.max(0, 1 - Math.abs(t - e) / tol) : NaN };
    }
    return out;
  }

  /**
   * Score all cells (or only those inside `zone`, a lat/lon box from zones.js).
   * Returns { plan, score, top: indices of the best `topN` cells (best first),
   * best: up to `nBest` sites at least `minKm` apart, threshold, n: cells searched, zone }.
   * Inside a zone the results are spaced by min(minKm, zone size / 5) so a small zone still
   * gives several distinct sites.
   */
  rank(targetValues, bodyKey, prueba, { topN = 6000, nBest = 6, minKm = 400, zone = null } = {}) {
    const plan = this.plan(targetValues, bodyKey, prueba);
    const n = this.n;
    const inZone = zone ? this.zoneMask(zone) : null;
    if (zone) minKm = Math.max(5, Math.min(minKm, zoneSizeKm(zone) / 5));
    const total = new Float32Array(n);
    const wsum = new Float32Array(n);
    for (const [name, w] of Object.entries(plan.weights)) {
      const { arr, scale, offset, dtype } = this.cols[name];
      const nod = NODATA[dtype];
      const t = plan.target[name];
      const tol = this.meta.variables[name].tolerance;
      for (let i = 0; i < n; i++) {
        const q = arr[i];
        if (q === nod) continue;
        const s = 1 - Math.abs(q * scale + offset - t) / tol;
        if (s > 0) total[i] += w * s;
        wsum[i] += w;
      }
    }
    const score = new Float32Array(n);
    const hist = new Uint32Array(1001);
    for (let i = 0; i < n; i++) {
      const s = wsum[i] > 0 && (!inZone || inZone.mask[i]) ? (100 * total[i]) / wsum[i] : -1;
      score[i] = s;
      if (s >= 0) hist[Math.round(s * 10)]++;
    }
    // threshold that keeps ~topN cells, then sort only those
    let kept = 0;
    let bin = 1000;
    for (; bin > 0 && kept + hist[bin] <= topN; bin--) kept += hist[bin];
    const threshold = Math.max(0, (bin + 0.5) / 10);
    const top = [];
    for (let i = 0; i < n; i++) if (score[i] >= threshold) top.push(i);
    top.sort((a, b) => score[b] - score[a]);

    const best = [];
    for (const i of top) {
      const h3 = this.h3(i);
      const [lat, lon] = cellToLatLng(h3);
      if (best.every((b) => greatCircleDistance([lat, lon], [b.lat, b.lon], 'km') >= minKm)) {
        best.push({ i, h3, lat, lon, score: score[i], env: this.value('env', i), notes: this.notes(plan, i) });
        if (best.length === nBest) break;
      }
    }
    const histogram = { ge90: 0, ge75: 0, ge50: 0 };
    for (let i = 0; i < n; i++) {
      const s = score[i];
      if (s >= 90) histogram.ge90++;
      if (s >= 75) histogram.ge75++;
      if (s >= 50) histogram.ge50++;
    }
    return { plan, score, top, best, threshold, histogram, n: inZone ? inZone.count : n, zone, minKm };
  }
}

// Perceptual colour ramp ("magma"-like): low = deep purple, high = pale yellow
const RAMP = ['#1d1147', '#51127c', '#822681', '#b73779', '#e75263', '#fc8961', '#fec287', '#fcfdbf'];

export function rampColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const k = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - k;
  const a = parseInt(RAMP[k].slice(1), 16);
  const b = parseInt(RAMP[k + 1].slice(1), 16);
  const mix = (sh) => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f);
  return `rgb(${mix(16)}, ${mix(8)}, ${mix(0)})`;
}

export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.join(', ')})`;
