"""Rastreador semanal de deforestación para Caldas (sin llaves, gratis).

Fuente: Alertas integradas de pérdida de bosque de Global Forest Watch (GLAD-L, GLAD-S2, RADD y DIST-ALERT), leídas de las
teselas públicas tiles.globalforestwatch.org/gfw_integrated_alerts/latest/default/{z}/{x}/{y}.png. Cada píxel trae codificada
la fecha: días desde 2014-12-31 = R*255 + G; el canal B codifica la confianza (B//100: 1 = nominal/baja, 2 = alta).
Zoom 12 → píxel ≈ 38 m (≈ 0,145 ha a 5° N). Cada píxel se asigna a municipio y vereda (Corpocaldas) y se descarta fuera de Caldas.

Salida: data/deforestacion_alertas.json
  pts: [lat, lon, dia, conf, idx_vereda]   (dia = días desde 2014-12-31)
  veredas: [[id, vereda, municipio], ...]
  semanas: {"2026-S45": {"ha": .., "n": .., "alta": ..}, ...}"""
import sys, os, io, math, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from comun import *
from PIL import Image
import numpy as np

Z = 12
URL = 'https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/default/%d/%d/%d.png'
EPOCA = dt.date(2014, 12, 31)
DESDE = dt.date(2024, 1, 1)          # historial que se conserva para el rastreador (≈ 3 años)


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def px_lonlat(xt, yt, i, j, z):
    """Centro del píxel (i columna, j fila) de la tesela (xt, yt)."""
    n = 2 ** z
    x = xt + (i + .5) / 256; y = yt + (j + .5) / 256
    lon = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def main():
    w, s, e, n = BBOX
    x0, y0 = tile_xy(w, n, Z); x1, y1 = tile_xy(e, s, Z)
    ub = Ubicador()
    dmin = (DESDE - EPOCA).days
    pts, idx_ver, veredas = [], {}, []
    C = caldas()
    from shapely.prepared import prep
    from shapely.geometry import box
    Cp = prep(C)
    total = 0
    for xt in range(int(x0), int(x1) + 1):
        for yt in range(int(y0), int(y1) + 1):
            # descartar teselas completamente fuera de Caldas
            lo0, la0 = px_lonlat(xt, yt, -0.5, 255.5, Z); lo1, la1 = px_lonlat(xt, yt, 255.5, -0.5, Z)
            if not Cp.intersects(box(lo0, la0, lo1, la1)): continue
            try:
                a = np.array(Image.open(io.BytesIO(bajar(URL % (Z, xt, yt), binario=True, timeout=60))).convert('RGBA')).astype(np.int32)
            except Exception as ex:
                print('  tesela', xt, yt, 'falló:', ex); continue
            total += 1
            dias = a[..., 0] * 255 + a[..., 1]
            m = (a[..., 3] > 0) & (dias >= dmin)
            for j, i in zip(*np.nonzero(m)):
                lon, lat = px_lonlat(xt, yt, i, j, Z)
                mun, ver, vid = ub(lon, lat)
                if mun is None: continue                       # fuera de Caldas
                k = vid if vid is not None else (mun, ver)
                if k not in idx_ver:
                    idx_ver[k] = len(veredas); veredas.append([vid, ver, mun])
                conf = 2 if a[j, i, 2] >= 200 else 1
                pts.append([round(lat, 5), round(lon, 5), int(dias[j, i]), conf, idx_ver[k]])
    if total == 0:
        raise SystemExit('No se pudo leer ninguna tesela de GFW; se conserva el archivo anterior')
    ha_px = (2 * math.pi * 6378137 * math.cos(math.radians(5.2)) / (2 ** Z * 256)) ** 2 / 1e4
    semanas = {}
    for p in pts:
        sem = semana_iso(EPOCA + dt.timedelta(p[2]))
        d = semanas.setdefault(sem, {'n': 0, 'alta': 0})
        d['n'] += 1; d['alta'] += p[3] == 2
    for d in semanas.values(): d['ha'] = round(d['n'] * ha_px, 2)
    pts.sort(key=lambda p: -p[2])
    ult = (EPOCA + dt.timedelta(pts[0][2])).isoformat() if pts else None
    guardar('deforestacion_alertas.json', {
        'fuente': 'Global Forest Watch · Alertas integradas de pérdida de bosque (GLAD-L, GLAD-S2, RADD, DIST-ALERT) · teselas públicas z12',
        'actualizado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'epoca': EPOCA.isoformat(), 'ha_pixel': round(ha_px, 4),
        'ultima_alerta': ult, 'desde': DESDE.isoformat(), 'veredas': veredas, 'pts': pts, 'semanas': dict(sorted(semanas.items()))})
    print('%d teselas, %d píxeles de alerta en Caldas desde %s; última alerta %s' % (total, len(pts), DESDE, ult))


if __name__ == '__main__':
    main()
