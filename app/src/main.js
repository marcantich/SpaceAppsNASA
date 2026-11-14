// Target body (Mars or Moon) on the left, Earth on the right.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createGlobe } from './globe.js';
import { loadSites } from './data.js';
import { CardGrid } from './grid.js';
import { createCardPanel, createMatchPanel, SHORT } from './card.js';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import { latLonToCartesian } from './coords.js';
import { EarthMatcher, RAMP_CSS, rampColor } from './match.js';
import { ZONES, makeZone, zoneText } from './zones.js';
import { createPlaceSearch, createZoneMenu } from './places.js';

const reliefBox = document.getElementById('relief');
const reliefLabel = reliefBox.closest('label');
const targetLabel = document.getElementById('target-label');
const buttons = document.querySelectorAll('.switch button');

const earth = createGlobe('earth', 'earth');
let target = null;
let sites = { targets: [], analogs: [] };

// --- 4.9 Click any point of the target body → card of its H3 cell ---
// Planet-wide card grids available in app/data/ (Mars: H3 res 5, ~9 km; Moon: H3 res 4, ~12 km)
const GRIDS = { mars: new CardGrid('marte'), moon: new CardGrid('luna') };
const cardEl = document.getElementById('card');
const card = createCardPanel(cardEl, { onClose: clearAll });
let cardRequest = 0; // ignore answers to older clicks

async function showCardAt(lat, lon, title) {
  const request = ++cardRequest;
  const grid = GRIDS[target.key];
  if (!grid) {
    target.clearCell();
    card.message(title, `No card grid for the ${target.body.name} yet (ROADMAP 3.7 + 3.16).`);
    return;
  }
  card.loading(title, lat, lon);
  try {
    const c = await grid.cardAt(lat, lon);
    if (request !== cardRequest) return;
    if (!c) {
      card.message(title, 'No data for this cell.');
      return;
    }
    target.showCell(c.h3);
    card.show(title, lat, lon, c, { footer: 'Hover a value to see its source. The best Earth analogs are on the right.' });
    frameCell(target, c.h3, [cardEl]);
    lastTarget = { values: c.values, h3: c.h3, lat, lon, body: target.body.name, key: target.key };
    runMatch();
  } catch (err) {
    console.error(err);
    if (request === cardRequest) card.message(title, `Could not load the card: ${err.message}`);
  }
}

// --- Earth: card grid (H3 res 6, ~6.5 km) + search over every analog cell -------------------------
const EARTH_GRID = new CardGrid('tierra');
const matcher = new EarthMatcher();
const pruebaSel = document.getElementById('prueba');
const status = document.getElementById('earth-status');
const resultsEl = document.getElementById('earth-results');
const earthCardEl = document.getElementById('earth-card');
resultsEl.style.setProperty('--ramp', RAMP_CSS);
let lastTarget = null; // card of the selected Mars / Moon cell
let lastRank = null;   // EarthMatcher.rank() result for it
let matchRequest = 0;
let earthRequest = 0;
let zone = null;       // Earth search zone ({ key, label, south, north, west, east }) or null = whole Earth

const results = createMatchPanel(resultsEl, {
  onPick: (b) => b && showEarthCell(b, { rank: lastRank.best.indexOf(b) }),
  onClose: clearMatch,
});
const earthCard = createCardPanel(earthCardEl, {
  onClose: () => {
    earthCard.hide();
    earth.clearCell();
    earth.clearSelection();
  },
});

function setStatus(text) {
  status.hidden = !text;
  status.textContent = text ?? '';
}

/** Score colour: the shown range (threshold → best) stretched over the whole ramp. */
function colorOf(score) {
  if (!lastRank) return rampColor(score / 100);
  const lo = lastRank.threshold;
  const hi = Math.max(lo + 1, lastRank.best[0]?.score ?? 100);
  return rampColor((score - lo) / (hi - lo));
}

