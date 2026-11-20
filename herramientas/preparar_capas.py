"""Descarga y recorta a Caldas las capas de referencia obligatorias del SAT-Caldas → data/capas/*.geojson
Se corre una vez y luego mensualmente (GitHub Actions). Uso:  python herramientas/preparar_capas.py [nombre ...]

Capas:
  veredas, paramos, sinap, rnsc, ley2, aica, eep_componentes  (Corpocaldas, EEP noviembre 2026)
  resguardos                                                  (Agencia Nacional de Tierras)
  rios_principales                                            (Corpocaldas, cartografía base)
  dtd_ideam            puntos trimestrales de Detección Temprana de Deforestación (IDEAM-SMByC)
  deforestacion_ideam  zonas deforestadas 2013-2024 por vereda (IDEAM-SMByC)
Los drenajes (Strahler) y la red vial por tipo se muestran en vivo desde Corpocaldas (son > 35 MB)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from comun import *
from comun import _redondear

def props(fc, mapa):
    """Conserva solo los campos útiles y los renombra: mapa = {nuevo: campo_original}."""
    for f in fc['features']:
        p = f.get('properties') or {}
        low = {k.lower(): v for k, v in p.items()}
        f['properties'] = {n: (p.get(o) if o in p else low.get(o.lower())) for n, o in mapa.items()}
    return fc

CLASE_OSM = {'motorway': 'primaria', 'trunk': 'primaria', 'primary': 'primaria', 'motorway_link': 'primaria', 'trunk_link': 'primaria',
             'primary_link': 'primaria', 'secondary': 'secundaria', 'secondary_link': 'secundaria', 'tertiary': 'terciaria',
             'tertiary_link': 'terciaria', 'unclassified': 'terciaria'}

def vias_osm():
    """Red vial jerarquizada de OpenStreetMap (Overpass API, gratis). primaria = trunk/primary, secundaria = secondary,
    terciaria = tertiary/unclassified. Se recorta al límite de Caldas."""
    w, s_, e, n = BBOX
    q = '[out:json][timeout:180];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)(_link)?$"](%s,%s,%s,%s);out tags geom;' % (s_, w, n, e)
    j = None
    for srv in ('https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'):
        try:
            req = urllib.request.Request(srv, data=urllib.parse.urlencode({'data': q}).encode(),
                                         headers={'User-Agent': 'SAT-Caldas/1.0 (datos abiertos)', 'Accept': 'application/json'})
            j = json.loads(urllib.request.urlopen(req, timeout=300).read()); break
        except Exception as ex: print('  Overpass', srv, ex)
    if not j: return {'type': 'FeatureCollection', 'features': []}
    from shapely.geometry import LineString
    C = caldas(); feats = []
    for el in j.get('elements', []):
        g = el.get('geometry')
        if not g or len(g) < 2: continue
        ln = LineString([(p['lon'], p['lat']) for p in g]).simplify(0.0001)
        if not ln.intersects(C): continue
        if not C.contains(ln): ln = ln.intersection(C)
        if ln.is_empty: continue
        t = el.get('tags', {})
        feats.append({'type': 'Feature', 'geometry': _redondear(mapping(ln)),
                      'properties': {'clase': CLASE_OSM.get(t.get('highway'), 'terciaria'), 'osm': t.get('highway'),
                                     'nombre': t.get('name') or t.get('ref') or '', 'ref': t.get('ref', '')}})
    return {'type': 'FeatureCollection', 'features': feats}

CAPAS_DEF = {
    'veredas': lambda: props(arcgis_geojson(CORPO + '/CartografiaBase/MapServer/10', simplificar=0.0003),
                             {'id': 'ID_VEREDA', 'ver': 'NOMBRE', 'mun': 'MUNICIPIO', 'codmun': 'CODMPO'}),
    'paramos': lambda: props(arcgis_geojson(CORPO + '/EEPNoviembre2026/MapServer/165', simplificar=0.0002),
                             {'complejo': 'cmpljnom', 'distrito': 'distrnom', 'sector': 'sectornom'}),
    'sinap': lambda: props(arcgis_geojson(CORPO + '/EEPNoviembre2026/MapServer/1', simplificar=0.0002),
                           {'nombre': 'NOMBRE', 'categoria': 'CATEGORIA', 'acto': 'ACTO_ADMON', 'ha': 'AREA_HA'}),
    'rnsc': lambda: arcgis_geojson(CORPO + '/EEPNoviembre2026/MapServer/187', simplificar=0.0001),
    'ley2': lambda: arcgis_geojson(CORPO + '/EEPNoviembre2026/MapServer/163', simplificar=0.0008),
    'aica': lambda: arcgis_geojson(CORPO + '/EstructuraEcologica/MapServer/217', simplificar=0.0002),
    'eep_componentes': lambda: arcgis_geojson(CORPO + '/EEPNoviembre2026/MapServer/7', simplificar=0.0003),
    'resguardos': lambda: props(arcgis_geojson(ANT + '/Resguardo_Indigena_Formalizado/FeatureServer/0', simplificar=0.0002),
                                {'nombre': 'NOMBRE', 'pueblo': 'PUEBLO', 'acto': 'ULTIMO_TIP', 'fecha': 'ULTIMA_FEC', 'ha': 'AREA_TOTAL'}),
    # Ríos principales = red hídrica Strahler de orden ≥ 5 (la capa "Ríos Principales" de Corpocaldas solo trae Cauca y Magdalena)
    'rios_principales': lambda: props(arcgis_geojson(CORPO + '/CartografiaBase/MapServer/18', where='Straler>=5', simplificar=0.0002),
                                      {'nombre': 'NOMBRE', 'orden': 'Straler'}),
    # Corpocaldas (cartografía base): V1 Carretera, V2 Carreteable (V3 Sendero se ve en vivo)
    'vias_corpocaldas': lambda: props(arcgis_geojson(CORPO + '/CartografiaBase/MapServer/15', where="tipo IN ('V1','V2')", simplificar=0.0002),
                                      {'tipo': 'tipo', 'nombre': 'nombre'}),
    # Jerarquía funcional (primaria / secundaria / terciaria) desde OpenStreetMap
    'vias_jerarquia': lambda: vias_osm(),
    'dtd_ideam': lambda: props(arcgis_geojson(IDEAM + '/Hosted/DTD_Trimestral/FeatureServer/0', where="cod_depto='17'", recortar=False),
                               {'anio': 'anio', 'periodo': 'periodo', 'mun': 'nom_mpio', 'runap': 'nom_runap', 'cat_runap': 'cat_runap', 'nucleo': 'nucleo_tri'}),
    # Nota: la capa IDEAM 'zonas_deforestadas_2013_2024' no cubre Caldas; el histórico IDEAM se muestra en vivo
    # desde Dinamica_Cambio_Cobertura_Bosque (1990-2024) en alertas.html.
}


def main():
    nombres = sys.argv[1:] or list(CAPAS_DEF)
    resumen = leer('capas/_indice.json', {})
    for n in nombres:
        print('·', n)
        try:
            fc = CAPAS_DEF[n]()
        except Exception as e:
            print('  FALLÓ:', e); continue
        if not fc['features']:
            print('  sin entidades; se conserva la versión anterior'); continue
        guardar(os.path.join(CAPAS, n + '.geojson'), fc)
        resumen[n] = {'n': len(fc['features']), 'actualizado': time.strftime('%Y-%m-%d')}
    guardar(os.path.join(CAPAS, '_indice.json'), resumen)

if __name__ == '__main__':
    main()
