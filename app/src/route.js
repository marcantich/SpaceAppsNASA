// [route] Third view of the app, "Route replica" (opened from the view menu in rover.js).
//
// The user draws a route on Mars or the Moon (or loads a real rover traverse). The app reads the
// elevation along it, turns it into a list of slopes (one per step) and searches on Earth a path that
// a rover can drive feeling the same slopes in the same order (routeSolver.js).
//
// Elevation data, all public, no account, read straight from the browser:
//   Mars   HRSC + MOLA blended DEM, 200 m/px (USGS Astrogeology / DLR), byte ranges of the GeoTIFF
//   Moon   LRO LOLA global DEM, 118 m/px (USGS Astrogeology / NASA GSFC), byte ranges of the GeoTIFF
//   Earth  "Terrarium" elevation tiles (Mapzen / AWS Open Data: SRTM ~30 m, USGS 3DEP 10 m in the US)
//   Real rover traverses: app/data/route/presets.json (rover telemetry, 10 m along the track)
//
// What is compared is the RELIEF at the step length (≥ 200 m on Mars, ≥ 120 m on the Moon for drawn
// routes; 30 m for the rover traverses). Rocks, sand and anything smaller than a step are not seen.
import * as Cesium from 'cesium';
import './route.css';
import { latLonToCartesian } from './coords.js';
import { compareProfiles, solveRoute } from './routeSolver.js';

const RAD = Math.PI / 180;
const MAX_STEPS = 100;       // steps of the replica (memory and time of the search grow with it)
const GRID = 360;            // Earth search window: GRID × GRID pixels of (step / 3) = 120 steps wide
const R_EARTH = 6371008.8;
const COLOR = { target: '#ff6a3d', earth: '#4da3ff' };

const S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/';
// Uncompressed 16-bit GeoTIFFs, one row per strip, rows stored one after another (checked 2026-11-15):
// the byte of pixel (row, col) is offset + (row * W + col) * 2, so a few bytes can be read by range.
const DEM = {
  mars: {
    name: 'Mars', R: 3396190, minStep: 200, W: 106694, H: 53347, offset: 854272, scale: 1,
    pxPerDeg: 1 / 0.003374120830641,
    url: `${S3}Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`,
    credit: 'Mars HRSC+MOLA blended DEM 200 m v2 (Fergason, Hare & Laura 2018, USGS Astrogeology; HRSC: ESA/DLR/FU Berlin, CC BY-SA 3.0 IGO; MOLA: NASA, CC0)',
  },
  moon: {
    name: 'Moon', R: 1737400, minStep: 120, W: 92160, H: 46080, offset: 738233, scale: 0.5,
    pxPerDeg: 256,
    url: `${S3}Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif`,
    credit: 'LRO LOLA global DEM 118 m (LOLA Science Team 2014, NASA GSFC; USGS Astrogeology)',
  },
};

// Where to look on Earth: centres of well-known planetary analog areas (our choice of places).
const REGIONS = [
  { id: 'death-valley', name: 'Death Valley, USA', lat: 36.28, lon: -116.81 },
  { id: 'hanksville', name: 'Hanksville (MDRS), Utah, USA', lat: 38.41, lon: -110.79 },
  { id: 'craters-moon', name: 'Craters of the Moon, Idaho, USA', lat: 43.42, lon: -113.52 },
  { id: 'mojave', name: 'Mojave (Cima), USA', lat: 35.2, lon: -115.8 },
  { id: 'mauna-kea', name: 'Mauna Kea, Hawaii, USA', lat: 19.76, lon: -155.46 },
  { id: 'atacama', name: 'Atacama (Yungay), Chile', lat: -24.1, lon: -69.9 },
  { id: 'askja', name: 'Askja, Iceland', lat: 65.05, lon: -16.75 },
  { id: 'lanzarote', name: 'Lanzarote, Spain', lat: 29.0, lon: -13.72 },
  { id: 'bardenas', name: 'Bardenas Reales, Spain', lat: 42.2, lon: -1.5 },
  { id: 'rio-tinto', name: 'Río Tinto, Spain', lat: 37.72, lon: -6.55 },
  { id: 'wadi-rum', name: 'Wadi Rum, Jordan', lat: 29.58, lon: 35.42 },
  { id: 'namib', name: 'Namib desert, Namibia', lat: -24.7, lon: 15.45 },
  { id: 'tenere', name: 'Ténéré, Niger', lat: 17.5, lon: 10.5 },
  { id: 'pilbara', name: 'Pilbara, Australia', lat: -21.2, lon: 119.3 },
  { id: 'haughton', name: 'Haughton crater, Devon Island, Canada', lat: 75.38, lon: -89.67 },
];

