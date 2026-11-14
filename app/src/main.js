// Target body (Mars or Moon) on the left, Earth on the right.
//
// Flow of a click on the target body ("think first, then animate"):
//   1. load the cell card and show it;
//   2. score every Earth search cell, name the countries of the best ones, build the hexagon layer
//      (waits until Cesium has it ready) and load the card of Earth analog #1;
//   3. only then fly BOTH cameras at the same time, so nothing heavy runs during the flights.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createGlobe } from './globe.js';
import { loadSites } from './data.js';
import { CardGrid } from './grid.js';
import { createCardPanel, createCompareStrip, createMatchPanel } from './card.js';
import { cellToBoundary, cellToLatLng } from 'h3-js';
import { latLonToCartesian } from './coords.js';
import { EarthMatcher, RAMP_CSS, rampColor } from './match.js';
import { areaIndex, scoreCell } from './scoring.js';
import { ZONES, makeZone, zoneText } from './zones.js';
import { createPlaceSearch, createZoneMenu } from './places.js';
import { countryAt, preloadCountries } from './countries.js';

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

async function showCardAt(lat, lon, title, subtitle = null) {
  const request = ++cardRequest;
  const grid = GRIDS[target.key];
  if (!grid) {
    target.clearCell();
    card.message(title, `No card grid for the ${target.body.name} yet (ROADMAP 3.7 + 3.16).`);
    return;
  }
  card.loading(title, lat, lon, subtitle);
  try {
    const c = await grid.cardAt(lat, lon);
    if (request !== cardRequest) return;
    if (!c) {
      card.message(title, 'No data for this cell.');
      return;
    }
    target.showCell(c.h3);
    card.show(title, lat, lon, c, {
      subtitle,
      footer: 'Hover a value to see its source. The best Earth analogs are on the right.',
    });
    lastTarget = { values: c.values, h3: c.h3, lat, lon, body: target.body.name, key: target.key };
    // think first (Earth search, hexagons, analog #1), then animate both globes together
    const flyEarth = await runMatch({ fly: false });
    if (request !== cardRequest) return;
    const view = frameView(target, c.h3, [cardEl]);
    hexPx = view.px; // Earth frames its hexagon at the same size on screen
    flyView(target, view);
    flyEarth?.();
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
const earthPane = document.getElementById('earth').closest('.pane');
const resultsEl = document.getElementById('earth-results');
const earthCardEl = document.getElementById('earth-card');
const stripEl = document.getElementById('earth-compare');
resultsEl.style.setProperty('--ramp', RAMP_CSS);
let lastTarget = null; // card of the selected Mars / Moon cell
let lastRank = null;   // EarthMatcher.rank() result for it
let matchRequest = 0;
let earthRequest = 0;
let zone = null;       // Earth search zone ({ key, label, south, north, west, east }) or null = whole Earth
let hexPx = null;      // on-screen size of the last framed target hexagon (px)

const results = createMatchPanel(resultsEl, {
  onPick: (b) => b && showEarthCell(b, { rank: lastRank.best.indexOf(b) }),
  onClose: clearMatch,
});
const earthCard = createCardPanel(earthCardEl, {
  onClose: () => {
    earthCard.hide();
    strip.hide();
    layoutEarth();
    earth.clearCell();
    earth.clearSelection();
  },
});
const strip = createCompareStrip(stripEl, {
  onClose: () => {
    strip.hide();
    layoutEarth();
  },
});

/** Panels of the Earth pane start below the comparison strip when it is shown. */
function layoutEarth() {
  const top = stripEl.hidden ? null : `${stripEl.offsetTop + stripEl.offsetHeight + 8}px`;
  if (top) earthPane.style.setProperty('--panel-top', top);
  else earthPane.style.removeProperty('--panel-top');
}

function setStatus(text) {
  status.hidden = !text;
  status.textContent = text ?? '';
}

/** Score colour: the shown range (threshold → best) stretched over the whole ramp. */
function colorOf(score) {
  if (!Number.isFinite(score)) return '#555';
  if (!lastRank) return rampColor(score / 100);
  const lo = lastRank.threshold;
  const hi = Math.max(lo + 1, lastRank.best[0]?.score ?? 100);
  return rampColor((score - lo) / (hi - lo));
}

/**
 * Score Earth for the selected target cell and prepare everything (list, countries, hexagons, card of
 * #1). Returns a function that starts the Earth camera flight; with fly = true it is called at once.
 */
async function runMatch({ fly = true } = {}) {
  if (!lastTarget) return null;
  const request = ++matchRequest;
  const where = zone ? `inside ${zone.label}` : 'over the whole Earth';
  results.loading(`Scoring every Earth search cell ${where}…`);
  setStatus(!matcher.meta ? 'Loading the Earth search grid (3.5 MB)…'
    : zone && !matcher.lat ? 'Locating the Earth search cells (first zone search only)…' : 'Finding the best Earth analogs…');
  try {
    await matcher.load();
    fillTests();
    if (request !== matchRequest) return null;
    await new Promise((r) => setTimeout(r, 30)); // let the panels paint before the heavy loop
    const res = matcher.rank(lastTarget.values, lastTarget.key, pruebaSel.value, { zone });
    if (request !== matchRequest) return null;
    lastRank = res;
    if (!res.best.length) {
      earth.clearHexes();
      earth.clearRanks();
      earthCard.hide();
      strip.hide();
      layoutEarth();
      results.loading(zone && !res.n
        ? `No analog search cell inside ${zone.label}: only deserts, polar ice and arid open land are searched. Pick another zone or draw a bigger area.`
        : 'No Earth cell shares a variable with this cell.');
      setStatus('');
      return null;
    }
    const names = await Promise.all(res.best.map((b) => countryAt(b.lat, b.lon).catch(() => null)));
    res.best.forEach((b, k) => { b.country = names[k]; });
    if (request !== matchRequest) return null;
    const prueba = matcher.meta.pruebas[pruebaSel.value];
    results.show(res, {
      body: lastTarget.body,
      colorOf,
      testNote: res.plan.note,
      validity: prueba?.test_validity,
      zoneLabel: zone?.label,
    });
    await earth.showHexes(res.top.map((i) => ({ h3: matcher.h3(i), color: colorOf(res.score[i]) })));
    if (request !== matchRequest) return null;
    earth.setRanks(res.best.map((b, k) => ({
      lat: b.lat, lon: b.lon, text: `#${k + 1} · ${b.score.toFixed(0)}`, color: colorOf(b.score), payload: b,
    })));
    const h3 = await showEarthCell(res.best[0], { rank: 0, move: 'none' });
    setStatus('');
    if (request !== matchRequest) return null;
    const go = () => {
      if (zone) earth.flyToZone(zone, 2);
      else if (h3) flyView(earth, frameView(earth, h3, earthPanels(), hexPx));
    };
    if (fly) go();
    return go;
  } catch (err) {
    console.error(err);
    if (request === matchRequest) {
      results.loading(`Could not search Earth: ${err.message}`);
      setStatus('');
    }
    return null;
  }
}

function fillTests() {
  if (pruebaSel.options.length > 1) return;
  for (const [key, p] of Object.entries(matcher.meta.pruebas)) {
    pruebaSel.add(new Option(p.label, key));
  }
}

// Short names for the comparison strip
const STRIP_SHORT = {
  slope_deg: 'Slope', roughness_deg: 'Rough.', t_mean_K: 'Mean T', t_max_K: 'Max T', t_min_K: 'Min T',
  t_night_K: 'Night T', precip_mm_year: 'Rain', ice_depth_m: 'Ice', dust_aod: 'Dust', sun_elev_max_deg: 'Sun',
};
const ENV = ['outside the search zone', 'polar ice', 'desert', 'arid open land'];

/** Comparison of an Earth cell with the selected target cell (same formula as the ranking). */
function compareWith(c) {
  const plan = lastRank.plan;
  const meta = matcher.meta;
  const sc = scoreCell(meta, plan, (name) => c.values[name]);
  const ring = matcher.neighbourMean(c.h3, lastRank.score);
  const index = areaIndex(meta, sc.index, ring);
  const dims = Object.entries(plan.dims).map(([d, { label, vars }]) => ({
    label,
    score: sc.dims[d],
    rows: Object.keys(vars).map((name) => ({
      name,
      label: meta.variables[name].label,
      short: STRIP_SHORT[name] ?? name,
      unit: matcher.cols[name]?.unit ?? meta.variables[name].unit,
      target: plan.target[name],
      earth: c.values[name],
      note: sc.notes[name],
    })),
  }));
  return { index, cell: sc.index, ring, dims, body: lastTarget.body, color: colorOf(index), colorOf };
}

/**
 * Card of an Earth cell (+ the comparison strip when a target cell is selected). Everything is
 * computed before the camera moves. move: 'frame' (fly down onto the hexagon, same on-screen size as
 * on the target body) or 'none'. Returns the cell's H3 id.
 */
async function showEarthCell({ lat, lon }, { rank = -1, title = null, move = 'frame' } = {}) {
  const request = ++earthRequest;
  const fallback = rank >= 0 ? `Analog #${rank + 1}` : 'Earth · selected point';
  earthCard.loading(title ?? fallback, lat, lon);
  try {
    const [c, country] = await Promise.all([EARTH_GRID.cardAt(lat, lon), countryAt(lat, lon).catch(() => null)]);
    if (request !== earthRequest) return null;
    if (!c) {
      earthCard.message(title ?? fallback, 'No data for this cell.');
      return null;
    }
    const where = country ?? 'at sea';
    const heading = title ?? (rank >= 0 ? `Analog #${rank + 1} · ${where}` : country ?? 'Earth · selected point');
    const env = ENV[c.values.env] ?? '';
    earth.showCell(c.h3);
    if (lastRank && lastTarget) strip.show({ ...compareWith(c), place: country ?? 'This Earth cell' });
    else strip.hide();
    layoutEarth();
    earthCard.show(heading, lat, lon, c, {
      subtitle: [title ? country : null, env].filter(Boolean).join(' · '),
      footer: c.values.in_mask === 1 ? 'Inside the analog search zone. Hover a value to see its source.'
        : 'Outside the search zone (vegetation, water or cities): not ranked, shown for reference.',
    });
    if (move === 'frame') flyView(earth, frameView(earth, c.h3, earthPanels(), hexPx));
    return c.h3;
  } catch (err) {
    console.error(err);
    if (request === earthRequest) earthCard.message(title ?? fallback, `Could not load the Earth card: ${err.message}`);
    return null;
  }
}

const earthPanels = () => [stripEl, resultsEl, earthCardEl];

function clearMatch() {
  matchRequest++;
  lastRank = null;
  results.hide();
  earthCard.hide();
  strip.hide();
  layoutEarth();
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
const siteSub = (s) => `${BODY_LABEL[s.body] ?? ''} · ${s.type ?? 'site'}`;

function placeEntries() {
  return [
    ...sites.targets.map((s) => ({
      kind: 'site', body: s.body, label: s.name, sub: siteSub(s),
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
    return showEarthCell(data, { title: kind === 'analog' ? data.name : null });
  }
  // Mars / Moon: switch the left globe if needed, then open the cell card (it starts the search)
  showTarget(body);
  if (kind === 'site') {
    target.selectSite(`target:${data.id ?? data.name}`, { fly: false });
    return showCardAt(data.lat, data.lon, data.name, siteSub(data));
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
pruebaSel.addEventListener('change', () => runMatch());
matcher.load().then(fillTests).catch(() => {}); // fill the test list early (the table is cached)
(window.requestIdleCallback ?? setTimeout)(() => preloadCountries());

// --- Camera: fly straight down onto an H3 cell, framed in the part of the globe the panels leave free
const CELL_FILL = 0.55; // the hexagon spans ~55 % of the free part of the globe
const FLIGHT_S = 1.8;

/**
 * Largest free rectangle of the canvas (CSS px, relative to it) once the visible panels are taken
 * out. Each panel can be avoided by going beside it or above/below it: every combination is tried
 * and the one with the largest smaller side wins.
 */
function freeArea(canvas, panels) {
  const boxes = panels.filter((el) => el && !el.hidden).map((el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - canvas.left, t: r.top - canvas.top, r: r.right - canvas.left, b: r.bottom - canvas.top };
  }).filter((p) => p.r > 0 && p.l < canvas.width && p.b > 0 && p.t < canvas.height);
  let best = { x0: 0, x1: canvas.width, y0: 0, y1: canvas.height, m: -1 };
  for (let mask = 0; mask < 1 << boxes.length; mask++) {
    let x0 = 0;
    let x1 = canvas.width;
    let y0 = 0;
    let y1 = canvas.height;
    boxes.forEach((p, k) => {
      if (mask & (1 << k)) { // avoid sideways
        if (p.l + p.r < canvas.width) x0 = Math.max(x0, p.r);
        else x1 = Math.min(x1, p.l);
      } else if (p.t + p.b < canvas.height) { // avoid vertically
        y0 = Math.max(y0, p.b);
      } else {
        y1 = Math.min(y1, p.t);
      }
    });
    const m = Math.min(x1 - x0, y1 - y0);
    if (m > best.m) best = { x0, x1, y0, y1, m };
  }
  if (best.m < 80) best = { x0: 0, x1: canvas.width, y0: 0, y1: canvas.height };
  return { w: best.x1 - best.x0, h: best.y1 - best.y0, x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2 };
}

/**
 * Camera view looking straight down onto an H3 cell of `globe`, centred in the free part of the
 * canvas. The hexagon spans CELL_FILL of that part, or `px` pixels if given (so Earth matches the
 * size of the target hexagon), never more than 90 % of it. Returns { destination, orientation, px }.
 */
function frameView(globe, h3, panels, px = null) {
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
  const room = Math.min(free.w, free.h);
  const size = Math.min(px ?? CELL_FILL * room, 0.9 * room); // hexagon size on screen (px)

  // Camera height so that `diameter` metres cover `size` pixels
  const mPerPx = diameter / size;
  const height = (mPerPx * canvas.height) / (2 * Math.tan(viewer.camera.frustum.fovy / 2));

  // Shift the camera so the cell lands in the middle of the free part, not under a panel
  const dx = (canvas.width / 2 - free.x) * mPerPx;   // metres east
  const dy = (free.y - canvas.height / 2) * mPerPx;  // metres north
  const R = ell.maximumRadius;
  const camLon = lon + Cesium.Math.toDegrees(dx / (R * Math.max(0.05, Math.cos(Cesium.Math.toRadians(lat)))));
  const camLat = Math.max(-89.9, Math.min(89.9, lat + Cesium.Math.toDegrees(dy / R)));
  return {
    // same latitude convention as the cell, raised along the surface normal → looking straight down
    destination: toXYZ(camLat, camLon, height),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    px: size,
  };
}

function flyView(globe, { destination, orientation }) {
  globe.viewer.camera.cancelFlight();
  globe.viewer.camera.flyTo({
    destination,
    orientation,
    duration: FLIGHT_S,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
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
    target.onSiteSelect((site) => showCardAt(site.lat, site.lon, site.name, siteSub(site)));
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
window.matcher = matcher;
window.globes = {
  earth,
  get target() {
    return target;
  },
};
