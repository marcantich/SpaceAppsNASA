"""Cleans the Perseverance traverse and extracts stretches resampled by arc length.
usage: python prep_route.py traverse.json waypoints.json output.json"""
import json, sys, numpy as np
R_MARS = 3389500.0
SEGMENTS = {  # km along the route [assumption: stretches chosen by hand]
    "landing": (0.0, 3.0),
    "floor": (9.0, 12.0),
    "rim": (27.0, 36.0),
}
DS = 10.0  # m, resampling step

def load(path):
    tr = json.load(open(path, encoding="utf-8"))
    P = []
    for f in tr["features"]:
        g = f["geometry"]
        for l in ([g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]):
            P += l
    P = np.array(P, float)
    P = P[P[:, 2] < -100]                      # corrupted elevations (z = 0)
    keep = np.r_[True, np.any(np.diff(P[:, :2], axis=0) != 0, axis=1)]
    return P[keep]

def main(tr_path, wp_path, out):
    P = load(tr_path)
    lat0 = np.radians(P[:, 1].mean())
    x = np.radians(P[:, 0]) * R_MARS * np.cos(lat0)
    y = np.radians(P[:, 1]) * R_MARS
    s = np.r_[0, np.cumsum(np.hypot(np.diff(x), np.diff(y)))]
    wps = [f["properties"] for f in json.load(open(wp_path, encoding="utf-8"))["features"]]
    wl = np.array([[w["lon"], w["lat"]] for w in wps])
    wx = np.radians(wl[:, 0]) * R_MARS * np.cos(lat0); wy = np.radians(wl[:, 1]) * R_MARS
    # s of each stop = nearest point of the traverse, searching forwards
    ws = []; j0 = 0
    for a, b in zip(wx, wy):
        j1 = min(len(x), j0 + 4000)
        j = j0 + int(np.argmin((x[j0:j1] - a) ** 2 + (y[j0:j1] - b) ** 2)); ws.append(s[j]); j0 = j
    res = {"ds_m": DS, "total_km": s[-1] / 1e3, "segments": {}}
    for name, (a, b) in SEGMENTS.items():
        sg = np.arange(a * 1e3, b * 1e3 + 1e-6, DS)
        xs, ys, zs = (np.interp(sg, s, v) for v in (x, y, P[:, 2]))
        lon, lat = (np.interp(sg, s, P[:, k]) for k in (0, 1))
        stops = [{"s_m": round(float(q - a * 1e3), 1), "sol": w["sol"], "tilt": w.get("tilt"), "note": w.get("Note") or ""}
                 for q, w in zip(ws, wps) if a * 1e3 <= q <= b * 1e3]
        res["segments"][name] = {
            "km": [a, b], "s": (sg - sg[0]).round(1).tolist(),
            "x": (xs - xs.mean()).round(2).tolist(), "y": (ys - ys.mean()).round(2).tolist(),
            "z": zs.round(3).tolist(), "lon": lon.round(7).tolist(), "lat": lat.round(7).tolist(), "stops": stops}
        print(name, len(sg), "pts  extent m", np.ptp(xs).round(0), np.ptp(ys).round(0), " dz", (zs[-1] - zs[0]).round(1), " stops", len(stops))
    json.dump(res, open(out, "w"))

if __name__ == "__main__":
    main(*sys.argv[1:4])
