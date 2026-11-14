// Rover test planner: "send a rover to the clicked Mars / Moon cell → where on Earth can each of
// its parts be field-tested, and where can the whole rover be tested at once?"
//
// It is the SECOND VIEW of the app. The view menu (the title at the left of the toolbar) switches
// between "Analogs" (the analog finder, untouched) and "Rover test planner" (only the rover: the
// analog results, the score dock and the Test selector are hidden). #rover in the URL opens it directly.
//
// Method (config and assumptions in data/rover.json):
//   • a part depends on a few card variables, each with a margin (±) around the target cell's value;
//   • an Earth search cell "passes" for the part when EVERY one of those variables is inside the box
//     (the weakest link decides: a wheel test with the right slope but the wrong roughness is not valid);
//   • distance of a cell to the target for that part:  d = max_k |earth_k − target_k| / margin_k
//       d ≤ 1 → inside the margins      d ≤ 2 → inside twice the margins
//   • status: FIELD (some cell with d ≤ 1) · PARTIAL (only d ≤ 2, or a variable is missing, or physics
//     such as gravity caps it) · LAB (no cell with d ≤ 2, or the part needs vacuum);
//   • testability index = 100 · (field + ½ · partial) / parts.
// It reuses the Earth search table of match.js (1.37 M search cells), so nothing new is downloaded.
import './rover.css';
import { cellToLatLng, greatCircleDistance } from 'h3-js';
import { SHORT } from './card.js';
import { inkOn, isTableLoaded, loadScoringMeta, loadTable, rampColor, RAMP_CSS } from './match.js';
import { ZONES, zoneContains, zoneSizeKm } from './zones.js';
import { countryAt } from './countries.js';

const BASE = `${import.meta.env.BASE_URL}data/`;
const NODATA = { u1: 255, u2: 65535 };
const EPS = 1e-4;
const MAX_HEXES = 6000;
const NAME = { earth: 'Earth', mars: 'Mars', moon: 'the Moon' };
const FLY_S = 2.6; // camera flights on Earth (calm, like the analog view)

export const STATUS = {
  field: { label: 'Field test on Earth', short: 'field', color: '#4fd17b', icon: '✔' },
  partial: { label: 'Field test with caveats', short: 'with caveats', color: '#ffc14d', icon: '◐' },
  lab: { label: 'Lab only', short: 'lab only', color: '#ff6b5e', icon: '✖' },
  nodata: { label: 'No data for this cell', short: 'no data', color: '#8a93a8', icon: '?' },
};
const ENV = { 1: 'polar ice', 2: 'desert', 3: 'arid open land' };
const ICE = { 0.5: 'within 1 m', 3: '1–5 m deep', 5: 'deeper than 5 m', 10: 'none' };

/** Indices of the (up to) K lowest finite keys, sorted ascending. */
function lowestK(key, K, maxKey) {
  const BINS = 4000;
  const n = key.length;
  const hist = new Uint32Array(BINS + 1);
  const binOf = (k) => Math.min(BINS, Math.floor((k / maxKey) * BINS));
  for (let i = 0; i < n; i++) if (key[i] <= maxKey) hist[binOf(key[i])]++;
  let kept = 0;
  let b = 0;
  for (; b <= BINS && kept + hist[b] <= K; b++) kept += hist[b];
  const out = [];
  for (let i = 0; i < n; i++) if (key[i] <= maxKey && binOf(key[i]) < b) out.push(i);
  // the next bin does not fit whole: take cells from it until K (ties → any of them)
  for (let i = 0; b <= BINS && i < n && out.length < K; i++) if (key[i] <= maxKey && binOf(key[i]) === b) out.push(i);
  return out.sort((x, y) => key[x] - key[y]);
}

