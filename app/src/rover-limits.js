// Explain the classification without exposing grid-cell counts in the planner UI.
export function limitingFactor(p) {
  if (p.cap?.max === 'lab' || (p.cap?.max === 'partial' && p.status === 'partial')) {
    return { label: p.cap.factor ?? 'Physical conditions', why: p.cap.why };
  }
  if (p.status === 'nodata') {
    return { label: 'Insufficient data', why: 'No shared variables are available to assess this subsystem.' };
  }
  if (p.status === 'partial' && (p.missing.length || p.noTarget.length)) {
    return {
      label: 'Missing data',
      why: [...p.missing.map((x) => `${x}: no Earth data`), ...p.noTarget.map((x) => `${x}: no target value`)].join('; '),
    };
  }
  const candidates = p.used.flatMap((u) => {
    const earth = p.closest?.earth[u.name];
    if (!Number.isFinite(earth) || !(u.margin > 0)) return [];
    return [{ variable: u, earth, ratio: Math.abs(earth - u.target) / u.margin }];
  }).sort((a, b) => b.ratio - a.ratio);
  const worst = candidates[0];
  if (!worst) return { label: 'Insufficient data', why: 'No fully comparable terrain was found in the search area.' };
  if (worst.ratio < 1e-4) return { label: 'No measured mismatch', why: 'All compared variables match at the closest terrain; unmeasured conditions still apply.' };
  return { label: worst.variable.label, ...worst };
}
