// Pixel-level slope of Mars (ROADMAP 5.6): "data tiles" read on click, on top of the ~9 km card.
// Tiles made by scripts/export_mars_slope_tiles.py (format: src/analogs/mars_slope_tiles.py):
//   data/marte/slope64/index.json + t{row}_{col}.bin.gz, 10° × 10° at 64 px/deg (~925 m),
//   one byte per pixel: bits 0–6 = slope / 0.5° (127 = no data), bit 7 = measured by the laser.
// Only the tile under the click is downloaded (~100–250 KB) and kept in memory.

const BASE = `${import.meta.env?.BASE_URL ?? '/'}data/marte/slope64/`;
let indexPromise = null;
const tiles = new Map(); // "row_col" → Promise<Uint8Array | null>

async function gunzip(buffer) {
  const u8 = new Uint8Array(buffer);
  // some servers (Vite dev) send .gz with Content-Encoding: gzip, so the browser already inflated it
  if (!(u8[0] === 0x1f && u8[1] === 0x8b)) return u8;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function index() {
  indexPromise ??= fetch(`${BASE}index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return indexPromise;
}

function tile(row, col) {
  const key = `${row}_${col}`;
  if (!tiles.has(key)) {
    const name = `t${String(row).padStart(2, '0')}_${String(col).padStart(2, '0')}.bin.gz`;
    tiles.set(key, fetch(BASE + name)
      .then((r) => (r.ok ? r.arrayBuffer().then(gunzip) : null))   // 404 = no data (poles)
      .catch(() => null));
  }
  return tiles.get(key);
}

/**
 * Slope of Mars at lat/lon (planetocentric, east −180…180) from the ~0.9 km pixel under the point.
 * Returns { slope (deg), measured (bool), km, source } or null when there is no data.
 */
export async function slopeAt(lat, lon) {
  const idx = await index();
  if (!idx) return null;
  const { ppd, tile_deg: td, tile_px: n, step_deg: step, nodata } = idx;
  const lo = ((((lon + 180) % 360) + 360) % 360) - 180;
  const row = Math.min(180 / td - 1, Math.floor((90 - lat) / td));
  const col = Math.min(360 / td - 1, Math.floor((lo + 180) / td));
  const data = await tile(row, col);
  if (!data) return null;
  const r = Math.min(n - 1, Math.floor((90 - row * td - lat) * ppd));
  const c = Math.min(n - 1, Math.floor((lo - (col * td - 180)) * ppd));
  const b = data[r * n + c];
  if ((b & 0x7f) === nodata) return null;
  return { slope: (b & 0x7f) * step, measured: (b & 0x80) !== 0, km: (Math.PI * 3389.5 / 180 / ppd).toFixed(1), source: idx.source };
}
