// Toolbar place search and zone menu.
//
// Search box: type a name (Mars / Moon sites, known Earth analogs, Earth zones) or coordinates
// ("-24.1, -70", "24.1S 70W", "18.4° N 77.5° E") and pick a suggestion with the mouse or the
// arrow keys + Enter. Zone menu: limit the Earth analog search to a region or a drawn box.
import { ZONES_BY_BODY, zoneText } from './zones.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const BODY_NAME = { mars: 'Mars', moon: 'Moon', earth: 'Earth' };

/** "lat, lon" in decimal degrees with optional ° and N/S/E/W (O = oeste) → { lat, lon } or null. */
export function parseCoords(text) {
  const m = text.trim().replace(/°/g, ' ').match(
    /^([+-]?\d+(?:\.\d+)?)\s*([NS])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*([EWO])?$/i,
  );
  if (!m) return null;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /[wo]/i.test(m[4])) lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const fmt = ({ lat, lon }) =>
  `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;

/** How well `entry` matches the (normalised) query: -1 = no match; higher = better. */
function matchScore(entry, q) {
  let s = 0;
  for (const w of q.split(/\s+/).filter(Boolean)) {
    const i = entry.text.indexOf(w);
    if (i < 0) return -1;
    s += i === 0 ? 3 : /[^a-z0-9]/.test(entry.text[i - 1]) ? 2 : 1;
  }
  if (entry.key.startsWith(q)) s += 4;
  return s;
}

/**
 * entries(): [{ kind: 'site'|'analog'|'zone', body, label, sub, words?, data }]
 * onChoose({ kind, body, data }) — kind 'coords' gives data = { lat, lon }.
 * bodies(): the three bodies, in the order offered for typed coordinates (left pane first).
 */
export function createPlaceSearch(input, list, { entries, onChoose, bodies }) {
  let shown = [];
  let active = -1;
  let index = null;

  const build = () => {
    index = entries().map((e) => ({
      ...e,
      key: norm(e.label),
      text: norm(`${e.label} ${e.sub ?? ''} ${e.words ?? ''} ${BODY_NAME[e.body] ?? ''}`),
    }));
  };

  function suggestions(raw) {
    const q = norm(raw.trim());
    const out = [];
    const c = parseCoords(raw);
    if (c) {
      for (const body of bodies()) {
        out.push({ kind: 'coords', body, label: fmt(c), sub: `Go to this point on ${BODY_NAME[body]}`, data: c, group: 'Coordinates' });
      }
      return out;
    }
    if (!index) build();
    if (!q) {
      // nothing typed yet: the sites of the clicked body, then the zones of the search body
      const [body, search] = bodies();
      return [
        ...index.filter((e) => (e.kind === 'site' || e.kind === 'analog') && e.body === body).slice(0, 8),
        ...index.filter((e) => e.kind === 'zone' && e.body === search).slice(0, 7),
      ].map(withGroup);
    }
    return index
      .map((e) => ({ e, s: matchScore(e, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s || a.e.label.localeCompare(b.e.label))
      .slice(0, 12)
      .map(({ e }) => withGroup(e));
  }

  function withGroup(e) {
    const group = e.kind === 'zone' ? `${BODY_NAME[e.body]} · search zones`
      : e.kind === 'analog' ? 'Earth · known analogs' : `${BODY_NAME[e.body]} · sites`;
    return { ...e, group };
  }

  function render() {
    if (!shown.length) {
      list.innerHTML = `<li class="empty">No match. Try a name (Shackleton, Jezero, Atacama…) or coordinates like <b>-24.1, -70.0</b></li>`;
      list.hidden = false;
      return;
    }
    let group = null;
    list.innerHTML = shown.map((e, k) => {
      const head = e.group !== group ? `<li class="group" role="presentation">${esc((group = e.group))}</li>` : '';
      return `${head}<li role="option" data-k="${k}" class="opt${k === active ? ' active' : ''}" aria-selected="${k === active}">
          <span class="dot ${e.kind === 'zone' ? 'zone' : e.body}"></span>
          <span class="txt"><b>${esc(e.label)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span>
        </li>`;
    }).join('');
    list.hidden = false;
    list.querySelector('.opt.active')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    shown = suggestions(input.value);
    active = shown.length ? 0 : -1;
    render();
  }
  function close() {
    list.hidden = true;
    active = -1;
  }
  function choose(k) {
    const e = shown[k];
    if (!e) return;
    close();
    input.value = e.kind === 'coords' ? input.value : e.label;
    input.blur();
    onChoose(e);
  }

  input.addEventListener('input', open);
  input.addEventListener('focus', () => {
    input.select();
    open();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + d + shown.length) % shown.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // don't clear the whole selection
      close();
      input.blur();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-k]');
    if (!li) return;
    e.preventDefault(); // keep the focus until the choice is made
    choose(Number(li.dataset.k));
  });

  return { rebuild: build, close };
}

/**
 * Zone menu: button "Zone: Whole Earth ▾" + popover with the regions, "Other zones",
 * the last custom area and "Draw an area".
 * onSelect(zoneKey | null | 'custom'), onDraw()
 */
export function createZoneMenu(root, { onSelect, onDraw }) {
  const btn = root.querySelector('.zone-btn');
  const name = root.querySelector('.zone-name');
  const clear = root.querySelector('.zone-clear');
  const menu = root.querySelector('.menu');
  let current = null;
  let custom = null;
  let body = 'earth';
  const NAME = { earth: 'Earth', mars: 'Mars', moon: 'the Moon' };
  const whole = () => `Whole ${body === 'moon' ? 'Moon' : NAME[body]}`;

  const chip = (key, label, cls = '') =>
    `<button type="button" role="menuitemradio" aria-checked="${current === key}" class="chip ${cls}${current === key ? ' on' : ''}" data-zone="${key}">${esc(label)}</button>`;

  function render() {
    const zones = ZONES_BY_BODY[body] ?? [];
    const main = zones.filter((z) => !z.group);
    const other = zones.filter((z) => z.group === 'other');
    menu.innerHTML = `
      <p class="menu-title">Search analogs on ${esc(NAME[body])} in…</p>
      <div class="chips">${chip('', whole(), 'wide')}${main.map((z) => chip(z.key, z.label)).join('')}</div>
      ${other.length ? `<p class="menu-title">Other zones</p>
      <div class="chips">${other.map((z) => chip(z.key, z.label)).join('')}</div>` : ''}
      ${custom ? `<p class="menu-title">Your area</p><div class="chips">${chip('custom', zoneText(custom), 'wide')}</div>` : ''}
      <button type="button" class="draw" data-draw>▭ Draw an area on the ${esc(NAME[body])} globe</button>`;
  }

  function set(key, label) {
    current = key || null;
    name.textContent = label ?? whole();
    root.classList.toggle('filtered', !!current);
    clear.hidden = !current;
  }

  const toggle = (show = menu.hidden) => {
    if (show) render();
    menu.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
  };

  btn.addEventListener('click', () => toggle());
  clear.addEventListener('click', () => onSelect(null));
  menu.addEventListener('click', (e) => {
    if (e.target.closest('[data-draw]')) {
      toggle(false);
      return onDraw();
    }
    const b = e.target.closest('[data-zone]');
    if (!b) return;
    toggle(false);
    onSelect(b.dataset.zone || null);
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.hidden && !root.contains(e.target)) toggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      e.stopPropagation();
      toggle(false);
    }
  }, true);

  return {
    /** Show the active zone (key, label) or null = whole Earth. */
    set,
    setCustom(z) {
      custom = z;
    },
    /** Body whose zones are offered (the search body); forgets the custom area. */
    setBody(b) {
      body = b;
      custom = null;
      set(null);
    },
    drawing(on) {
      root.classList.toggle('drawing', on);
      if (on) name.textContent = 'drawing… (Esc cancels)';
    },
  };
}
