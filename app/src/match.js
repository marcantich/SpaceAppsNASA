// Global comparator (ROADMAP 4.9): scores EVERY cell of the search body (Earth, Mars or the Moon)
// against the card of the clicked cell of the other body, in the browser, with the formula of
// scoring.js (= src/analogs/similarity.py): soft note per variable, mean per dimension, weighted mean of
// dimensions; the ranking then mixes each candidate with its 6 neighbours (homogeneous areas first).
//
// Search tables (all from data already in app/data/, nothing new is exported):
//   Earth       data/tierra/match.json + match.bin.gz: only the analog search cells (deserts, polar ice,
//               arid open land; ~1.4 M H3 res-6 cells) and only the compared columns
//   Mars, Moon  the planet-wide card grids (data/marte, data/luna: one gzip per H3 base cell, the same
//               files the cards use), every cell, only the compared columns kept in memory
// Both keep the cells in ascending H3 order with the ids as two uint32 arrays (high, low), so a cell
// is found by binary search.
import { cellToChildren, cellToLatLng, getRes0Cells, getBaseCellNumber, gridDisk, greatCircleDistance, isPentagon } from 'h3-js';
import { zoneContains, zoneSizeKm } from './zones.js';
import { areaIndex, makePlan, noteOf, scoreCell } from './scoring.js';

const DATA = `${import.meta.env?.BASE_URL ?? '/'}data/`; // (no Vite env when tested in Node)
const NODATA = { u1: 255, u2: 65535 };
const BYTES = { u1: 1, u2: 2 };
const FOLDER = { earth: 'tierra', mars: 'marte', moon: 'luna' };

async function gunzip(buffer) {
  const u8 = new Uint8Array(buffer);
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return buffer;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** H3 id string → [high, low] uint32 halves. */
const split = (h3) => [parseInt(h3.slice(0, -8), 16), parseInt(h3.slice(-8), 16)];

// --- Scoring settings: variables, dimensions, tests (configs/*.yaml → tierra/match.json) ----------
let metaPromise = null;
export function loadScoringMeta() {
  metaPromise ??= fetch(`${DATA}tierra/match.json`).then((r) => {
    if (!r.ok) throw new Error(`Could not load the scoring settings (HTTP ${r.status})`);
    return r.json();
  });
  return metaPromise;
}

// --- A search table: cells (ascending H3) × compared columns ---------------------------------------
class Table {
  constructor(body, n, hi, lo, cols) {
    this.body = body;
    this.n = n;
    this.hi = hi;
    this.lo = lo;
    this.cols = cols; // name → { arr, scale, offset, dtype, unit, label }
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
    if (!c) return NaN;
    const q = c.arr[i];
    return q === NODATA[c.dtype] ? NaN : q * c.scale + c.offset;
  }

  /** Centre lat/lon of every cell (computed once, on the first zone search). */
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

  /** 1 for the cells inside the zone (cached per zone). */
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
}

/** Earth: the analog search cells only (data/tierra/match.bin.gz). */
async function loadEarthTable(onProgress) {
  const meta = await loadScoringMeta();
  onProgress?.('Loading the Earth search grid (3.5 MB)…');
  const raw = await gunzip(await (await fetch(`${DATA}tierra/match.bin.gz`)).arrayBuffer());
  const n = meta.n_cells;
  let off = 0;
  const hi = new Uint32Array(raw.slice(off, off + 4 * n)); off += 4 * n;
  const lo = new Uint32Array(raw.slice(off, off + 4 * n)); off += 4 * n;
  const cols = {};
  for (const c of meta.columns) {
    cols[c.name] = { ...c, arr: c.dtype === 'u1' ? new Uint8Array(raw, off, n) : new Uint16Array(raw.slice(off, off + 2 * n)) };
    off += BYTES[c.dtype] * n;
  }
  return new Table('earth', n, hi, lo, cols);
}

/**
 * Ids of the children of a base cell at `res`, ascending: computed from the digits (k-th child =
 * k written in base 7) for hexagon base cells, from h3-js for the 12 pentagons (they lack some).
 */
function childIds(base, res, count, hi, lo, at) {
  const root = getRes0Cells().find((c) => getBaseCellNumber(c) === base);
  if (isPentagon(root) || count !== 7 ** res) {
    const kids = cellToChildren(root, res).sort();
    kids.forEach((c, k) => {
      const [h, l] = split(c);
      hi[at + k] = h;
      lo[at + k] = l;
    });
    return;
  }
  // H3 bits: mode 1 (bit 59), resolution (52–55), base cell (45–51), 15 digits × 3 bits (unused = 7)
  const head = 2 ** 27 + res * 2 ** 20 + base * 2 ** 13; // the high 32 bits above the digits
  for (let k = 0; k < count; k++) {
    let digits = 0; // the 45 digit bits, as a plain number (< 2^45: exact in a double)
    let x = k;
    for (let d = res; d >= 1; d--) {
      digits += (x % 7) * 8 ** (15 - d);
      x = Math.floor(x / 7);
    }
    for (let d = res + 1; d <= 15; d++) digits += 7 * 8 ** (15 - d);
    hi[at + k] = head + Math.floor(digits / 2 ** 32);
    lo[at + k] = digits % 2 ** 32;
  }
}

/** Mars / Moon: every cell of the card grid, only the columns in `names`. */
async function loadGridTable(body, names, onProgress) {
  const folder = FOLDER[body];
  const index = await (await fetch(`${DATA}${folder}/index.json`)).json();
  const res = index.h3_resolution;
  const regions = Object.entries(index.regions).map(([b, r]) => ({ base: Number(b), ...r }))
    .sort((a, b) => a.base - b.base); // base cell order = global ascending H3 order
  const n = regions.reduce((s, r) => s + r.n_cells, 0);
  const wanted = index.columns.filter((c) => names.includes(c.name));
  const hi = new Uint32Array(n);
  const lo = new Uint32Array(n);
  const cols = Object.fromEntries(wanted.map((c) => [c.name, { ...c, arr: c.dtype === 'u1' ? new Uint8Array(n) : new Uint16Array(n) }]));
  let at = 0;
  for (const r of regions) {
    r.at = at;
    at += r.n_cells;
  }
  let done = 0;
  const label = body === 'mars' ? 'Mars' : 'the Moon';
  const mb = (regions.reduce((s, r) => s + (r.bytes ?? 0), 0) / 1e6).toFixed(1);
  onProgress?.(`Loading ${label} (${mb} MB, once)…`);
  const work = async (r) => {
    const raw = await gunzip(await (await fetch(`${DATA}${folder}/${r.file}`)).arrayBuffer());
    let off = 0;
    for (const c of index.columns) {
      const size = BYTES[c.dtype] * r.n_cells;
      if (cols[c.name]) {
        const src = c.dtype === 'u1' ? new Uint8Array(raw, off, r.n_cells) : new Uint16Array(raw.slice(off, off + size));
        cols[c.name].arr.set(src, r.at);
      }
      off += size;
    }
    childIds(r.base, res, r.n_cells, hi, lo, r.at);
    done++;
    if (done % 10 === 0) onProgress?.(`Loading ${label}: ${Math.round((100 * done) / regions.length)} %`);
  };
  const queue = [...regions];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) await work(queue.shift());
  }));
  return new Table(body, n, hi, lo, cols);
}

