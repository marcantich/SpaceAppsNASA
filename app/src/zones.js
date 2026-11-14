// Earth search zones: limit the analog search to one region (toolbar "Earth zone").
// A zone is a lat/lon box in degrees; west > east means it crosses the 180° meridian.
// Predefined boxes cover the regions where Mars / Moon analog fieldwork is usually done.
import { greatCircleDistance } from 'h3-js';

export const ZONES = [
  { key: 'sahara', label: 'Sahara', south: 15, north: 35, west: -17, east: 35 },
  { key: 'arabia', label: 'Arabian Peninsula', south: 12, north: 32, west: 34, east: 60 },
  { key: 'atacama', label: 'Atacama & Altiplano', south: -30, north: -15, west: -72, east: -65 },
  { key: 'sw_usa', label: 'SW USA (Mojave, Utah)', south: 31, north: 42, west: -120, east: -106 },
  { key: 'tibet', label: 'Tibetan Plateau', south: 27, north: 40, west: 73, east: 104 },
  { key: 'gobi', label: 'Gobi & Tarim', south: 36, north: 48, west: 73, east: 120 },
  { key: 'australia', label: 'Australian Outback', south: -32, north: -18, west: 115, east: 145 },
  { key: 'namib', label: 'Namib & Kalahari', south: -30, north: -17, west: 11, east: 25 },
  { key: 'iceland', label: 'Iceland', south: 63, north: 67, west: -25, east: -13 },
  { key: 'svalbard', label: 'Svalbard', south: 76, north: 81, west: 10, east: 34 },
  { key: 'arctic', label: 'Greenland & Canadian Arctic', south: 60, north: 84, west: -95, east: -10 },
  { key: 'dry_valleys', label: 'McMurdo Dry Valleys', south: -78.6, north: -76.4, west: 159, east: 165 },
  { key: 'antarctica', label: 'Antarctica', south: -90, north: -60, west: -180, east: 180 },
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
