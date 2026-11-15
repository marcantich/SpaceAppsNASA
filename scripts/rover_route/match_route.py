"""Encaja un tramo de la ruta marciana (plantilla rigida: traslacion + giro + espejo) sobre teselas de relieve.
Coste E = RMS de [z_Tierra(s) - z_Marte(s)] quitando la media (m). Referencia: suelo plano -> E0 = std(z_Marte).
Busqueda gruesa (50 m, 10 grados) y afinado local (10 m, 1 grado).
uso: python match_route.py segments.json resultados.json dem/*.npz"""
import json, sys, glob, os, numpy as np
from scipy.ndimage import map_coordinates
R_EARTH = 6371008.8
PT_STEP = 30.0   # m entre puntos de la plantilla

def offsets(x, y, phi, mirror, px):
    c, s = np.cos(np.radians(phi)), np.sin(np.radians(phi))
    xr = c * (mirror * x) - s * y; yr = s * (mirror * x) + c * y
    return np.round(xr / px).astype(int), np.round(-yr / px).astype(int)   # fila crece hacia el sur

def scan(z, px, x, y, zm, phis, mirrors, stride, sample=None):
    """Devuelve el mejor (E, phi, mirror, row, col) y, si sample, una muestra de E de todas las posiciones."""
    H, W = z.shape; n = len(x); best = (np.inf,); dist = []
    for mirror in mirrors:
        for phi in phis:
            ix, iy = offsets(x, y, phi, mirror, px)
            x0, x1 = -ix.min(), W - ix.max(); y0, y1 = -iy.min(), H - iy.max()
            if x1 - x0 < 1 or y1 - y0 < 1:
                continue
            s1 = 0.0; s2 = 0.0
            for k in range(n):
                d = z[y0 + iy[k]:y1 + iy[k]:stride, x0 + ix[k]:x1 + ix[k]:stride] - zm[k]
                s1 = s1 + d; s2 = s2 + d * d
            E = np.sqrt(np.maximum(s2 / n - (s1 / n) ** 2, 0))
            E = np.where(np.isfinite(E), E, np.inf)
            if sample:
                dist.append(E.ravel()[::sample])
            j = np.unravel_index(np.argmin(E), E.shape)
            if E[j] < best[0]:
                best = (float(E[j]), float(phi), mirror, int(y0 + j[0] * stride), int(x0 + j[1] * stride))
    return best, (np.concatenate(dist) if dist else None)

def match(seg, dem):
    z = dem["z"].astype(np.float64); px = float(dem["px"])
    z = z - np.nanmean(z)
    step = int(round(PT_STEP / (seg["s"][1] - seg["s"][0])))
    x = np.array(seg["x"])[::step]; y = np.array(seg["y"])[::step]; zm = np.array(seg["z"])[::step]
    zm = zm - zm.mean()
    b, dist = scan(z, px, x, y, zm, np.arange(0, 360, 10.0), (1, -1), 5, sample=3)
    if not np.isfinite(b[0]):
        return None
    dist = dist[np.isfinite(dist)]
    # afinado: recorte alrededor de la mejor posicion
    r = int(np.ceil(np.hypot(x, y).max() / px)) + 12
    r0, c0 = max(b[3] - r, 0), max(b[4] - r, 0)
    zc = z[r0:b[3] + r, c0:b[4] + r]
    f, _ = scan(zc, px, x, y, zm, b[1] + np.arange(-6, 7, 1.0), (b[2],), 1)
    if f[0] < b[0]:
        b = (f[0], f[1], f[2], f[3] + r0, f[4] + c0)
    return {"E": b[0], "phi": b[1] % 360, "mirror": b[2], "row": b[3], "col": b[4],
            "E0_flat": float(zm.std()), "E_median": float(np.median(dist)), "E_p1": float(np.percentile(dist, 1)),
            "n_tested": int(dist.size * 3)}

def place(seg, dem, b):
    """Ruta completa sobre la Tierra: lat, lon, z (interpolacion bilineal)."""
    px = float(dem["px"]); lat0 = float(dem["lat"]); lon0 = float(dem["lon"]); H, W = dem["z"].shape
    x = np.array(seg["x"]); y = np.array(seg["y"])
    c, s = np.cos(np.radians(b["phi"])), np.sin(np.radians(b["phi"]))
    xr = c * (b["mirror"] * x) - s * y; yr = s * (b["mirror"] * x) + c * y
    col = b["col"] + xr / px; row = b["row"] - yr / px
    ze = map_coordinates(np.nan_to_num(dem["z"]).astype(np.float64), [row, col], order=1)
    lat = lat0 + np.degrees((H / 2 - row) * px / R_EARTH)
    lon = lon0 + np.degrees((col - W / 2) * px / R_EARTH) / np.cos(np.radians(lat0))
    return lat, lon, ze, row, col

def slope_stats(s, zm, ze, L):
    k = int(round(L / (s[1] - s[0])))
    tm = np.degrees(np.arctan((zm[k:] - zm[:-k]) / L))[::k]; te = np.degrees(np.arctan((ze[k:] - ze[:-k]) / L))[::k]
    r = float(np.corrcoef(tm, te)[0, 1]) if tm.std() > 0 and te.std() > 0 else float("nan")
    return {"L": L, "J": float(np.mean(np.abs(te - tm))), "J0_flat": float(np.mean(np.abs(tm))), "r": r,
            "rms_mars": float(tm.std()), "rms_earth": float(te.std())}

if __name__ == "__main__":
    segs = json.load(open(sys.argv[1]))["segments"]; out = sys.argv[2]
    files = [f for a in sys.argv[3:] for f in glob.glob(a)]
    res = []
    for name, seg in segs.items():
        for f in files:
            dem = np.load(f); b = match(seg, dem)
            if b is None:
                continue
            lat, lon, ze, _, _ = place(seg, dem, b)
            s = np.array(seg["s"]); zm = np.array(seg["z"])
            b.update(segment=name, tile=os.path.basename(f)[:-4], E_full=float(np.std((ze - ze.mean()) - (zm - zm.mean()))),
                     slopes=[slope_stats(s, zm, ze, L) for L in (30.0, 90.0)],
                     lat=[round(float(v), 6) for v in lat[::3]], lon=[round(float(v), 6) for v in lon[::3]],
                     z=[round(float(v), 2) for v in ze[::3]])
            res.append(b)
            sl = b["slopes"]
            print(f"{name:8s} {b['tile']:18s} E={b['E']:6.2f} m  plano={b['E0_flat']:6.2f}  p1={b['E_p1']:6.2f}  mediana={b['E_median']:7.2f} | "
                  f"pend30: J={sl[0]['J']:.2f} (plano {sl[0]['J0_flat']:.2f}) r={sl[0]['r']:.2f} | pend90: J={sl[1]['J']:.2f} (plano {sl[1]['J0_flat']:.2f}) r={sl[1]['r']:.2f}", flush=True)
    json.dump(res, open(out, "w"))
