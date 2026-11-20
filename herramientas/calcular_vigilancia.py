"""Índice de priorización de veredas para vigilancia (versión 1.0).

  riesgo = S · (0,4 + 0,6·H) + 0,15·A
  S  susceptibilidad (0-1, rangos percentiles entre veredas):
       0,40 área quemada histórica por km² (MapBiomas Fuego 2000-2025)
       0,20 años con fuego (frecuencia MapBiomas)
       0,20 deforestación últimos 90 días (alertas integradas GFW, confianza alta pesa doble)
       0,20 cercanía a vías primarias/secundarias y a centros poblados (presión de ignición y acceso)
  H  peligro climático (0-1), interpolado (IDW) desde la malla Open-Meteo:
       0,35 anomalía de Tmax próximos 7 días (+3 °C = 1)
       0,25 días consecutivos sin lluvia (20 días = 1)
       0,25 déficit de lluvia 30 días frente a lo normal (20 % de lo normal = 1)
       0,15 caída de humedad relativa próximos 7 días (-10 puntos = 1)
  A  actividad: puntos de calor FIRMS/IDEAM en la vereda últimos 30 días (3 o más = 1)
Niveles: 'vigilar' = 5 % superior, 'atencion' = siguiente 10 %, 'normal' = resto.
Se marca si la vereda toca páramo, área SINAP o resguardo indígena (valores a proteger).
Calibración prevista con los reportes verificados en campo (aplicación de reportes)."""
import sys, os, math, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from comun import *
from shapely.geometry import shape, Point
from shapely.strtree import STRtree


def km2(g):
    lat = g.centroid.y
    return g.area * (111.32 ** 2) * math.cos(math.radians(lat))


def rango(vals):
    """Rango percentil (0-1); los ceros quedan en 0."""
    orden = sorted(v for v in vals if v > 0)
    n = len(orden)
    def r(v):
        if v <= 0 or n == 0: return 0.0
        import bisect
        return (bisect.bisect_right(orden, v)) / n
    return [r(v) for v in vals]


def clamp(x): return 0.0 if x is None else max(0.0, min(1.0, x))


def capa(nombre):
    fc = leer(os.path.join(CAPAS, nombre + '.geojson'))
    gs = []
    for f in (fc or {}).get('features', []):
        try:
            g = shape(f['geometry']); gs.append(g if g.is_valid else g.buffer(0))
        except Exception: pass
    return gs


