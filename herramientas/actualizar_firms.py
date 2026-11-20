"""Puntos de calor NASA FIRMS en Caldas para el ÚLTIMO AÑO COMPLETO hasta hoy (365 días) → data/firms_caldas.json

Fuentes, en este orden:
  1. Archivos anuales por país (públicos, sin llave): data/country/<sensor>/<año>/<sensor>_<año>_Colombia.csv
     (NASA los publica para años cerrados; cubren el tramo del año anterior dentro de la ventana).
  2. API de área de FIRMS con llave gratuita (variable de entorno FIRMS_MAP_KEY, secreto de GitHub): rellena todo el
     año en curso en bloques de 10 días. Se pide una llave en https://firms.modaps.eosdis.nasa.gov/api/map_key/
  3. Archivos NRT de 7 días (públicos): se acumulan en cada corrida, así la serie nunca queda con huecos hacia adelante.
Sensores: VIIRS S-NPP, VIIRS NOAA-20, VIIRS NOAA-21 y MODIS. Los puntos son detecciones térmicas, no incendios confirmados."""
import csv, io, json, os, sys, time, urllib.request, datetime as dt

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SALIDA = os.path.join(RAIZ, 'data', 'firms_caldas.json')
LIMITE = os.path.join(RAIZ, 'data', 'base', 'caldas_limite.json')
DIAS = 365
LAT = (4.7, 5.9); LON = (-76.1, -74.5)
UA = {'User-Agent': 'VigiaFuego-Caldas/1.0 (datos abiertos)'}
NRT = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/'
SENSORES = {  # clave interna: (archivo NRT 7d, carpeta país, prefijo país, fuente API)
    'VIIRS_SNPP': ('suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_America_7d.csv', 'viirs-snpp', 'viirs-snpp', 'VIIRS_SNPP_NRT'),
    'VIIRS_NOAA20': ('noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_7d.csv', 'viirs-noaa20', 'viirs-noaa20', 'VIIRS_NOAA20_NRT'),
    'VIIRS_NOAA21': ('noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_7d.csv', 'viirs-noaa21', 'viirs-noaa21', 'VIIRS_NOAA21_NRT'),
    'MODIS': ('modis-c6.1/csv/MODIS_C6_1_South_America_7d.csv', 'modis', 'modis', 'MODIS_NRT'),
}

_POLIS = None
def _dentro(x, y, a):
    r = False; j = len(a) - 1
    for i in range(len(a)):
        xi, yi = a[i]; xj, yj = a[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: r = not r
        j = i
    return r

def en_caldas(lat, lon):
    global _POLIS
    if not (LAT[0] <= lat <= LAT[1] and LON[0] <= lon <= LON[1]): return False
    if _POLIS is None: _POLIS = json.load(open(LIMITE, encoding='utf-8'))['poligonos']
    return any(_dentro(lon, lat, p[0]) and not any(_dentro(lon, lat, h) for h in p[1:]) for p in _POLIS)

def bajar(url, timeout=180):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read().decode('utf-8', 'replace')

def leer_csv(txt, sensor, corte):
    out = []
    for f in csv.DictReader(io.StringIO(txt)):
        try: la, lo = float(f['latitude']), float(f['longitude'])
        except Exception: continue
        if not en_caldas(la, lo): continue
        hh = str(f.get('acq_time', '1200')).zfill(4)
        try: t = dt.datetime.strptime(f['acq_date'] + hh, '%Y-%m-%d%H%M').replace(tzinfo=dt.timezone.utc)
        except Exception: continue
        if t < corte: continue
        out.append({'fuente': sensor, 'fecha_hora': t.strftime('%Y-%m-%dT%H:%M:%SZ'), 'lat': round(la, 5), 'lon': round(lo, 5),
                    'frp': f.get('frp', ''), 'confianza': f.get('confidence', ''), 'dia_noche': f.get('daynight', '')})
    return out

def main():
    ahora = dt.datetime.now(dt.timezone.utc)
    corte = ahora - dt.timedelta(days=DIAS)
    previo = {}
    if os.path.exists(SALIDA):
        try: previo = json.load(open(SALIDA, encoding='utf-8'))
        except Exception: previo = {}
    hechos = set(previo.get('rellenos', []))        # bloques ya descargados (no se repiten)
    nuevos = []
    # 1. archivos anuales por país (años cerrados dentro de la ventana)
    for anio in range(corte.year, ahora.year):
        for s, (_, carpeta, pref, _) in SENSORES.items():
            k = 'pais:%s:%d' % (s, anio)
            if k in hechos: continue
            try:
                txt = bajar('https://firms.modaps.eosdis.nasa.gov/data/country/%s/%d/%s_%d_Colombia.csv' % (carpeta, anio, pref, anio), 600)
                p = leer_csv(txt, s, corte); nuevos += p; hechos.add(k); print(k, len(p), 'puntos en Caldas')
            except Exception as e: print(k, 'no disponible:', e)
    # 2. API de área con llave gratuita (año en curso, bloques de 10 días)
    key = os.environ.get('FIRMS_MAP_KEY', '').strip()
    if key:
        bbox = '%s,%s,%s,%s' % (LON[0], LAT[0], LON[1], LAT[1])
        d = dt.date(ahora.year, 1, 1) if corte.year < ahora.year else corte.date()
        while d <= ahora.date():
            for s, (_, _, _, src) in SENSORES.items():
                k = 'api:%s:%s' % (s, d.isoformat())
                fin_bloque = d + dt.timedelta(days=9)
                if k in hechos and fin_bloque < ahora.date() - dt.timedelta(days=3): continue
                try:
                    txt = bajar('https://firms.modaps.eosdis.nasa.gov/api/area/csv/%s/%s/%s/10/%s' % (key, src, bbox, d.isoformat()))
                    p = leer_csv(txt, s, corte); nuevos += p
                    if fin_bloque < ahora.date() - dt.timedelta(days=3): hechos.add(k)
                except Exception as e: print(k, 'falló:', e)
                time.sleep(0.5)
            d += dt.timedelta(days=10)
        print('API FIRMS: relleno del año en curso hecho')
    else:
        print('Sin FIRMS_MAP_KEY: el año en curso se completa con la acumulación diaria (y con IDEAM en la página).')
    # 3. NRT 7 días
    for s, (arch, _, _, _) in SENSORES.items():
        try: p = leer_csv(bajar(NRT + arch), s, corte); nuevos += p; print(s, 'NRT 7d:', len(p))
        except Exception as e: print(s, 'NRT falló:', e)
    uni = {}
    for p in previo.get('puntos', []) + nuevos:
        p['fuente'] = p['fuente'].replace('_NRT', '')
        if p['fecha_hora'] >= corte.strftime('%Y-%m-%dT%H:%M:%SZ'):
            uni[(p['fuente'], p['fecha_hora'], p['lat'], p['lon'])] = p
    pts = sorted(uni.values(), key=lambda p: p['fecha_hora'], reverse=True)
    json.dump({'actualizado': ahora.strftime('%Y-%m-%dT%H:%M:%SZ'), 'fuente': 'NASA FIRMS (LANCE / archivos por país)', 'dias': DIAS,
               'desde': corte.strftime('%Y-%m-%d'), 'con_api': bool(key), 'rellenos': sorted(hechos), 'puntos': pts},
              open(SALIDA, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('Total en la ventana de 365 días:', len(pts))

if __name__ == '__main__':
    main()