const tables = {};
/** Search table of a body (loaded once, then cached). */
export async function loadTable(body, onProgress) {
  if (!tables[body]) {
    tables[body] = (async () => {
      if (body === 'earth') return loadEarthTable(onProgress);
      const meta = await loadScoringMeta();
      return loadGridTable(body, Object.keys(meta.variables), onProgress);
    })();
    tables[body].catch(() => { delete tables[body]; });
  }
  return tables[body];
}

export const isTableLoaded = (body) => !!tables[body];

// --- Matcher: one search table + the scoring settings ---------------------------------------------
export class Matcher {
  constructor(table, meta) {
    this.table = table;
    this.meta = meta;
    this.body = table.body;
  }

  /**
   * prueba = key of configs/pruebas.yaml or '' for "all shared variables". Only variables that the
   * search body really has are compared (no rain on Mars / the Moon: it is not a column there).
   */
  plan(sourceValues, sourceBody, prueba) {
    // a variable that is constant on the search body (zero_on_target: no rain on Mars or the Moon)
    // would score every cell alike: it is not compared, even if the grid carries the column
    const constant = (name) => this.meta.zero_on_target?.[name]?.includes(this.body);
    return makePlan(this.meta, sourceValues, sourceBody, prueba, (name) => !!this.table.cols[name] && !constant(name));
  }

  /** Index of table cell i (with the dimension scores and notes). */
  scoreOf(plan, i) {
    return scoreCell(this.meta, plan, (name) => this.table.value(name, i));
  }

  /**
   * Mean index of the 6 neighbours (ring 1) of an H3 cell; cells not in the table (outside Earth's
   * search zone: vegetation, water, cities) count 0.
   */
  neighbourMean(h3, score) {
    const ring = gridDisk(h3, 1).filter((c) => c !== h3);
    let sum = 0;
    for (const c of ring) {
      const j = this.table.find(c);
      if (j >= 0 && score[j] > 0) sum += score[j];
    }
    return ring.length ? sum / ring.length : NaN;
  }