const toRad = Math.PI / 180;
function km(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * toRad) / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(((lon2 - lon1) * toRad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export class RoverPlanner {
  /**
   * @param table  Earth search table (match.js loadTable('earth'))
   * @param meta   scoring settings (match.js loadScoringMeta()): units, tolerances, zero_on_target
   * @param config data/rover.json
   */
  constructor(table, meta, config) {
    this.m = table;
    this.meta = meta;
    this.config = config;
  }

  site(i, extra = {}) {
    const m = this.m;
    const h3 = m.h3(i);
    const [lat, lon] = cellToLatLng(h3);
    const zone = ZONES.find((z) => zoneContains(z, lat, lon));
    // `place` = broad region; the UI replaces it with the country (countries.js) when it is known
    return { i, h3, lat, lon, env: ENV[m.value('env', i)] ?? '', place: zone?.label ?? '', ...extra };
  }

  /** Up to `count` sites from `sorted` (best first), at least `minKm` apart. */
  spaced(sorted, count, minKm, make) {
    const out = [];
    for (const i of sorted) {
      const s = this.site(i);
      if (out.every((o) => greatCircleDistance([s.lat, s.lon], [o.lat, o.lon], 'km') >= minKm)) {
        out.push(make ? make(s) : s);
        if (out.length === count) break;
      }
    }
    return out;
  }

  /**
   * @param values card of the target cell ({column: number|NaN})
   * @param bodyKey 'mars' | 'moon'
   * @param zone optional Earth zone (zones.js) to search inside
   */
  evaluate(values, bodyKey, zone = null) {
    const m = this.m;
    const meta = this.meta;
    const n = m.n;
    const inZone = zone ? m.zoneMask(zone).mask : null;
    const minKm = zone ? Math.max(5, Math.min(400, zoneSizeKm(zone) / 5)) : 400;
    const zero = meta.zero_on_target ?? {};

    const parts = this.config.parts.map((part) => {
      const cap = part.caps?.[bodyKey] ?? null;
      const used = [];
      const missing = [...(part.missing_on_earth ?? [])]; // it matters, but cannot be compared
      const noTarget = [];                                // the target cell has no value for it
      for (const name of Object.keys(part.variables)) {
        const label = part.missing_label?.[name] ?? (SHORT[name] ?? name).toLowerCase();
        const col = m.cols[name];
        let t = values[name];
        if (!Number.isFinite(t) && zero[name]?.includes(bodyKey)) t = 0;
        if (!(name in values) && !Number.isFinite(t)) {
          // this body's grid has no such column: skipped, unless the part declares it essential
          if (part.optional?.includes(name)) missing.push(label);
          continue;
        }
        if (!col) {
          missing.push(label);
          continue;
        }
        if (!Number.isFinite(t)) {
          noTarget.push(label);
          continue;
        }
        used.push({
          name, label: SHORT[name] ?? name, unit: col.unit ?? meta.variables[name]?.unit ?? '', scale: col.scale,
          target: t, margin: part.variables[name] ?? meta.variables[name].tolerance,
        });
      }
      const res = { part, id: part.id, cap, used, missing, noTarget, n1: 0, n2: 0, limit: 0, d: null, top: [], sites: [] };
      if (cap?.max === 'lab') return { ...res, status: 'lab' };
      if (!used.length) return { ...res, status: 'nodata' };

      const d = new Float32Array(n);
      for (const u of used) {
        const { arr, scale, offset, dtype } = m.cols[u.name];
        const nod = NODATA[dtype];
        const inv = 1 / u.margin;
        for (let i = 0; i < n; i++) {
          const q = arr[i];
          if (q === nod) {
            d[i] = Infinity;
          } else {
            const x = Math.abs(q * scale + offset - u.target) * inv;
            if (x > d[i]) d[i] = x;
          }
        }
      }
      let n1 = 0;
      let n2 = 0;
      for (let i = 0; i < n; i++) {
        if (inZone && !inZone[i]) d[i] = Infinity;
        else if (d[i] <= 1 + EPS) n1++;
        else if (d[i] <= 2 + EPS) n2++;
      }
      let status = n1 ? 'field' : n2 ? 'partial' : 'lab';
      if (status === 'field' && (cap?.max === 'partial' || missing.length || noTarget.length)) status = 'partial';
      return { ...res, d, n1, n2: n1 + n2, limit: n1 ? 1 : 2, status };
    });

    // Overall closeness of each cell to the whole rover (0–1): used to break ties, so the site
    // proposed for one part is, among equally good ones, the best for the rest of the rover too.
    const testable = parts.filter((p) => p.d && p.status !== 'lab');
    const G = new Float32Array(n);
    for (const p of testable) for (let i = 0; i < n; i++) G[i] += Math.max(0, 1 - p.d[i] / 2);
    if (testable.length) for (let i = 0; i < n; i++) G[i] /= testable.length;

    const key = new Float32Array(n);
    for (const p of testable) {
      const lim = p.limit + EPS;
      for (let i = 0; i < n; i++) key[i] = p.d[i] <= lim ? p.d[i] + 0.5 * (1 - G[i]) : Infinity;
      p.top = lowestK(key, MAX_HEXES, 2.6);
      p.sites = this.spaced(p.top, 3, minKm, (s) => ({
        ...s, d: p.d[s.i], earth: Object.fromEntries(p.used.map((u) => [u.name, m.value(u.name, s.i)])),
      }));
    }

    // Whole rover: how many testable parts pass in the same cell
    const count = new Uint8Array(n);
    for (const p of testable) {
      const lim = p.limit + EPS;
      for (let i = 0; i < n; i++) if (p.d[i] <= lim) count[i]++;
    }
    const P = testable.length;
    let maxCount = 0;
    for (let i = 0; i < n; i++) {
      key[i] = count[i] ? P - count[i] + (1 - G[i]) : Infinity;
      if (count[i] > maxCount) maxCount = count[i];
    }
    const top = P ? lowestK(key, MAX_HEXES, P + 1) : [];
    const passAt = (i) => testable.filter((p) => p.d[i] <= p.limit + EPS).map((p) => p.id);
    const sites = this.spaced(top, 3, minKm, (s) => ({ ...s, pass: passAt(s.i), count: count[s.i] }));

    const tally = { field: 0, partial: 0, lab: 0, nodata: 0 };
    for (const p of parts) tally[p.status]++;
    const total = parts.length - tally.nodata;
    return {
      bodyKey, zone, parts, testable, tally, total,
      index: total ? (100 * (tally.field + 0.5 * tally.partial)) / total : NaN,
      combo: { top, sites, count, maxCount, P },
      campaign: null,
    };
  }

  /**
   * Fewest sites that together cover every testable part: start at the best all-in-one site, then
   * add the nearest cell that covers the most parts still uncovered. Needs every cell's lat/lon
   * (Table.coords(), ~1 s the first time), so it is computed on demand.
   */
  campaign(res) {
    if (res.campaign) return res.campaign;
    const first = res.combo.sites[0];
    if (!first) return (res.campaign = []);
    const plan = [{ site: first, covers: first.pass, km: 0 }];
    let left = res.testable.filter((p) => !first.pass.includes(p.id));
    if (left.length) {
      const { lat, lon } = this.m.coords();
      const n = this.m.n;
      const gain = new Uint8Array(n);
      while (left.length && plan.length < 6) {
        gain.fill(0);
        let g = 0;
        for (const p of left) {
          const lim = p.limit + EPS;
          for (let i = 0; i < n; i++) if (p.d[i] <= lim && ++gain[i] > g) g = gain[i];
        }
        if (!g) break;
        let best = -1;
        let bestCost = Infinity;
        for (let i = 0; i < n; i++) {
          if (gain[i] !== g) continue;
          let worst = 0;
          for (const p of left) if (p.d[i] <= p.limit + EPS && p.d[i] > worst) worst = p.d[i];
          const cost = km(first.lat, first.lon, lat[i], lon[i]) + 300 * worst; // near, and not on the edge of the box
          if (cost < bestCost) {
            bestCost = cost;
            best = i;
          }
        }
        const s = this.site(best);
        const covers = left.filter((p) => p.d[best] <= p.limit + EPS).map((p) => p.id);
        plan.push({ site: s, covers, km: km(first.lat, first.lon, s.lat, s.lon) });
        left = left.filter((p) => !covers.includes(p.id));
      }
    }
    return (res.campaign = plan);
  }
}

// ------------------------------------------------------------------------------------------------
// UI: view menu in the toolbar + 3D rover on the left pane + plan panel on the Earth (right) pane
// ------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtLL = (s) => `${Math.abs(s.lat).toFixed(1)}° ${s.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.lon).toFixed(1)}° ${s.lon >= 0 ? 'E' : 'W'}`;
const where = (s) => (s.place ? `${s.place} · ${fmtLL(s)}` : `${fmtLL(s)}${s.env ? ` · ${s.env}` : ''}`);
const num = (x) => x.toLocaleString('en-US');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const badge = (text, color) => `<span class="score" style="background:${color};color:${inkOn(color)}">${text}</span>`;

function fmtValue(u, v) {
  if (!Number.isFinite(v)) return '–';
  if (u.name === 'ice_depth_m') return ICE[v] ?? `${v} m`;
  const dec = u.scale >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(u.scale)));
  return `${v.toFixed(dec)}${u.unit === '°' ? '°' : u.unit ? ` ${u.unit}` : ''}`;
}

