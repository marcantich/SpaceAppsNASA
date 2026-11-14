// Earth matcher (ROADMAP 4.9): scores EVERY Earth search cell against the card of the clicked
// Mars / Moon cell, in the browser, with the formula of scoring.js (= src/analogs/similarity.py):
// soft note per variable, mean per dimension, weighted mean of dimensions; the ranking then mixes
// each candidate with its 6 neighbours so homogeneous areas come first.
//
// Data: data/tierra/match.json + match.bin.gz (src/analogs/earth_grid.py, write_match_table):
// only the analog search cells (deserts, polar ice, arid open land; ~1.4 M H3 res-6 cells) and only
// the compared columns, in ascending H3 order, ids as two uint32 blocks (high, low).
import { cellToLatLng, gridDisk, greatCircleDistance } from 'h3-js';
import { zoneContains, zoneSizeKm } from './zones.js';
import { areaIndex, makePlan, noteOf, scoreCell } from './scoring.js';

const BASE = `${import.meta.env.BASE_URL}data/tierra/`;
const NODATA = { u1: 255, u2: 65535 };

async function gunzip(buffer) {
  const u8 = new Uint8Array(buffer);
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return buffer;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** H3 id string → [high, low] uint32 halves. */
const split = (h3) => [parseInt(h3.slice(0, -8), 16), parseInt(h3.slice(-8), 16)];

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

  /** Index of an H3 cell in the table (binary search on the sorted ids), or -1. */
  find(h3) {
    const [h, l] = split(h3);
    let a = 0;
    let b = this.n - 1;
    while (a <= b) {
      const m = (a + b) >> 1;
      const mh = this.hi[m];
      const ml = this.lo[m];
      if (mh === h && ml === l) return m;
      if (mh < h || (mh === h && ml < l)) a = m + 1;
      else b = m - 1;
    }
    return -1;
  }

  value(name, i) {
    const c = this.cols[name];
    const q = c.arr[i];
    return q === NODATA[c.dtype] ? NaN : q * c.scale + c.offset;
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

  /** prueba = key of configs/pruebas.yaml or '' for "all shared variables". */
  plan(targetValues, bodyKey, prueba) {
    return makePlan(this.meta, targetValues, bodyKey, prueba, (name) => !!this.cols[name]);
  }

  /** Index of search cell i (with the dimension scores and notes). */
  scoreOf(plan, i) {
    return scoreCell(this.meta, plan, (name) => this.value(name, i));
  }

  /**
   * Mean index of the neighbours (ring 1, ~20 km around) of an H3 cell; cells outside the search
   * zone count 0 (they are vegetation, water or cities: not part of an analog area).
   */
  neighbourMean(h3, score) {
    const ring = gridDisk(h3, 1).filter((c) => c !== h3);
    let sum = 0;
    for (const c of ring) {
      const j = this.find(c);
      if (j >= 0 && score[j] > 0) sum += score[j];
    }
    return ring.length ? sum / ring.length : NaN;
  }

  /**
   * Score all cells, then rank the best ones (or only those inside `zone`, a lat/lon box).
   * Returns { plan, score (cell index, -1 = no shared variable), top: best `topN` cells by cell index
   * (for the map), best: up to `nBest` sites at least `minKm` apart ranked by the area index,
   * threshold, n: cells searched, zone, minKm }.
   */
  rank(targetValues, bodyKey, prueba, { topN = 6000, nBest = 6, minKm = 400, zone = null } = {}) {
    const plan = this.plan(targetValues, bodyKey, prueba);
    const n = this.n;
    const inZone = zone ? this.zoneMask(zone) : null;
    if (zone) minKm = Math.max(5, Math.min(minKm, zoneSizeKm(zone) / 5));

    // one 256-entry note table per u1 variable: the per-cell loop is then just lookups
    const dims = Object.values(plan.dims).map(({ weight, vars }) => ({
      weight,
      vars: Object.entries(vars).map(([name, w]) => {
        const c = this.cols[name];
        const spec = this.meta.variables[name];
        const t = plan.target[name];
        let lut = null;
        if (c.dtype === 'u1') {
          lut = new Float32Array(256);
          for (let q = 0; q < 256; q++) lut[q] = q === 255 ? NaN : noteOf(spec, t, q * c.scale + c.offset);
        }
        return { w, arr: c.arr, lut, c, spec, t };
      }),
    }));

    const score = new Float32Array(n);
    const hist = new Uint32Array(1001);
    for (let i = 0; i < n; i++) {
      let num = 0;
      let den = 0;
      for (const d of dims) {
        let dn = 0;
        let dd = 0;
        for (const v of d.vars) {
          const q = v.arr[i];
          const note = v.lut ? v.lut[q] : (q === NODATA[v.c.dtype] ? NaN : noteOf(v.spec, v.t, q * v.c.scale + v.c.offset));
          if (note === note) { // not NaN
            dn += v.w * note;
            dd += v.w;
          }
        }
        if (dd > 0) {
          num += (d.weight * dn) / dd;
          den += d.weight;
        }
      }
      const s = den > 0 ? (100 * num) / den : -1;
      score[i] = s;
      if (s >= 0 && (!inZone || inZone.mask[i])) hist[Math.round(s * 10)]++;
    }

    // threshold that keeps ~topN cells of the zone, then sort only those
    let kept = 0;
    let bin = 1000;
    for (; bin > 0 && kept + hist[bin] <= topN; bin--) kept += hist[bin];
    const threshold = Math.max(0, (bin + 0.5) / 10);
    const top = [];
    for (let i = 0; i < n; i++) if (score[i] >= threshold && (!inZone || inZone.mask[i])) top.push(i);
    top.sort((a, b) => score[b] - score[a]);

    // ranking: the cell mixed with its 6 neighbours (homogeneous areas first)
    const cand = top.slice(0, 3000).map((i) => {
      const h3 = this.h3(i);
      const ring = this.neighbourMean(h3, score);
      return { i, h3, cell: score[i], ring, area: areaIndex(this.meta, score[i], ring) };
    });
    cand.sort((a, b) => b.area - a.area);
    const best = [];
    for (const c of cand) {
      const [lat, lon] = cellToLatLng(c.h3);
      if (best.every((b) => greatCircleDistance([lat, lon], [b.lat, b.lon], 'km') >= minKm)) {
        best.push({ ...c, lat, lon, score: c.area, env: this.value('env', c.i), ...this.scoreOf(plan, c.i) });
        if (best.length === nBest) break;
      }
    }
    const histogram = { ge90: 0, ge75: 0, ge50: 0 };
    for (let k = 1000; k >= 500; k--) {
      if (k >= 900) histogram.ge90 += hist[k];
      if (k >= 750) histogram.ge75 += hist[k];
      histogram.ge50 += hist[k];
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

/** Dark or light text, whichever reads better on a CSS colour ("rgb(r, g, b)" or "#rrggbb"). */
export function inkOn(css) {
  const s = String(css);
  const [r, g, b] = s.startsWith('#')
    ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
    : (s.match(/\d+/g) ?? [0, 0, 0]).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#10141f' : '#ffffff';
}
