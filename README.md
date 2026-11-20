# Vigías del Fuego

**Sistema de Alerta Temprana de Incendios y Deforestación del departamento de Caldas**

Gobernación de Caldas – Secretaría de Medio Ambiente · Fundación para la Conservación de la Vida Silvestre en Colombia (FCV)

Vigías del Fuego integra en un visor web la información satelital, climática y territorial para la vigilancia de
incendios de la cobertura vegetal y de la pérdida de bosque en los 27 municipios y 1.208 veredas de Caldas.

## Módulos

| Módulo | Contenido |
|---|---|
| Vigilancia | Veredas priorizadas por el índice de priorización territorial, con las razones de cada nivel |
| Incendios | Puntos de calor NASA FIRMS e IDEAM del último año, densidad, serie mensual, frecuencia de quemas MapBiomas 2000-2025 y probabilidad de incendio del IDEAM |
| Deforestación | Seguimiento semanal de alertas de pérdida de bosque por municipio y vereda; detección temprana trimestral del IDEAM; histórico IDEAM 1990-2024 y Hansen 2001-2025 |
| Clima | Anomalías de temperatura, días sin lluvia, lluvia frente a lo normal, humedad y pronóstico a 16 días |
| Especies | Registros biológicos del equipo (archivo `data/especies.geojson` o carga directa CSV/GeoJSON) |
| Capas | Áreas protegidas SINAP, páramos, Estructura Ecológica Principal, resguardos indígenas, hidrografía, vías y límites |

La metodología completa está en [metodologia.html](metodologia.html).

## Estructura del repositorio

```
index.html            visor
metodologia.html      metodología y documentación
app/                  estilos, lógica del visor y logotipos
data/base/            datos fijos (límite, MapBiomas Fuego, centros poblados)
data/capas/           capas de referencia recortadas a Caldas
data/*.json           datos dinámicos (puntos de calor, alertas, clima, índice)
herramientas/         procesos de actualización
.github/workflows/    programación de las actualizaciones
```

## Actualización de datos

Los procesos se ejecutan automáticamente: puntos de calor e índice cada 3 horas, alertas de pérdida de bosque y clima
cada día, capas de referencia cada mes. Para ejecutarlos manualmente:

```
pip install -r requirements.txt
python herramientas/preparar_capas.py
python herramientas/actualizar_firms.py
python herramientas/actualizar_ideam.py
python herramientas/actualizar_deforestacion.py
python herramientas/actualizar_clima.py
python herramientas/calcular_vigilancia.py
```

Llave de NASA FIRMS (gratuita, opcional): permite completar con FIRMS el año en curso. Se solicita en
https://firms.modaps.eosdis.nasa.gov/api/map_key/ y se registra como secreto `FIRMS_MAP_KEY` del repositorio.

## Publicación

Sitio estático compatible con GitHub Pages (rama `main`, carpeta raíz).

## Fuentes

NASA FIRMS · IDEAM · Global Forest Watch / Universidad de Maryland · Hansen et al. (2013) · MapBiomas Colombia ·
Corpocaldas · Agencia Nacional de Tierras · OpenStreetMap · Open-Meteo / Copernicus ERA5.
