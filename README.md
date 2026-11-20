# SAT Caldas · Sistema de alertas tempranas de incendios y deforestación

Página estática (GitHub Pages) + scripts en Python que corren gratis en GitHub Actions. Sin Google Earth Engine,
sin servidores y sin costos. La vista está restringida al departamento de Caldas.

## Qué muestra

| Pestaña | Contenido | Fuente | Actualización |
|---|---|---|---|
| Sitios a vigilar | Ranking de veredas por índice de riesgo con sus razones (clima + susceptibilidad + actividad) | Cálculo propio (`calcular_vigilancia.py`) | cada 3 h / diario |
| Incendios | Puntos de calor del último año completo (24 h · 7 d · 30 d · 12 meses), densidad, serie mensual, MapBiomas Fuego 2000-2025, probabilidad ICV | NASA FIRMS, IDEAM, MapBiomas | cada 3 h |
| Deforestación | Rastreador semanal por municipio y vereda, CSV, puntos en mapa | GFW alertas integradas (GLAD-L, GLAD-S2, RADD, DIST) | diario |
| Clima | Anomalías de Tmax, días secos, lluvia vs. normal, HR, DPV; serie 30 d + pronóstico 16 d | Open-Meteo (ERA5 / best_match) | diario |
| Especies | Registros del equipo (`data/especies.geojson` o carga CSV/GeoJSON en la página) | SiB Colombia / equipo | manual |
| Capas | Obligatorias: SINAP, páramos, EEP nov. 2026, resguardos, ríos principales, drenajes, vías primarias/secundarias/terciarias. Histórico: Hansen 2001-2025, IDEAM cambio de bosque 1990-2024, DTD trimestral IDEAM | Corpocaldas, ANT, IDEAM, GFW/UMD, OSM | mensual / en vivo |

Enlaces directos: `index.html#m=deforestacion&mun=Samaná`, `#m=vigilancia&ver=<id vereda>`.

**Llave FIRMS (opcional, gratuita):** para completar el año en curso con FIRMS, pida una llave en
https://firms.modaps.eosdis.nasa.gov/api/map_key/ y guárdela como secreto `FIRMS_MAP_KEY` del repositorio
(Settings → Secrets and variables → Actions). Sin llave, el año se cubre con IDEAM.

## Estructura

```
index.html, app/            página (Leaflet + esri-leaflet, sin compilar)
data/base/                  datos fijos: límite de Caldas, MapBiomas Fuego por vereda, centros poblados 2026
data/capas/                 capas de referencia recortadas a Caldas (preparar_capas.py)
data/*.json                 datos dinámicos (FIRMS, IDEAM, GFW, clima, especies, vigilancia)
herramientas/               scripts de actualización
.github/workflows/          automatización
docs/diseno.md              diseño, fuentes y hoja de ruta
```

## Correr localmente

```
pip install -r requirements.txt
python herramientas/preparar_capas.py        # una vez
python herramientas/actualizar_firms.py
python herramientas/actualizar_ideam.py
python herramientas/actualizar_deforestacion.py
python herramientas/actualizar_clima.py      # las normales se completan por partes (cuota gratuita)
python herramientas/calcular_vigilancia.py
python -m http.server 8000                   # abrir http://localhost:8000
```

## Advertencias

- Los puntos de calor son detecciones térmicas, no incendios confirmados.
- Las alertas GFW de confianza nominal pueden incluir falsas alarmas (nubes); filtre por confianza alta.
- El índice de sitios a vigilar es **preliminar** (fase 1); la fase 3 lo reemplaza por un modelo entrenado y validado.
- Las anomalías de temperatura comparan pronóstico con normales de reanálisis y pueden tener sesgo de modelo.
