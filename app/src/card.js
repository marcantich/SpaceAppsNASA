// The card panel: shows the values of one H3 cell (ROADMAP 4.9).
import { formatLatLon } from './coords.js';
import { inkOn } from './match.js';

// Sections of the card and the columns they show (columns not in the grid are skipped)
const SECTIONS = [
  ['Terrain', ['elevation_m', 'slope_deg', 'roughness_deg', 'mola_measured_frac', 'lola_measured_frac',
    'rock_abundance_pct']],
  ['Climate & light', ['t_mean_K', 't_max_K', 't_min_K', 't_night_K', 'dust_aod', 'p_surf_Pa',
    'sun_elev_max_deg', 'psr_frac', 'precip_mm_year', 'snow_cover_pct']],
  ['Ice & composition', ['ice_depth_m', 'ice_frac_1m', 'grs_h2o_wt_pct', 'ns_epithermal_cps', 'grs_cl_wt_pct',
    'thermal_inertia_day_SI', 'feo_wt_pct', 'tio2_wt_pct', 'silica_wt_pct', 'th_ppm']],
  ['Subsurface', ['caves', 'pit_dist_km']],
  ['Search zone', ['env', 'land_frac']],   // Earth only
];

// Where each value's source comes from (docs/07, "Where the source of each value comes from"):
//   - index.json, per column: `source` (full text, tooltip) and `short_source` (tag on the card);
//   - if the source varies per cell, the column has `source_column` = a code column in the binary,
//     and that code column has `codes` = {code: tag}. E.g. ice_depth_m → ice_depth_source (1/2/3).
// Nothing about sources is hard-coded here.

export const SHORT = {
  elevation_m: 'Elevation',
  slope_deg: 'Slope',
  roughness_deg: 'Roughness',
  mola_measured_frac: 'Laser coverage (QC)',
  t_mean_K: 'Mean temperature',
  t_max_K: 'Max temperature',
  t_night_K: 'Night temperature',
  dust_aod: 'Dust (optical depth)',
  p_surf_Pa: 'Surface pressure',
  sun_elev_max_deg: 'Max Sun elevation',
  ice_depth_m: 'Water ice',
  grs_h2o_wt_pct: 'Hydrogen (as H₂O)',
  grs_cl_wt_pct: 'Chlorine',
  ns_epithermal_cps: 'Neutrons (low = more H)',
  thermal_inertia_day_SI: 'Thermal inertia',
  // Moon
  lola_measured_frac: 'Laser coverage (QC)',
  t_min_K: 'Min temperature',
  psr_frac: 'Permanent shadow',
  ice_frac_1m: 'Ice within 1 m (area)',
  feo_wt_pct: 'Iron (FeO)',
  tio2_wt_pct: 'Titanium (TiO₂)',
  silica_wt_pct: 'Silica (SiO₂)',
  th_ppm: 'Thorium',
  rock_abundance_pct: 'Rocks',
  caves: 'Cave entrance (pit)',
  pit_dist_km: 'Nearest known pit',
  // Earth
  precip_mm_year: 'Rainfall',
  snow_cover_pct: 'Snow cover',
  env: 'Zone',
  land_frac: 'Land in the cell',
};

const ICE_CLASSES = { 0.5: 'within 1 m', 3: '1–5 m deep', 5: 'deeper than 5 m', 10: 'none (top 5 m)' };

function decimals(scale) {
  return scale >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(scale)));
}

const tag = (text) => (text ? ` <span class="tag">${text}</span>` : '');

/** Short source of a column's value in this cell: per-cell code if any, else the fixed tag. */
function sourceOf(col, values, cols) {
  if (col.source_column) {
    const codeCol = cols[col.source_column];
    return codeCol?.codes?.[String(values[col.source_column])] ?? '';
  }
  return col.short_source ?? '';
}

/** { text, src }: the value and its short source (no source when there is no value). */
function formatValue(col, v, values, cols) {
  const text = valueText(col, v, values, cols);
  if (text.startsWith('<span class="nodata">')) return { text, src: '' };
  let src = sourceOf(col, values, cols);
  // "ice-rich" fallback for hydrogen: it comes from the ice value, so it takes the ice's source
  if (col.name === 'grs_h2o_wt_pct' && !Number.isFinite(v) && cols.ice_depth_m) {
    src = sourceOf(cols.ice_depth_m, values, cols);
  }
  return { text, src };
}

