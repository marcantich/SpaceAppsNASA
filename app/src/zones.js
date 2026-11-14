// Earth search zones: limit the analog search to one region (toolbar "Zone").
// A zone is a lat/lon box in degrees; west > east means it crosses the 180° meridian.
// Broad, easy-to-name regions; `group: 'other'` ones go under "Other zones" in the menu.
// `words` = extra search terms for the place search box.
import { greatCircleDistance } from 'h3-js';

export const ZONES = [
  { key: 'usa', label: 'USA', south: 24.5, north: 49.5, west: -125, east: -66,
    words: 'united states america mojave utah nevada arizona death valley' },
  { key: 'south_america', label: 'South America', south: -56, north: 13, west: -82, east: -34,
    words: 'andes atacama altiplano chile peru bolivia argentina patagonia' },
  { key: 'north_africa', label: 'North Africa', south: 10, north: 38, west: -18, east: 40,
    words: 'sahara morocco algeria libya egypt mali niger chad' },
  { key: 'australia', label: 'Australia', south: -44, north: -10, west: 112, east: 154,
    words: 'outback pilbara' },
  { key: 'mongolia', label: 'Mongolia & China', south: 25, north: 53, west: 73, east: 125,
    words: 'gobi tarim taklamakan tibet himalaya qaidam' },
  { key: 'arctic', label: 'Arctic', south: 60, north: 90, west: -180, east: 180,
    words: 'greenland svalbard canada devon alaska siberia north pole' },
  { key: 'antarctica', label: 'Antarctica', south: -90, north: -60, west: -180, east: 180,
    words: 'south pole mcmurdo dry valleys' },
  { key: 'middle_east', label: 'Middle East', group: 'other', south: 12, north: 42, west: 34, east: 63,
    words: 'arabia saudi iran oman' },
  { key: 'central_asia', label: 'Central Asia', group: 'other', south: 35, north: 55, west: 46, east: 80,
    words: 'kazakhstan uzbekistan turkmenistan' },
  { key: 'south_asia', label: 'South Asia', group: 'other', south: 20, north: 37, west: 60, east: 80,
    words: 'thar india pakistan ladakh' },
  { key: 'southern_africa', label: 'Southern Africa', group: 'other', south: -35, north: -15, west: 10, east: 36,
    words: 'namib kalahari namibia botswana' },
  { key: 'iceland', label: 'Iceland', group: 'other', south: 63, north: 67, west: -25, east: -13,
    words: 'askja' },
];

/** Normalise a box: clamp latitudes, order south/north, longitudes in [-180, 180]. */
export function makeZone({ key = 'custom', label = 'Custom area', south, north, west, east }) {
  const wrap = (x) => (x > 180 ? x - 360 : x < -180 ? x + 360 : x);
  const s = Math.max(-90, Math.min(south, north));
  const n = Math.min(90, Math.max(south, north));
  const full = Math.abs(east - west) >= 359.9;
  return { key, label, south: s, north: n, west: full ? -180 : wrap(west), east: full ? 180 : wrap(east) };
}

/** Does the zone contain lat/lon (degrees)? */
export function zoneContains(z, lat, lon) {
  if (lat < z.south || lat > z.north) return false;
  return z.west <= z.east ? lon >= z.west && lon <= z.east : lon >= z.west || lon <= z.east;
}

/** Longitude span in degrees (handles the 180° crossing). */
export function lonSpan(z) {
  const d = z.east - z.west;
  return d >= 0 ? d : d + 360;
}

/** Rough size of the zone in km (diagonal), to space the ranked results inside it. */
export function zoneSizeKm(z) {
  const midLon = z.west + lonSpan(z) / 2;
  const ns = greatCircleDistance([z.south, midLon], [z.north, midLon], 'km');
  // widest parallel of the box: the equator if it crosses it, else the edge nearest to it
  const midLat = z.south <= 0 && z.north >= 0 ? 0 : Math.abs(z.south) < Math.abs(z.north) ? z.south : z.north;
  const ew = Math.min(20000, greatCircleDistance([midLat, z.west], [midLat, z.west + lonSpan(z) / 2], 'km') * 2);
  return Math.hypot(ns, ew);
}

export function zoneText(z) {
  const f = (v, p, m) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? p : m}`;
  return `${f(z.south, 'N', 'S')}–${f(z.north, 'N', 'S')}, ${f(z.west, 'E', 'W')}–${f(z.east, 'E', 'W')}`;
}