async function runMatch() {
  if (!lastTarget) return;
  const request = ++matchRequest;
  const where = zone ? `inside ${zone.label}` : 'over the whole Earth';
  results.loading(`Scoring every Earth search cell ${where}…`);
  setStatus(!matcher.meta ? 'Loading the Earth search grid (3.5 MB)…'
    : zone && !matcher.lat ? 'Locating the Earth search cells (first zone search only)…' : 'Scoring Earth…');
  try {
    await matcher.load();
    fillTests();
    if (request !== matchRequest) return;
    await new Promise((r) => setTimeout(r, 30)); // let the panel paint before the heavy loop
    const res = matcher.rank(lastTarget.values, lastTarget.key, pruebaSel.value, { zone });
    if (request !== matchRequest) return;
    lastRank = res;
    if (!res.best.length) {
      earth.clearHexes();
      earth.clearRanks();
      earthCard.hide();
      results.loading(zone && !res.n
        ? `No analog search cell inside ${zone.label}: only deserts, polar ice and arid open land are searched. Pick another zone or draw a bigger area.`
        : 'No Earth cell shares a variable with this cell.');
      setStatus('');
      return;
    }
    earth.showHexes(res.top.map((i) => ({ h3: matcher.h3(i), color: colorOf(res.score[i]) })));
    earth.setRanks(res.best.map((b, k) => ({
      lat: b.lat, lon: b.lon, text: `#${k + 1} · ${b.score.toFixed(0)}`, color: colorOf(b.score), payload: b,
    })));
    const prueba = matcher.meta.pruebas[pruebaSel.value];
    results.show(res, {
      body: lastTarget.body,
      colorOf,
      testNote: res.plan.note,
      validity: prueba?.test_validity,
      zoneLabel: zone?.label,
    });
    setStatus('');
    // first result: card only; the camera shows the whole picture (the zone, or the region of #1)
    showEarthCell(res.best[0], { rank: 0, move: zone ? 'none' : 'overview' });
    if (zone) earth.flyToZone(zone);
  } catch (err) {
    console.error(err);
    if (request === matchRequest) {
      results.loading(`Could not search Earth: ${err.message}`);
      setStatus('');
    }
  }
}

function fillTests() {
  if (pruebaSel.options.length > 1) return;
  for (const [key, p] of Object.entries(matcher.meta.pruebas)) {
    pruebaSel.add(new Option(p.label, key));
  }
}

/**
 * Card of an Earth cell, with the comparison against the selected target cell (if any).
 * move: 'frame' (fly down onto the hexagon, like on Mars / the Moon), 'overview' (regional view), 'none'.
 */
async function showEarthCell({ lat, lon }, { rank = -1, title = null, move = 'frame' } = {}) {
  const request = ++earthRequest;
  title ??= rank >= 0 ? `Earth · analog #${rank + 1}` : 'Earth · selected point';
  earthCard.loading(title, lat, lon);
  try {
    const c = await EARTH_GRID.cardAt(lat, lon);
    if (request !== earthRequest) return;
    if (!c) return earthCard.message(title, 'No data for this cell.');
    earth.showCell(c.h3);
    let compare = null;
    if (lastRank && lastTarget) {
      const plan = lastRank.plan;
      const tol = matcher.meta.variables;
      let num = 0;
      let den = 0;
      const rows = Object.entries(plan.weights).map(([name, w]) => {
        const t = plan.target[name];
        const e = c.values[name];
        const note = Number.isFinite(e) ? Math.max(0, 1 - Math.abs(t - e) / tol[name].tolerance) : NaN;
        if (Number.isFinite(note)) {
          num += w * note;
          den += w;
        }
        const unit = matcher.cols[name]?.unit ?? tol[name].unit;
        return { name, label: tol[name].label, short: SHORT[name] ?? name, unit, target: t, earth: e, note };
      });
      const index = den ? (100 * num) / den : NaN;
      compare = { rows, index, body: lastTarget.body, color: Number.isFinite(index) ? colorOf(index) : '#555' };
    }
    earthCard.show(title, lat, lon, c, {
      compare,
      footer: c.values.in_mask === 1 ? 'Inside the analog search zone. Hover a value to see its source.'
        : 'Outside the search zone (vegetation, water or cities): not ranked, shown for reference.',
    });
    if (move === 'frame') frameCell(earth, c.h3, [resultsEl, earthCardEl]);
    else if (move === 'overview') earth.flyTo(lat, lon, 2.2e6, 1.6);
  } catch (err) {
    console.error(err);
    if (request === earthRequest) earthCard.message(title, `Could not load the Earth card: ${err.message}`);
  }
}

function clearMatch() {
  matchRequest++;
  lastRank = null;
  results.hide();
  earthCard.hide();
  earth.clearHexes();
  earth.clearRanks();
  earth.clearCell();
  setStatus('');
}

// --- Earth search zone: a region from the menu or a box the user drags on the Earth globe --------
let customZone = null; // last box drawn by the user

function setZone(z) {
  zone = z;
  zoneMenu.set(z?.key ?? null, z?.label);
  if (z) {
    earth.showZone(z);
    if (!lastTarget) earth.flyToZone(z);
  } else {
    earth.clearZone();
  }
  runMatch();
}

