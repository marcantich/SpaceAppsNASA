// Route replica solver (pure functions, no DOM: used by route.js, testable from node).
//
// Problem: a route on Mars / the Moon is a list of slopes, one per step of length L (what the rover
// feels). Find a path on an Earth elevation grid whose slopes follow the same list.
//
// Method: dynamic programming over (cell, heading). The Earth path advances one step of ~L in one of
// 16 headings, may turn at most one heading (22.5°) per step, and pays |slope_Earth − slope_target|
// for that step. The grid pixel is L / 3, so a step is 3 px long (2.83–3.16 px depending on heading).
// Same algorithm as scripts/rover_route/free_route.py (checked against it).

// (d_row, d_col), counter-clockwise from east; rows grow to the south
export const HEADINGS = [
  [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3],
  [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
];
const NH = HEADINGS.length;
const INF = 1e9;

/**
 * @param z        Float32Array(H * W) elevations in metres, row 0 = north; NaN = not allowed (water…)
 * @param px       grid pixel in metres (= step length / 3)
 * @param targets  Float32Array(N): tan(slope) wanted at each step
 * @param maxTan   Earth steps steeper than this are not allowed (rover limit), or Infinity
 * @param onProgress  optional fn(fraction); the solver yields to the browser between steps
 * @returns { cost (mean |Δ tan slope|), rows, cols } (N + 1 points) or null if no path fits
 */
export async function solveRoute({ z, W, H, px, targets, maxTan = Infinity, onProgress = null }) {
  const N = targets.length;
  const cells = W * H;
  // slope of a step that starts at each cell, per heading
  const S = new Float32Array(NH * cells).fill(INF);
  const shift = new Int32Array(NH);
  const bounds = HEADINGS.map(([dy, dx], h) => {
    shift[h] = dy * W + dx;
    return { y0: Math.max(0, -dy), y1: H - Math.max(0, dy), x0: Math.max(0, -dx), x1: W - Math.max(0, dx) };
  });
  for (let h = 0; h < NH; h++) {
    const { y0, y1, x0, x1 } = bounds[h];
    const len = Math.hypot(HEADINGS[h][0], HEADINGS[h][1]) * px;
    const base = h * cells;
    for (let y = y0; y < y1; y++) {
      for (let c = y * W + x0, end = y * W + x1; c < end; c++) {
        const s = (z[c + shift[h]] - z[c]) / len; // NaN if either end is not allowed
        if (Math.abs(s) <= maxTan) S[base + c] = s;
      }
    }
  }

  // backward pass; choice[k * cells + c] keeps, 2 bits per heading, the turn taken after step k
  let V = new Float32Array(NH * cells);
  let Vn = new Float32Array(NH * cells);
  const choice = new Uint32Array(N * cells);
  let last = performance.now();
  for (let k = N - 1; k >= 0; k--) {
    const t = targets[k];
    const ck = k * cells;
    Vn.fill(INF);
    for (let h = 0; h < NH; h++) {
      const { y0, y1, x0, x1 } = bounds[h];
      const base = h * cells;
      const bm = ((h + NH - 1) % NH) * cells + shift[h];
      const b0 = base + shift[h];
      const bp = ((h + 1) % NH) * cells + shift[h];
      const bit = 2 * h;
      for (let y = y0; y < y1; y++) {
        for (let c = y * W + x0, end = y * W + x1; c < end; c++) {
          const s = S[base + c];
          if (s >= INF) continue;
          let m = V[b0 + c];
          let ch = 1;
          const a = V[bm + c];
          if (a < m) { m = a; ch = 0; }
          const b = V[bp + c];
          if (b < m) { m = b; ch = 2; }
          if (m >= INF) continue;
          Vn[base + c] = Math.abs(s - t) + m;
          choice[ck + c] |= ch << bit;
        }
      }
    }
    [V, Vn] = [Vn, V];
    if (performance.now() - last > 60) {
      onProgress?.((N - k) / N);
      await new Promise((r) => setTimeout(r));
      last = performance.now();
    }
  }

  let best = INF;
  let arg = -1;
  for (let i = 0; i < NH * cells; i++) if (V[i] < best) { best = V[i]; arg = i; }
  if (arg < 0) return null;
  let h = Math.floor(arg / cells);
  let c = arg - h * cells;
  const rows = new Int32Array(N + 1);
  const cols = new Int32Array(N + 1);
  rows[0] = Math.floor(c / W);
  cols[0] = c % W;
  for (let k = 0; k < N; k++) {
    const turn = ((choice[k * cells + c] >>> (2 * h)) & 3) - 1;
    c += shift[h];
    rows[k + 1] = Math.floor(c / W);
    cols[k + 1] = c % W;
    h = (h + turn + NH) % NH;
  }
  return { cost: best / N, rows, cols };
}

/** Compare the two profiles step by step. zm, ze: elevations (N + 1); lens: Earth step lengths (N). */
export function compareProfiles(zm, L, ze, lens, tolDeg) {
  const N = zm.length - 1;
  const deg = (t) => (Math.atan(t) * 180) / Math.PI;
  const sm = new Float32Array(N);
  const se = new Float32Array(N);
  let err = 0, flat = 0, within = 0, max = 0, a = 0, b = 0;
  for (let k = 0; k < N; k++) {
    sm[k] = deg((zm[k + 1] - zm[k]) / L);
    se[k] = deg((ze[k + 1] - ze[k]) / lens[k]);
    const e = Math.abs(se[k] - sm[k]);
    err += e;
    flat += Math.abs(sm[k]);
    if (e <= tolDeg) within++;
    if (e > max) max = e;
    a += sm[k];
    b += se[k];
  }
  a /= N; b /= N;
  let sab = 0, saa = 0, sbb = 0;
  for (let k = 0; k < N; k++) {
    sab += (sm[k] - a) * (se[k] - b);
    saa += (sm[k] - a) ** 2;
    sbb += (se[k] - b) ** 2;
  }
  return {
    slopeMars: sm, slopeEarth: se,
    meanErr: err / N, flatErr: flat / N, within: within / N, maxErr: max,
    r: saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : NaN,
  };
}
