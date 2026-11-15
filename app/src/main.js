// Two globes: the body you click on (left) and the body where analogs are searched (right).
// Any pair of Earth, Mars and the Moon works (⇄ swaps them); the comparator is the same everywhere.
//
// Flow of a click on the left globe ("data first, then a slow approach"):
//   1. load the cell card and show it;
//   2. score every cell of the search body, name the best ones (country / nearest known site), build
//      the hexagon layer (waits until Cesium has it ready) and open the card of analog #1 + the score;
//   3. a short pause to read, then both cameras pull out to a regional view (where on the globe are
//      we?), pause, and descend slowly onto the two hexagons, framed at the same size on screen.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createGlobe } from './globe.js';
import { loadSites } from './data.js';
import { CardGrid } from './grid.js';
import { createCardPanel, createResultsBar, createScoreDock } from './card.js';
import { cellToBoundary, cellToLatLng, greatCircleDistance } from 'h3-js';
import { latLonToCartesian } from './coords.js';
import { Matcher, RAMP_CSS, isTableLoaded, loadScoringMeta, loadTable, rampColor } from './match.js';
import { areaIndex, scoreCell, valueOn } from './scoring.js';
import { ZONES_BY_BODY, makeZone, zoneText } from './zones.js';
import { createPlaceSearch, createZoneMenu } from './places.js';
import { countryAt, preloadCountries } from './countries.js';
import { createRover } from './rover.js'; // [rover]
import { createRoute } from './route.js'; // [route]
import { slopeAt } from './slopetiles.js';

/** Pixel-level value under the point (only Mars has data tiles so far: slope at ~0.9 km). */
const pointValue = (body, lat, lon) => (body === 'mars' ? slopeAt(lat, lon).catch(() => null) : null);

const NAME = { earth: 'Earth', mars: 'Mars', moon: 'Moon' };
const RADIUS_KM = { earth: 6371, mars: 3390, moon: 1737 };
// Card grids (app/data/): Earth H3 res 6 (~6.5 km), Mars res 5 (~9 km), Moon res 4 (~12 km)
const GRIDS = { earth: new CardGrid('tierra'), mars: new CardGrid('marte'), moon: new CardGrid('luna') };

const reliefBox = document.getElementById('relief');
const reliefLabel = reliefBox.closest('label');
const leftButtons = document.querySelectorAll('#left-body button');
const rightButtons = document.querySelectorAll('#right-body button');
const leftLabel = document.getElementById('left-label');
const rightLabel = document.getElementById('right-label');
const cardLeftEl = document.getElementById('card-left');
const cardRightEl = document.getElementById('card-right');
const resultsEl = document.getElementById('results');
const dockEl = document.getElementById('dock');
const status = document.getElementById('status');
const pruebaSel = document.getElementById('prueba');
resultsEl.style.setProperty('--ramp', RAMP_CSS);

let left = null;  // globe on the left (+ .key)
let right = null; // globe on the right (+ .key)
let sites = { targets: [], analogs: [] };

let lastSource = null;    // card of the clicked (left) cell: { values, h3, lat, lon, key, name }
let lastRank = null;      // Matcher.rank() result for it
let lastCandidate = null; // shown right cell: { lat, lon, name }
let zone = null;          // search zone on the right body, or null = whole body
let customZone = null;    // last box drawn by the user
let hexPx = null;         // on-screen size of the last framed left hexagon (px)
let sourceRequest = 0;
let matchRequest = 0;
let candRequest = 0;

const cardLeft = createCardPanel(cardLeftEl, { onClose: clearAll });
const cardRight = createCardPanel(cardRightEl, {
  onClose: () => {
    cardRight.hide();
    dock.hide();
    right.clearCell();
    right.clearSelection();
    results.select(-1);
  },
});
const results = createResultsBar(resultsEl, {
  onPick: (b) => b && showCandidateAt(b, { rank: lastRank.best.indexOf(b) }),
  onClose: clearMatch,
});
const dock = createScoreDock(dockEl, { onClose: () => dock.hide() });

