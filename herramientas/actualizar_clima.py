"""Clima actual, pronóstico y anomalías para Caldas con Open-Meteo (gratis, sin llave).

Malla regular de 0,1° (≈ 11 km) dentro de Caldas. Open-Meteo corrige por elevación (DEM 90 m), clave en los Andes.
  1. Normales diarias por punto (2016-2025, ventana móvil de 31 días), del archivo histórico de Open-Meteo.
     Se construyen por partes (cuota gratuita ≈ 10 000 llamadas/día): cada corrida completa hasta NORM_POR_CORRIDA puntos
     y se guardan en data/clima_normales.json. Mientras falten, la anomalía usa el punto vecino más cercano con normal.
  2. Últimos 30 días + pronóstico 16 días (API de pronóstico, modelo best_match).
  3. Indicadores por punto: anomalía de Tmax (7 días pasados y 7 próximos), días consecutivos sin lluvia (hoy y en el
     pronóstico), lluvia 30 días como % de lo normal, anomalía de humedad relativa, DPV máximo.
Salida: data/clima_actual.json"""
import sys, os, math, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from comun import *
from shapely.geometry import Point

PASO = 0.1
ANIOS = (2016, 2025)
NORM_POR_CORRIDA = int(os.environ.get('NORM_POR_CORRIDA', '25'))
VARS_D = ['temperature_2m_max', 'temperature_2m_mean', 'relative_humidity_2m_mean', 'relative_humidity_2m_min',
          'precipitation_sum', 'et0_fao_evapotranspiration', 'vapour_pressure_deficit_max', 'wind_speed_10m_max']
VARS_N = ['temperature_2m_max', 'relative_humidity_2m_mean', 'precipitation_sum']


def malla():
    C = caldas().buffer(0.03)
    w, s, e, n = BBOX
    pts = []
    la = s + PASO / 2
    while la < n:
        lo = w + PASO / 2
        while lo < e:
            if C.contains(Point(lo, la)): pts.append((round(la, 3), round(lo, 3)))
            lo += PASO
        la += PASO
    return pts


def om(url, lats, lons, extra):
    q = dict(extra, latitude=','.join(map(str, lats)), longitude=','.join(map(str, lons)), timezone='America/Bogota')
    j = bajar_json(url + '?' + urllib.parse.urlencode(q), timeout=180)
    return j if isinstance(j, list) else [j]


def normales(pts):
    """Completa normales faltantes (por partes). Devuelve {clave: {var: [366 valores]}}."""
    cache = leer('clima_normales.json', {'anios': ANIOS, 'p': {}})
    falt = [p for p in pts if '%s,%s' % p not in cache['p']][:NORM_POR_CORRIDA]
    for k in range(0, len(falt), 5):
        lote = falt[k:k + 5]
        try:
            res = om('https://archive-api.open-meteo.com/v1/archive', [p[0] for p in lote], [p[1] for p in lote],
                     {'start_date': '%d-01-01' % ANIOS[0], 'end_date': '%d-12-31' % ANIOS[1], 'daily': ','.join(VARS_N)})
        except Exception as e:
            print('  normales: cuota o error, se sigue en la próxima corrida:', e); break
        for p, r in zip(lote, res):
            d = r['daily']; fechas = d['time']
            out = {}
            for v in VARS_N:
                suma = [0.0] * 366; cnt = [0] * 366
                for f, x in zip(fechas, d[v]):
                    if x is None: continue
                    doy = dt.date.fromisoformat(f).timetuple().tm_yday - 1
                    suma[doy] += x; cnt[doy] += 1
                diario = [suma[i] / cnt[i] if cnt[i] else None for i in range(366)]
                suav = []
                for i in range(366):            # ventana móvil de 31 días (circular)
                    vals = [diario[(i + k2) % 366] for k2 in range(-15, 16) if diario[(i + k2) % 366] is not None]
                    suav.append(round(sum(vals) / len(vals), 2) if vals else None)
                out[v] = suav
            out['elev'] = r.get('elevation')
            cache['p']['%s,%s' % p] = out
        time.sleep(1)
    guardar('clima_normales.json', cache)
    print('  normales: %d/%d puntos completos' % (len(cache['p']), len(pts)))
    return cache['p']


def normal_de(nor, p, elev=None):
    """Normal del punto; si aún no existe, la del vecino más cercano con altura parecida (< 600 m de diferencia),
    con la temperatura corregida por gradiente altitudinal (-6,5 °C/km). Si no hay vecino adecuado: None."""
    k = '%s,%s' % p
    if k in nor: return nor[k], False
    cand = []
    for q, v in nor.items():
        la, lo = map(float, q.split(','))
        de = abs((v.get('elev') or 0) - (elev or 0)) if elev is not None else 0
        if de <= 600: cand.append(((la - p[0]) ** 2 + (lo - p[1]) ** 2, q, v))
    if not cand: return None, True
    _, q, v = min(cand)
    dz = ((elev or 0) - (v.get('elev') or 0)) / 1000.0
    adj = dict(v); adj['temperature_2m_max'] = [None if x is None else x - 6.5 * dz for x in v['temperature_2m_max']]
    return adj, True