function zoneByKey(key) {
  if (!key) return null;
  if (key === 'custom') return customZone;
  const z = ZONES.find((x) => x.key === key);
  return z ? makeZone(z) : null;
}

async function drawZone() {
  zoneMenu.drawing(true);
  setStatus('Drag a box on Earth: the search will only look inside it · Esc cancels');
  const box = await earth.drawBox();
  zoneMenu.drawing(false);
  setStatus('');
  if (!box) {
    zoneMenu.set(zone?.key ?? null, zone?.label); // cancelled: keep the previous zone
    if (zone) earth.showZone(zone);
    return;
  }
  const z = makeZone(box);
  customZone = { ...z, key: 'custom', label: `Area ${zoneText(z)}` };
  zoneMenu.setCustom(customZone);
  setZone(customZone);
}

const zoneMenu = createZoneMenu(document.getElementById('zone'), {
  onSelect: (key) => setZone(zoneByKey(key)),
  onDraw: drawZone,
});

// --- Place search: sites, known analogs, zones or typed coordinates -----------------------------
const BODY_LABEL = { mars: 'Mars', moon: 'Moon' };

function placeEntries() {
  return [
    ...sites.targets.map((s) => ({
      kind: 'site', body: s.body, label: s.name, sub: `${BODY_LABEL[s.body]} · ${s.type ?? 'site'}`,
      words: `${s.id ?? ''} ${(s.features ?? []).join?.(' ') ?? ''}`, data: s,
    })),
    ...sites.analogs.map((a) => ({
      kind: 'analog', body: 'earth', label: a.name,
      sub: `${a.country} · analog of ${String(a.analog_of ?? '').replace(';', ' & ')}`,
      words: `${a.environment ?? ''}`, data: a,
    })),
    ...ZONES.map((z) => ({
      kind: 'zone', body: 'earth', label: z.label, sub: 'Earth · search only in this zone', words: z.words, data: z,
    })),
  ];
}

async function goToPlace({ kind, body, data }) {
  if (kind === 'zone') return setZone(makeZone(data));
  if (kind === 'analog' || (kind === 'coords' && body === 'earth')) {
    if (kind === 'analog') earth.selectSite(`analog:${data.name}`, { fly: false });
    else earth.setMarker(data.lat, data.lon);
    return showEarthCell(data, { title: kind === 'analog' ? data.name : 'Earth · searched point' });
  }
  // Mars / Moon: switch the left globe if needed, then open the cell card (it starts the search)
  showTarget(body);
  if (kind === 'site') {
    target.selectSite(`target:${data.id ?? data.name}`, { fly: false });
    return showCardAt(data.lat, data.lon, data.name);
  }
  target.setMarker(data.lat, data.lon);
  return showCardAt(data.lat, data.lon, `${target.body.name} · searched point`);
}

const placeSearch = createPlaceSearch(document.getElementById('place-search'), document.getElementById('place-results'), {
  entries: placeEntries,
  onChoose: goToPlace,
  currentBody: () => target?.key ?? 'mars',
});

earth.onPick(({ lat, lon }) => showEarthCell({ lat, lon }));
earth.onSiteSelect((site) => showEarthCell(site, { title: site.name }));
earth.onRankSelect((b) => showEarthCell(b, { rank: lastRank?.best.indexOf(b) ?? -1 }));
pruebaSel.addEventListener('change', runMatch);
matcher.load().then(fillTests).catch(() => {}); // fill the test list early (the table is cached)

// --- Camera: fly straight down onto an H3 cell, framed in the part of the globe the panels leave free
const CELL_FILL = 0.55; // the hexagon spans ~55 % of the free part of the globe