function valueText(col, v, values, cols) {
  const iceSrc = cols.ice_depth_m ? sourceOf(cols.ice_depth_m, values, cols) : '';
  const moon = Boolean(cols.psr_frac); // only the Moon grid has a permanent-shadow column
  // ice_depth_m is a CLASS on every body (0.5 / 3 / 5 / 10, same as Mars SWIM); the Moon and Earth also
  // carry the metres in ice_depth_cont_m, shown next to the class
  const iceMetres = Number.isFinite(values.ice_depth_cont_m) ? values.ice_depth_cont_m : NaN;
  if (moon) {
    const lat = Math.abs(values._lat);
    if (col.name === 'ice_depth_m') {
      if (!Number.isFinite(v)) return '<span class="nodata">no data (no product for 60–80° or the north pole)</span>';
      if (v >= 10) return iceSrc === 'assumed' ? 'none (not stable away from the poles)' : 'none within ~2.9 m';
      if (iceMetres === 0) return `${ICE_CLASSES[v]} · stable at the surface`;
      return Number.isFinite(iceMetres) ? `${ICE_CLASSES[v] ?? v} · ${iceMetres.toFixed(2)} m` : (ICE_CLASSES[v] ?? `${v} m`);
    }
    if (col.name === 'sun_elev_max_deg' && !Number.isFinite(v) && lat >= 80) {
      return '<span class="nodata">relief decides the light here: see permanent shadow</span>';
    }
    if ((col.name === 'psr_frac' || col.name === 'ice_frac_1m') && !Number.isFinite(v)) {
      return '<span class="nodata">only mapped at 80–90° S</span>';
    }
    if (col.name === 'rock_abundance_pct' && !Number.isFinite(v)) {
      return '<span class="nodata">not mapped beyond ±60°</span>';
    }
    if (col.name === 'psr_frac' || col.name === 'ice_frac_1m') return `${Math.round(v * 100)} % of the cell`;
    if (col.name === 'caves' && Number.isFinite(v)) return v >= 1 ? 'yes' : 'none known';
  }
  if (col.name === 'ice_depth_m') {
    if (!Number.isFinite(v)) {
      return iceSrc === 'neutrons' ? 'not detected in top ~1 m' : '<span class="nodata">no data</span>';
    }
    const cls = ICE_CLASSES[v] ?? `${v} m`;
    if (v >= 10 || !Number.isFinite(iceMetres)) return cls;
    return iceMetres === 0 ? `${cls} · at the surface` : `${cls} · ≈${iceMetres.toFixed(1)} m`;
  }
  if (col.name === 'env' && Number.isFinite(v)) return col.codes?.[String(Math.round(v))] ?? String(v);
  if (col.name === 'land_frac' && Number.isFinite(v)) return `${Math.round(v * 100)} %`;
  if (col.name === 'grs_h2o_wt_pct' && !Number.isFinite(v)) {
    // GRS element maps stop at ~±50°: say what the neutrons say instead of inventing a wt%
    if (values.ice_depth_m === 0.5 && iceSrc) return 'ice-rich';
    return '<span class="nodata">no wt% here (see neutrons)</span>';
  }
  if (!Number.isFinite(v) && Math.abs(values._lat) > 87) {
    if (col.name === 'slope_deg' || col.name === 'roughness_deg' || col.name === 'mola_measured_frac') {
      return '<span class="nodata">not measured (MGS never flew over |lat| &gt; 87°)</span>';
    }
    if (col.name === 'thermal_inertia_day_SI') return '<span class="nodata">not measured (TES coverage ends ~87°)</span>';
  }
  if (!Number.isFinite(v) && col.name === 'elevation_m' && Math.abs(values._lat) > 88) {
    return '<span class="nodata">polar map, other height reference (not shown)</span>';
  }
  if (!Number.isFinite(v)) return '<span class="nodata">no data</span>';
  if (col.name.endsWith('_measured_frac')) return `${Math.round(v * 100)} % measured`;
  const shown = col.short_unit ?? col.unit;   // short unit from index.json when the full one is long
  const unit = shown ? ` ${shown}` : '';
  return `${v.toFixed(decimals(col.scale))}${unit}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const ICE_SHORT = { 0.5: '≤ 1 m', 3: '1–5 m', 5: '> 5 m', 10: 'none' };
const fmt = (v, unit, name) => {
  if (!Number.isFinite(v)) return '—';
  if (name === 'ice_depth_m') return ICE_SHORT[v] ?? `${v} m`;
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${v.toFixed(d)}${unit && unit !== '°' ? ` ${unit}` : unit}`;
};