def main():
    pts = malla()
    print('Malla de %d puntos (%.1f°) dentro de Caldas' % (len(pts), PASO))
    nor = normales(pts)
    hoy = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()
    salida = []
    for k in range(0, len(pts), 50):
        lote = pts[k:k + 50]
        res = om('https://api.open-meteo.com/v1/forecast', [p[0] for p in lote], [p[1] for p in lote],
                 {'daily': ','.join(VARS_D), 'past_days': 30, 'forecast_days': 16})
        for p, r in zip(lote, res):
            d = r['daily']; fechas = [dt.date.fromisoformat(f) for f in d['time']]
            ih = max(i for i, f in enumerate(fechas) if f <= hoy)
            N, aprox = normal_de(nor, p, r.get('elevation'))
            def nval(v, f): return N[v][f.timetuple().tm_yday - 1] if N else None
            def media(xs): xs = [x for x in xs if x is not None]; return sum(xs) / len(xs) if xs else None
            tx = d['temperature_2m_max']; pr = d['precipitation_sum']; rh = d['relative_humidity_2m_mean']
            an_tx = [None if tx[i] is None or nval('temperature_2m_max', fechas[i]) is None else tx[i] - nval('temperature_2m_max', fechas[i]) for i in range(len(fechas))]
            an_rh = [None if rh[i] is None or nval('relative_humidity_2m_mean', fechas[i]) is None else rh[i] - nval('relative_humidity_2m_mean', fechas[i]) for i in range(len(fechas))]
            # días consecutivos sin lluvia (< 1 mm) hasta hoy y hasta el final del pronóstico
            def secos(hasta):
                c = 0
                for i in range(hasta, -1, -1):
                    if pr[i] is not None and pr[i] < 1: c += 1
                    else: break
                return c
            p30 = sum(x or 0 for x in pr[max(0, ih - 29):ih + 1])
            n30 = sum(nval('precipitation_sum', fechas[i]) or 0 for i in range(max(0, ih - 29), ih + 1)) if N else None
            salida.append({
                'lat': p[0], 'lon': p[1], 'elev': r.get('elevation'), 'normal_aprox': aprox,
                'tmax_hoy': tx[ih], 'tmax_max_fc': max([x for x in tx[ih + 1:] if x is not None], default=None),
                'an_tmax_7p': _r(media(an_tx[ih - 6:ih + 1])), 'an_tmax_7f': _r(media(an_tx[ih + 1:ih + 8])),
                'an_tmax_16f': _r(media(an_tx[ih + 1:])), 'an_hr_7p': _r(media(an_rh[ih - 6:ih + 1])), 'an_hr_7f': _r(media(an_rh[ih + 1:ih + 8])),
                'secos_hoy': secos(ih), 'secos_fc': None,
                'lluvia_30d': _r(p30), 'lluvia_30d_pct': _r(100 * p30 / n30) if n30 else None,
                'lluvia_fc16': _r(sum(x or 0 for x in pr[ih + 1:])),
                'dpv_max_7f': _r(max([x for x in d['vapour_pressure_deficit_max'][ih + 1:ih + 8] if x is not None], default=None)),
                'serie': {'t': [f.isoformat() for f in fechas], 'tmax': tx, 'tmax_n': [_r(nval('temperature_2m_max', f)) for f in fechas],
                          'lluvia': pr, 'hr': rh, 'hr_min': d['relative_humidity_2m_min'], 'dpv': d['vapour_pressure_deficit_max'],
                          'viento': d['wind_speed_10m_max'], 'et0': d['et0_fao_evapotranspiration']}})
        time.sleep(1)
    # días secos encadenados hasta el final del pronóstico (si hoy ya está seco y sigue seco)
    for s in salida:
        pr = s['serie']['lluvia']; c = 0
        for x in reversed(pr):
            if x is not None and x < 1: c += 1
            else: break
        s['secos_fc'] = c
    guardar('clima_actual.json', {'fuente': 'Open-Meteo (modelos best_match; histórico ERA5/ERA5-Land para normales %d-%d)' % ANIOS,
                                  'actualizado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'hoy': hoy.isoformat(),
                                  'paso': PASO, 'normales_completas': sum(not s['normal_aprox'] for s in salida), 'puntos': salida})
    print('Clima listo:', len(salida), 'puntos')


def _r(x, n=1):
    return None if x is None else round(x, n)


if __name__ == '__main__':
    main()
