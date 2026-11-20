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
| Puntos de calor | NASA FIRMS (archivos públicos 7 d), IDEAM puntosdecalor | sin llave |
| Fuego histórico | MapBiomas Fuego Col. 1, 2000-2025 (procesado por vereda) | archivo fijo |
| Probabilidad de incendio | IDEAM StoryMaps_IDA/Alertas_ICV | en vivo |
| Deforestación semanal | GFW alertas integradas; teselas públicas z12 con fecha codificada (R·255+G = días desde 2014-12-31; B//100 = confianza) | sin llave |
| Deforestación trimestral | IDEAM Hosted/DTD_Trimestral (cod_depto = 17) | sin llave |
| Histórico | IDEAM Dinamica_Cambio_Cobertura_Bosque 1990-2024, Superficie_Bosque; Hansen/UMD v1.13 2001-2025 (teselas GFW) | en vivo |
| Clima | Open-Meteo: archivo (normales 2016-2025) y pronóstico (30 d pasados + 16 d) | sin llave, cuota ~10 000/día |
| Especies | GBIF (incluye SiB Colombia), UICN CR/EN/VU | sin llave |
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

## Hoja de ruta
1. **Fase 1 (hecha):** fuego, clima y anomalías, capas obligatorias, especies, índice preliminar.
2. **Fase 2 (hecha en versión inicial):** rastreador semanal de deforestación por municipio/vereda. Pendiente:
   alertas por correo/Telegram cuando una vereda supere un umbral semanal.
3. **Fase 3:** modelo Random Forest entrenado sin GEE:
   - Malla de 250 m sobre Caldas; respuesta = quema MapBiomas por año (y pérdida Hansen por año).
   - Variables: coberturas IDEAM 100K 2024, NDVI y LST MODIS (Microsoft Planetary Computer, STAC gratis),
     clima Open-Meteo/ERA5-Land por año, suelos SoilGrids (WCS) y suelos/erosión IDEAM, pendiente y altitud
     (Copernicus DEM 30 m), distancia a vías, ríos y centros poblados.
   - Validación temporal: entrenar 2001-2019, probar 2020-2025 (AUC, sensibilidad en el 10 % superior).
   - Salida: probabilidad por celda que reemplaza a S; H pasa a usar las variables dinámicas del modelo.
   - Contraste de anomalías con estaciones del IDEAM (sesgo pronóstico vs. reanálisis).
