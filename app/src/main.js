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
const card = createCardPanel(document.getElementById('card'), { onClose: clearAll });
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
    frameCell(c.h3);
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
resultsEl.style.setProperty('--ramp', RAMP_CSS);
let lastTarget = null; // card of the selected Mars / Moon cell
let lastRank = null;   // EarthMatcher.rank() result for it
let matchRequest = 0;

const results = createMatchPanel(resultsEl, {
  onPick: (b) => b && showEarthCell(b, { rank: lastRank.best.indexOf(b) }),
  onClose: clearMatch,
});
const earthCard = createCardPanel(document.getElementById('earth-card'), {
  onClose: () => {
    earthCard.hide();
    earth.clearCell();
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
    showEarthCell(res.best[0], { rank: 0, height: 2.2e6, fly: !zone });
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

/** Card of an Earth cell, with the comparison against the selected target cell (if any). */
async function showEarthCell({ lat, lon }, { rank = -1, height = 6e5, fly = true } = {}) {
  const title = rank >= 0 ? `Earth · analog #${rank + 1}` : 'Earth · selected point';
  earthCard.loading(title, lat, lon);
  try {
    const c = await EARTH_GRID.cardAt(lat, lon);
    if (!c) return earthCard.message(title, 'No data for this cell.');
    earth.showCell(c.h3);
    if (fly) earth.flyTo(lat, lon, height, 1.6);
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
  } catch (err) {
    console.error(err);
    earthCard.message(title, `Could not load the Earth card: ${err.message}`);
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

// --- Earth search zone: a predefined region or a box the user drags on the Earth globe ---------
const zoneSel = document.getElementById('zone');
const drawBtn = document.getElementById('draw-zone');
let zone = null;       // current zone ({ key, label, south, north, west, east }) or null = whole Earth
let customZone = null; // last box drawn by the user
for (const z of ZONES) zoneSel.add(new Option(z.label, z.key));

function setZone(z) {
  zone = z;
  zoneSel.value = z ? z.key : '';
  if (z) {
    earth.showZone(z);
    if (!lastTarget) earth.flyToZone(z);
  } else {
    earth.clearZone();
  }
  runMatch();
}

zoneSel.addEventListener('change', () => {
  const key = zoneSel.value;
  if (!key) return setZone(null);
  if (key === 'custom') return setZone(customZone);
  setZone(makeZone(ZONES.find((z) => z.key === key)));
});

drawBtn.addEventListener('click', async () => {
  if (drawBtn.classList.contains('active')) return earth.cancelDraw();
  drawBtn.classList.add('active');
  setStatus('Drag a box on Earth: the search will only look inside it · Esc cancels');
  const box = await earth.drawBox();
  drawBtn.classList.remove('active');
  setStatus('');
  if (!box) {
    if (zone) earth.showZone(zone); // cancelled: keep the previous zone
    return;
  }
  const z = makeZone(box);
  customZone = { ...z, label: `area ${zoneText(z)}` };
  let opt = [...zoneSel.options].find((o) => o.value === 'custom');
  if (!opt) zoneSel.add((opt = new Option('', 'custom')));
  opt.textContent = `Custom: ${zoneText(z)}`;
  setZone(customZone);
});

earth.onPick(({ lat, lon }) => showEarthCell({ lat, lon }, { height: 4e5 }));
earth.onRankSelect((b) => showEarthCell(b, { rank: lastRank?.best.indexOf(b) ?? -1 }));
pruebaSel.addEventListener('change', runMatch);
matcher.load().then(fillTests).catch(() => {}); // fill the test list early (the table is cached)

const CELL_FILL = 0.55; // the hexagon spans ~55 % of the free part of the globe

/**
 * Fly the camera straight down onto an H3 cell, zoomed so the hexagon is well framed in the part
 * of the globe the card leaves free (left of it on wide screens, above it on phones).
 */
function frameCell(h3) {
  const { viewer } = target;
  const ell = target.body.ellipsoid;
  const latType = target.body.latitudeType; // H3 lat/lon use the body's convention (planetocentric on Mars)
  const toXYZ = (la, lo, h = 0) => latLonToCartesian(la, lo, ell, latType, h);
  const [lat, lon] = cellToLatLng(h3);
  // Hexagon size on the ground: largest centre-to-vertex distance, ×2
  const centre = toXYZ(lat, lon);
  const radius = Math.max(...cellToBoundary(h3).map(([la, lo]) => Cesium.Cartesian3.distance(centre, toXYZ(la, lo))));
  const diameter = 2 * radius;

  const canvas = viewer.canvas.getBoundingClientRect();
  const panel = document.getElementById('card').getBoundingClientRect();
  const narrow = panel.left - canvas.left < 120;
  const free = narrow
    ? { w: canvas.width, h: Math.max(80, panel.top - canvas.top), x: canvas.width / 2 }
    : { w: Math.max(80, panel.left - canvas.left), h: canvas.height, x: (panel.left - canvas.left) / 2 };
  free.y = narrow ? free.h / 2 : canvas.height / 2;

  // Camera height so that `diameter` metres cover CELL_FILL of the smaller free dimension
  const mPerPx = diameter / (CELL_FILL * Math.min(free.w, free.h));
  const height = (mPerPx * canvas.height) / (2 * Math.tan(viewer.camera.frustum.fovy / 2));

  // Shift the camera so the cell lands in the middle of the free part, not under the card
  const dx = (canvas.width / 2 - free.x) * mPerPx;   // metres east
  const dy = (free.y - canvas.height / 2) * mPerPx;  // metres north
  const R = ell.maximumRadius;
  const camLon = lon + Cesium.Math.toDegrees(dx / (R * Math.max(0.05, Math.cos(Cesium.Math.toRadians(lat)))));
  const camLat = Math.max(-89.9, Math.min(89.9, lat + Cesium.Math.toDegrees(dy / R)));
  viewer.camera.flyTo({
    // same latitude convention as the cell, raised along the surface normal → looking straight down
    destination: toXYZ(camLat, camLon, height),
    orientation: { heading: 0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.2,
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
  })
  .catch((err) => console.error(err));

// For debugging from the browser console
window.Cesium = Cesium;
window.CardGrid = CardGrid;
window.showCardAt = (lat, lon, title = 'debug') => showCardAt(lat, lon, title);
window.globes = {
  earth,
  get target() {
    return target;
  },
};
