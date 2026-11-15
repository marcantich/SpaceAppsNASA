import json, sys, numpy as np, matplotlib
matplotlib.use("Agg"); import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
sys.path.insert(0, ".")
from match_route import place
segs = json.load(open("segments.json"))["segments"]; res = json.load(open("results.json"))
picks = [("floor", "death_valley_ca"), ("landing", "craters_moon_id"), ("rim", "death_valley_ca")]
fig, ax = plt.subplots(3, 3, figsize=(17, 13), gridspec_kw={"width_ratios": [1, 1, 1.5]})
for i, (sn, tn) in enumerate(picks):
    seg = segs[sn]; b = next(r for r in res if r["segment"] == sn and r["tile"] == tn)
    dem = np.load(f"dem/{tn}.npz"); lat, lon, ze, row, col = place(seg, dem, b)
    s = np.array(seg["s"]) / 1e3; zm = np.array(seg["z"])
    a = ax[i, 0]; a.plot(seg["x"], seg["y"], "r-", lw=1.5); a.plot(seg["x"][0], seg["y"][0], "ko"); a.set_aspect("equal")
    a.set_title(f"Marte: tramo '{sn}' (km {seg['km'][0]:.0f}-{seg['km'][1]:.0f})"); a.set_xlabel("x [m]"); a.set_ylabel("y [m]")
    a = ax[i, 1]; m = 60; r0, r1 = int(row.min()) - m, int(row.max()) + m; c0, c1 = int(col.min()) - m, int(col.max()) + m
    r0, c0 = max(r0, 0), max(c0, 0); zc = dem["z"][r0:r1, c0:c1]
    a.imshow(LightSource(315, 35).hillshade(zc.astype(float), vert_exag=3, dx=10, dy=10), cmap="gray",
             extent=[c0 * 10, (c0 + zc.shape[1]) * 10, (r0 + zc.shape[0]) * 10, r0 * 10])
    a.plot(col * 10, row * 10, "r-", lw=1.5); a.plot(col[0] * 10, row[0] * 10, "ko")
    a.set_title(f"Tierra: {tn}  ({lat.mean():.4f}, {lon.mean():.4f})"); a.set_xlabel("x [m]"); a.set_ylabel("y [m]")
    a = ax[i, 2]; a.plot(s, zm - zm.mean(), "r-", lw=1.8, label="Marte (Perseverance)"); a.plot(s, ze - ze.mean(), "b-", lw=1.2, label="Tierra (USGS 3DEP)")
    sl = b["slopes"][1]
    a.set_title(f"Perfil: RMS dif. {b['E_full']:.2f} m (suelo plano: {b['E0_flat']:.1f} m) | pendientes a 90 m: r = {sl['r']:.2f}")
    a.set_xlabel("distancia recorrida s [km]"); a.set_ylabel("cota - media [m]"); a.grid(alpha=.3); a.legend()
plt.tight_layout(); plt.savefig("best_fits.png", dpi=70)
