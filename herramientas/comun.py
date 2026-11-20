"""Utilidades compartidas del sistema Vigía Fuego Caldas.
Todo es gratis y sin Google Earth Engine: servicios ArcGIS públicos, Open-Meteo, GBIF y teselas de GFW."""
import json, os, ssl, time, urllib.parse, urllib.request
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA = os.path.join(RAIZ, 'data')
SAL = DATA
BASE = os.path.join(DATA, 'base')
CAPAS = os.path.join(DATA, 'capas')
os.makedirs(CAPAS, exist_ok=True)

BBOX = (-76.1, 4.7, -74.5, 5.9)          # oeste, sur, este, norte
CORPO = 'https://swappweb.corpocaldas.gov.co/waserver/rest/services'
IDEAM = 'https://visualizador.ideam.gov.co/gisserver/rest/services'
ANT = 'https://services2.arcgis.com/RVvWzU3lgJISqdke/arcgis/rest/services'
UA = {'User-Agent': 'Mozilla/5.0 (VigiaFuego-Caldas; datos abiertos)'}

_ctx_laxo = ssl.create_default_context(); _ctx_laxo.check_hostname = False; _ctx_laxo.verify_mode = ssl.CERT_NONE


def bajar(url, timeout=120, intentos=3, binario=False, datos=None):
    """GET/POST con reintentos. El IDEAM publica su certificado sin cadena intermedia: se reintenta sin verificar TLS
    (son datos públicos de solo lectura)."""
    ult = None
    for i in range(intentos):
        for ctx in (None, _ctx_laxo):
            try:
                req = urllib.request.Request(url, data=datos, headers=UA)
                r = urllib.request.urlopen(req, timeout=timeout, context=ctx).read()
                return r if binario else r.decode('utf-8', 'replace')
            except ssl.SSLError as e:
                ult = e; continue
            except Exception as e:
                ult = e; break
        time.sleep(2 * (i + 1))
    raise RuntimeError('No se pudo descargar %s: %s' % (url[:120], ult))


def bajar_json(url, **kw):
    return json.loads(bajar(url, **kw))


def guardar(nombre, obj):
    ruta = os.path.join(SAL, nombre) if not os.path.isabs(nombre) else nombre
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print('  guardado', os.path.relpath(ruta, RAIZ), '%.0f KB' % (os.path.getsize(ruta) / 1024))


def leer(nombre, defecto=None):
    ruta = os.path.join(SAL, nombre) if not os.path.isabs(nombre) else nombre
    if not os.path.exists(ruta): return defecto
    with open(ruta, encoding='utf-8') as f: return json.load(f)


# ── Límite de Caldas ───────────────────────────────────────────────
_CALDAS = None
def caldas():
    """Polígono (shapely) de Caldas = unión de sus 27 municipios (data/caldas_limite.json)."""
    global _CALDAS
    if _CALDAS is None:
        j = json.load(open(os.path.join(BASE, 'caldas_limite.json'), encoding='utf-8'))
        polis = [shape({'type': 'Polygon', 'coordinates': p}) for p in j['poligonos']]
        _CALDAS = unary_union([p.buffer(0) for p in polis])
    return _CALDAS


# ── Consultas ArcGIS paginadas → GeoJSON en EPSG:4326 ─────────────
def arcgis_geojson(url_capa, where='1=1', campos='*', simplificar=None, bbox=BBOX, paso=None, recortar=True):
    """Descarga todas las entidades de una capa ArcGIS (MapServer o FeatureServer) dentro del bbox de Caldas.
    simplificar: tolerancia en grados (maxAllowableOffset) para aligerar polígonos/líneas."""
    meta = bajar_json(url_capa + '?f=json')
    maxr = paso or min(int(meta.get('maxRecordCount') or 1000), 2000)
    base = {'where': where, 'outFields': campos, 'outSR': '4326', 'f': 'geojson', 'returnGeometry': 'true',
            'geometry': '%s,%s,%s,%s' % bbox, 'geometryType': 'esriGeometryEnvelope', 'inSR': '4326',
            'spatialRel': 'esriSpatialRelIntersects'}
    if simplificar: base['maxAllowableOffset'] = str(simplificar); base['geometryPrecision'] = '5'
    ids = bajar_json(url_capa + '/query?' + urllib.parse.urlencode(dict(base, returnIdsOnly='true', f='json')))
    oids = sorted(ids.get('objectIds') or [])
    campo_id = ids.get('objectIdFieldName') or 'OBJECTID'
    feats = []
    maxr = min(maxr, 500)   # objectIds va en el cuerpo POST; lotes moderados evitan errores del servidor
    omitidos = []
    def lote_ok(lote, nivel=0):
        q = dict(base, objectIds=','.join(str(o) for o in lote))
        for intento in range(3):
            j = bajar_json(url_capa + '/query', datos=urllib.parse.urlencode(q).encode())
            if 'error' not in j: return j.get('features') or []
            time.sleep(1 + intento)
        if len(lote) == 1: omitidos.append(lote[0]); return []
        m = len(lote) // 2                   # el servidor falla de forma intermitente: se parte el lote
        return lote_ok(lote[:m], nivel + 1) + lote_ok(lote[m:], nivel + 1)
    for i in range(0, len(oids), maxr):
        feats.extend(lote_ok(oids[i:i + maxr]))
    if omitidos: print('  aviso: %d entidades no se pudieron leer del servidor' % len(omitidos))
    if recortar:
        C = caldas(); fuera = []
        for f in feats:
            if not f.get('geometry'): continue
            g = shape(f['geometry'])
            if not g.is_valid: g = g.buffer(0)
            if not g.intersects(C): continue
            if g.geom_type in ('Polygon', 'MultiPolygon', 'LineString', 'MultiLineString') and not C.contains(g):
                g = g.intersection(C)
                if g.is_empty: continue
            f['geometry'] = _redondear(mapping(g))
            fuera.append(f)
        feats = fuera
    return {'type': 'FeatureCollection', 'features': feats}


def _redondear(geom, n=5):
    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)): return [round(c[0], n), round(c[1], n)]
        return [r(x) for x in c]
    if geom['type'] == 'GeometryCollection':
        return {'type': 'GeometryCollection', 'geometries': [_redondear(g, n) for g in geom['geometries']]}
    return {'type': geom['type'], 'coordinates': r(geom['coordinates'])}


# ── Asignación de municipio y vereda a puntos ───────────────────────
class Ubicador:
    """Devuelve (municipio, vereda, id_vereda) para un punto usando data/alertas/capas/veredas.geojson."""
    def __init__(self):
        v = leer(os.path.join(CAPAS, 'veredas.geojson'))
        if not v: raise SystemExit('Falta data/capas/veredas.geojson: corra primero preparar_capas.py')
        self.geoms, self.props = [], []
        for f in v['features']:
            g = shape(f['geometry'])
            if not g.is_valid: g = g.buffer(0)
            self.geoms.append(g); self.props.append(f['properties'])
        self.arbol = STRtree(self.geoms)

    def __call__(self, lon, lat):
        p = Point(lon, lat)
        for i in self.arbol.query(p):
            if self.geoms[i].contains(p):
                pr = self.props[i]
                return pr.get('mun'), pr.get('ver'), pr.get('id')
        return None, None, None


def semana_iso(fecha):
    a, s, _ = fecha.isocalendar()
    return '%d-S%02d' % (a, s)