const ENV = ['outside the search zone', 'polar ice', 'desert', 'arid open land'];
const latLonShort = (lat, lon) =>
  `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;

/** "200 → 235 K": target → Earth, compact, unit once (strip). */
const UNIT_SHORT = { 'mm/year': 'mm', 'mm/yr': 'mm' };
function pair({ name, target, earth, unit }) {
  if (name === 'ice_depth_m') return `${fmt(target, '', name)}<i>→</i>${fmt(earth, '', name)}`;
  const num = (v) => {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    return v.toFixed(a >= 100 || a === 0 ? 0 : a >= 10 ? 1 : 2);
  };
  const u = UNIT_SHORT[unit] ?? unit ?? '';
  return `${num(target)}<i>→</i>${num(earth)}${u === '°' ? '°' : u ? ` ${u}` : ''}`;
}

/** Score badge with readable text on any ramp colour. */
const badge = (score, color, cls = 'score') =>
  `<b class="${cls}" style="background:${color};color:${inkOn(color)}">${Number.isFinite(score) ? score.toFixed(0) : '—'}</b>`;

/**
 * Horizontal comparison strip at the top of the Earth pane: the index, then one column per
 * dimension (Terrain, Thermal…) with its score and a mini bar per variable.
 * data = { index, cell, ring, body, color, colorOf, dims: [{ label, score, rows: [{ name, short, unit,
 *          target, earth, note }] }] }
 */
export function createCompareStrip(el, { onClose } = {}) {
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) onClose?.();
  });
  return {
    show({ index, cell, ring, body, color, colorOf, dims, place }) {
      const cols = dims.map((d) => `
        <div class="dim">
          <div class="dim-head">${badge(d.score, colorOf(d.score), 'mini')}<span>${esc(d.label)}</span></div>
          ${d.rows.map((r) => `
            <div class="dim-row" title="${esc(r.label)} · ${esc(body)} ${fmt(r.target, r.unit, r.name)} vs Earth ${fmt(r.earth, r.unit, r.name)} · note ${Number.isFinite(r.note) ? r.note.toFixed(2) : '—'}">
              <span class="dim-name">${esc(r.short)}</span>
              <span class="dim-vals">${pair(r)}</span>
              <span class="cmp-bar"><i style="width:${Number.isFinite(r.note) ? Math.round(r.note * 100) : 0}%"></i></span>
            </div>`).join('')}
        </div>`).join('');
      el.hidden = false;
      el.innerHTML = `
        <div class="strip-index">
          ${badge(index, color, 'big')}
          <div><b>Analog index</b><span class="muted">${esc(place ?? 'Earth cell')} vs the ${esc(body)} cell</span>
            ${Number.isFinite(ring) ? `<span class="muted small">cell ${cell.toFixed(0)} · 20 km around ${ring.toFixed(0)}</span>` : ''}</div>
        </div>
        <div class="dims">${cols}</div>
        <button class="strip-close" data-close aria-label="Close">×</button>`;
    },
    hide() {
      el.hidden = true;
      el.innerHTML = '';
    },
  };
}

/**
 * Earth-side panel with the ranked analogs of the selected target cell.
 * handlers.onPick(best) when a result is clicked; handlers.onClose().
 */
export function createMatchPanel(el, { onPick, onClose } = {}) {
  let current = [];
  let infoOpen = false;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return onClose?.();
    const li = e.target.closest('[data-rank]');
    if (li) onPick?.(current[Number(li.dataset.rank)]);
  });
  el.addEventListener('toggle', (e) => {
    if (e.target.matches('details')) infoOpen = e.target.open;
  }, true);
  return {
    loading(text) {
      el.hidden = false;
      el.innerHTML = `<header><h2>Best Earth analogs</h2><button data-close aria-label="Close">×</button></header>
        <p class="muted">${esc(text)}</p>`;
    },
    /** res = EarthMatcher.rank() (best[k].country filled by the caller) */
    show(res, { body, colorOf, testNote, validity, zoneLabel }) {
      current = res.best;
      const items = res.best.map((b, k) => `<li data-rank="${k}" tabindex="0">
            ${badge(b.score, colorOf(b.score))}
            <span class="rank-txt"><b>#${k + 1} · ${esc(b.country ?? 'Earth')}</b>
              <span class="muted small">${latLonShort(b.lat, b.lon)}</span></span>
            <span class="env">${ENV[b.env] ?? ''}</span>
          </li>`).join('');
      el.hidden = false;
      el.innerHTML = `<header><h2>Best Earth analogs</h2><button data-close aria-label="Close">×</button></header>
        <p class="where">${esc(body)} cell · ${esc(testNote)}</p>
        ${zoneLabel ? `<p class="zone-note">Only inside <b>${esc(zoneLabel)}</b></p>` : ''}
        <ol class="ranks">${items}</ol>
        <div class="legend"><span>${res.threshold.toFixed(0)}</span><i></i><span>100</span></div>
        <details class="more"${infoOpen ? ' open' : ''}><summary>How these are ranked</summary>
          <p class="muted small">Coloured hexagons: the ${res.top.length.toLocaleString()} best of
            ${res.n.toLocaleString()} Earth search cells${zoneLabel ? ' in this zone' : ''} (deserts, polar ice, arid land; ~6.5 km).
            The list ranks each cell together with its 6 neighbours (~20 km), so homogeneous areas come
            first; results are ≥ ${Math.round(res.minKm)} km apart.</p>
          ${validity ? `<p class="muted small"><b>Validity:</b> ${esc(validity)}</p>` : ''}
        </details>`;
    },
    hide() {
      el.hidden = true;
      el.innerHTML = '';
      current = [];
    },
  };
}

// Always-visible key values of a card; the rest goes under "More info"
const SUMMARY = ['elevation_m', 'slope_deg', 't_mean_K', 'ice_depth_m'];

export function createCardPanel(el, { onClose } = {}) {
  let moreOpen = false; // remembered between cards of this panel
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) onClose?.();
  });
  el.addEventListener('toggle', (e) => {
    if (e.target.matches('details.more')) moreOpen = e.target.open;
  }, true);

  const head = (title, sub) => `<header><div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</div>
    <button data-close aria-label="Close">×</button></header>`;

  return {
    loading(title, lat, lon, sub) {
      el.hidden = false;
      el.innerHTML = `${head(title, sub)}<p class="where">${formatLatLon({ lat, lon })}</p><p class="muted">Loading…</p>`;
    },
    message(title, text) {
      el.hidden = false;
      el.innerHTML = `${head(title)}<p class="muted">${esc(text)}</p>`;
    },
    /**
     * card = CardGrid.cardAt() result.
     * opts.subtitle = second line under the title (site type, country…)
     * opts.footer   = text at the bottom of "More info"
     */
    show(title, lat, lon, card, opts = {}) {
      const cols = Object.fromEntries(card.columns.map((c) => [c.name, c]));
      const values = { ...card.values, _lat: lat };
      const row = (k) => {
        const col = cols[k];
        const { text, src } = formatValue(col, values[k], values, cols);
        return `<dt title="${esc(col.label)}">${SHORT[k] ?? esc(col.label)}</dt>
                <dd title="${esc(col.unit ? `Unit: ${col.unit} · ` : '')}Source: ${esc(col.source)}">${text}</dd>
                <dd class="src" title="Source: ${esc(col.source)}">${src ? tag(src) : ''}</dd>`;
      };
      const summary = SUMMARY.filter((k) => cols[k]).map(row).join('');
      const sections = SECTIONS.map(([name, keys]) => {
        const rows = keys.filter((k) => cols[k]).map(row).join('');
        return rows ? `<section><h3>${name}</h3><dl>${rows}</dl></section>` : '';
      }).join('');
      el.hidden = false;
      el.innerHTML = `${head(title, opts.subtitle)}
        <p class="where">${formatLatLon({ lat, lon })} · ~${card.cellSizeKm ?? 9} km cell</p>
        <dl class="summary">${summary}</dl>
        <details class="more"${moreOpen ? ' open' : ''}><summary>More info</summary>
          ${sections}
          <footer>${opts.footer ?? 'Hover a value to see its source.'}</footer>
        </details>`;
    },
    hide() {
      el.hidden = true;
      el.innerHTML = '';
    },
  };
}
