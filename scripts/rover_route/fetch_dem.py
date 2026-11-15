"""Descarga una tesela de relieve USGS 3DEP (sin registro) centrada en lat/lon.
uso: python fetch_dem.py nombre lat lon lado_km [px_m]   -> dem/nombre.npz"""
import sys, io, os, numpy as np, requests
from PIL import Image
R_EARTH = 6371008.8
URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

def fetch(name, lat, lon, side_km, px=10.0, outdir="dem"):
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, name + ".npz")
    if os.path.exists(out):
        return out
    n = int(round(side_km * 1e3 / px))
    dlat = np.degrees(side_km * 1e3 / 2 / R_EARTH)
    dlon = dlat / np.cos(np.radians(lat))
    r = requests.get(URL, timeout=300, headers={"User-Agent": "generic-client"}, params={
        "bbox": f"{lon - dlon},{lat - dlat},{lon + dlon},{lat + dlat}", "bboxSR": 4326, "imageSR": 4326,
        "size": f"{n},{n}", "format": "tiff", "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation", "f": "image"})
    r.raise_for_status()
    z = np.array(Image.open(io.BytesIO(r.content)), dtype=np.float32)   # fila 0 = norte
    z[(z < -500) | (z > 9000)] = np.nan
    np.savez_compressed(out, z=z, lat=lat, lon=lon, side_km=side_km, px=px)
    print(name, z.shape, "z", np.nanmin(z).round(1), np.nanmax(z).round(1), "nan", int(np.isnan(z).sum()))
    return out

if __name__ == "__main__":
    a = sys.argv
    fetch(a[1], float(a[2]), float(a[3]), float(a[4]), float(a[5]) if len(a) > 5 else 10.0)