const GOTO = {
  mars: [
    { name: 'Jezero crater', lat: 18.44, lon: 77.45, h: 6e4 },
    { name: 'Gale crater', lat: -4.6, lon: 137.4, h: 1.2e5 },
    { name: 'Valles Marineris', lat: -13.9, lon: -59.2, h: 4e5 },
    { name: 'Olympus Mons', lat: 18.65, lon: -133.8, h: 9e5 },
  ],
  moon: [
    { name: 'Shackleton (south pole)', lat: -89.3, lon: 130, h: 1.2e5 },
    { name: 'Apollo 17 valley', lat: 20.19, lon: 30.77, h: 6e4 },
    { name: 'Apollo 15 (Hadley)', lat: 26.13, lon: 3.63, h: 6e4 },
    { name: 'Tycho crater', lat: -43.3, lon: -11.2, h: 2.5e5 },
  ],
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const deg = (t) => (Math.atan(t) * 180) / Math.PI;
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const fmtKm = (m) => (m >= 10000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

// ---- geometry on a sphere ---------------------------------------------------------------------
const toVec = ({ lat, lon }) => {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)];
};
const fromVec = ([x, y, z]) => ({ lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD });
const angle = (a, b) => Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
function slerp(a, b, w, f) {
  if (w < 1e-12) return a;
  const s = Math.sin(w);
  const p = Math.sin((1 - f) * w) / s;
  const q = Math.sin(f * w) / s;
  return [p * a[0] + q * b[0], p * a[1] + q * b[1], p * a[2] + q * b[2]];
}

/** Points every `step` metres along the great-circle polyline through `pts` (sphere of radius R). */
function resample(pts, R, step, n) {
  const v = pts.map(toVec);
  const w = v.slice(1).map((b, k) => angle(v[k], b));
  const out = [];
  let seg = 0;
  let before = 0; // metres before segment `seg`
  for (let k = 0; k <= n; k++) {
    const s = k * step;
    while (seg < w.length - 1 && s > before + w[seg] * R) before += w[seg++] * R;
    out.push(fromVec(slerp(v[seg], v[seg + 1], w[seg], w[seg] ? clamp((s - before) / (w[seg] * R), 0, 1) : 0)));
  }
  return out;
}
const pathLength = (pts, R) => pts.slice(1).reduce((s, p, k) => s + angle(toVec(pts[k]), toVec(p)) * R, 0);

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// ---- Mars / Moon: elevation of a list of points (bilinear), a few bytes per row by HTTP range ----
async function sampleDem(body, pts) {
  const d = DEM[body];
  const need = new Map(); // row → [first col, last col]
  const pos = pts.map(({ lat, lon }) => {
    const c = clamp((((lon + 540) % 360)) * d.pxPerDeg - 0.5, 0, d.W - 1.001);
    const r = clamp((90 - lat) * d.pxPerDeg - 0.5, 0, d.H - 1.001);
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    for (const row of [r0, r0 + 1]) {
      const e = need.get(row);
      if (!e) need.set(row, [c0, c0 + 1]);
      else { e[0] = Math.min(e[0], c0); e[1] = Math.max(e[1], c0 + 1); }
    }
    return { c, r, c0, r0 };
  });
  const rows = new Map();
  await pool([...need], 8, async ([row, [a, b]]) => {
    const start = d.offset + (row * d.W + a) * 2;
    const res = await fetch(d.url, { headers: { Range: `bytes=${start}-${start + (b - a + 1) * 2 - 1}` } });
    if (!res.ok) throw new Error(`${d.name} elevation: HTTP ${res.status}`);
    rows.set(row, { a, view: new DataView(await res.arrayBuffer()) });
  });
  const at = (row, col) => {
    const e = rows.get(row);
    return e.view.getInt16((col - e.a) * 2, true) * d.scale;
  };
  return pos.map(({ c, r, c0, r0 }) => {
    const fx = c - c0;
    const fy = r - r0;
    return (1 - fy) * ((1 - fx) * at(r0, c0) + fx * at(r0, c0 + 1)) + fy * ((1 - fx) * at(r0 + 1, c0) + fx * at(r0 + 1, c0 + 1));
  });
}

