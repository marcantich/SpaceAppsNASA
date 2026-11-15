"""Real traverses (Perseverance, Curiosity) as examples for the Route view of the app.
usage: python make_presets.py m20_traverse.json msl_traverse.json output.json"""
import json, sys, numpy as np
R = 3389500.0; DS = 10.0
def load(path):
    P = []
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        g = f["geometry"]
        for l in ([g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]): P += [p[:3] for p in l]
    P = np.array(P, float); P = P[P[:, 2] < -100]
    return P[np.r_[True, np.any(np.diff(P[:, :2], axis=0) != 0, axis=1)]]
def cut(P, a, b):
    la = np.radians(P[:, 1].mean()); x = np.radians(P[:, 0]) * R * np.cos(la); y = np.radians(P[:, 1]) * R
    s = np.r_[0, np.cumsum(np.hypot(np.diff(x), np.diff(y)))]
    if a < 0: a, b = s[-1] / 1e3 + a, s[-1] / 1e3 + b
    sg = np.arange(a * 1e3, b * 1e3 + 1e-6, DS)
    return {"km": [round(a, 1), round(b, 1)], "ds": DS, "lat": np.interp(sg, s, P[:, 1]).round(6).tolist(),
            "lon": np.interp(sg, s, P[:, 0]).round(6).tolist(), "z": np.interp(sg, s, P[:, 2]).round(2).tolist()}
m20, msl = load(sys.argv[1]), load(sys.argv[2])
out = {"_note": "Real rover traverses (NASA/JPL-Caltech, mars.nasa.gov MMGIS), resampled every 10 m along the track with the rover's own elevation. Written by scripts/rover_route/make_presets.py.",
       "presets": [
    {"id": "m20_floor", "body": "mars", "name": "Perseverance · crater floor (3 km)", **cut(m20, 9, 12)},
    {"id": "m20_landing", "body": "mars", "name": "Perseverance · first 3 km after landing", **cut(m20, 0, 3)},
    {"id": "m20_rim", "body": "mars", "name": "Perseverance · climb to the crater rim (9 km)", **cut(m20, 27, 36)},
    {"id": "msl_sharp", "body": "mars", "name": "Curiosity · Mount Sharp, last 6 km", **cut(msl, -6, 0)},
]}
json.dump(out, open(sys.argv[3], "w"), separators=(",", ":"))
for p in out["presets"]: print(p["id"], len(p["z"]), "pts  dz", round(p["z"][-1] - p["z"][0], 1), "km", p["km"])