/** Free rectangle of the canvas (CSS px, relative to it) once the visible panels are taken out. */
function freeArea(canvas, panels) {
  const narrow = window.matchMedia('(max-width: 760px)').matches; // panels stacked above / below
  let x0 = 0;
  let x1 = canvas.width;
  let y0 = 0;
  let y1 = canvas.height;
  for (const el of panels) {
    if (!el || el.hidden) continue;
    const r = el.getBoundingClientRect();
    const left = r.left - canvas.left;
    const top = r.top - canvas.top;
    if (narrow) {
      if (top < canvas.height - (top + r.height)) y0 = Math.max(y0, top + r.height);
      else y1 = Math.min(y1, top);
    } else if (left < canvas.width - (left + r.width)) {
      x0 = Math.max(x0, left + r.width);
    } else {
      x1 = Math.min(x1, left);
    }
  }
  // never less than 80 px: if the panels cover everything, use the whole canvas
  if (x1 - x0 < 80) [x0, x1] = [0, canvas.width];
  if (y1 - y0 < 80) [y0, y1] = [0, canvas.height];
  return { w: x1 - x0, h: y1 - y0, x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/**
 * Fly the camera straight down onto an H3 cell of `globe`, zoomed so the hexagon is well framed in
 * the part of the globe the panels leave free (between them on wide screens, above/below on phones).
 */
function frameCell(globe, h3, panels) {
  const { viewer } = globe;
  const ell = globe.body.ellipsoid;
  const latType = globe.body.latitudeType; // H3 lat/lon use the body's convention (planetocentric on Mars)
  const toXYZ = (la, lo, h = 0) => latLonToCartesian(la, lo, ell, latType, h);
  const [lat, lon] = cellToLatLng(h3);
  // Hexagon size on the ground: largest centre-to-vertex distance, ×2
  const centre = toXYZ(lat, lon);
  const radius = Math.max(...cellToBoundary(h3).map(([la, lo]) => Cesium.Cartesian3.distance(centre, toXYZ(la, lo))));
  const diameter = 2 * radius;

  const rect = viewer.canvas.getBoundingClientRect();
  const canvas = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const free = freeArea(canvas, panels);

  // Camera height so that `diameter` metres cover CELL_FILL of the smaller free dimension
  const mPerPx = diameter / (CELL_FILL * Math.min(free.w, free.h));
  const height = (mPerPx * canvas.height) / (2 * Math.tan(viewer.camera.frustum.fovy / 2));

  // Shift the camera so the cell lands in the middle of the free part, not under a panel
  const dx = (canvas.width / 2 - free.x) * mPerPx;   // metres east
  const dy = (free.y - canvas.height / 2) * mPerPx;  // metres north
  const R = ell.maximumRadius;
  const camLon = lon + Cesium.Math.toDegrees(dx / (R * Math.max(0.05, Math.cos(Cesium.Math.toRadians(lat)))));
  const camLat = Math.max(-89.9, Math.min(89.9, lat + Cesium.Math.toDegrees(dy / R)));
  viewer.camera.flyTo({
    // same latitude convention as the cell, raised along the surface normal → looking straight down
    destination: toXYZ(camLat, camLon, height),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.6,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
  });
}

function clearAll() {
  cardRequest++;
  card.hide();
  lastTarget = null;
  clearMatch();
  earth.clearSelection();
  target.clearSelection();
}

function applyRelief() {
  earth.setRelief(reliefBox.checked);
  target.setRelief(reliefBox.checked);
  reliefLabel.classList.toggle('disabled', !target.hasRelief);
  reliefLabel.title = target.hasRelief ? '' : `No relief layer for the ${target.body.name} yet`;
}

function showTargetSites() {
  target.setSites(sites.targets.filter((s) => s.body === target.key), 'target');
}

function showTarget(bodyKey) {
  if (!target || target.key !== bodyKey) {
    target?.destroy();
    target = { ...createGlobe('target', bodyKey), key: bodyKey };
    showTargetSites();
    clearAll();
    target.onPick(({ lat, lon }) => showCardAt(lat, lon, `${target.body.name} · selected point`));
    target.onSiteSelect((site) => showCardAt(site.lat, site.lon, site.name));
  }
  targetLabel.textContent = target.body.name;
  buttons.forEach((b) => b.classList.toggle('active', b.dataset.body === bodyKey));
  applyRelief();
}

buttons.forEach((b) => b.addEventListener('click', () => showTarget(b.dataset.body)));
reliefBox.addEventListener('change', applyRelief);

// Esc clears every selection: coordinate markers, highlighted sites, cell outline and card
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') clearAll();
});

showTarget('mars');

loadSites()
  .then((data) => {
    sites = data;
    showTargetSites();
    earth.setSites(
      data.analogs.map((a) => ({ ...a, id: a.name, subtitle: a.country })),
      'analog',
    );
    placeSearch.rebuild();
  })
  .catch((err) => console.error(err));

// For debugging from the browser console
window.Cesium = Cesium;
window.CardGrid = CardGrid;
window.showCardAt = (lat, lon, title = 'debug') => showCardAt(lat, lon, title);
window.goToPlace = goToPlace;
window.globes = {
  earth,
  get target() {
    return target;
  },
};