// The right card starts below the results bar; both cards stop above the score dock
const paneRight = document.getElementById('pane-right');
const panesEl = document.querySelector('.panes');
function layout() {
  if (resultsEl.hidden) paneRight.style.removeProperty('--right-top');
  else paneRight.style.setProperty('--right-top', `${resultsEl.offsetTop + resultsEl.offsetHeight + 8}px`);
  panesEl.style.setProperty('--dock-h', dockEl.hidden ? '0px' : `${dockEl.offsetHeight}px`);
}
new ResizeObserver(layout).observe(resultsEl);
new ResizeObserver(layout).observe(dockEl);

function setStatus(text) {
  status.hidden = !text;
  status.textContent = text ?? '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- [rover] Second view, "Rover test planner" (rover.js), opened from the view menu (the title in
// the toolbar). While it is open, runMatch() hands the clicked cell to it instead of searching analogs.
// [route] Third view, "Route replica" (route.js): draw a route on the left globe, find it on Earth.
const route = createRoute({
  left: () => left,
  right: () => right,
  setBodies: (l, r) => setBodies(l, r),
  setStatus,
});
const rover = createRover({
  route, // [route]
  left: () => left,
  right: () => right,
  source: () => lastSource,
  zone: () => zone,
  setBodies: (l, r) => setBodies(l, r),
  showEarthCell: (site, opts) => showCandidateAt(site, opts),
  clearEarthCell: () => {
    candRequest++;
    cardRight.hide();
    right.clearCell();
  },
  clearMatch: () => clearMatch(),
  runMatch: () => runMatch(),
  rebuildPlaces: () => placeSearch.rebuild(),
  // the clicked hexagon moves out from under the 3D rover when that view opens
  reframe: () => lastSource && animate([{ globe: left, h3: lastSource.h3, panels: leftPanels() }]),
  setStatus,
});

/** Score colour: the shown range (threshold → best) stretched over the whole ramp. */
function colorOf(score) {
  if (!Number.isFinite(score)) return '#555';
  if (!lastRank) return rampColor(score / 100);
  const lo = lastRank.threshold;
  const hi = Math.max(lo + 1, lastRank.best[0]?.score ?? 100);
  return rampColor((score - lo) / (hi - lo));
}

// --- Names: country on Earth, nearest known site on Mars / the Moon ------------------------------
async function placeName(body, lat, lon) {
  if (body === 'earth') return (await countryAt(lat, lon).catch(() => null)) ?? 'at sea';
  const R = RADIUS_KM[body];
  let best = null;
  for (const s of sites.targets.filter((t) => t.body === body)) {
    const km = greatCircleDistance([lat, lon], [s.lat, s.lon], 'rads') * R;
    if (!best || km < best.km) best = { name: s.name, km };
  }
  if (best && best.km < 30) return best.name;
  if (best && best.km < R / 4) return `${Math.round(best.km / 10) * 10} km from ${best.name}`;
  return NAME[body];
}

// --- Matchers (one per search body, the table is downloaded once) ---------------------------------
const matchers = {};
async function matcherFor(body) {
  matchers[body] ??= Promise.all([loadTable(body, setStatus), loadScoringMeta()]).then(([t, m]) => new Matcher(t, m));
  matchers[body].catch(() => { delete matchers[body]; });
  return matchers[body];
}

async function fillTests() {
  if (pruebaSel.options.length > 1) return;
  const meta = await loadScoringMeta();
  for (const [key, p] of Object.entries(meta.pruebas)) pruebaSel.add(new Option(p.label, key));
}

// --- 1. Click on the left globe → its card, the search on the right, then the animation -----------
async function showSourceAt(lat, lon, title = null, subtitle = null) {
  const request = ++sourceRequest;
  const key = left.key;
  const fallback = `${NAME[key]} · selected point`;
  cardLeft.loading(title ?? fallback, lat, lon, subtitle);
  try {
    const [c, name, point] = await Promise.all([GRIDS[key].cardAt(lat, lon), title ? title : placeName(key, lat, lon),
      pointValue(key, lat, lon)]);
    if (request !== sourceRequest) return;
    if (!c) {
      cardLeft.message(title ?? fallback, 'No data for this cell.');
      return;
    }
    left.showCell(c.h3);
    cardLeft.show(title ?? name, lat, lon, c, {
      subtitle: subtitle ?? NAME[key],
      point,
      footer: `Hover a value to see its source. The best analogs on ${NAME[right.key]} are on the right.`,
    });
    lastSource = { values: c.values, h3: c.h3, lat, lon, key, name: title ?? name };
    // think first: the whole search, the hexagons and analog #1 are ready before anything moves
    const found = await runMatch({ animate: false });
    if (request !== sourceRequest) return;
    await sleep(READ_PAUSE_MS);
    if (request !== sourceRequest) return;
    const flight = animate([
      { globe: left, h3: c.h3, panels: leftPanels() },
      found?.h3 ? { globe: right, h3: found.h3, panels: rightPanels() } : null,
    ]);
    // no match to fly to: show the zone ([rover] the rover view flies to its own best test site)
    if (zone && !found?.h3 && !rover.active) right.flyToZone(zone, FLY_S);
    // [rover] once the camera has settled on the place, the rover window opens by itself
    await flight;
    if (request === sourceRequest && rover.active) rover.open();
  } catch (err) {
    console.error(err);
    if (request === sourceRequest) cardLeft.message(title ?? fallback, `Could not load the card: ${err.message}`);
  }
}

/**
 * 2. Score the right body for the clicked cell and prepare everything (list, names, hexagons, card of
 * #1 + score). Returns { h3 } of analog #1. With animate = true (test or zone changed) the right
 * camera then flies on its own.
 */
async function runMatch({ animate: fly = true } = {}) {
  if (!lastSource) return null;
  if (rover.active) { // [rover] the rover view plans tests instead; fly to its best test site
    const plan = await rover.update();
    if (fly && plan?.h3) animate([{ globe: right, h3: plan.h3, panels: rightPanels() }]);
    return plan;
  }
  const request = ++matchRequest;
  const body = right.key;
  const where = zone ? `inside ${zone.label}` : `over the whole ${NAME[body]}`;
  results.loading(`Scoring every cell ${where}…`);
  setStatus(isTableLoaded(body) ? `Finding the best analogs on ${NAME[body]}…` : `Loading ${NAME[body]}…`);
  try {
    const matcher = await matcherFor(body);
    await fillTests();
    if (request !== matchRequest) return null;
    setStatus(zone && !matcher.table.lat ? 'Locating the cells of the zone (first zone search only)…'
      : `Finding the best analogs on ${NAME[body]}…`);
    await sleep(30); // let the panels paint before the heavy loop
    const res = matcher.rank(lastSource.values, lastSource.key, pruebaSel.value, { zone });
    if (request !== matchRequest) return null;
    lastRank = { ...res, matcher };
    if (!res.best.length) {
      right.clearHexes();
      right.clearRanks();
      cardRight.hide();
      dock.hide();
      results.loading(zone && !res.n
        ? `No search cell inside ${zone.label}. Pick another zone or draw a bigger area.`
        : `No cell of ${NAME[body]} shares a variable with this cell.`);
      setStatus('');
      return null;
    }
    const names = await Promise.all(res.best.map((b) => placeName(body, b.lat, b.lon)));
    res.best.forEach((b, k) => { b.name = names[k]; });
    if (request !== matchRequest) return null;
    const prueba = matcher.meta.pruebas[pruebaSel.value];
    results.show(res, {
      bodyName: NAME[body],
      colorOf,
      testNote: res.plan.note,
      validity: prueba?.test_validity,
      zoneLabel: zone?.label,
    });
    await right.showHexes(res.top.map((i) => ({ h3: matcher.table.h3(i), color: colorOf(res.score[i]) })));
    if (request !== matchRequest) return null;
    right.setRanks(res.best.map((b, k) => ({
      lat: b.lat, lon: b.lon, text: `#${k + 1} · ${b.score.toFixed(0)}`, color: colorOf(b.score), payload: b,
    })));
    const h3 = await showCandidateAt(res.best[0], { rank: 0, animate: false });
    setStatus('');
    if (request !== matchRequest) return null;
    if (fly) {
      // Always go to the best match, also inside a zone (before, a zone search stopped at the
      // whole-zone view and the best analog had to be found by hand).
      if (h3) animate([{ globe: right, h3, panels: rightPanels() }]);
      else if (zone) right.flyToZone(zone, FLY_S);
    }
    return { h3 };
  } catch (err) {
    console.error(err);
    if (request === matchRequest) {
      results.loading(`Could not search ${NAME[body]}: ${err.message}`);
      setStatus('');
    }
    return null;
  }
}

// Short names for the score dock
const SHORT_VAR = {
  slope_deg: 'Slope', roughness_deg: 'Rough.', t_mean_K: 'Mean T', t_max_K: 'Max T', t_min_K: 'Min T',
  t_night_K: 'Night T', precip_mm_year: 'Rain', ice_depth_m: 'Ice', dust_aod: 'Dust', sun_elev_max_deg: 'Sun',
};
const ENV = ['outside the search zone', 'polar ice', 'desert', 'arid open land'];

/** Comparison of a right cell with the clicked cell (same formula as the ranking). */
function compareWith(c) {
  const { plan, matcher } = lastRank;
  const meta = matcher.meta;
  const val = (name) => valueOn(meta, matcher.body, c.values, name); // 0 = no rain on Mars, no dust on the Moon
  const sc = scoreCell(meta, plan, val);
  const ring = matcher.neighbourMean(c.h3, lastRank.score);
  const index = areaIndex(meta, sc.index, ring);
  const dims = Object.entries(plan.dims).map(([d, { label, vars }]) => ({
    label,
    score: sc.dims[d],
    rows: Object.keys(vars).map((name) => ({
      name,
      label: meta.variables[name].label,
      short: SHORT_VAR[name] ?? name,
      unit: matcher.table.cols[name]?.unit ?? meta.variables[name].unit,
      target: plan.target[name],
      earth: val(name),
      note: sc.notes[name],
    })),
  }));
  return { index, cell: sc.index, ring, dims, color: colorOf(index), colorOf };
}

/**
 * Card of a cell of the right globe (+ the score dock when a left cell is selected). Everything is
 * computed before the camera moves; then (animate) the slow two-step approach. Returns the H3 id.
 */
async function showCandidateAt({ lat, lon }, { rank = -1, title = null, animate: fly = true } = {}) {
  const request = ++candRequest;
  const body = right.key;
  const fallback = rank >= 0 ? `Analog #${rank + 1}` : `${NAME[body]} · selected point`;
  cardRight.loading(title ?? fallback, lat, lon);
  results.select(rank);
  try {
    const [c, name, point] = await Promise.all([GRIDS[body].cardAt(lat, lon), placeName(body, lat, lon),
      pointValue(body, lat, lon)]);
    if (request !== candRequest) return null;
    if (!c) {
      cardRight.message(title ?? fallback, 'No data for this cell.');
      return null;
    }
    const heading = title ?? (rank >= 0 ? `Analog #${rank + 1} · ${name}` : name);
    right.showCell(c.h3);
    const env = body === 'earth' ? ENV[c.values.env] ?? '' : '';
    cardRight.show(heading, lat, lon, c, {
      subtitle: [NAME[body], title ? name : null, env].filter(Boolean).join(' · '),
      point,
      footer: body !== 'earth' ? 'Hover a value to see its source.'
        : c.values.in_mask === 1 ? 'Inside the analog search zone. Hover a value to see its source.'
          : 'Outside the search zone (vegetation, water or cities): not ranked, shown for reference.',
    });
    lastCandidate = { lat, lon, name: title ?? name };
    if (lastRank && lastSource) {
      dock.show({
        ...compareWith(c),
        source: { name: lastSource.name, body: NAME[lastSource.key] },
        candidate: { name: title ?? name, body: NAME[body] },
      });
    } else {
      dock.hide();
    }
    if (fly) animate([{ globe: right, h3: c.h3, panels: rightPanels() }]);
    return c.h3;
  } catch (err) {
    console.error(err);
    if (request === candRequest) cardRight.message(title ?? fallback, `Could not load the card: ${err.message}`);
    return null;
  }
}

function clearMatch() {
  matchRequest++;
  candRequest++;
  lastRank = null;
  lastCandidate = null;
  rover.reset(); // [rover]
  results.hide();
  cardRight.hide();
  dock.hide();
  right.clearHexes();
  right.clearRanks();
  right.clearCell();
  setStatus('');
}

function clearAll() {
  sourceRequest++;
  cardLeft.hide();
  lastSource = null;
  clearMatch();
  right.clearSelection();
  left.clearSelection();
}

// --- Camera: data first, then out to a regional view, pause, and down onto the hexagon ------------
const READ_PAUSE_MS = 700;  // read the data before anything moves
const OUT_S = 2.6;          // pull out to the regional view
const LOOK_PAUSE_MS = 800;  // look where on the globe we are
const FLY_S = 3.0;          // descend onto the hexagon
const CELL_FILL = 0.55;     // the hexagon spans ~55 % of the free part of the globe
// Regional view: altitude ~ the body's radius × this, so a continent-sized area is visible
const REGION_ALT = 0.7;
let animToken = 0;

const leftPanels = () => [cardLeftEl, dockEl, ...rover.panels.left];              // [rover] + its panels
const rightPanels = () => [resultsEl, cardRightEl, dockEl, ...rover.panels.right];

/**
 * Largest free rectangle of the canvas (CSS px, relative to it) once the visible panels are taken
 * out. Each panel can be avoided by going beside it or above/below it: every combination is tried
 * and the one with the largest smaller side wins.
 */
function freeArea(canvas, panels) {
  const boxes = panels.filter((el) => el && !el.hidden).map((el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - canvas.left, t: r.top - canvas.top, r: r.right - canvas.left, b: r.bottom - canvas.top };
  }).filter((p) => p.r > 0 && p.l < canvas.width && p.b > 0 && p.t < canvas.height)
    .map((p) => ({ l: Math.max(0, p.l), r: Math.min(canvas.width, p.r), t: Math.max(0, p.t), b: Math.min(canvas.height, p.b) }));
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
 * Camera view looking straight down onto an H3 cell, centred in the free part of the canvas.
 * Either at a given `altitude` (m) or zoomed so the hexagon spans CELL_FILL of the free part (or
 * `px` pixels, so both globes show it at the same size), never more than 90 % of it.
 */
function frameView(globe, h3, panels, { px = null, altitude = null } = {}) {
  const { viewer } = globe;
  const ell = globe.body.ellipsoid;
  const latType = globe.body.latitudeType; // H3 lat/lon use the body's convention (planetocentric on Mars)
  const toXYZ = (la, lo, h = 0) => latLonToCartesian(la, lo, ell, latType, h);
  const [lat, lon] = cellToLatLng(h3);
  const centre = toXYZ(lat, lon);
  const radius = Math.max(...cellToBoundary(h3).map(([la, lo]) => Cesium.Cartesian3.distance(centre, toXYZ(la, lo))));
  const diameter = 2 * radius;

  const rect = viewer.canvas.getBoundingClientRect();
  const canvas = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const free = freeArea(canvas, panels);
  const room = Math.min(free.w, free.h);
  const k = 2 * Math.tan(viewer.camera.frustum.fovy / 2);
  let mPerPx;
  let size = null;
  if (altitude) {
    mPerPx = (altitude * k) / canvas.height;
  } else {
    size = Math.min(px ?? CELL_FILL * room, 0.9 * room); // hexagon size on screen (px)
    mPerPx = diameter / size;
  }
  const height = altitude ?? (mPerPx * canvas.height) / k;

  // Shift the camera so the cell lands in the middle of the free part, not under a panel
  const dx = (canvas.width / 2 - free.x) * mPerPx;   // metres east
  const dy = (free.y - canvas.height / 2) * mPerPx;  // metres north
  const R = ell.maximumRadius;
  const camLon = lon + Cesium.Math.toDegrees(dx / (R * Math.max(0.05, Math.cos(Cesium.Math.toRadians(lat)))));
  const camLat = Math.max(-89.9, Math.min(89.9, lat + Cesium.Math.toDegrees(dy / R)));
  return {
    destination: toXYZ(camLat, camLon, height),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    px: size,
    height,
  };
}

function flyView(globe, { destination, orientation }, seconds) {
  return new Promise((resolve) => {
    globe.viewer.camera.cancelFlight();
    globe.viewer.camera.flyTo({
      destination,
      orientation,
      duration: seconds,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: resolve,
      cancel: resolve,
    });
  });
}

/** Is the camera already low and over this cell? Then skip the regional step. */
function alreadyNear(globe, h3, regionAlt) {
  const cam = globe.viewer.camera.positionCartographic;
  if (!cam || cam.height > regionAlt * 1.1) return false;
  const [lat, lon] = cellToLatLng(h3);
  const R = globe.body.ellipsoid.maximumRadius;
  const d = greatCircleDistance([lat, lon], [Cesium.Math.toDegrees(cam.latitude), Cesium.Math.toDegrees(cam.longitude)], 'rads') * R;
  return d < regionAlt;
}

/**
 * The slow two-step approach for one or two globes at once: out to a regional view centred on the
 * cell, a pause, then down onto the hexagon. The first item sets the hexagon size on screen; the
 * others use the same size. A newer call stops an older one between steps.
 */
async function animate(items) {
  const token = ++animToken;
  const list = items.filter(Boolean);
  const region = list.map(({ globe, h3, panels }) => {
    const alt = globe.body.ellipsoid.maximumRadius * REGION_ALT;
    return alreadyNear(globe, h3, alt) ? null : flyView(globe, frameView(globe, h3, panels, { altitude: alt }), OUT_S);
  });
  if (region.some(Boolean)) {
    await Promise.all(region);
    if (token !== animToken) return;
    await sleep(LOOK_PAUSE_MS);
    if (token !== animToken) return;
  }
  const flights = list.map(({ globe, h3, panels }, k) => {
    const view = frameView(globe, h3, panels, { px: k === 0 && globe === left ? null : hexPx });
    if (globe === left) hexPx = view.px;
    return flyView(globe, view, FLY_S);
  });
  await Promise.all(flights);
}

// --- Bodies on each side --------------------------------------------------------------------------
const siteSub = (s) => `${NAME[s.body] ?? ''} · ${s.type ?? 'site'}`;

function sitesFor(globe) {
  if (globe.key === 'earth') {
    globe.setSites(sites.analogs.map((a) => ({ ...a, id: a.name, subtitle: a.country })), 'analog');
  } else {
    globe.setSites(sites.targets.filter((s) => s.body === globe.key), 'target');
  }
}

function makeGlobe(container, key, side) {
  const g = { ...createGlobe(container, key), key };
  sitesFor(g);
  if (side === 'left') {
    g.onPick(({ lat, lon }) => (route.active ? route.pickLeft({ lat, lon }) : showSourceAt(lat, lon))); // [route]
    g.onSiteSelect((site) => (route.active ? route.pickLeft(site) // [route]
      : showSourceAt(site.lat, site.lon, site.name, site.type ? siteSub({ ...site, body: key }) : site.country)));
  } else {
    g.onPick(({ lat, lon }) => (route.active ? route.pickRight({ lat, lon }) : showCandidateAt({ lat, lon }))); // [route]
    g.onSiteSelect((site) => (route.active ? route.pickRight(site) : showCandidateAt(site, { title: site.name }))); // [route]
    g.onRankSelect((b) => showCandidateAt(b, { rank: lastRank?.best.indexOf(b) ?? -1 }));
  }
  return g;
}

/**
 * Put `l` on the left and `r` on the right. Never the same body on both sides: picking on one side
 * the body that is on the other side swaps them.
 */
function setBodies(l, r) {
  if (l === r && left && right) {
    if (l !== left.key) r = left.key;   // the left choice moved: the old left goes right
    else l = right.key;                 // the right choice moved: the old right goes left
  }
  if (l === r) r = l === 'earth' ? 'mars' : 'earth';
  const changed = left && right && (left.key !== l || right.key !== r);
  if (left && right) clearAll();
  if (changed) animToken++; // stop any camera animation still running for the old pair
  if (left?.key !== l) {
    left?.destroy();
    left = makeGlobe('globe-left', l, 'left');
  } else if (changed) {
    left.flyHome(); // the selection was cleared: the globe that stays goes back to its whole view
  }
  if (right?.key !== r) {
    right?.destroy();
    right = makeGlobe('globe-right', r, 'right');
    zone = null;
    zoneMenu.setBody(r);
  } else if (changed) {
    if (zone) right.flyToZone(zone, 1.5); // keep the search zone in view if there is one
    else right.flyHome();
  }
  leftButtons.forEach((b) => b.classList.toggle('active', b.dataset.body === l));
  rightButtons.forEach((b) => b.classList.toggle('active', b.dataset.body === r));
  leftLabel.textContent = `${NAME[l]} · click a point`;
  rightLabel.textContent = `${NAME[r]} · analogs`;
  applyRelief();
  if (changed) route.bodiesChanged(); // [route]
}

function applyRelief() {
  left.setRelief(reliefBox.checked);
  right.setRelief(reliefBox.checked);
  const has = left.hasRelief || right.hasRelief;
  reliefLabel.classList.toggle('disabled', !has);
  reliefLabel.title = has ? '' : 'No relief layer for these bodies yet';
}

leftButtons.forEach((b) => b.addEventListener('click', () => setBodies(b.dataset.body, right.key)));
rightButtons.forEach((b) => b.addEventListener('click', () => setBodies(left.key, b.dataset.body)));
document.getElementById('swap').addEventListener('click', () => {
  const next = lastCandidate; // the analog on screen becomes the clicked point on the other side
  setBodies(right.key, left.key);
  if (next) showSourceAt(next.lat, next.lon, next.name);
});
reliefBox.addEventListener('change', applyRelief);
pruebaSel.addEventListener('change', () => runMatch());

// --- Search zone on the right body: a region from the menu or a box dragged on the globe ---------
function setZone(z) {
  zone = z;
  zoneMenu.set(z?.key ?? null, z?.label);
  if (z) {
    right.showZone(z);
    if (!lastSource) right.flyToZone(z, FLY_S);
  } else {
    right.clearZone();
  }
  runMatch();
}

function zoneByKey(key) {
  if (!key) return null;
  if (key === 'custom') return customZone;
  const z = (ZONES_BY_BODY[right.key] ?? []).find((x) => x.key === key);
  return z ? makeZone(z) : null;
}

async function drawZone() {
  zoneMenu.drawing(true);
  setStatus(`Drag a box on ${NAME[right.key]}: the search will only look inside it · Esc cancels`);
  const box = await right.drawBox();
  zoneMenu.drawing(false);
  setStatus('');
  if (!box) {
    zoneMenu.set(zone?.key ?? null, zone?.label); // cancelled: keep the previous zone
    if (zone) right.showZone(zone);
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
    ...Object.entries(ZONES_BY_BODY).flatMap(([body, list]) => list.map((z) => ({
      kind: 'zone', body, label: z.label, sub: `${NAME[body]} · search only in this zone`, words: z.words, data: z,
    }))),
  ].filter(rover.allowsPlace); // [rover] the rover view only offers Earth zones
}

function goToPlace({ kind, body, data }) {
  if (kind === 'zone') {
    if (right.key !== body) setBodies(left.key === body ? right.key : left.key, body);
    return setZone(makeZone(data));
  }
  const title = kind === 'coords' ? null : data.name;
  const sub = kind === 'site' ? siteSub(data) : kind === 'analog' ? data.country : null;
  const select = (g) => {
    if (kind === 'coords') g.setMarker(data.lat, data.lon);
    else g.selectSite(`${kind === 'analog' ? 'analog' : 'target'}:${data.id ?? data.name}`, { fly: false });
  };
  if (right.key === body && left.key !== body) {
    select(right);
    return showCandidateAt(data, { title });
  }
  if (left.key !== body) setBodies(body, right.key);
  select(left);
  return showSourceAt(data.lat, data.lon, title, sub);
}

const placeSearch = createPlaceSearch(document.getElementById('place-search'), document.getElementById('place-results'), {
  entries: placeEntries,
  onChoose: goToPlace,
  bodies: () => [left.key, right.key, ['earth', 'mars', 'moon'].find((b) => b !== left.key && b !== right.key)],
});

// Esc clears every selection (coordinate markers, highlighted sites, cell outlines, cards and score)
// and takes both cameras back to the opening view, like the home button. With a search zone, the
// right globe goes back to the zone instead. In the route view it also clears the drawn route, its
// profile and the search results (route.reset()), so every view starts again the same way.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  clearAll();
  if (route.active) route.reset(); // [route]
  animToken++; // stop the approach animation if it is still running
  left.flyHome();
  if (zone) right.flyToZone(zone, 1.5);
  else right.flyHome();
});

setBodies('mars', 'earth');
fillTests().catch(() => {});
(window.requestIdleCallback ?? setTimeout)(() => preloadCountries());

loadSites()
  .then((data) => {
    sites = data;
    sitesFor(left);
    sitesFor(right);
    placeSearch.rebuild();
  })
  .catch((err) => console.error(err));

// For debugging from the browser console
window.Cesium = Cesium;
window.goToPlace = goToPlace;
window.showSourceAt = showSourceAt;
window.setBodies = setBodies;
window.rover = rover; // [rover]
window.route = route; // [route]
window.globes = {
  get left() {
    return left;
  },
  get right() {
    return right;
  },
};
