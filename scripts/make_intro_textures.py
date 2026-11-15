"""Texturas equirectangulares pequeñas (1024x512) de la Luna, la Tierra y Marte para la pantalla de inicio.
Fuentes: NASA Trek (Viking MDIM 2.1, LRO WAC) y NASA GIBS (Blue Marble). uso: python make_textures.py carpeta_salida"""
import io, sys, os, requests
from PIL import Image
UA = {"User-Agent": "generic-client"}
def get(u):
    r = requests.get(u, headers=UA, timeout=60); r.raise_for_status(); return Image.open(io.BytesIO(r.content)).convert("RGB")
def trek(body, layer, ext="jpg", z=1):
    im = Image.new("RGB", (256 * 2 ** (z + 1), 256 * 2 ** z))
    for y in range(2 ** z):
        for x in range(2 ** (z + 1)):
            im.paste(get(f"https://trek.nasa.gov/tiles/{body}/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}"), (256 * x, 256 * y))
    return im
def gibs():
    # EPSG:4326, nivel 1: teselas de 144 grados y 512 px, 3 x 2 teselas desde (-180, 90)
    im = Image.new("RGB", (512 * 3, 512 * 2))
    for y in range(2):
        for x in range(3):
            im.paste(get(f"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/1/{y}/{x}.jpeg"), (512 * x, 512 * y))
    return im.crop((0, 0, 1280, 640))
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for name, im in (("mars", trek("Mars", "Mars_Viking_MDIM21_ClrMosaic_global_232m")), ("moon", trek("Moon", "LRO_WAC_Mosaic_Global_303ppd_v02")), ("earth", gibs())):
    im = im.resize((1024, 512), Image.LANCZOS); p = os.path.join(out, name + ".jpg"); im.save(p, quality=82, optimize=True)
    print(name, im.size, os.path.getsize(p) // 1024, "kB")
