# SAT Caldas · Diseño (noviembre 2026)

## Propósito
Generar **sitios para vigilar de cerca** en Caldas durante el fenómeno de El Niño 2026-2027, combinando alertas
satelitales de fuego y deforestación con un modelo entre clima (temperatura, lluvia, humedad) y condiciones del
territorio (coberturas, suelos, NDVI, cercanía a vías y centros poblados). Debe ser **gratis e independiente**
(sin cuotas de cómputo de Google Earth Engine) y la vista debe limitarse a Caldas.

## Enfoque elegido
Página estática + GitHub Actions (gratis). Alternativas descartadas: todo en el navegador (CORS, llaves expuestas,
no permite entrenar modelo) y tarea programada en un PC (se cae si el equipo está apagado).

## Fuentes y cómo se obtienen
| Tema | Fuente | Acceso |
|---|---|---|
| Puntos de calor (último año completo) | IDEAM puntosdecalor (365 días); NASA FIRMS: archivos anuales por país + NRT 7 d, y API de área con llave gratuita `FIRMS_MAP_KEY` para el año en curso | sin llave / llave gratuita |
| Fuego histórico | MapBiomas Fuego Col. 1, 2000-2025 (procesado por vereda) | archivo fijo |
| Probabilidad de incendio | IDEAM StoryMaps_IDA/Alertas_ICV | en vivo |
| Deforestación semanal | GFW alertas integradas; teselas públicas z12 con fecha codificada (R·255+G = días desde 2014-12-31; B//100 = confianza) | sin llave |
| Deforestación trimestral | IDEAM Hosted/DTD_Trimestral (cod_depto = 17) | sin llave |
| Histórico | IDEAM Dinamica_Cambio_Cobertura_Bosque 1990-2024, Superficie_Bosque; Hansen/UMD v1.13 2001-2025 (teselas GFW) | en vivo |
| Clima | Open-Meteo: archivo (normales 2016-2025) y pronóstico (30 d pasados + 16 d) | sin llave, cuota ~10 000/día |
| Especies | Datos del equipo (SiB Colombia / GBIF) en `data/especies.geojson`, o carga directa CSV/GeoJSON en la página | archivo propio |
| Áreas protegidas, páramos, EEP | Corpocaldas EEPNoviembre2026 (capas 1, 7, 8, 163, 165, 187), EstructuraEcologica/217 | sin llave |
| Resguardos | ANT Resguardo_Indigena_Formalizado | sin llave |
| Ríos | Corpocaldas red hídrica Strahler (≥5 vector; 1-4 en vivo) | sin llave |
| Vías | OSM (jerarquía primaria/secundaria/terciaria) + Corpocaldas (carretera, carreteable, sendero) | sin llave |
| Población | Corpocaldas centros poblados rurales y suelo urbano 2026 | archivo fijo |

Notas: la capa "Ríos Principales" de Corpocaldas solo trae Cauca y Magdalena; la capa IDEAM de zonas deforestadas
2013-2024 no cubre Caldas; los códigos viales de Corpocaldas (V1-V4) son tipo físico, no jerarquía funcional.

## Índice preliminar (fase 1)
`riesgo = S·(0,4 + 0,6·H) + 0,15·A` por vereda. Pesos y umbrales en `herramientas/calcular_vigilancia.py`.
Niveles: 5 % superior = vigilar de cerca; siguiente 10 % = atención.

## Diseño de la interfaz
Estilo institucional (blanco, trazos finos, verde bosque), inspirado en el patrón de Global Forest Watch (riel de módulos,
tarjetas de capa con interruptor, leyenda viva con opacidad y fuente) y MapBiomas Alerta (selector de territorio, tarjetas de
indicadores). Colores cartográficos convencionales: SINAP verde, páramos lila, resguardos marrón, ríos azul, vías primarias
rojo / secundarias naranja / terciarias amarillo, pérdida de bosque magenta (convención GFW), fuego en rampa amarillo-rojo.
Rásters suavizados (interpolación del navegador + desenfoque leve; clima por IDW; fuego por densidad de núcleo).
Guía rápida en la primera visita.

## Hoja de ruta
1. **Fase 1 (hecha):** fuego del último año completo, clima y anomalías, capas obligatorias, índice preliminar.
2. **Fase 2 (hecha, versión inicial):** rastreador semanal de deforestación por municipio/vereda.
   Especies: el equipo carga sus propios datos (SiB Colombia).
3. **Fase 3 (anclada a la aplicación de reportes de campo, por desarrollar):** los reportes verificados en campo
   (incendio confirmado / falsa alarma, deforestación confirmada) serán la verdad de terreno para calibrar y validar
   el modelo de sitios a vigilar (clima + coberturas + NDVI + suelos + cercanía a vías y poblados) y para medir la
   precisión de cada fuente satelital en Caldas.