// ---- Earth: elevation grid in local metres around a point, from Terrarium PNG tiles --------------
// Attribution required by the terrain tiles (github.com/tilezen/joerd/blob/master/docs/attribution.md)
const TERRAIN_CREDIT = 'Mapzen / AWS Terrain Tiles (Terrarium). Sources: '
  + '3DEP, GMTED2010 and SRTM data courtesy of the U.S. Geological Survey; '
  + 'ArcticDEM DEMs were created from DigitalGlobe, Inc., imagery and funded under NSF awards 1043681, 1559691 and 1542736; '
  + 'EU-DEM produced using Copernicus data and information funded by the European Union; '
  + 'ETOPO1 (NOAA NCEI); © Commonwealth of Australia (Geoscience Australia) 2017; '
  + '© offene Daten Österreichs – DGM Österreich; contains information licensed under the Open Government Licence – Canada; '
  + 'Source: INEGI, Continental relief, 2016; © Land Information New Zealand; © Kartverket; '
  + '© Environment Agency copyright and/or database right 2015.';
const tiles = new Map();
function loadTile(z, x, y) {
  const n = 2 ** z;
  const key = `${z}/${((x % n) + n) % n}/${clamp(y, 0, n - 1)}`;
  if (!tiles.has(key)) {
    tiles.set(key, (async () => {
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`);
      if (!res.ok) throw new Error(`Earth elevation tile ${key}: HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data;
      const h = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) h[i] = d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768;
      return h;
    })());
    tiles.get(key).catch(() => tiles.delete(key));
  }
  return tiles.get(key);
}