/** Colour of a cell for one part: bright green = same as the target, dark green = edge of the margin. */
function partColor(d) {
  if (d <= 1 + EPS) {
    const t = 1 - Math.min(1, d);
    return `rgb(${Math.round(40 + 130 * t)}, ${Math.round(150 + 105 * t)}, ${Math.round(95 + 95 * t)})`;
  }
  const t = 2 - Math.min(2, d);
  return `rgb(${Math.round(170 + 85 * t)}, ${Math.round(110 + 83 * t)}, 60)`;
}

/** Country of each site (countries.js), kept in `place`; the broad region stays if it is at sea. */
async function nameSites(sites) {
  await Promise.all(sites.map(async (s) => {
    if (s.named) return;
    s.named = true;
    const country = await countryAt(s.lat, s.lon).catch(() => null);
    if (country) s.place = country;
  }));
}

const VIEWS = {
  analogs: {
    title: 'Analogs',
    name: 'Analog finder',
    text: 'Where does Earth look like the Moon or Mars? Click a point and get its best analogs.',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 2.6 3 14.4 0 17M12 3.5c-3 2.6-3 14.4 0 17"/></svg>',
  },
  rover: {
    title: 'Rover test planner',
    name: 'Rover test planner',
    text: 'Send a rover to Mars or the Moon: where on Earth can each of its parts be tested?',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13V9.5h9l3 3.5h4v2.5H4z"/><path d="M9 9.5V6h3"/><circle cx="7" cy="17.5" r="2"/><circle cx="12.5" cy="17.5" r="2"/><circle cx="18" cy="17.5" r="2"/></svg>',
  },
};

