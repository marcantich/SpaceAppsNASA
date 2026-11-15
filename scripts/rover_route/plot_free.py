import json, numpy as np, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
res = json.load(open("free_results.json")); picks = [("floor", "death_valley_ca"), ("rim", "craters_moon_id")]
fig, ax = plt.subplots(2, 3, figsize=(18, 9.5), gridspec_kw={"width_ratios": [1, 1.4, 1.4]})
for i, (sn, tn) in enumerate(picks):
    b = next(r for r in res if r["segment"] == sn and r["tile"] == tn); z = np.load(f"dem/{tn}.npz")["z"]
    row, col = np.array(b["row"]), np.array(b["col"]); ze, zm = np.array(b["z"]), np.array(b["z_mars"]); s = np.arange(len(zm)) * 0.03
    m = 60; r0, r1 = max(row.min() - m, 0), row.max() + m; c0, c1 = max(col.min() - m, 0), col.max() + m; zc = z[r0:r1, c0:c1]
    a = ax[i, 0]; a.imshow(LightSource(315, 35).hillshade(zc.astype(float), vert_exag=3, dx=10, dy=10), cmap="gray",
                           extent=[c0 * 10, (c0 + zc.shape[1]) * 10, (r0 + zc.shape[0]) * 10, r0 * 10])
    a.plot(col * 10, row * 10, "r-", lw=1.5); a.plot(col[0] * 10, row[0] * 10, "ko")
    a.set_title(f"Earth: {tn} ({np.mean(b['lat']):.4f}, {np.mean(b['lon']):.4f})"); a.set_xlabel("x [m]"); a.set_ylabel("y [m]")
    a = ax[i, 1]; a.plot(s, zm - zm[0], "r-", lw=1.8, label="Mars (Perseverance)"); a.plot(s, ze - ze[0], "b-", lw=1.2, label="Earth (free path)")
    a.set_title(f"Stretch '{sn}': elevation profile"); a.set_xlabel("distance travelled s [km]"); a.set_ylabel("elevation from the start [m]"); a.grid(alpha=.3); a.legend()
    d = np.hypot(np.diff(row), np.diff(col)) * 10
    a = ax[i, 2]; a.plot(s[1:], np.degrees(np.arctan(np.diff(zm) / 30)), "r-", lw=1.5, label="Mars"); a.plot(s[1:], np.degrees(np.arctan(np.diff(ze) / d)), "b-", lw=1, label="Earth")
    a.set_title(f"Slope per 30 m step: mean error {b['J']:.2f} deg, r = {b['r']:.2f}, {100*b['within_2deg']:.0f} % within 2 deg")
    a.set_xlabel("distance travelled s [km]"); a.set_ylabel("slope [deg]"); a.grid(alpha=.3); a.legend()
plt.tight_layout(); plt.savefig("free_fits.png", dpi=70)
