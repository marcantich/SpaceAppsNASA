// Analog index (same formula as src/analogs/similarity.py; settings in data/tierra/match.json,
// written from configs/variables.yaml + configs/pruebas.yaml by scripts/export_scoring.py):
//
//   note_v      = 1 / (1 + (|target − earth| / half_diff)²)     soft: 0.5 at half_diff, never 0
//                 matrix[target][earth]                          classes (water ice)
//   dimension_d = Σ w_v · note_v / Σ w_v                         over its variables present on both sides
//   index       = 100 · Σ W_d · dimension_d / Σ W_d              W_d = largest weight of its variables
//                 (a dimension with no data at all in that cell counts 0: unmeasured is not rewarded)
//   Compared: only the variables with data on the clicked cell and on the search body (a test with
//   5 of its 7 variables available uses those 5; with none, all available variables). Zero by nature (no rain on Mars / Moon, no dust on the Moon) counts as 0
//   in both directions, so A → B and B → A give the same index.
//   ranking     = (1 − area_weight) · index + area_weight · mean index of the 6 neighbour cells

const key = (v) => String(Number(v)); // 0.5 → "0.5", 3 → "3" (same keys as the Python export)

/**
 * Variables that are zero by nature on a body (meta.zero_on_target: no rain on Mars or the Moon, no
 * dust on the airless Moon): 0 there even when the card has no such column, so they count the same
 * in both directions (Mars → Earth and Earth → Mars give the same index for the same pair).
 */
export const isZeroOn = (meta, body, name) => !!meta.zero_on_target?.[name]?.includes(body);

/** Value of `name` from a card's values, with the zero-by-nature rule for `body`. */
export function valueOn(meta, body, values, name) {
  const v = values[name];
  return Number.isFinite(v) ? v : isZeroOn(meta, body, name) ? 0 : NaN;
}

/** Note 0–1 of one variable (NaN when the Earth value is missing). */
export function noteOf(spec, target, earth) {
  if (!Number.isFinite(earth) || !Number.isFinite(target)) return NaN;
  if (spec.matrix) {
    const v = spec.matrix[key(target)]?.[key(earth)];
    return v ?? (key(target) === key(earth) ? 1 : 0);
  }
  const d = Math.abs(target - earth);
  if (spec.half_diff) {
    const x = d / spec.half_diff;
    return 1 / (1 + x * x);
  }
  return Math.max(0, 1 - d / spec.tolerance);
}

/**
 * What is compared for this target card and how much each part weighs.
 * meta = match.json; has(name) = the Earth table has that column.
 * Returns { target, weights, dims: { d: { weight, label, vars: { name: w } } }, note }.
 */
export function makePlan(meta, targetValues, bodyKey, prueba, has) {
  const { variables, pruebas, dimensions = {} } = meta;
  const target = {};
  for (const name of Object.keys(variables)) {
    const v = valueOn(meta, bodyKey, targetValues, name); // no rain on Mars / Moon, no dust on the Moon
    if (Number.isFinite(v) && has(name)) target[name] = v;
  }
  let weights = Object.fromEntries(Object.keys(target).map((k) => [k, 1]));
  let note = 'all shared variables · each dimension weighs the same';
  let missing = [];
  if (prueba && pruebas[prueba]) {
    // The test compares the variables that have data (on this cell and on the search body): 5 of 7
    // available → those 5, and the note says so. If none of them has data here, all the available
    // variables are compared instead (said in the note), so a search always gives an answer.
    const wanted = Object.entries(pruebas[prueba].weights).filter(([, x]) => x > 0);
    const have = Object.fromEntries(wanted.filter(([k]) => k in target));
    missing = wanted.filter(([k]) => !(k in target))
      .map(([k]) => (meta.labels?.[k] ?? variables[k]?.label ?? k).replace(/\s*\(.*\)$/, '').toLowerCase());
    const n = Object.keys(have).length;
    note = pruebas[prueba].label;
    if (n) {
      weights = have;
      if (missing.length) note += ` · ${n} of ${wanted.length} variables (no data: ${missing.join(', ')})`;
    } else {
      note += ` · no data for its variables here (${missing.join(', ')}): all available variables compared`;
    }
  }
  const dims = {};
  for (const [name, w] of Object.entries(weights)) {
    const d = variables[name].dimension ?? name;
    dims[d] ??= { weight: 0, label: dimensions[d]?.label ?? d, vars: {} };
    dims[d].vars[name] = w;
    dims[d].weight = Math.max(dims[d].weight, w);
  }
  return { target, weights, dims, note, missing };
}

/**
 * Index of one Earth cell. value(name) → Earth value (NaN if missing).
 * Returns { index, dims: { d: score 0–100 | NaN }, notes: { name: note } }.
 */
export function scoreCell(meta, plan, value) {
  const notes = {};
  const dims = {};
  let num = 0;
  let den = 0;
  for (const [d, { weight, vars }] of Object.entries(plan.dims)) {
    let dn = 0;
    let dd = 0;
    for (const [name, w] of Object.entries(vars)) {
      const n = noteOf(meta.variables[name], plan.target[name], value(name));
      notes[name] = n;
      if (Number.isFinite(n)) {
        dn += w * n;
        dd += w;
      }
    }
    dims[d] = dd ? (100 * dn) / dd : NaN;
    if (dd) num += (weight * dn) / dd;
    den += weight; // a dimension with no data at all counts 0
  }
  const any = Object.values(dims).some(Number.isFinite);
  return { index: any && den ? (100 * num) / den : NaN, dims, notes };
}

/** Ranking index from the cell's own index and the mean of its neighbours (missing → 0). */
export function areaIndex(meta, cell, neighbourMean) {
  const a = meta.area_weight ?? 0;
  if (!Number.isFinite(cell)) return NaN;
  return Number.isFinite(neighbourMean) ? (1 - a) * cell + a * neighbourMean : cell;
}