/** GRID × GRID elevations (m), pixel `px` metres, row 0 = north, centred on lat0/lon0. */
async function earthGrid(lat0, lon0, px, n = GRID) {
  if (Math.abs(lat0) > 82) throw new Error('No Earth elevation tiles this close to the pole');
  const zoom = clamp(Math.ceil(Math.log2((156543.03392 * Math.cos(lat0 * RAD)) / px)), 0, 14);
  const size = 256 * 2 ** zoom;
  const X = (lon) => ((lon + 180) / 360) * size;
  const Y = (lat) => ((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * size;
  const half = (n / 2) * px;
  const dLat = half / R_EARTH / RAD;
  const dLon = dLat / Math.cos(lat0 * RAD);
  const tx0 = Math.floor(X(lon0 - dLon) / 256) - 0;
  const tx1 = Math.floor(X(lon0 + dLon) / 256);
  const ty0 = Math.floor(Y(lat0 + dLat) / 256);
  const ty1 = Math.floor(Y(lat0 - dLat) / 256);
  const mw = (tx1 - tx0 + 1) * 256;
  const mh = (ty1 - ty0 + 1) * 256;
  if (mw * mh > 4096 * 4096) throw new Error('Search window too large');
  const mosaic = new Float32Array(mw * mh);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  await pool(jobs, 8, async ([tx, ty]) => {
    const h = await loadTile(zoom, tx, ty);
    for (let r = 0; r < 256; r++) mosaic.set(h.subarray(r * 256, r * 256 + 256), ((ty - ty0) * 256 + r) * mw + (tx - tx0) * 256);
  });
  const z = new Float32Array(n * n);
  const lats = new Float64Array(n);
  const lons = new Float64Array(n);
  for (let j = 0; j < n; j++) lons[j] = lon0 + ((j - n / 2) * px) / (R_EARTH * Math.cos(lat0 * RAD)) / RAD;
  for (let i = 0; i < n; i++) {
    lats[i] = lat0 + ((n / 2 - i) * px) / R_EARTH / RAD;
    const y = clamp(Y(lats[i]) - 0.5 - ty0 * 256, 0, mh - 1.001);
    const y0 = Math.floor(y);
    const fy = y - y0;
    for (let j = 0; j < n; j++) {
      const x = clamp(X(lons[j]) - 0.5 - tx0 * 256, 0, mw - 1.001);
      const x0 = Math.floor(x);
      const fx = x - x0;
      const a = y0 * mw + x0;
      z[i * n + j] = (1 - fy) * ((1 - fx) * mosaic[a] + fx * mosaic[a + 1]) + fy * ((1 - fx) * mosaic[a + mw] + fx * mosaic[a + mw + 1]);
    }
  }
  // the sea is not a test site: perfectly flat cells at or below sea level, and deep bathymetry
  for (let i = 1; i < n - 1; i++) {
    for (let c = i * n + 1; c < i * n + n - 1; c++) {
      const v = z[c];
      if (v < -450 || (v <= 0.5 && z[c - 1] === v && z[c + 1] === v && z[c - n] === v && z[c + n] === v)) z[c] = NaN;
    }
  }
  return { z, n, px, lats, lons, zoom };
}

// ---- small SVG line chart ---------------------------------------------------------------------------
function chart({ title, unit, series, w = 430, h = 150 }) {
  const m = { l: 44, r: 8, t: 20, b: 22 };
  let x1 = 0, y0 = Infinity, y1 = -Infinity;
  for (const s of series) {
    for (let k = 0; k < s.x.length; k++) {
      if (s.x[k] > x1) x1 = s.x[k];
      if (s.y[k] < y0) y0 = s.y[k];
      if (s.y[k] > y1) y1 = s.y[k];
    }
  }
  if (!(y1 > y0)) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06;
  y0 -= pad; y1 += pad;
  const px = (x) => m.l + (x / (x1 || 1)) * (w - m.l - m.r);
  const py = (y) => h - m.b - ((y - y0) / (y1 - y0)) * (h - m.t - m.b);
  const tick = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  const lines = series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.6}" stroke-linejoin="round" points="${
    Array.from(s.x, (x, k) => `${px(x).toFixed(1)},${py(s.y[k]).toFixed(1)}`).join(' ')}"/>`).join('');
  const zero = y0 < 0 && y1 > 0 ? `<line x1="${m.l}" x2="${w - m.r}" y1="${py(0)}" y2="${py(0)}" class="zero"/>` : '';
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">
    <text x="${m.l}" y="12" class="t">${title}</text>
    <rect x="${m.l}" y="${m.t}" width="${w - m.l - m.r}" height="${h - m.t - m.b}" class="frame"/>${zero}
    <text x="${m.l - 5}" y="${m.t + 9}" text-anchor="end">${tick(y1)}</text>
    <text x="${m.l - 5}" y="${h - m.b}" text-anchor="end">${tick(y0)}</text>
    <text x="${m.l - 5}" y="${(m.t + h - m.b) / 2 + 4}" text-anchor="end" class="u">${unit}</text>
    <text x="${m.l}" y="${h - 6}">0</text>
    <text x="${w - m.r}" y="${h - 6}" text-anchor="end">${(x1 / 1000).toFixed(x1 >= 20000 ? 0 : 1)} km along the route</text>
    ${lines}</svg>`;
}

/**
 * @param api (from main.js; globes are recreated when the bodies change, so they are getters)
 *   left(), right()   the two globes (+ .key)
 *   setBodies(l, r)   put these bodies on the left / right
 *   setStatus(text)
 */
export function createRoute(api) {
  const state = {
    on: false, points: [], preset: null, profile: null, profileRequest: 0, searchRequest: 0,
    custom: null, results: [], shown: null, presets: null, timer: 0, error: null, busy: false,
  };
  const ents = { left: [], right: [] };
  const body = () => api.left()?.key;

  // ---- panels --------------------------------------------------------------------------------
  const draw = document.createElement('aside');
  draw.className = 'route-panel route-draw';
  draw.hidden = true;
  draw.innerHTML = `<header><b>1 · Draw the route</b><span class="on"></span></header>
    <p class="hint">Zoom in and <b>click the globe</b> to add points along the path of your rover. Or load a real one.</p>
    <div class="row"><button type="button" data-act="undo">Undo point</button><button type="button" data-act="clear">Clear</button></div>
    <label><span>Go to</span><select class="goto"></select></label>
    <label><span>Real rover route</span><select class="preset"><option value="">— none —</option></select></label>
    <div class="summary"></div>`;
  document.getElementById('pane-left').append(draw);

  const find = document.createElement('aside');
  find.className = 'route-panel route-find';
  find.hidden = true;
  find.innerHTML = `<header><b>2 · Replicate it on Earth</b></header>
    <label><span>Where</span><select class="region"></select></label>
    <p class="hint">…or click anywhere on the Earth globe to search around that point.</p>
    <label title="A step counts as replicated when the Earth slope is within this margin of the target slope"><span>Slope tolerance ±</span><input type="number" class="tol" value="2" min="0.5" max="10" step="0.5"> °</label>
    <label title="The Earth path never takes a step steeper than this"><span>Rover slope limit</span><input type="number" class="limit" value="25" min="5" max="45" step="1"> °</label>
    <button type="button" class="go" disabled>Find the route on Earth</button>
    <div class="progress" hidden><i></i></div>
    <ol class="found"></ol>
    <p class="note"></p>`;
  document.getElementById('pane-right').append(find);

  const dock = document.createElement('section');
  dock.className = 'route-chart';
  dock.hidden = true;
  document.querySelector('.panes').append(dock);

  const $ = (root, sel) => root.querySelector(sel);
  const regionSel = $(find, '.region');
  const goBtn = $(find, '.go');
  const bar = $(find, '.progress');

  function paintRegions() {
    const cur = regionSel.value || 'all';
    regionSel.innerHTML = `<option value="all">All ${REGIONS.length} analog regions (ranked)</option>${
      state.custom ? `<option value="custom">Around my click (${fmt(state.custom.lat, 2)}°, ${fmt(state.custom.lon, 2)}°)</option>` : ''}${
      REGIONS.map((r) => `<option value="${r.id}">${r.name}</option>`).join('')}`;
    regionSel.value = [...regionSel.options].some((o) => o.value === cur) ? cur : 'all';
  }

  function paintBody() {
    const b = body();
    if (!DEM[b]) return;
    $(draw, '.on').textContent = `on ${DEM[b].name}`;
    $(draw, '.goto').innerHTML = `<option value="">— a place on ${DEM[b].name} —</option>${
      GOTO[b].map((g, k) => `<option value="${k}">${g.name}</option>`).join('')}`;
    const sel = $(draw, '.preset');
    sel.innerHTML = `<option value="">— none —</option>${(state.presets ?? []).map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}`;
    sel.value = state.preset?.id ?? '';
  }

  // ---- drawing on the globes -----------------------------------------------------------------
  function clearEnts(side) {
    const g = side === 'left' ? api.left() : api.right();
    for (const e of ents[side]) { try { g?.viewer.entities.remove(e); } catch { /* globe already destroyed */ } }
    ents[side] = [];
  }
  function drawPath(side, pts, color, { dots = null, labels = [] } = {}) {
    clearEnts(side);
    const g = side === 'left' ? api.left() : api.right();
    if (!g || !pts.length) return [];
    const xyz = (p, h = 30) => latLonToCartesian(p.lat, p.lon, g.body.ellipsoid, g.body.latitudeType, h);
    const c = Cesium.Color.fromCssColorString(color);
    const positions = pts.map((p) => xyz(p));
    if (positions.length > 1) {
      ents[side].push(g.viewer.entities.add({
        polyline: {
          positions, width: 4, arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineOutlineMaterialProperty({ color: c, outlineColor: Cesium.Color.BLACK.withAlpha(0.7), outlineWidth: 1.5 }),
          depthFailMaterial: c.withAlpha(0.6),
        },
      }));
    }
    for (const p of dots ?? []) {
      ents[side].push(g.viewer.entities.add({
        position: xyz(p, 40),
        point: { pixelSize: 8, color: c, outlineColor: Cesium.Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      }));
    }
    for (const { p, text } of labels) {
      ents[side].push(g.viewer.entities.add({
        position: xyz(p, 40),
        point: { pixelSize: 10, color: Cesium.Color.WHITE, outlineColor: c, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text, font: '12px system-ui, sans-serif', fillColor: Cesium.Color.WHITE, showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(16,20,31,0.85)'), pixelOffset: new Cesium.Cartesian2(0, -18),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));
    }
    return positions;
  }
  function flyOver(side, positions) {
    const g = side === 'left' ? api.left() : api.right();
    if (!g || positions.length < 2) return;
    const bs = Cesium.BoundingSphere.fromPoints(positions);
    g.viewer.camera.flyToBoundingSphere(bs, {
      duration: 2.2, offset: new Cesium.HeadingPitchRange(0, -Math.PI / 2, Math.max(bs.radius * 3.6, 1500)),
    });
  }

  // ---- step 1: the target route and its profile --------------------------------------------------
  function paintTarget() {
    const p = state.profile;
    if (p) {
      drawPath('left', p.pts, COLOR.target, { dots: state.preset ? [] : state.points, labels: [{ p: p.pts[0], text: 'start' }] });
    } else {
      drawPath('left', state.points, COLOR.target, { dots: state.points });
    }
  }

  function summary() {
    const el = $(draw, '.summary');
    const p = state.profile;
    if (state.error) {
      el.innerHTML = `<p class="err">${state.error}</p>`;
    } else if (!p) {
      const n = state.points.length;
      el.innerHTML = state.busy ? '<p class="wait">Reading the elevation along the route…</p>'
        : `<p class="wait">${n === 0 ? 'No route yet.' : n === 1 ? '1 point: add at least one more.' : ''}</p>`;
    } else {
      const limit = Number($(find, '.limit').value) || 25;
      const over = p.slopes.filter((s) => Math.abs(s) > limit).length;
      let climb = 0;
      for (let k = 1; k < p.z.length; k++) climb += Math.max(0, p.z[k] - p.z[k - 1]);
      el.innerHTML = `<dl>
        <dt>Length</dt><dd>${fmtKm(p.L * p.N)}</dd>
        <dt>Steps</dt><dd>${p.N} × ${Math.round(p.L)} m</dd>
        <dt>Climb / net</dt><dd>${Math.round(climb)} m / ${Math.round(p.z[p.N] - p.z[0])} m</dd>
        <dt>Steepest step</dt><dd>${fmt(Math.max(...p.slopes.map(Math.abs)))}°</dd></dl>
        ${over ? `<p class="warn">${over} step${over > 1 ? 's' : ''} steeper than the rover limit (${limit}°): they cannot be replicated.</p>` : ''}
        <p class="src">${p.source}</p>`;
    }
    goBtn.disabled = !state.profile || state.searching;
  }

  /** Common profile: N steps of L metres; pts (N + 1) and z (N + 1) on the target body. */
  function setProfile(pts, z, L, source) {
    const N = pts.length - 1;
    const slopes = Array.from({ length: N }, (_, k) => deg((z[k + 1] - z[k]) / L));
    state.profile = { body: body(), pts, z, L, N, slopes, source };
    state.error = null;
    state.busy = false;
    clearResults();
    paintTarget();
    summary();
    paintChart();
  }

  async function buildProfile() {
    const request = ++state.profileRequest;
    const b = body();
    const d = DEM[b];
    state.profile = null;
    state.error = null;
    clearResults();
    paintTarget();
    if (state.points.length < 2) {
      state.busy = false;
      summary();
      paintChart();
      return;
    }
    const D = pathLength(state.points, d.R);
    const L = Math.max(d.minStep, D / MAX_STEPS);
    const N = Math.floor(D / L);
    if (N < 6) {
      state.busy = false;
      state.error = `Too short: ${fmtKm(D)}. The ${d.name} relief map has ${d.minStep} m steps; draw at least ${fmtKm(6 * d.minStep)}.`;
      summary();
      paintChart();
      return;
    }
    state.busy = true;
    summary();
    try {
      const pts = resample(state.points, d.R, L, N);
      const z = await sampleDem(b, pts);
      if (request !== state.profileRequest) return;
      setProfile(pts, z, L, `Elevation: ${d.credit}`);
    } catch (err) {
      console.error(err);
      if (request !== state.profileRequest) return;
      state.busy = false;
      state.error = `Could not read the elevation: ${err.message}`;
      summary();
    }
  }

  function scheduleProfile() {
    clearTimeout(state.timer);
    state.busy = state.points.length > 1;
    state.error = null;
    state.profile = null;
    paintTarget();
    summary();
    state.timer = setTimeout(buildProfile, 700);
  }

  async function loadPreset(id) {
    state.presets ??= (await (await fetch('./data/route/presets.json')).json()).presets;
    const p = state.presets.find((x) => x.id === id);
    state.profileRequest++;
    clearTimeout(state.timer);
    state.points = [];
    state.preset = p ?? null;
    if (!p) {
      state.profile = null;
      clearResults();
      paintTarget();
      summary();
      paintChart();
      return;
    }
    if (body() !== p.body) api.setBodies(p.body, 'earth'); // (bodiesChanged() keeps state.preset)
    const D = (p.z.length - 1) * p.ds;
    const stride = Math.max(3, Math.ceil(D / MAX_STEPS / p.ds));
    const idx = [];
    for (let k = 0; k < p.z.length; k += stride) idx.push(k);
    setProfile(idx.map((k) => ({ lat: p.lat[k], lon: p.lon[k] })), idx.map((k) => p.z[k]), stride * p.ds,
      'Elevation: rover telemetry (NASA/JPL-Caltech)');
    $(draw, '.preset').value = p.id;
    flyOver('left', state.profile.pts.map((q) => latLonToCartesian(q.lat, q.lon, api.left().body.ellipsoid, api.left().body.latitudeType)));
  }

  // ---- step 2: search on Earth ---------------------------------------------------------------
  function clearResults() {
    state.searchRequest++;
    state.searching = false;
    state.results = [];
    state.shown = null;
    bar.hidden = true;
    $(find, '.found').innerHTML = '';
    $(find, '.note').textContent = '';
    clearEnts('right');
  }

  async function searchRegion(region, p, tol, limit, onProgress) {
    const px = p.L / 3;
    const grid = await earthGrid(region.lat, region.lon, px);
    const targets = new Float32Array(p.N);
    for (let k = 0; k < p.N; k++) targets[k] = (p.z[k + 1] - p.z[k]) / p.L;
    const sol = await solveRoute({ z: grid.z, W: grid.n, H: grid.n, px, targets, maxTan: Math.tan(limit * RAD), onProgress });
    if (!sol) return null;
    const pts = [];
    const ze = [];
    const lens = [];
    for (let k = 0; k <= p.N; k++) {
      pts.push({ lat: grid.lats[sol.rows[k]], lon: grid.lons[sol.cols[k]] });
      ze.push(grid.z[sol.rows[k] * grid.n + sol.cols[k]]);
      if (k) lens.push(Math.hypot(sol.rows[k] - sol.rows[k - 1], sol.cols[k] - sol.cols[k - 1]) * px);
    }
    return { region, pts, ze, lens, zoom: grid.zoom, stats: compareProfiles(p.z, p.L, ze, lens, tol) };
  }

  async function search() {
    const p = state.profile;
    if (!p || state.searching) return;
    clearResults();
    const request = state.searchRequest;
    const tol = clamp(Number($(find, '.tol').value) || 2, 0.1, 20);
    const limit = clamp(Number($(find, '.limit').value) || 25, 1, 60);
    const which = regionSel.value;
    const list = which === 'all' ? REGIONS
      : which === 'custom' ? [{ id: 'custom', name: `Around ${fmt(state.custom.lat, 2)}°, ${fmt(state.custom.lon, 2)}°`, ...state.custom }]
        : REGIONS.filter((r) => r.id === which);
    state.searching = true;
    goBtn.disabled = true;
    bar.hidden = false;
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      const region = list[i];
      const setBar = (f) => { bar.firstElementChild.style.width = `${(100 * (i + f)) / list.length}%`; };
      api.setStatus(`Searching ${region.name} (${i + 1} of ${list.length})…`);
      setBar(0);
      try {
        const res = await searchRegion(region, p, tol, limit, (f) => setBar(0.15 + 0.85 * f));
        if (request !== state.searchRequest) return;
        if (res) {
          state.results.push(res);
          state.results.sort((a, b) => a.stats.meanErr - b.stats.meanErr);
          paintResults(tol);
          if (state.results[0] === res) show(res, { fly: list.length === 1 });
        } else {
          failed.push(`${region.name}: no drivable path`);
        }
      } catch (err) {
        console.error(err);
        if (request !== state.searchRequest) return;
        failed.push(`${region.name}: ${err.message}`);
      }
    }
    state.searching = false;
    bar.hidden = true;
    api.setStatus('');
    goBtn.disabled = false;
    const best = state.results[0];
    $(find, '.note').innerHTML = `${failed.length ? `<span class="err">${failed.join(' · ')}</span><br>` : ''}${
      best ? `Search window: ${fmtKm(GRID * p.L / 3)} around each place. Compared at ${Math.round(p.L)} m steps: relief only, not rocks or sand. Earth elevation: ${TERRAIN_CREDIT}` : 'No path found.'}`;
    if (best) show(best, { fly: true });
  }

  function paintResults(tol) {
    $(find, '.found').innerHTML = state.results.map((r, k) => `<li><button type="button" data-k="${k}" class="${r === state.shown ? 'on' : ''}">
      <b>${r.region.name}</b>
      <span>${Math.round(100 * r.stats.within)} % of steps within ±${tol}° · mean error ${fmt(r.stats.meanErr, 2)}° · r = ${fmt(r.stats.r, 2)}</span>
    </button></li>`).join('');
  }

  function show(res, { fly = true } = {}) {
    state.shown = res;
    const pos = drawPath('right', res.pts, COLOR.earth, { labels: [{ p: res.pts[0], text: `start · ${res.region.name}` }] });
    if (fly) flyOver('right', pos);
    $(find, '.found').querySelectorAll('button').forEach((b) => b.classList.toggle('on', state.results[Number(b.dataset.k)] === res));
    paintChart();
  }

  // ---- charts (bottom, across both globes) -------------------------------------------------------
  function paintChart() {
    const p = state.profile;
    dock.hidden = !state.on || !p;
    if (dock.hidden) return;
    const name = DEM[p.body].name;
    const xm = Array.from({ length: p.N + 1 }, (_, k) => k * p.L);
    const xs = xm.slice(1).map((x) => x - p.L / 2);
    const elev = [{ x: xm, y: p.z.map((v) => v - p.z[0]), color: COLOR.target, width: 2 }];
    const slope = [{ x: xs, y: p.slopes, color: COLOR.target, width: 2 }];
    const r = state.shown;
    let head = `<span class="key"><i style="background:${COLOR.target}"></i>${name} (target)</span>`;
    if (r) {
      // Earth plotted against the same step index, so both curves line up step by step
      elev.push({ x: xm, y: r.ze.map((v) => v - r.ze[0]), color: COLOR.earth });
      slope.push({ x: xs, y: Array.from(r.stats.slopeEarth), color: COLOR.earth });
      const earthLen = r.lens.reduce((a, b) => a + b, 0);
      head += `<span class="key"><i style="background:${COLOR.earth}"></i>Earth · ${r.region.name}</span>
        <span class="stat">mean slope error <b>${fmt(r.stats.meanErr, 2)}°</b> (flat ground would give ${fmt(r.stats.flatErr, 2)}°)</span>
        <span class="stat">correlation <b>${fmt(r.stats.r, 2)}</b></span>
        <span class="stat">worst step <b>${fmt(r.stats.maxErr, 1)}°</b></span>
        <span class="stat">Earth path ${fmtKm(earthLen)} vs ${fmtKm(p.L * p.N)}</span>`;
    }
    dock.innerHTML = `<header>${head}</header><div class="plots">${
      chart({ title: 'Elevation from the start', unit: 'm', series: elev })}${
      chart({ title: 'Slope of each step', unit: '°', series: slope })}</div>`;
  }

  // ---- events --------------------------------------------------------------------------------
  draw.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (state.preset) {
      state.preset = null;
      $(draw, '.preset').value = '';
      state.points = [];
    } else if (act === 'undo') {
      state.points.pop();
    } else {
      state.points = [];
    }
    scheduleProfile();
  });
  $(draw, '.goto').addEventListener('change', (e) => {
    const g = GOTO[body()]?.[Number(e.target.value)];
    if (e.target.value !== '' && g) api.left().flyTo(g.lat, g.lon, g.h, 2.2);
    e.target.value = '';
  });
  $(draw, '.preset').addEventListener('change', (e) => loadPreset(e.target.value).catch((err) => {
    console.error(err);
    state.error = `Could not load the rover route: ${err.message}`;
    summary();
  }));
  $(find, '.limit').addEventListener('change', summary);
  goBtn.addEventListener('click', search);
  $(find, '.found').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-k]');
    if (b) show(state.results[Number(b.dataset.k)]);
  });

  function open() {
    state.on = true;
    draw.hidden = false;
    find.hidden = false;
    paintRegions();
    paintBody();
    paintTarget();
    summary();
    paintChart();
    if (state.shown) show(state.shown, { fly: false });
    if (!state.presets) {
      fetch('./data/route/presets.json').then((r) => r.json()).then((d) => {
        state.presets = d.presets;
        paintBody();
      }).catch((err) => console.error(err));
    }
  }
  function close() {
    state.on = false;
    state.searchRequest++;
    state.searching = false;
    draw.hidden = true;
    find.hidden = true;
    dock.hidden = true;
    bar.hidden = true;
    clearEnts('left');
    clearEnts('right');
    api.setStatus('');
  }

  return {
    get active() {
      return state.on;
    },
    open,
    close,
    /** Click on the left globe (Mars / the Moon): one more point of the route. */
    pickLeft({ lat, lon }) {
      api.left().clearMarker();
      if (state.preset) {
        state.preset = null;
        $(draw, '.preset').value = '';
        state.points = [];
      }
      state.points.push({ lat, lon });
      scheduleProfile();
    },
    /** Click on Earth: search around that point. */
    pickRight({ lat, lon }) {
      state.custom = { lat, lon };
      paintRegions();
      regionSel.value = 'custom';
    },
    /** Esc: start again, as in the other views — no route, no profile, no results (the region choice stays). */
    reset() {
      if (!state.on) return;
      state.profileRequest++;
      clearTimeout(state.timer);
      state.points = [];
      state.preset = null;
      state.profile = null;
      state.error = null;
      state.busy = false;
      $(draw, '.preset').value = '';
      clearResults();
      paintTarget();
      summary();
      paintChart();
    },
    /** main.js recreated a globe (the left body changed): the drawn route belonged to the old one. */
    bodiesChanged() {
      ents.left = [];
      ents.right = [];
      if (!state.on) return;
      const keep = state.preset && state.preset.body === body() ? state.preset : null;
      state.profileRequest++;
      clearTimeout(state.timer);
      state.points = [];
      state.preset = keep;
      state.profile = null;
      state.error = null;
      state.busy = false;
      clearResults();
      paintBody();
      summary();
      paintChart();
    },
    get state() {
      return state;
    },
  };
}