/**
 * @param api (from main.js; the globes are recreated when the bodies change, so they are getters)
 *   left(), right()        the two globes (+ .key)
 *   source()               the clicked left cell { values, h3, lat, lon, key, name } or null
 *   zone()                 search zone on the right body, or null
 *   setBodies(l, r)        put these bodies on the left / right
 *   showEarthCell(site, { title, animate })   card of a cell of the right globe
 *   clearEarthCell()       hide that card
 *   clearMatch()           remove the analog results from the screen
 *   runMatch()             run the analog search for the clicked cell (back to the analog view)
 *   rebuildPlaces()        rebuild the place search list (it depends on the view)
 *   reframe()              fly the left camera so the clicked hexagon is clear of the panels
 *   setStatus(text)
 */
export function createRover(api) {
  const state = { tab: 'analogs', config: null, planner: null, view: null, viewLoading: null, result: null, selected: 'all', request: 0 };
  const active = () => state.tab === 'rover';
  const earth = () => api.right(); // while this view is open, the right globe is always Earth

  // ---- view menu: the app title becomes a button that opens the list of views -------------------
  const h1 = document.querySelector('.toolbar h1');
  const menuRoot = document.createElement('div');
  menuRoot.className = 'view-menu';
  h1.before(menuRoot);
  menuRoot.append(h1);
  h1.innerHTML = '<button type="button" class="view-btn" aria-haspopup="true" aria-expanded="false" title="Change view">'
    + '<span class="view-name"></span><span class="caret">▾</span></button>';
  const viewBtn = h1.querySelector('.view-btn');
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menuRoot.append(menu);

  function paintMenu() {
    viewBtn.querySelector('.view-name').textContent = VIEWS[state.tab].title;
    menu.innerHTML = `<p class="menu-title">View</p>${Object.entries(VIEWS).map(([key, v]) => `
      <button type="button" role="menuitemradio" aria-checked="${state.tab === key}" class="view-opt${state.tab === key ? ' on' : ''}" data-tab="${key}">
        ${v.icon}<span><b>${v.name}</b><small>${v.text}</small></span></button>`).join('')}`;
  }
  const openMenu = (show = menu.hidden) => {
    menu.hidden = !show;
    viewBtn.setAttribute('aria-expanded', String(show));
  };
  viewBtn.addEventListener('click', () => openMenu());
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    openMenu(false);
    setTab(b.dataset.tab);
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.hidden && !menuRoot.contains(e.target)) openMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      e.stopPropagation(); // close the menu only, keep the selection
      openMenu(false);
    }
  }, true);

  // ---- 3D rover: bottom-left of the left pane (the body the rover goes to) -----------------------
  const view = document.createElement('div');
  view.className = 'rover-view';
  view.hidden = true;
  view.innerHTML = '<header><b>Your rover</b><span>drag to turn · click a part</span></header>'
    + '<div class="rover-stage"><p class="rover-wait">Loading the 3D rover (5 MB)…</p></div><footer></footer>';
  document.getElementById('pane-left').append(view);
  const stage = view.querySelector('.rover-stage');

  // ---- plan panel: right edge of the Earth pane ---------------------------------------------------
  const panel = document.createElement('aside');
  panel.className = 'card rover-panel';
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  panel.style.setProperty('--ramp', RAMP_CSS);
  document.getElementById('pane-right').append(panel);

  const part = (id) => state.result?.parts.find((p) => p.id === id);
  const partName = (id) => state.config.parts.find((p) => p.id === id)?.short ?? id;

  async function ensureConfig() {
    if (!state.config) {
      const res = await fetch(`${BASE}rover.json`);
      if (!res.ok) throw new Error(`rover.json: HTTP ${res.status}`);
      state.config = await res.json();
      view.querySelector('footer').textContent = state.config.model.credit;
    }
    return state.config;
  }

  function ensureView() {
    if (!state.viewLoading) {
      state.viewLoading = (async () => {
        const config = await ensureConfig();
        const { createRoverView } = await import('./rover3d.js');
        state.view = await createRoverView(stage, config, { onPick: (id) => select(id ?? 'all') });
        window.roverView = state.view; // for debugging from the console
        stage.querySelector('.rover-wait')?.remove();
        if (active()) state.view.start();
        paintRover();
      })().catch((err) => {
        console.error(err);
        const wait = stage.querySelector('.rover-wait');
        if (wait) wait.textContent = `Could not load the 3D rover: ${err.message}`;
      });
    }
    return state.viewLoading;
  }

  function paintRover() {
    if (!state.view) return;
    const colors = {};
    const marks = {};
    for (const p of state.result?.parts ?? []) {
      colors[p.id] = STATUS[p.status].color;
      marks[p.id] = STATUS[p.status].icon;
    }
    state.view.setStatuses(colors, marks);
    state.view.select(state.selected === 'all' ? null : state.selected);
  }

  // ---- panel ------------------------------------------------------------------------------------
  const head = (sub) => `<header><div><h2>Rover test plan</h2><p class="sub">${sub}</p></div></header>`;

  function renderMessage(text) {
    panel.innerHTML = `${head('Where on Earth can each part of a rover be tested?')}<p class="rv-msg">${text}</p>`;
  }

  function summaryOf(p) {
    if (p.status === 'lab') {
      return p.cap?.max === 'lab' ? 'needs vacuum → lab' : state.result.zone ? 'not inside this zone' : 'nowhere on Earth → lab';
    }
    if (p.status === 'nodata') return 'no value in this cell';
    const s = p.sites[0];
    return `${num(p.limit === 1 ? p.n1 : p.n2)} cells${p.limit === 2 ? ' (close: 2× margin)' : ''}${s?.place ? ` · best in ${s.place}` : ''}`;
  }

  function siteList(sites, text) {
    return `<ol class="rv-ranks">${sites.map((s, k) => `<li tabindex="0" data-site="${k}">
      ${badge(`#${k + 1}`, s.color)}
      <span><b>${esc(where(s))}</b><br><span class="muted">${text(s)}</span></span></li>`).join('')}</ol>`;
  }

  function renderAll(res) {
    const { combo, tally } = res;
    const labOnly = res.parts.filter((p) => p.status === 'lab');
    const chips = (ids, ok) => ids.map((id) => `<span class="rv-chip ${ok ? 'ok' : 'no'}">${esc(partName(id))}</span>`).join('');
    let html = '';
    if (combo.sites.length) {
      for (const s of combo.sites) s.color = rampColor(s.count / combo.P);
      html += `<h3>Whole rover at one site</h3>
        <p class="small">Best cells of Earth by number of parts testable at the same place
        (${combo.maxCount} of ${combo.P} at best).</p>
        ${siteList(combo.sites, (s) => `${s.count} of ${combo.P} parts: ${chips(s.pass, true)}${chips(res.testable.map((p) => p.id).filter((id) => !s.pass.includes(id)), false)}`)}
        <div class="legend"><span>1</span><i></i><span>${combo.P} parts</span></div>`;
      html += '<div data-campaign><button type="button" class="rv-btn" data-plan>Plan the campaign: fewest sites that cover every part</button></div>';
    } else {
      html += '<p>No Earth search cell passes for any part of this rover.</p>';
    }
    if (labOnly.length) {
      html += `<h3>Not testable in the field${res.zone ? ' here' : ''}</h3><ul class="rv-lab">${labOnly.map((p) => `<li><b>${esc(p.part.short)}</b>: ${esc(p.part.lab)}</li>`).join('')}</ul>`;
    }
    html += `<p class="small muted">${tally.field} field · ${tally.partial} with caveats · ${tally.lab} lab only${tally.nodata ? ` · ${tally.nodata} without data` : ''}.
      Margins and caps are our assumptions (data/rover.json).</p>`;
    return html;
  }

  function renderPart(p) {
    const st = STATUS[p.status];
    let html = `<h3 style="color:${st.color}">${st.icon} ${esc(p.part.name)} · ${st.label}</h3>
      <p class="rv-story">${esc(typeof p.part.story === 'string' ? p.part.story : p.part.story?.[state.result.bodyKey] ?? '')}</p>`;
    if (p.used.length && p.d) {
      const s = p.sites[0];
      html += `<table class="rv-table"><tr><th></th><th>target</th><th>margin</th><th>${s ? 'Earth #1' : ''}</th></tr>${p.used.map((u) => `<tr>
        <td>${esc(u.label)}</td><td>${fmtValue(u, u.target)}</td><td>± ${u.margin}</td><td>${s ? fmtValue(u, s.earth[u.name]) : ''}</td></tr>`).join('')}</table>`;
      html += p.n1
        ? `<p><b>${num(p.n1)}</b> Earth cells (~${num(Math.round(p.n1 * 36.1))} km²) have every value inside the margin.</p>`
        : p.n2 ? `<p>No Earth cell inside the margin; <b>${num(p.n2)}</b> inside twice the margin (close, not the same).</p>`
          : `<p>No search cell even inside twice the margin${state.result.zone ? ` in ${esc(state.result.zone.label)}: try the whole Earth` : ': Earth does not have this'}.</p>`;
    }
    const notes = [];
    if (p.cap) notes.push(esc(p.cap.why));
    for (const x of p.missing) notes.push(`Not compared: ${esc(x)} (no Earth data in the search table).`);
    for (const x of p.noTarget) notes.push(`No ${esc(x)} value for this cell, so it is not compared.`);
    if (notes.length) html += `<ul class="rv-notes">${notes.map((t) => `<li>${t}</li>`).join('')}</ul>`;
    if (p.sites.length) {
      for (const s of p.sites) s.color = partColor(s.d);
      html += `<h3>Where to test it</h3>${siteList(p.sites, (s) => (s.d < 0.05 ? 'same values as the target cell' : s.d <= 1 + EPS ? `inside the margin (${Math.round(100 * s.d)} % of it used)` : 'inside twice the margin'))}`;
    }
    if (p.status !== 'field') html += `<p class="small"><b>Lab complement:</b> ${esc(p.part.lab)}.</p>`;
    return html;
  }

  function render() {
    const res = state.result;
    const src = api.source();
    if (!res || !src) {
      const body = api.left()?.key;
      return renderMessage(`Click any point of ${NAME[body] ?? 'Mars or the Moon'} on the left globe (or search a site, e.g. Jezero or Shackleton) to send the rover there.`);
    }
    const idx = Math.round(res.index);
    const idxColor = idx >= 67 ? STATUS.field.color : idx >= 34 ? STATUS.partial.color : STATUS.lab.color;
    const fieldable = res.tally.field + res.tally.partial;
    const rows = res.parts.map((p) => `<li tabindex="0" data-part="${p.id}" class="${state.selected === p.id ? 'sel' : ''}">
      <i style="background:${STATUS[p.status].color}">${STATUS[p.status].icon}</i>
      <span><b>${esc(p.part.name)}</b><br><span class="muted">${esc(summaryOf(p))}</span></span></li>`).join('');
    panel.innerHTML = `${head(`${esc(state.config.model.name)}-class rover at <b>${esc(src.name ?? 'the selected cell')}</b> · ${esc(NAME[res.bodyKey])}${res.zone ? ` · Earth search inside ${esc(res.zone.label)}` : ''}`)}
      <div class="rv-head">
        <b style="background:${idxColor}">${Number.isFinite(res.index) ? idx : '–'}<small>%</small></b>
        <span><strong>${fieldable} of ${res.total} parts</strong> can be field-tested ${res.zone ? `inside ${esc(res.zone.label)}` : 'on Earth'}<br>
        <span class="muted">${res.zone ? 'testability index of this zone' : 'Earth testability index'} · ${res.tally.lab} part${res.tally.lab === 1 ? '' : 's'} ${res.zone ? 'not testable here' : 'only in a lab'}</span></span>
      </div>
      <ul class="rv-parts">
        <li tabindex="0" data-part="all" class="${state.selected === 'all' ? 'sel' : ''}"><i class="all">◎</i>
          <span><b>Whole rover</b><br><span class="muted">best single site: ${res.combo.maxCount} of ${res.combo.P} parts at once</span></span></li>
        ${rows}
      </ul>
      <div class="rv-detail">${state.selected === 'all' ? renderAll(res) : renderPart(part(state.selected))}</div>`;
  }

  // ---- Earth globe ------------------------------------------------------------------------------
  /** Card of a proposed site (the analog view's Earth card) + a calm flight above it. */
  function showSite(site, title, { height = 6e5, fly = true } = {}) {
    api.showEarthCell(site, { title, animate: false });
    if (fly) earth().flyTo(site.lat, site.lon, height, FLY_S);
  }

  async function paintEarth(fly) {
    const res = state.result;
    if (!res) return;
    const table = state.planner.m;
    let hexes = [];
    let ranks = [];
    let title = 'Whole rover · best site';
    if (state.selected === 'all') {
      const { combo } = res;
      hexes = combo.top.map((i) => ({ h3: table.h3(i), color: rampColor(combo.count[i] / combo.P) }));
      ranks = combo.sites.map((s, k) => ({ lat: s.lat, lon: s.lon, text: `#${k + 1} · ${s.count}/${combo.P} parts`, color: rampColor(s.count / combo.P), payload: s }));
    } else {
      const p = part(state.selected);
      if (p?.d) {
        hexes = p.top.map((i) => ({ h3: table.h3(i), color: partColor(p.d[i]) }));
        ranks = p.sites.map((s, k) => ({ lat: s.lat, lon: s.lon, text: `#${k + 1} · ${p.part.short}`, color: partColor(s.d), payload: s }));
        title = `${p.part.short} · best test site`;
      }
    }
    const g = earth();
    const ready = hexes.length ? g.showHexes(hexes) : g.clearHexes();
    if (ranks.length) g.setRanks(ranks); else g.clearRanks();
    if (!ranks.length) return api.clearEarthCell();
    if (fly) {
      showSite(ranks[0].payload, title, { height: 2.2e6, fly: !res.zone });
      if (res.zone) g.flyToZone(res.zone, FLY_S);
    }
    await ready; // the coloured cells are built in web workers
    return undefined;
  }

  async function select(id, { fly = true } = {}) {
    if (!state.result) return;
    state.selected = id === 'all' || part(id) ? id : 'all';
    render();
    paintRover();
    await paintEarth(fly);
  }

  async function showCampaign(holder) {
    holder.innerHTML = '<p class="small muted">Locating every Earth search cell (first time only)…</p>';
    await sleep(30);
    const res = state.result;
    const plan = state.planner.campaign(res);
    await nameSites(plan.map((s) => s.site));
    if (res !== state.result || !holder.isConnected) return;
    const covered = new Set(plan.flatMap((s) => s.covers));
    const green = STATUS.field.color;
    holder.innerHTML = `<h3>Campaign: ${plan.length} site${plan.length === 1 ? ' covers' : 's cover'} ${covered.size} of ${res.combo.P} testable parts</h3>
      <ol class="rv-ranks">${plan.map((s, k) => `<li tabindex="0" data-plan-site="${k}">
        ${badge(String.fromCharCode(65 + k), green)}
        <span><b>${esc(where(s.site))}</b><br><span class="muted">${s.covers.map(partName).map(esc).join(', ')}${k ? ` · ${num(Math.round(s.km / 10) * 10)} km from A` : ''}</span></span></li>`).join('')}</ol>`;
    earth().setRanks(plan.map((s, k) => ({ lat: s.site.lat, lon: s.site.lon, text: `${String.fromCharCode(65 + k)} · ${s.covers.map(partName).join(' + ')}`, color: green, payload: s.site })));
  }

  panel.addEventListener('click', (e) => {
    const t = e.target;
    const row = t.closest('[data-part]');
    if (row) return select(row.dataset.part);
    const res = state.result;
    if (!res) return undefined;
    if (t.closest('[data-plan]')) return showCampaign(t.closest('[data-campaign]'));
    const planSite = t.closest('[data-plan-site]');
    if (planSite) {
      const k = +planSite.dataset.planSite;
      return showSite(res.campaign[k].site, `Campaign site ${String.fromCharCode(65 + k)}`);
    }
    const li = t.closest('[data-site]');
    if (li) {
      const p = state.selected === 'all' ? null : part(state.selected);
      const k = +li.dataset.site;
      return showSite((p ? p.sites : res.combo.sites)[k], `${p ? p.part.short : 'Whole rover'} · test site #${k + 1}`);
    }
    return undefined;
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('li[tabindex]')) e.target.click();
  });

  // ---- public -----------------------------------------------------------------------------------
  /** Recompute the plan for the clicked cell (main.js calls it instead of the analog search). */
  async function update() {
    if (!active()) return null;
    const src = api.source();
    const request = ++state.request;
    if (!src || src.key === 'earth') {
      state.result = null;
      render();
      paintRover();
      return null;
    }
    renderMessage('Checking every Earth search cell for each part…');
    api.setStatus(isTableLoaded('earth') ? 'Checking where each part can be tested…' : 'Loading Earth…');
    try {
      const [table, meta] = await Promise.all([loadTable('earth', api.setStatus), loadScoringMeta(), ensureConfig()]);
      if (request !== state.request) return null;
      state.planner ??= new RoverPlanner(table, meta, state.config);
      const zone = api.zone();
      api.setStatus(zone && !table.lat ? 'Locating the cells of the zone (first zone search only)…' : 'Checking where each part can be tested…');
      await sleep(30); // let the panel paint before the heavy loops
      const res = state.planner.evaluate(src.values, src.key, zone);
      await nameSites([...res.combo.sites, ...res.parts.flatMap((p) => p.sites)]);
      if (request !== state.request) return null;
      state.result = res;
      api.setStatus('');
      await select(state.selected);
    } catch (err) {
      console.error(err);
      if (request === state.request) {
        api.setStatus('');
        renderMessage(`Could not build the plan: ${esc(err.message)}`);
      }
    }
    return null; // (main.js: nothing for the analog camera to fly to)
  }

  /** The selection was cleared (Esc, closed card, bodies changed): back to the empty plan. */
  function reset() {
    state.request++;
    state.result = null;
    if (!active()) return;
    // after the caller finishes (the left globe may be changing right now)
    Promise.resolve().then(() => {
      if (!active() || state.result) return;
      render();
      paintRover();
    });
  }

  async function setTab(tab) {
    tab = tab === 'rover' ? 'rover' : 'analogs';
    if (tab === state.tab) return;
    state.tab = tab;
    const on = active();
    document.body.classList.toggle('rover-tab', on);
    paintMenu();
    view.hidden = !on;
    panel.hidden = !on;
    try {
      history.replaceState(null, '', on ? '#rover' : location.pathname + location.search);
    } catch { /* file:// or sandboxed: the URL is only a convenience */ }
    if (on) {
      api.clearMatch(); // the analog results leave the screen; the clicked cell stays
      // the rover goes to Mars or the Moon and is tested on Earth
      const l = api.left().key;
      const r = api.right().key;
      if (r !== 'earth' || l === 'earth') api.setBodies(l !== 'earth' ? l : r !== 'earth' ? r : 'mars', 'earth');
      api.rebuildPlaces();
      ensureView().then(() => active() && state.view?.start());
      render();
      api.reframe();
      await update();
    } else {
      state.request++;
      state.result = null;
      state.view?.stop();
      api.setStatus('');
      const g = api.right();
      g.clearHexes();
      g.clearRanks();
      api.clearEarthCell();
      api.rebuildPlaces();
      api.runMatch(); // back to the analog map of the clicked cell, if there is one
    }
  }

  paintMenu();
  window.addEventListener('hashchange', () => setTab(location.hash === '#rover' ? 'rover' : 'analogs'));
  // #rover in the URL opens the rover view directly (once main.js has created the globes)
  if (location.hash === '#rover') setTimeout(() => setTab('rover'), 0);

  return {
    get active() {
      return active();
    },
    get tab() {
      return state.tab;
    },
    get result() {
      return state.result;
    },
    /** Panels that cover the globes (main.js keeps the selected hexagon out from under them). */
    panels: { left: [view], right: [panel] },
    /** Place-search entries offered in the current view (the rover is always tested on Earth). */
    allowsPlace: (e) => !active() || e.kind !== 'zone' || e.body === 'earth',
    setTab,
    update,
    reset,
    select,
  };
}