def main():
    ahora = dt.datetime.now(dt.timezone.utc)
    ver = leer(os.path.join(CAPAS, 'veredas.geojson'))['features']
    G = []; P = []
    for f in ver:
        g = shape(f['geometry']); G.append(g if g.is_valid else g.buffer(0)); P.append(f['properties'])
    arbol = STRtree(G)
    def donde(lon, lat):
        p = Point(lon, lat)
        for i in arbol.query(p):
            if G[i].contains(p): return i
        return None
    n = len(G)
    area = [max(km2(g), 0.01) for g in G]

    # 1. Historial de fuego MapBiomas por vereda (por nombre vereda+municipio)
    mb = leer(os.path.join(BASE, 'mapbiomas_fuego_veredas.json'))
    def clave(v, m): return (str(v or '').strip().lower(), str(m or '').strip().lower())
    mbd = {clave(r[1], r[2]): r[3] for r in mb['v']}
    mbi = {str(r[0]): r[3] for r in mb['v']}
    quema = [0.0] * n; anios = [0] * n
    for i, p in enumerate(P):
        serie = mbi.get(str(p.get('id'))) or mbd.get(clave(p['ver'], p['mun']))
        if serie: quema[i] = sum(serie) / area[i]; anios[i] = sum(1 for x in serie if x > 0.5)

    # 2. Deforestación reciente (GFW, 90 días)
    defo = [0.0] * n
    df = leer('deforestacion_alertas.json')
    if df:
        ep = dt.date.fromisoformat(df['epoca']); lim = (ahora.date() - ep).days - 90
        for la, lo, d, c, _ in df['pts']:
            if d < lim: continue
            i = donde(lo, la)
            if i is not None: defo[i] += df['ha_pixel'] * (2 if c == 2 else 1)

    # 3. Puntos de calor 30 días (FIRMS + IDEAM)
    calor = [0] * n
    lim30 = ahora - dt.timedelta(days=30)
    fj = leer('firms_caldas.json', {}) or {}
    for p in fj.get('puntos', []):
        try: t = dt.datetime.fromisoformat(p['fecha_hora'].replace('Z', '+00:00'))
        except Exception: continue
        if t < lim30: continue
        i = donde(p['lon'], p['lat'])
        if i is not None: calor[i] += 1
    ij = leer('ideam_caldas.json', {}) or {}
    if ij.get('t0'):
        t0 = dt.datetime.fromisoformat(ij['t0']).replace(tzinfo=dt.timezone(dt.timedelta(hours=-5)))
        for la, lo, m in ij.get('pts', []):
            if t0 + dt.timedelta(minutes=m) < lim30: continue
            i = donde(lo, la)
            if i is not None: calor[i] += 1

    # 4. Cercanía a vías primarias/secundarias y centros poblados (distancia del centroide, km)
    vias = [g for g, f in zip(capa('vias_jerarquia'), (leer(os.path.join(CAPAS, 'vias_jerarquia.geojson')) or {'features': []})['features'])
            if f['properties'].get('clase') in ('primaria', 'secundaria')]
    cp_fc = leer(os.path.join(BASE, 'centros_poblados_rurales_2026.geojson')) or {'features': []}
    cps = []
    for f in cp_fc['features']:
        try: cps.append(shape(f['geometry']).centroid)
        except Exception: pass
    av = STRtree(vias) if vias else None; ac = STRtree(cps) if cps else None
    dvia = []; dcp = []
    for g in G:
        c = g.representative_point()
        dvia.append(vias[av.nearest(c)].distance(c) * 111.32 if av else 99)
        dcp.append(cps[ac.nearest(c)].distance(c) * 111.32 if ac else 99)
    cerca = [1 / (1 + a) + 1 / (1 + b) for a, b in zip(dvia, dcp)]

    # 5. Valores a proteger
    def toca(gs):
        if not gs: return [False] * n
        t = STRtree(gs)
        return [any(gs[j].intersects(g) for j in t.query(g)) for g in G]
    t_par, t_sin, t_res = toca(capa('paramos')), toca(capa('sinap')), toca(capa('resguardos'))

    # 6. Clima (IDW de los 4 puntos más cercanos)
    cl = leer('clima_actual.json') or {'puntos': []}
    cp = cl['puntos']
    def idw(c, k):
        ds = sorted(((math.hypot(p['lon'] - c.x, p['lat'] - c.y), p[k]) for p in cp if p.get(k) is not None))[:4]
        if not ds: return None
        w = [1 / max(d, 1e-4) ** 2 for d, _ in ds]
        return sum(wi * v for wi, (_, v) in zip(w, ds)) / sum(w)

    rq, ra, rd, rc = rango(quema), rango([float(a) for a in anios]), rango(defo), rango(cerca)
    filas = []
    for i, g in enumerate(G):
        c = g.representative_point()
        an_t, secos, ll, an_h, dpv = idw(c, 'an_tmax_7f'), idw(c, 'secos_hoy'), idw(c, 'lluvia_30d_pct'), idw(c, 'an_hr_7f'), idw(c, 'dpv_max_7f')
        H = 0.35 * clamp((an_t or 0) / 3) + 0.25 * clamp((secos or 0) / 20) + 0.25 * clamp((100 - (ll if ll is not None else 100)) / 80) + 0.15 * clamp(-(an_h or 0) / 10)
        S = 0.40 * rq[i] + 0.20 * ra[i] + 0.20 * rd[i] + 0.20 * rc[i]
        A = clamp(calor[i] / 3)
        R = S * (0.4 + 0.6 * H) + 0.15 * A
        razones = []
        if an_t is not None and an_t >= 1: razones.append('Tmax +%.1f °C sobre lo normal (próx. 7 días)' % an_t)
        if secos and secos >= 5: razones.append('%d días seguidos sin lluvia' % round(secos))
        if ll is not None and ll < 70: razones.append('lluvia de 30 días al %d %% de lo normal' % round(ll))
        if an_h is not None and an_h <= -3: razones.append('humedad relativa %.0f puntos bajo lo normal' % an_h)
        if anios[i] >= 3: razones.append('fuego en %d de 26 años (MapBiomas)' % anios[i])
        if calor[i]: razones.append('%d puntos de calor en 30 días' % calor[i])
        if defo[i] >= 1: razones.append('%.1f ha de alertas de deforestación (90 días)' % defo[i])
        if dvia[i] < 1: razones.append('a %.1f km de vía primaria/secundaria' % dvia[i])
        filas.append({'id': P[i].get('id'), 'ver': P[i].get('ver'), 'mun': P[i].get('mun'), 'riesgo': round(R, 4),
                      'S': round(S, 3), 'H': round(H, 3), 'A': round(A, 2), 'km2': round(area[i], 2),
                      'quema_ha_km2': round(quema[i], 2), 'anios_fuego': anios[i], 'defo90_ha': round(defo[i], 2), 'calor30': calor[i],
                      'an_tmax_7f': None if an_t is None else round(an_t, 1), 'secos': None if secos is None else round(secos),
                      'lluvia30_pct': None if ll is None else round(ll), 'an_hr_7f': None if an_h is None else round(an_h, 1),
                      'dpv': None if dpv is None else round(dpv, 2), 'km_via': round(dvia[i], 2), 'km_centro_poblado': round(dcp[i], 2),
                      'paramo': t_par[i], 'sinap': t_sin[i], 'resguardo': t_res[i], 'razones': razones})
    filas.sort(key=lambda f: -f['riesgo'])
    for k, f in enumerate(filas):
        f['puesto'] = k + 1
        f['nivel'] = 'vigilar' if k < 0.05 * n else ('atencion' if k < 0.15 * n else 'normal')
    guardar('vigilancia.json', {'metodo': 'Índice de priorización v1.0 (ver metodologia.html)',
                                'actualizado': ahora.strftime('%Y-%m-%dT%H:%M:%SZ'), 'clima_hoy': cl.get('hoy'), 'veredas': filas})
    print('Top 10:')
    for f in filas[:10]: print('  %2d %-28s %-12s R=%.3f  %s' % (f['puesto'], f['ver'], f['mun'], f['riesgo'], '; '.join(f['razones'][:3])))


if __name__ == '__main__':
    main()
