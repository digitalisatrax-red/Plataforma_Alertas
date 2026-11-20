"""Especies en Caldas desde GBIF (donde publica el SiB Colombia), gratis y sin llave.

1. Resumen por especie (facetas): número de registros, grupo taxonómico y categoría UICN.
2. Puntos de las especies amenazadas (UICN: CR, EN, VU) con coordenadas, recortados al polígono de Caldas.
Salida: data/especies.json"""
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from comun import *
from shapely.geometry import Point
from shapely.geometry.polygon import orient

API = 'https://api.gbif.org/v1/occurrence/search'
AMENAZA = ['CR', 'EN', 'VU']
MAX_PUNTOS = 30000


def wkt_caldas():
    g = caldas().buffer(0.02).simplify(0.02)   # polígono corto (URL); el recorte fino se hace después
    if g.geom_type == 'MultiPolygon': g = max(g.geoms, key=lambda x: x.area)
    g = orient(g, 1.0)    # GBIF exige polígonos en sentido antihorario
    return 'POLYGON((%s))' % ','.join('%.4f %.4f' % c for c in g.exterior.coords)


def main():
    W = wkt_caldas(); C = caldas()
    base = {'geometry': W, 'hasCoordinate': 'true', 'hasGeospatialIssue': 'false', 'occurrenceStatus': 'PRESENT'}
    tot = bajar_json(API + '?' + urllib.parse.urlencode(dict(base, limit=0)))['count']
    print('Registros GBIF en Caldas:', tot)
    # Resumen por clase y por especie amenazada
    fac = bajar_json(API + '?' + urllib.parse.urlencode(dict(base, limit=0, facet='classKey', facetLimit=60)))
    clases = []
    for f in fac['facets'][0]['counts'] if fac.get('facets') else []:
        try: nom = bajar_json('https://api.gbif.org/v1/species/%s' % f['name']).get('canonicalName')
        except Exception: nom = f['name']
        clases.append([nom, f['count']])
    pts, especies = [], {}
    for cat in AMENAZA:
        off = 0
        while off < 100000 and len(pts) < MAX_PUNTOS:
            j = bajar_json(API + '?' + urllib.parse.urlencode(dict(base, iucnRedListCategory=cat, limit=300, offset=off)), timeout=120)
            for r in j.get('results', []):
                la, lo = r.get('decimalLatitude'), r.get('decimalLongitude')
                if la is None or not C.contains(Point(lo, la)): continue
                sp = r.get('species') or r.get('scientificName')
                e = especies.setdefault(sp, {'cat': cat, 'n': 0, 'clase': r.get('class'), 'reino': r.get('kingdom'),
                                             'nombre_comun': r.get('vernacularName') or ''})
                e['n'] += 1
                pts.append([round(la, 4), round(lo, 4), sp, (r.get('eventDate') or '')[:10], r.get('basisOfRecord', '')[:1]])
            off += 300
            if j.get('endOfRecords'): break
            time.sleep(.3)
        print(' ', cat, sum(1 for e in especies.values() if e['cat'] == cat), 'especies')
    guardar('especies.json', {'fuente': 'GBIF.org (incluye datos publicados por el SiB Colombia); categoría UICN según GBIF',
                              'actualizado': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                              'registros_total': tot, 'clases': clases, 'amenazadas': especies, 'pts': pts,
                              'consulta': 'https://www.gbif.org/occurrence/search?geometry=' + urllib.parse.quote(W)})


if __name__ == '__main__':
    main()