  /**
   * Score all cells, then rank the best ones (or only those inside `zone`, a lat/lon box).
   * Returns { plan, score (cell index, -1 = no shared variable), top: best `topN` cells by cell index
   * (for the map), best: up to `nBest` sites at least `minKm` apart ranked by the area index,
   * threshold, n: cells searched, zone, minKm, body }.
   */
  /**
   * Index of every cell for `plan` (Float32Array, −1 = no shared variable). One 256-entry note
   * table per u1 variable, so the per-cell loop is just lookups.
   */
  scoreAll(plan) {
    const t = this.table;
    const n = t.n;
    const dims = Object.values(plan.dims).map(({ weight, vars }) => ({
      weight,
      vars: Object.entries(vars).map(([name, w]) => {
        const c = t.cols[name];
        const spec = this.meta.variables[name];
        const target = plan.target[name];
        let lut = null;
        if (c.dtype === 'u1') {
          lut = new Float32Array(256);
          for (let q = 0; q < 256; q++) lut[q] = q === 255 ? NaN : noteOf(spec, target, q * c.scale + c.offset);
        }
        return { w, arr: c.arr, lut, c, spec, target };
      }),
    }));
    const score = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let num = 0;
      let den = 0;
      let any = false;
      for (const d of dims) {
        let dn = 0;
        let dd = 0;
        for (const v of d.vars) {
          const q = v.arr[i];
          const note = v.lut ? v.lut[q] : (q === NODATA[v.c.dtype] ? NaN : noteOf(v.spec, v.target, q * v.c.scale + v.c.offset));
          if (note === note) { // not NaN
            dn += v.w * note;
            dd += v.w;
          }
        }
        if (dd > 0) {
          num += (d.weight * dn) / dd;
          any = true;
        }
        den += d.weight; // a dimension with no data at all counts 0 (what was not measured is not rewarded)
      }
      score[i] = any && den > 0 ? (100 * num) / den : -1;
    }
    return score;
  }

  rank(sourceValues, sourceBody, prueba, { topN = 6000, nBest = 6, minKm = 400, zone = null } = {}) {
    const t = this.table;
    const plan = this.plan(sourceValues, sourceBody, prueba);
    const n = t.n;
    const inZone = zone ? t.zoneMask(zone) : null;
    // spacing of the results: smaller bodies and zones get closer sites
    const R = { earth: 6371, mars: 3390, moon: 1737 }[this.body] ?? 6371;
    minKm *= R / 6371;
    if (zone) minKm = Math.min(minKm, zoneSizeKm(zone) * (R / 6371) / 5);
    minKm = Math.max(5, minKm);

    const score = this.scoreAll(plan);
    // Tie-break: a test with few variables gives thousands of cells the same index. Cells whose
    // index rounds to the same whole point (as the app shows it) count as tied, and among them the
    // one most similar on ALL shared variables goes first (not the first in table order).
    const general = prueba ? this.scoreAll(this.plan(sourceValues, sourceBody, '')) : score;
    const tie = (a, b, i, j) => Math.round(b) - Math.round(a) || general[j] - general[i] || b - a;
    const byScore = (i, j) => tie(score[i], score[j], i, j);

    const hist = new Uint32Array(1001);
    for (let i = 0; i < n; i++) if (score[i] >= 0 && (!inZone || inZone.mask[i])) hist[Math.round(score[i] * 10)]++;

    /** The `limit` best cells of the zone, best first (ties broken by the general index). */
    const bestCells = (limit) => {
      // walk down the histogram until `limit` cells are reached; the bin that overflows is
      // included whole (it may hold thousands of tied cells) and the list is cut after sorting
      let kept = 0;
      let bin = 1000;
      for (; bin > 0 && kept < limit; bin--) kept += hist[bin];
      const cut = Math.max(0, (bin + 0.5) / 10);
      const list = [];
      for (let i = 0; i < n; i++) if (score[i] >= cut && (!inZone || inZone.mask[i])) list.push(i);
      list.sort(byScore);
      if (list.length > limit) list.length = limit;
      return list;
    };
    const top = bestCells(topN);
    const threshold = top.length ? Math.max(0, score[top[top.length - 1]]) : 0;

    // ranking: the cell mixed with its 6 neighbours (homogeneous areas first)
    const candidate = (i) => {
      const h3 = t.h3(i);
      const ring = this.neighbourMean(h3, score);
      return { i, h3, cell: score[i], ring, area: areaIndex(this.meta, score[i], ring) };
    };
    const best = [];
    const tryAdd = (c) => {
      const [lat, lon] = cellToLatLng(c.h3);
      if (best.every((b) => greatCircleDistance([lat, lon], [b.lat, b.lon], 'km') * (R / 6371) >= minKm)) {
        best.push({ ...c, lat, lon, score: c.area, env: t.value('env', c.i), ...this.scoreOf(plan, c.i) });
      }
      return best.length === nBest;
    };
    const cand = top.slice(0, 3000).map(candidate);
    cand.sort((a, b) => tie(a.area, b.area, a.i, b.i));
    for (const c of cand) if (tryAdd(c)) break;
    // the best cells may all lie in one region: then look further down the list for the others
    if (best.length < nBest) {
      for (const i of bestCells(50000).slice(3000)) if (tryAdd(candidate(i))) break;
      best.sort((a, b) => tie(a.score, b.score, a.i, b.i));
    }
    const histogram = { ge90: 0, ge75: 0, ge50: 0 };
    for (let k = 1000; k >= 500; k--) {
      if (k >= 900) histogram.ge90 += hist[k];
      if (k >= 750) histogram.ge75 += hist[k];
      histogram.ge50 += hist[k];
    }
    return { plan, score, top, best, threshold, histogram, n: inZone ? inZone.count : n, zone, minKm, body: this.body };
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
