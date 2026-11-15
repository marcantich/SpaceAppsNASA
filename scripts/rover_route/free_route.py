"""Camino libre en la Tierra que reproduce la secuencia de pendientes de un tramo marciano.
Programacion dinamica sobre (posicion, rumbo): en cada paso de ~30 m el camino avanza en uno de 16 rumbos,
puede girar como mucho 22,5 grados por paso, y paga |pendiente_Tierra - pendiente_Marte| de ese paso.
uso: python free_route.py segments.json salida.json dem/*.npz"""
import json, sys, glob, os, tempfile, numpy as np
R_EARTH = 6371008.8
OFF = [(0, 3), (-1, 3), (-2, 2), (-3, 1), (-3, 0), (-3, -1), (-2, -2), (-1, -3),
       (0, -3), (1, -3), (2, -2), (3, -1), (3, 0), (3, 1), (2, 2), (1, 3)]      # (dfila, dcol), antihorario desde el este
NH = len(OFF); C = 20; INF = np.float32(1e9)

def shift(A, dy, dx, fill=INF):
    """B[y, x] = A[y + dy, x + dx]"""
    H, W = A.shape; B = np.full_like(A, fill)
    ys = slice(max(-dy, 0), H - max(dy, 0)); xs = slice(max(-dx, 0), W - max(dx, 0))
    yd = slice(max(dy, 0), H + min(dy, 0)); xd = slice(max(dx, 0), W + min(dx, 0))
    B[ys, xs] = A[yd, xd]
    return B

def slope_fields(z, px):
    S = np.empty((NH,) + z.shape, np.float32)
    for h, (dy, dx) in enumerate(OFF):
        S[h] = (shift(z, dy, dx, np.float32(np.nan)) - z) / (np.hypot(dy, dx) * px)
    return np.where(np.isfinite(S), S, INF)

def backstep(V, S, t):
    m = np.minimum(np.minimum(np.roll(V, 1, 0), V), np.roll(V, -1, 0))
    out = np.empty_like(V)
    for h, (dy, dx) in enumerate(OFF):
        out[h] = np.minimum(np.abs(S[h] - t) + shift(m[h], dy, dx), INF)
    return out

def solve(z, px, t, tmpdir):
    """t = tan(pendiente) objetivo por paso. Devuelve coste medio (tan) y camino [(fila, col)]."""
    N = len(t); S = slope_fields(z.astype(np.float32), px); H, W = z.shape
    ncp = (N + C - 1) // C
    cp = np.lib.format.open_memmap(os.path.join(tmpdir, "cp.npy"), "w+", np.float32, (ncp, NH, H, W))
    V = np.zeros((NH, H, W), np.float32)
    for k in range(N - 1, -1, -1):
        V = backstep(V, S, t[k])
        if k % C == 0:
            cp[k // C] = V
    j = np.unravel_index(np.argmin(V), V.shape)
    cost = float(V[j]) / N
    if cost > 1e3:
        return None, None
    h, y, x = map(int, j); path = [(y, x)]; k = 0
    while k < N:
        kend = min(k + C, N); R = (kend - k) * 4 + 4
        y0, y1 = max(y - R, 0), min(y + R + 1, H); x0, x1 = max(x - R, 0), min(x + R + 1, W)
        Sl = S[:, y0:y1, x0:x1]
        Vl = {kend: (np.zeros((NH, y1 - y0, x1 - x0), np.float32) if kend == N else np.array(cp[kend // C][:, y0:y1, x0:x1]))}
        for kk in range(kend - 1, k, -1):
            Vl[kk] = backstep(Vl[kk + 1], Sl, t[kk])
        for kk in range(k, kend):
            y += OFF[h][0]; x += OFF[h][1]; path.append((y, x))
            if kk + 1 < N:
                cand = [(h - 1) % NH, h, (h + 1) % NH]
                h = min(cand, key=lambda q: Vl[kk + 1][q, y - y0, x - x0])
        k = kend
    del cp
    return cost, np.array(path)

def run(seg, dem, tmpdir, L=30.0, quad=1000):
    z = dem["z"]; px = float(dem["px"]); step = int(round(L / (seg["s"][1] - seg["s"][0])))
    zm = np.array(seg["z"])[::step]; t = (np.diff(zm) / L).astype(np.float32)
    best = None
    for r0 in range(0, z.shape[0], quad):
        for c0 in range(0, z.shape[1], quad):
            cost, path = solve(z[r0:r0 + quad, c0:c0 + quad], px, t, tmpdir)
            if cost is not None and (best is None or cost < best[0]):
                best = (cost, path + [r0, c0])
    if best is None:
        return None
    path = best[1]; ze = z[path[:, 0], path[:, 1]].astype(float)
    d = np.hypot(np.diff(path[:, 0]), np.diff(path[:, 1])) * px
    te = np.degrees(np.arctan(np.diff(ze) / d)); tm = np.degrees(np.arctan(t))
    H, W = z.shape; lat0 = float(dem["lat"]); lon0 = float(dem["lon"])
    lat = lat0 + np.degrees((H / 2 - path[:, 0]) * px / R_EARTH)
    lon = lon0 + np.degrees((path[:, 1] - W / 2) * px / R_EARTH) / np.cos(np.radians(lat0))
    err = np.abs(te - tm)
    return {"J": float(err.mean()), "J0_flat": float(np.abs(tm).mean()), "r": float(np.corrcoef(te, tm)[0, 1]),
            "within_1deg": float((err <= 1).mean()), "within_2deg": float((err <= 2).mean()), "max_err": float(err.max()),
            "len_earth_m": float(d.sum()), "len_mars_m": float(L * len(t)),
            "E": float(np.std((ze - ze.mean()) - (zm - zm.mean()))), "E0_flat": float(zm.std()),
            "lat": lat.round(6).tolist(), "lon": lon.round(6).tolist(), "z": ze.round(2).tolist(),
            "z_mars": zm.round(2).tolist(), "row": path[:, 0].tolist(), "col": path[:, 1].tolist()}

if __name__ == "__main__":
    segs = json.load(open(sys.argv[1]))["segments"]; out = sys.argv[2]
    files = [f for a in sys.argv[3:] for f in glob.glob(a)]; res = []
    with tempfile.TemporaryDirectory(dir=".") as tmp:
        for name, seg in segs.items():
            for f in files:
                b = run(seg, np.load(f), tmp)
                if b is None:
                    continue
                b.update(segment=name, tile=os.path.basename(f)[:-4]); res.append(b)
                print(f"{name:8s} {b['tile']:18s} J={b['J']:.2f} deg (plano {b['J0_flat']:.2f})  r={b['r']:.3f}  <=1deg {100*b['within_1deg']:.0f}%  <=2deg {100*b['within_2deg']:.0f}%  max {b['max_err']:.1f}  "
                      f"cota RMS {b['E']:.2f} m (plano {b['E0_flat']:.1f})  long {b['len_earth_m']/1e3:.2f}/{b['len_mars_m']/1e3:.2f} km", flush=True)
                json.dump(res, open(out, "w"))
