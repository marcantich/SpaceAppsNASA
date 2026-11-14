// Country of an Earth point, in the browser: Natural Earth 1:50m admin-0 boundaries (public domain,
// npm package world-atlas, de facto borders), loaded once (~750 kB, ~0.2 MB gzipped) on first use.
// Points at sea or on the coast take the nearest country within ~30 km.
import { geoBounds, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import url from 'world-atlas/countries-50m.json?url';

// Shorter or clearer names than the Natural Earth abbreviations
const RENAME = {
  'United States of America': 'USA',
  'Dem. Rep. Congo': 'DR Congo',
  'Central African Rep.': 'Central African Republic',
  'W. Sahara': 'Western Sahara',
  'S. Sudan': 'South Sudan',
  'Eq. Guinea': 'Equatorial Guinea',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Dominican Rep.': 'Dominican Republic',
  'Solomon Is.': 'Solomon Islands',
  'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern Lands',
  'Heard I. and McDonald Is.': 'Heard Island (Australia)',
  'S. Geo. and the Is.': 'South Georgia',
  Greenland: 'Greenland (Denmark)',
  Antarctica: 'Antarctica',
};

let loading = null;

function load() {
  loading ??= fetch(url)
    .then((r) => r.json())
    .then((topo) => feature(topo, topo.objects.countries).features.map((f) => {
      const [[w, s], [e, n]] = geoBounds(f);
      return { f, name: RENAME[f.properties.name] ?? f.properties.name, w, s, e, n };
    }));
  return loading;
}

function inside(list, lat, lon) {
  for (const c of list) {
    if (lat < c.s - 0.01 || lat > c.n + 0.01) continue;
    const inLon = c.w <= c.e ? lon >= c.w - 0.01 && lon <= c.e + 0.01 : lon >= c.w || lon <= c.e;
    if (inLon && geoContains(c.f, [lon, lat])) return c.name;
  }
  return null;
}

/** Country name at lat/lon (degrees), the nearest one within ~30 km at the coast, or null at sea. */
export async function countryAt(lat, lon) {
  const list = await load();
  const hit = inside(list, lat, lon);
  if (hit) return hit;
  // coast: look around on two small rings (≈ 10 and 30 km)
  for (const km of [10, 30]) {
    const dLat = km / 111;
    const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const name = inside(list, Math.max(-90, Math.min(90, lat + dLat * Math.sin(a))), lon + dLon * Math.cos(a));
      if (name) return name;
    }
  }
  return null;
}

/** Start downloading the boundaries without waiting (call when idle). */
export function preloadCountries() {
  load().catch(() => {});
}
