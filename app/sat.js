/* Vigías del Fuego · Sistema de Alerta Temprana de Incendios y Deforestación.
   Página estática: lee los JSON que generan los scripts de herramientas/ (GitHub Actions) y servicios públicos en vivo.
   La vista está restringida a Caldas (máscara + límites de navegación). Todas las capas pasan por un registro único
   (REG) que define su color cartográfico, su leyenda, su opacidad y su fuente. */
(function () {
  'use strict';
  var V = '?v=' + Math.floor(Date.now() / 6e5);
  var CORPO = 'https://swappweb.corpocaldas.gov.co/waserver/rest/services';
  var IDEAM = 'https://visualizador.ideam.gov.co/gisserver/rest/services';
  var D = {}, F = { mun: '', ver: '' };
  var E = { mod: 'vigilancia', fuegoP: 365, fuegoVista: 'densidad', defoConf: 'todas', defoSem: 26, defoMapa: 12, climaVar: 'an_tmax_7f', climaSel: null };
  var map, mascara, resaltado, fondoActual;

  /* ── íconos ─────────────────────────────────── */
  var IC = {
    vigilancia: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    incendios: '<path d="M12 22c4.4 0 7-3 7-7 0-3-1.6-5.4-3.4-7.3-.4 1.8-1.4 3.1-2.6 3.6.2-3.3-1.3-6.4-4-8.3.3 3.2-1.4 5.3-3 7.2C4.7 11.8 5 13 5 15c0 4 2.6 7 7 7Z"/>',
    deforestacion: '<path d="M12 2 6 10h3l-4 6h6v6h2v-6h6l-4-6h3Z"/><path d="m3 21 4-4"/>',
    clima: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z"/><path d="M12 10v7"/>',
    campo: '<path d="M12 2a3 3 0 0 0-3 3v1h6V5a3 3 0 0 0-3-3Z"/><rect x="7" y="6" width="10" height="16" rx="2"/><path d="M10 11h4M10 15h4"/><path d="M17 9l3-3M17 13h3"/>',
    especies: '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.3-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3M14 17.8V21"/>',
    capas: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    ojoNo: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6M2 2l20 20"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    subir: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    bajar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    tabla: '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/>'
  };
  function ic(n) { return '<svg class="i" viewBox="0 0 24 24">' + IC[n] + '</svg>'; }

  /* ── utilidades ─────────────────────────────── */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n, d) { return n == null || isNaN(n) ? '–' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); }
  function fecha(t) { try { return new Date(t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }); } catch (e) { return t; } }
  function fechaCorta(d) { return new Date(d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' }); }
  function hace(t) { var h = (Date.now() - new Date(t).getTime()) / 36e5; return h < 1 ? 'hace ' + Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? 'hace ' + Math.round(h) + ' h' : 'hace ' + Math.round(h / 24) + ' días'; }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  async function json(url) { var r = await fetch(url + V, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function opt(url) { try { return await json(url); } catch (e) { return null; } }
  function pp(titulo, filas) { return '<h3>' + esc(titulo) + '</h3>' + filas.filter(function (f) { return f[1] != null && f[1] !== ''; }).map(function (f) { return '<div class="pp-fila"><span>' + esc(f[0]) + '</span><span>' + esc(f[1]) + '</span></div>'; }).join(''); }
  function isoSemana(d) { var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); var dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia); var a = t.getUTCFullYear(); return a + '-S' + String(Math.ceil(((t - Date.UTC(a, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0'); }
  function lunes(d) { var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() || 7) - 1)); return t; }
  function mezcla(a, b, t) { var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); }), pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); }); return '#' + pa.map(function (x, i) { return Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, '0'); }).join(''); }
  function rampa(stops, t) { t = Math.max(0, Math.min(1, t)); var n = stops.length - 1, k = Math.min(n - 1, Math.floor(t * n)); return mezcla(stops[k], stops[k + 1], t * n - k); }

  /* ── vereda de un punto ─────────────────────── */
  var idxVer = [];
  function prepVeredas() {
    D.veredas.features.forEach(function (f) {
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates, bb = [180, 90, -180, -90];
      polys.forEach(function (p) { p[0].forEach(function (c) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }); });
      idxVer.push({ p: f.properties, polys: polys, bb: bb });
    });
  }
  function anillo(x, y, r) { var d = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; }
  function vereda(lon, lat) {
    for (var k = 0; k < idxVer.length; k++) { var v = idxVer[k]; if (lon < v.bb[0] || lon > v.bb[2] || lat < v.bb[1] || lat > v.bb[3]) continue;
      for (var q = 0; q < v.polys.length; q++) { var p = v.polys[q]; if (anillo(lon, lat, p[0]) && !p.slice(1).some(function (h) { return anillo(lon, lat, h); })) return v.p; } }
    return null;
  }
  function pasa(mun, verId) { if (F.ver) return String(verId) === F.ver; if (F.mun) return norm(mun) === norm(F.mun); return true; }
  function nombreFiltro() { if (F.ver) { var v = idxVer.find(function (x) { return String(x.p.id) === F.ver; }); return v ? 'vereda ' + v.p.ver + ' (' + v.p.mun + ')' : ''; } return F.mun || 'todo Caldas'; }

  /* ── registro de capas ──────────────────────── */
  // tipo de leyenda: area | linea | punto | rampa | clases
  function area(c, o) { return Object.assign({ color: c, weight: 1.6, opacity: 1, fillColor: c, fillOpacity: .22 }, o || {}); }
  function geo(archivo, estilo, onEach, filtro, pane) {
    return async function () { var fc = await json('data/capas/' + archivo + '.geojson'); return L.geoJSON(fc, { pane: pane || 'overlayPane', style: typeof estilo === 'function' ? estilo : function () { return estilo; }, onEachFeature: onEach, filter: filtro }); };
  }
  function vivo(url, ids, defs) { return function () { return L.esri.dynamicMapLayer({ url: url, layers: ids, layerDefs: defs, opacity: 1, format: 'png32', className: 'raster-suave' }); }; }
  function popup(titulo, campos) { return function (f, l) { var p = f.properties || {}; l.bindPopup(pp(titulo, campos.map(function (c) { return [c[1], p[c[0]]]; }))); }; }
  var GRUPOS = ['Límites y población', 'Conservación', 'Agua', 'Vías', 'Deforestación histórica'];
  var REG = {
    municipios: { g: 'Límites y población', n: 'Límite municipal', tipo: 'linea', c: '#12355b', obl: true, on: true, f: 'Corpocaldas · cartografía base',
      crear: geo('municipios', { color: '#12355b', weight: 1.4, opacity: .9, fill: false, dashArray: '6 3' }, function (f, l) { l.bindTooltip(f.properties.mun, { sticky: true }); }, null, 'limites') },
    veredas: { g: 'Límites y población', n: 'Límite veredal', tipo: 'linea', c: '#8a9a94', f: 'Corpocaldas · cartografía base (1.208 veredas)',
      crear: async function () { return L.geoJSON(D.veredas, { style: { color: '#6b7c76', weight: .6, fill: false, opacity: .9 }, onEachFeature: function (f, l) { l.bindTooltip(f.properties.ver + ' · ' + f.properties.mun, { sticky: true }); } }); } },
    centros: { g: 'Límites y población', n: 'Centros poblados y suelo urbano 2026', tipo: 'area', c: '#5d4037', obl: true, f: 'Corpocaldas · ERA 2026',
      crear: async function () { var a = await json('data/base/centros_poblados_rurales_2026.geojson'), b = await json('data/base/suelos_urbanos_2026.geojson');
        return L.featureGroup([L.geoJSON(b, { style: area('#5d4037', { fillOpacity: .45, weight: 1 }) }), L.geoJSON(a, { style: area('#8d6e63', { fillOpacity: .5, weight: 1 }), onEachFeature: function (f, l) { l.bindPopup('<h3>Centro poblado rural</h3>'); } })]); } },
    sinap: { g: 'Conservación', n: 'Áreas protegidas SINAP', tipo: 'area', c: '#2e7d32', obl: true, on: true, f: 'Corpocaldas · Estructura Ecológica Principal, noviembre 2026',
      crear: geo('sinap', area('#2e7d32', { fillOpacity: .25 }), popup('Área protegida SINAP', [['nombre', 'Nombre'], ['categoria', 'Categoría'], ['acto', 'Acto administrativo'], ['ha', 'Hectáreas']])) },
    rnsc: { g: 'Conservación', n: 'Reservas Naturales de la Sociedad Civil', tipo: 'area', c: '#66bb6a', f: 'Corpocaldas · EEP noviembre 2026', crear: geo('rnsc', area('#66bb6a', { fillOpacity: .3 }), function (f, l) { l.bindPopup('<h3>Reserva Natural de la Sociedad Civil</h3>'); }) },
    paramos: { g: 'Conservación', n: 'Páramos', tipo: 'area', c: '#7e57c2', obl: true, on: true, f: 'Corpocaldas · EEP noviembre 2026 (complejos Los Nevados y Sonsón)',
      crear: geo('paramos', area('#7e57c2', { fillOpacity: .28 }), popup('Páramo', [['complejo', 'Complejo'], ['distrito', 'Distrito'], ['sector', 'Sector']])) },
    eep: { g: 'Conservación', n: 'Estructura Ecológica Principal (componentes)', tipo: 'linea', c: '#1b5e20', obl: true, on: true, f: 'Corpocaldas · EEP noviembre 2026', crear: geo('eep_componentes', area('#1b5e20', { fillOpacity: .06, dashArray: '5 4', weight: 2 })) },
    eepvivo: { g: 'Conservación', n: 'EEP · elementos constituyentes (en vivo)', tipo: 'area', c: '#43a047', obl: true, f: 'Corpocaldas · EEPNoviembre2026 capa 8, consultada en vivo', crear: vivo(CORPO + '/EEPNoviembre2026/MapServer', [8]), op: .7 },
    resguardos: { g: 'Conservación', n: 'Resguardos indígenas', tipo: 'area', c: '#a0522d', obl: true, on: true, f: 'Agencia Nacional de Tierras · resguardos formalizados',
      crear: geo('resguardos', area('#a0522d', { fillOpacity: .22, weight: 2.2, dashArray: '8 3' }), popup('Resguardo indígena', [['nombre', 'Nombre'], ['pueblo', 'Pueblo'], ['acto', 'Acto'], ['ha', 'Hectáreas']])) },
    ley2: { g: 'Conservación', n: 'Reserva Forestal Central (Ley 2ª)', tipo: 'area', c: '#9e9d24', f: 'Corpocaldas · EEP noviembre 2026', crear: geo('ley2', area('#9e9d24', { fillOpacity: .08, dashArray: '6 4' })) },
    aica: { g: 'Conservación', n: 'AICA · áreas importantes para aves', tipo: 'area', c: '#d81b60', f: 'Corpocaldas · Estructura Ecológica Complementaria', crear: geo('aica', area('#d81b60', { fillOpacity: .12 })) },
    rios: { g: 'Agua', n: 'Ríos principales', tipo: 'linea', c: '#1565c0', obl: true, on: true, f: 'Corpocaldas · red hídrica Strahler, orden ≥ 5',
      crear: geo('rios_principales', function (f) { var o = f.properties.orden; return { color: '#1565c0', weight: o >= 7 ? 3.6 : o >= 6 ? 2.6 : 1.7, opacity: 1 }; }, popup('Río', [['nombre', 'Nombre'], ['orden', 'Orden Strahler']])) },
    drenajes: { g: 'Agua', n: 'Drenajes (orden 1-4, en vivo)', tipo: 'linea', c: '#64b5f6', obl: true, f: 'Corpocaldas · red hídrica Strahler, consultada en vivo', crear: vivo(CORPO + '/CartografiaBase/MapServer', [18], { 18: 'Straler<5' }) },
    v_pri: { g: 'Vías', n: 'Vías primarias', tipo: 'linea', c: '#c62828', obl: true, on: true, f: 'OpenStreetMap (trunk / primary)', ancho: 3.4,
      crear: geo('vias_jerarquia', { color: '#c62828', weight: 3.4, opacity: 1 }, popup('Vía primaria', [['nombre', 'Nombre'], ['ref', 'Ruta']]), function (f) { return f.properties.clase === 'primaria'; }) },
    v_sec: { g: 'Vías', n: 'Vías secundarias', tipo: 'linea', c: '#ef6c00', obl: true, on: true, f: 'OpenStreetMap (secondary)', ancho: 2.2,
      crear: geo('vias_jerarquia', { color: '#ef6c00', weight: 2.2, opacity: 1 }, popup('Vía secundaria', [['nombre', 'Nombre'], ['ref', 'Ruta']]), function (f) { return f.properties.clase === 'secundaria'; }) },
    v_ter: { g: 'Vías', n: 'Vías terciarias', tipo: 'linea', c: '#f9a825', obl: true, f: 'OpenStreetMap (tertiary / unclassified)', ancho: 1.4,
      crear: geo('vias_jerarquia', { color: '#f9a825', weight: 1.4, opacity: 1 }, popup('Vía terciaria', [['nombre', 'Nombre']]), function (f) { return f.properties.clase === 'terciaria'; }) },
    v_corpo: { g: 'Vías', n: 'Carreteables (Corpocaldas)', tipo: 'linea', c: '#8d6e63', f: 'Corpocaldas · red vial V1 carretera / V2 carreteable', dash: true,
      crear: geo('vias_corpocaldas', function (f) { return { color: '#8d6e63', weight: f.properties.tipo === 'V1' ? 1.6 : 1.1, dashArray: f.properties.tipo === 'V2' ? '4 3' : null }; }) },
    v_send: { g: 'Vías', n: 'Senderos (en vivo)', tipo: 'linea', c: '#a1887f', f: 'Corpocaldas · red vial V3, consultada en vivo', crear: vivo(CORPO + '/CartografiaBase/MapServer', [15], { 15: "tipo='V3'" }) },
    hansen: { g: 'Deforestación histórica', n: 'Pérdida de bosque Hansen 2021-2025', tipo: 'area', c: '#e8417f', f: 'Hansen/UMD/Google/USGS/NASA v1.13 vía Global Forest Watch (densidad de dosel ≥ 30 %)',
      crear: function () { return L.tileLayer('https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png?start_year=2021&end_year=2025&tree_cover_density_threshold=30&render_type=true_color', { maxNativeZoom: 12, maxZoom: 18, className: 'raster-suave' }); } },
    hansen01: { g: 'Deforestación histórica', n: 'Pérdida de bosque Hansen 2001-2020', tipo: 'area', c: '#f48fb1', f: 'Hansen/UMD v1.13 vía Global Forest Watch', op: .8,
      crear: function () { return L.tileLayer('https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png?start_year=2001&end_year=2020&tree_cover_density_threshold=30&render_type=true_color', { maxNativeZoom: 12, maxZoom: 18, className: 'raster-suave' }); } },
    ideamcb: { g: 'Deforestación histórica', n: 'IDEAM · cambio de bosque 2023-2024', tipo: 'area', c: '#b71c1c', f: 'IDEAM-SMByC · Dinámica de cambio de la cobertura de bosque', crear: vivo(IDEAM + '/Dinamica_Cambio_Cobertura_Bosque/MapServer', [15]) },
    ideamcb2: { g: 'Deforestación histórica', n: 'IDEAM · cambio de bosque 2020-2023', tipo: 'area', c: '#e57373', f: 'IDEAM-SMByC · periodos 2020-2021, 2021-2022, 2022-2023', crear: vivo(IDEAM + '/Dinamica_Cambio_Cobertura_Bosque/MapServer', [12, 13, 14]) },
    ideambnb: { g: 'Deforestación histórica', n: 'IDEAM · bosque / no bosque 2024', tipo: 'area', c: '#2e7d32', f: 'IDEAM-SMByC · Superficie de bosque 2024', crear: vivo(IDEAM + '/Superficie_Bosque/MapServer', [16]), op: .55 },
    dtd: { g: 'Deforestación histórica', n: 'IDEAM · detección temprana trimestral', tipo: 'punto', c: '#6a1b9a', f: 'IDEAM-SMByC · Detección Temprana de Deforestación (DTD), puntos trimestrales en Caldas',
      crear: async function () { var fc = await json('data/capas/dtd_ideam.geojson'); return L.geoJSON(fc, { pointToLayer: function (f, ll) { return L.circleMarker(ll, { pane: 'puntos', radius: 6, color: '#fff', weight: 2, fillColor: '#6a1b9a', fillOpacity: 1 }); },
        onEachFeature: popup('Detección temprana de deforestación', [['anio', 'Año'], ['periodo', 'Trimestre'], ['mun', 'Municipio'], ['runap', 'Área protegida'], ['nucleo', 'Núcleo']]) }); } }
  };
  Object.keys(REG).forEach(function (k) { REG[k].id = k; REG[k].op = REG[k].op || 1; });
  var TEM = {};   // capas temáticas del módulo activo: id → {n, tipo, leyenda html, capa, op, f}

  function opacidad(capa, v) {
    if (!capa) return;
    if (capa.setOpacity && !(capa instanceof L.FeatureGroup)) { capa.setOpacity(v); return; }
    if (capa._canvas && capa._heat) { capa._canvas.style.opacity = v; return; }
    if (capa.eachLayer) capa.eachLayer(function (l) {
      if (l.eachLayer) return opacidad(l, v);
      if (!l.setStyle || !l.options) return;
      if (!l._base) l._base = { o: l.options.opacity == null ? 1 : l.options.opacity, f: l.options.fillOpacity == null ? .2 : l.options.fillOpacity };
      l.setStyle({ opacity: l._base.o * v, fillOpacity: l._base.f * v });
    });
  }
  async function encender(id, on) {
    var r = REG[id]; r.on = on;
    if (on) {
      if (!r.capa) { try { r.capa = await r.crear(); } catch (e) { console.error(e); r.on = false; aviso('No se pudo cargar «' + r.n + '». El servicio de origen no respondió.'); pintarLeyenda(); return; } }
      if (r.on) { r.capa.addTo(map); opacidad(r.capa, r.op); }
    } else if (r.capa) map.removeLayer(r.capa);
    pintarLeyenda(); sincCatalogo();
  }
  function aviso(t) { var d = document.createElement('div'); d.className = 'ayuda'; d.style.cssText = 'position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:1500;box-shadow:var(--shadow-2);background:#fff'; d.innerHTML = ic('info') + '<span>' + esc(t) + '</span>'; $('.mapa-wrap').appendChild(d); setTimeout(function () { d.remove(); }, 4500); }

  /* ── capas temáticas por módulo ─────────────── */
  function tematica(id, def) {
    var prev = TEM[id];
    if (prev && prev.capa && map.hasLayer(prev.capa)) map.removeLayer(prev.capa);
    if (!def) { delete TEM[id]; pintarLeyenda(); return; }
    def.op = prev && prev.op != null ? prev.op : (def.op || 1);
    def.vis = prev ? prev.vis : true;
    TEM[id] = def;
    if (def.capa && def.vis) { def.capa.addTo(map); opacidad(def.capa, def.op); }
    pintarLeyenda();
  }
  function limpiarTematicas(conservar) { Object.keys(TEM).forEach(function (k) { if ((conservar || []).indexOf(k) < 0) tematica(k, null); }); }

  /* ── leyenda viva ───────────────────────────── */
  function simbolo(r) {
    if (r.tipo === 'linea') return '<svg class="sim" viewBox="0 0 18 14"><line x1="1" y1="7" x2="17" y2="7" stroke="' + r.c + '" stroke-width="' + Math.min(4, r.ancho || 2.5) + '" ' + (r.dash ? 'stroke-dasharray="4 2"' : '') + ' stroke-linecap="round"/></svg>';
    if (r.tipo === 'punto') return '<svg class="sim" viewBox="0 0 18 14"><circle cx="9" cy="7" r="5" fill="' + r.c + '" stroke="#fff" stroke-width="1.5"/></svg>';
    return '<svg class="sim" viewBox="0 0 18 14"><rect x="1" y="1" width="16" height="12" rx="3" fill="' + r.c + '" fill-opacity=".35" stroke="' + r.c + '" stroke-width="1.6"/></svg>';
  }
  function pintarLeyenda() {
    var items = [];
    Object.keys(TEM).forEach(function (k) { items.push({ k: 'T:' + k, r: TEM[k], tem: true }); });
    Object.keys(REG).forEach(function (k) { if (REG[k].on) items.push({ k: 'R:' + k, r: REG[k] }); });
    $('#leyenda-n').textContent = items.length;
    $('#leyenda-cuerpo').innerHTML = items.length ? items.map(function (it) {
      var r = it.r, apag = it.tem && !r.vis;
      return '<div class="item-l' + (apag ? ' apagada' : '') + '" data-k="' + it.k + '"><div class="f1">' + (r.tipo === 'rampa' || r.tipo === 'clases' ? '' : simbolo(r)) + '<span class="nm">' + esc(r.n) + '</span>' +
        '<button data-a="info" title="Fuente">' + ic('info') + '</button>' +
        (it.tem ? '<button data-a="ver" title="Mostrar u ocultar">' + ic(apag ? 'ojoNo' : 'ojo') + '</button>' : '<button data-a="quitar" title="Quitar capa">' + ic('x') + '</button>') + '</div>' +
        (r.leyenda || '') +
        '<div class="opac"><span>Opacidad</span><input type="range" min="0" max="100" value="' + Math.round(r.op * 100) + '" data-a="op" aria-label="Opacidad de ' + esc(r.n) + '"><span>' + Math.round(r.op * 100) + '%</span></div>' +
        '<div class="info">' + esc(r.f || '') + '</div></div>';
    }).join('') : '<div class="item-l"><span class="nota">No hay capas activas. Actívelas en <b>Capas</b>.</span></div>';
    $$('#leyenda-cuerpo .item-l[data-k]').forEach(function (el) {
      var k = el.dataset.k, tem = k[0] === 'T', id = k.slice(2), r = tem ? TEM[id] : REG[id];
      el.querySelector('[data-a="info"]').onclick = function () { el.classList.toggle('ver-info'); };
      var q = el.querySelector('[data-a="quitar"]'); if (q) q.onclick = function () { encender(id, false); };
      var v = el.querySelector('[data-a="ver"]'); if (v) v.onclick = function () { r.vis = !r.vis; if (r.capa) { if (r.vis) { r.capa.addTo(map); opacidad(r.capa, r.op); } else map.removeLayer(r.capa); } pintarLeyenda(); };
      var o = el.querySelector('[data-a="op"]'); o.oninput = function () { r.op = o.value / 100; o.nextElementSibling.textContent = o.value + '%'; opacidad(r.capa, r.op); };
    });
  }
  function rampaHTML(stops, a, b, nota) { return '<div class="rampa" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></div><div class="ext"><span>' + a + '</span><span>' + b + '</span></div>' + (nota ? '<div class="ext"><span>' + nota + '</span></div>' : ''); }
  function clasesHTML(cl) { return '<div class="clases">' + cl.map(function (c) { return '<span><i style="background:' + c[0] + '"></i>' + esc(c[1]) + '</span>'; }).join('') + '</div>'; }

  /* ── mapa ───────────────────────────────────── */
  var FONDOS = {
    claro: { n: 'Claro', mini: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/9/248/148', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', ref: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', at: 'Esri · HERE · Garmin · © OpenStreetMap' },
    satelite: { n: 'Satélite', mini: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/9/248/148', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', at: 'Esri · Maxar' },
    relieve: { n: 'Relieve', mini: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/9/248/148', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', at: 'Esri' }
  };
  function iniciarMapa() {
    var lim = D.limite.poligonos, bb = [180, 90, -180, -90];
    lim.forEach(function (p) { p[0].forEach(function (c) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }); });
    D.bounds = L.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]);
    map = L.map('mapa', { zoomControl: false, minZoom: 7.5, maxBounds: D.bounds.pad(0.6), maxBoundsViscosity: .8, zoomSnap: .25, zoomAnimation: false });
    map.fitBounds(D.bounds, { padding: [20, 20] });
    [['vigil', 410], ['etiquetas', 615], ['puntos', 620], ['exterior', 640], ['limites', 650]].forEach(function (p) { map.createPane(p[0]).style.zIndex = p[1]; });
    map.getPane('exterior').style.pointerEvents = 'none'; map.getPane('etiquetas').style.pointerEvents = 'none';
    var mundo = [[-89, -179], [-89, 179], [89, 179], [89, -179]], huecos = lim.map(function (p) { return p[0].map(function (c) { return [c[1], c[0]]; }); });
    // Fuera de Caldas: el mapa base se ve completo (una copia del fondo por encima de las capas de datos, recortada al
    // exterior del departamento) atenuado con un filtro CSS. Así los datos quedan restringidos a Caldas y el fondo no se recorta.
    D.anillos = huecos;
    map.on('zoom viewreset zoomend moveend resize', recortarExterior);
    L.polygon(huecos, { pane: 'limites', color: '#ffffff', weight: 6, fill: false, interactive: false, opacity: .9 }).addTo(map);
    L.polygon(huecos, { pane: 'limites', color: '#12355b', weight: 2.4, fill: false, interactive: false }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    $('#fondos').innerHTML = Object.keys(FONDOS).map(function (k) { return '<button data-f="' + k + '" aria-pressed="false"><div class="mini" style="background-image:url(' + FONDOS[k].mini + ')"></div><span>' + FONDOS[k].n + '</span></button>'; }).join('');
    $$('#fondos button').forEach(function (b) { b.onclick = function () { fondo(b.dataset.f); }; });
    fondo('claro');
    $('#z-mas').onclick = function () { map.zoomIn(); }; $('#z-menos').onclick = function () { map.zoomOut(); };
    $('#z-casa').onclick = function () { E.volver = null; F.mun = ''; F.ver = ''; $('#f-mun').value = ''; llenarVeredas(); zoomFiltro(); pintar(); };
    $('#z-pantalla').onclick = function () { var w = $('.mapa-wrap'); if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen(); };
    $('#leyenda-cab').onclick = function () { $('#leyenda').classList.toggle('cerrada'); };
  }
  function recortarExterior() {
    // recorte "par-impar": rectángulo grande menos los anillos de Caldas, en coordenadas de capa del panel
    if (!map || !D.anillos) return;
    var pane = map.getPane('exterior'), pb = map.getPixelBounds(), o = map.getPixelOrigin(), m = 4000;
    var x0 = pb.min.x - o.x - m, y0 = pb.min.y - o.y - m, x1 = pb.max.x - o.x + m, y1 = pb.max.y - o.y + m;
    var d = 'M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'Z';
    D.anillos.forEach(function (r) { d += 'M' + r.map(function (ll) { var p = map.latLngToLayerPoint(ll); return Math.round(p.x) + ' ' + Math.round(p.y); }).join('L') + 'Z'; });
    pane.style.clipPath = 'path(evenodd, "' + d + '")';
  }
  function fondo(k) {
    if (fondoActual) map.removeLayer(fondoActual);
    var base = L.tileLayer(FONDOS[k].url, { maxZoom: 19, attribution: FONDOS[k].at }), capas = [base, L.tileLayer(FONDOS[k].url, { maxZoom: 19, pane: 'exterior' })];
    if (FONDOS[k].ref) capas.push(L.tileLayer(FONDOS[k].ref, { maxZoom: 19, pane: 'etiquetas' }), L.tileLayer(FONDOS[k].ref, { maxZoom: 19, pane: 'exterior' }));
    fondoActual = L.layerGroup(capas).addTo(map); base.bringToBack();
    recortarExterior();
    $$('#fondos button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.f === k); });
  }

  /* ── gráficas SVG ───────────────────────────── */
  function barra(x, y, w, h, r) { if (h <= 0) return ''; r = Math.min(r, h); return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; }
  function tick(max) { var p = Math.pow(10, Math.floor(Math.log10(Math.max(max, 1)))), top = Math.ceil(max / p) * p; if (top / p > 5) p *= 2; return { paso: p, top: Math.max(top, p) }; }
  function barras(cont, datos, series, unidad, etiquetaCada) {
    var W = 380, H = 170, m = { l: 34, r: 6, t: 8, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = Math.max.apply(null, datos.map(function (d) { return d.v.reduce(function (a, b) { return a + b; }, 0); }).concat([1])), tk = tick(max), top = tk.top;
    var bw = iw / datos.length, s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img"><g class="grid eje">';
    for (var y = 0; y <= top + 1e-9; y += tk.paso) { var py = m.t + ih - y / top * ih; s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + py + '" y2="' + py + '"/><text x="' + (m.l - 4) + '" y="' + (py + 3) + '" text-anchor="end">' + fmt(y) + '</text>'; }
    s += '</g>';
    datos.forEach(function (d, i) {
      var x = m.l + i * bw + 1, w = Math.max(bw - 2, 1), acum = 0, ult = -1; d.v.forEach(function (v, k) { if (v > 0) ult = k; });
      d.v.forEach(function (v, k) { if (v <= 0) return; var h = v / top * ih, yy = m.t + ih - (acum + v) / top * ih; s += '<path d="' + barra(x, yy, w, h - (acum > 0 ? 1 : 0), k === ult ? Math.min(3, w / 2) : 0) + '" fill="' + series[k].c + '"/>'; acum += v; });
      if (i % (etiquetaCada || 4) === (datos.length - 1) % (etiquetaCada || 4)) s += '<text x="' + (x + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle" style="fill:var(--ink-3);font-size:10px">' + esc(d.x) + '</text>';
      s += '<rect x="' + (m.l + i * bw) + '" y="' + m.t + '" width="' + bw + '" height="' + ih + '" fill="transparent" data-i="' + i + '"/>';
    });
    cont.innerHTML = s + '</svg><div class="tip"></div>';
    var tip = $('.tip', cont), svg = $('svg', cont);
    svg.addEventListener('mousemove', function (ev) {
      var t = ev.target.getAttribute('data-i'); if (t == null) { tip.style.display = 'none'; return; }
      var d = datos[+t], tot = d.v.reduce(function (a, b) { return a + b; }, 0);
      tip.innerHTML = '<div><b>' + esc(d.d) + '</b></div>' + series.map(function (sr, k) { return '<div><span style="color:' + sr.c + '">■</span> ' + esc(sr.n) + ': <b>' + fmt(d.v[k], unidad === 'ha' ? 1 : 0) + '</b> ' + unidad + '</div>'; }).join('') + (series.length > 1 ? '<div>Total: <b>' + fmt(tot, unidad === 'ha' ? 1 : 0) + '</b> ' + unidad + '</div>' : '');
      var r = cont.getBoundingClientRect(), x = ev.clientX - r.left + 12; if (x + 190 > r.width) x = ev.clientX - r.left - 200;
      tip.style.display = 'block'; tip.style.left = x + 'px'; tip.style.top = (ev.clientY - r.top - 10) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  }
  function lineas(cont, xs, series, unidad, hoyIdx, tipo) {
    var W = 380, H = 160, m = { l: 34, r: 8, t: 10, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b, vals = [];
    series.forEach(function (s) { s.v.forEach(function (v) { if (v != null) vals.push(v); }); });
    var lo = tipo === 'barras' ? 0 : Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals.concat([lo + 1])) + (tipo === 'barras' ? 0 : 1));
    var X = function (i) { return m.l + i / Math.max(1, xs.length - 1) * iw; }, Y = function (v) { return m.t + ih - (v - lo) / (hi - lo) * ih; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '"><rect x="' + X(hoyIdx) + '" y="' + m.t + '" width="' + (W - m.r - X(hoyIdx)) + '" height="' + ih + '" fill="var(--surface-2)"/><g class="grid eje">';
    for (var k = 0; k <= 4; k++) { var v = lo + (hi - lo) * k / 4, py = Y(v); s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + py + '" y2="' + py + '"/><text x="' + (m.l - 4) + '" y="' + (py + 3) + '" text-anchor="end">' + fmt(v) + '</text>'; }
    s += '</g><text x="' + (X(hoyIdx) + 4) + '" y="' + (m.t + 10) + '" style="fill:var(--ink-3);font-size:10px">pronóstico →</text>';
    series.forEach(function (sr) {
      if (tipo === 'barras') { var bw = iw / xs.length; sr.v.forEach(function (v, i) { if (v > 0) s += '<path d="' + barra(m.l + i * bw + 1, Y(v), Math.max(bw - 2, 1), Y(lo) - Y(v), 2) + '" fill="' + sr.c + '" opacity="' + (i > hoyIdx ? .5 : 1) + '"/>'; }); }
      else { var d = ''; sr.v.forEach(function (v, i) { if (v != null) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }); s += '<path d="' + d + '" fill="none" stroke="' + sr.c + '" stroke-width="2" ' + (sr.dash ? 'stroke-dasharray="4 3"' : '') + ' stroke-linejoin="round"/>'; }
    });
    [0, Math.floor(xs.length / 2), xs.length - 1].forEach(function (i) { s += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle') + '" style="fill:var(--ink-3);font-size:10px">' + esc(fechaCorta(xs[i] + 'T12:00:00')) + '</text>'; });
    s += '<line class="cruz" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--ink-2)" style="display:none"/><rect x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg><div class="tip"></div>';
    cont.innerHTML = s;
    var tip = $('.tip', cont), svg = $('svg', cont), cruz = $('.cruz', cont);
    svg.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect(), i = Math.round(((ev.clientX - r.left) / r.width * W - m.l) / iw * (xs.length - 1));
      if (i < 0 || i >= xs.length) { tip.style.display = 'none'; return; }
      cruz.setAttribute('x1', X(i)); cruz.setAttribute('x2', X(i)); cruz.style.display = '';
      tip.innerHTML = '<div><b>' + esc(fechaCorta(xs[i] + 'T12:00:00')) + '</b>' + (i > hoyIdx ? ' · pronóstico' : '') + '</div>' + series.map(function (sr) { return '<div><span style="color:' + sr.c + '">■</span> ' + esc(sr.n) + ': <b>' + fmt(sr.v[i], 1) + '</b> ' + unidad + '</div>'; }).join('');
      var cr = cont.getBoundingClientRect(), x = ev.clientX - cr.left + 12; if (x + 180 > cr.width) x -= 200;
      tip.style.display = 'block'; tip.style.left = x + 'px'; tip.style.top = (ev.clientY - cr.top - 10) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; cruz.style.display = 'none'; });
  }
  function kpi(v, l, cls) { return '<div class="kpi ' + (cls || '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
  function seg(id, opciones, actual) { return '<div class="seg" id="' + id + '">' + opciones.map(function (o) { return '<button data-v="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(actual)) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
  function onSeg(id, fn) { $$('#' + id + ' button').forEach(function (b) { b.onclick = function () { fn(b.dataset.v); pintar(); }; }); }
  function ayuda(html) { return '<div class="ayuda">' + ic('info') + '<div>' + html + '</div></div>'; }
  function descargar(nombre, filas) { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + filas.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = nombre; a.click(); }

  /* ══ MÓDULOS ════════════════════════════════════════════════ */
  var NIVEL = { vigilar: 'Vigilar de cerca', atencion: 'Atención', normal: 'Normal' };
  function est(n) { return '<span class="estado ' + n + '">' + NIVEL[n] + '</span>'; }

  /* 1. Vigilancia */
  function modVigilancia(el) {
    var todas = D.vig ? D.vig.veredas : [], vs = todas.filter(function (v) { return pasa(v.mun, v.id); });
    var nv = vs.filter(function (v) { return v.nivel === 'vigilar'; }).length, na = vs.filter(function (v) { return v.nivel === 'atencion'; }).length;
    var maxR = todas.length ? todas[0].riesgo : 1;
    var lista = (F.ver || F.mun) ? vs.slice(0, 80) : vs.filter(function (v) { return v.nivel !== 'normal'; }).slice(0, 80);
    el.innerHTML = ayuda('Cada vereda recibe un <b>índice de riesgo</b> que cruza el <b>clima pronosticado</b> (calor anómalo, días sin lluvia, humedad baja) con su <b>historia de fuego y deforestación</b>, la cercanía a vías y poblados y los <b>puntos de calor</b> recientes. Haga clic en una vereda para verla en el mapa.') +
      '<div class="kpis">' + kpi(nv, 'veredas para vigilar de cerca', 'alerta') + kpi(na, 'veredas en atención', 'aviso') + kpi(vs.length, 'veredas evaluadas') + '</div>' +
      '<div class="sec"><span>' + (F.ver ? 'Vereda seleccionada' : F.mun ? 'Veredas de ' + esc(F.mun) : 'Prioridad en todo Caldas') + '</span><button class="btn chico" id="b-csv-vig">' + ic('bajar') + 'CSV</button></div>' +
      '<ul class="tarjetas">' + lista.map(function (v) {
        var chips = (v.paramo ? '<span class="chip"><i style="background:#7e57c2"></i>Páramo</span>' : '') + (v.sinap ? '<span class="chip"><i style="background:#2e7d32"></i>Área protegida</span>' : '') + (v.resguardo ? '<span class="chip"><i style="background:#a0522d"></i>Resguardo</span>' : '');
        return '<li class="tarjeta ' + v.nivel + '" data-ver="' + v.id + '"><div class="t"><b>' + v.puesto + '. ' + esc(v.ver) + '</b>' + est(v.nivel) + '</div><div class="m">' + esc(v.mun) + '</div>' +
          '<div class="medidor" title="Índice ' + fmt(v.riesgo, 2) + '"><i style="width:' + Math.round(100 * v.riesgo / maxR) + '%"></i></div>' +
          (v.razones.length ? '<ul>' + v.razones.slice(0, 3).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '') + (chips ? '<div class="chips">' + chips + '</div>' : '') + '</li>';
      }).join('') + '</ul>' +
      '<p class="fuente">Índice de priorización v1.0 · calculado ' + (D.vig ? fecha(D.vig.actualizado) : '–') + '. <a href="metodologia.html#indice" target="_blank">Ver metodología</a>.</p>';
    $$('.tarjeta[data-ver]', el).forEach(function (li) { li.onclick = function () { irVereda(li.dataset.ver); }; });
    $('#b-csv-vig').onclick = function () { descargar('sitios_a_vigilar.csv', ['puesto;nivel;vereda;municipio;indice;anomalia_tmax_7d;dias_secos;lluvia_30d_pct;anios_fuego;deforestacion_90d_ha;puntos_calor_30d;paramo;area_protegida;resguardo;razones'].concat(vs.map(function (v) { return [v.puesto, NIVEL[v.nivel], v.ver, v.mun, v.riesgo, v.an_tmax_7f, v.secos, v.lluvia30_pct, v.anios_fuego, v.defo90_ha, v.calor30, v.paramo ? 'sí' : '', v.sinap ? 'sí' : '', v.resguardo ? 'sí' : '', v.razones.join(' | ')].join(';'); }))); };
    var porId = {}; todas.forEach(function (v) { porId[v.id] = v; });
    var col = { vigilar: '#c62828', atencion: '#ef6c00', normal: '#2e7d32' };
    tematica('vig', { n: 'Veredas por nivel de vigilancia', tipo: 'clases', f: 'Índice de priorización Vigías del Fuego v1.0 (ver Metodología)', leyenda: clasesHTML([['#c62828', 'Vigilar de cerca'], ['#ef6c00', 'Atención']]),
      capa: L.geoJSON(D.veredas, { pane: 'vigil',
        filter: function (f) { var v = porId[f.properties.id]; return v && (v.nivel !== 'normal' || (F.mun && norm(f.properties.mun) === norm(F.mun))); },
        style: function (f) { var v = porId[f.properties.id] || {}; return { color: col[v.nivel], weight: 1.4, opacity: 1, fillColor: col[v.nivel], fillOpacity: v.nivel === 'normal' ? .06 : .32 }; },
        onEachFeature: function (f, l) { var v = porId[f.properties.id]; if (v) l.bindPopup(popupVereda(v)); l.on('mouseover', function () { l.setStyle({ weight: 3 }); }); l.on('mouseout', function () { l.setStyle({ weight: 1.4 }); }); } }) });
  }
  function popupVereda(v) {
    return '<h3>' + esc(v.ver) + ' · ' + esc(v.mun) + '</h3><div style="margin-bottom:6px">' + est(v.nivel) + ' <span style="color:var(--ink-3)">puesto ' + v.puesto + '</span></div>' +
      pp('', [['Anomalía Tmax próx. 7 días', v.an_tmax_7f == null ? null : (v.an_tmax_7f > 0 ? '+' : '') + fmt(v.an_tmax_7f, 1) + ' °C'], ['Días seguidos sin lluvia', fmt(v.secos)], ['Lluvia 30 días vs. normal', fmt(v.lluvia30_pct) + ' %'],
        ['Años con fuego (2000-2025)', v.anios_fuego], ['Deforestación 90 días', fmt(v.defo90_ha, 1) + ' ha'], ['Puntos de calor 30 días', v.calor30], ['Vía principal más cercana', fmt(v.km_via, 1) + ' km'], ['Centro poblado más cercano', fmt(v.km_centro_poblado, 1) + ' km']]).replace('<h3></h3>', '') +
      (function () { var iv = idxVer.find(function (x) { return String(x.p.id) === String(v.id); }); if (!iv) return ''; var b = L.geoJSON({ type: 'Polygon', coordinates: iv.polys[0] }).getBounds().getCenter(); var pt = vereda(b.lng, b.lat) ? b : { lat: (iv.bb[1] + iv.bb[3]) / 2, lng: (iv.bb[0] + iv.bb[2]) / 2 };
        return botonAlerta({ lat: pt.lat, lon: pt.lng, prioridad: v.nivel === 'vigilar' ? 'alta' : 'media', fuente: 'vigia_fuego', titulo: 'Vigilancia preventiva · ' + v.ver + ' (' + v.mun + ')', descripcion: 'Vereda priorizada por Vigías del Fuego (' + NIVEL[v.nivel] + ', puesto ' + v.puesto + '). ' + v.razones.join('; ') + '.' }); })();
  }

  /* 2. Incendios */
  function detecciones(dias) {
    var lim = Date.now() - dias * 864e5, out = [];
    (D.firms && D.firms.puntos || []).forEach(function (p) { var t = new Date(p.fecha_hora).getTime(); if (t >= lim) out.push({ f: 'FIRMS', s: p.fuente.replace('_', ' '), t: t, lat: p.lat, lon: p.lon, frp: p.frp, c: p.confianza }); });
    if (D.ideam && D.ideam.t0) { var t0 = new Date(D.ideam.t0 + '-05:00').getTime(), fi = out.slice();
      D.ideam.pts.forEach(function (q) { var t = t0 + q[2] * 6e4; if (t < lim) return; if (fi.some(function (d) { return Math.abs(d.t - t) <= 9e5 && Math.abs(d.lat - q[0]) < .01 && Math.abs(d.lon - q[1]) < .01; })) return; out.push({ f: 'IDEAM', s: 'IDEAM', t: t, lat: q[0], lon: q[1] }); }); }
    out.forEach(function (d) { var v = vereda(d.lon, d.lat); d.ver = v ? v.ver : ''; d.mun = v ? v.mun : ''; d.vid = v ? v.id : null; });
    return out.filter(function (d) { return d.vid != null && pasa(d.mun, d.vid); }).sort(function (a, b) { return b.t - a.t; });
  }
  function modIncendios(el) {
    var ds = detecciones(E.fuegoP), ahora = Date.now(), d24 = ds.filter(function (d) { return ahora - d.t <= 864e5; }).length;
    var porVer = {}, porMun = {}; ds.forEach(function (d) { var k = d.vid; porVer[k] = porVer[k] || { ver: d.ver, mun: d.mun, id: d.vid, n: 0 }; porVer[k].n++; porMun[d.mun] = (porMun[d.mun] || 0) + 1; });
    var top = Object.values(porVer).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
    // serie mensual de los últimos 12 meses (siempre el año completo, para dar contexto)
    var anual = detecciones(365), meses = [], hoy = new Date();
    for (var i = 11; i >= 0; i--) { var m = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1); meses.push({ k: m.getFullYear() + '-' + m.getMonth(), x: m.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), d: m.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }), v: [0, 0] }); }
    var im = {}; meses.forEach(function (m, i) { im[m.k] = i; });
    anual.forEach(function (d) { var t = new Date(d.t), k = t.getFullYear() + '-' + t.getMonth(); if (k in im) meses[im[k]].v[d.f === 'FIRMS' ? 0 : 1]++; });
    el.innerHTML = ayuda('Puntos de calor detectados por satélite en el <b>último año completo</b> hasta hoy. Son detecciones térmicas, <b>no incendios confirmados</b>: deben verificarse en campo. Los puntos de las últimas 24 horas aparecen con un pulso rojo.') +
      '<div class="fila"><span>Periodo</span>' + seg('s-per', [[1, '24 h'], [7, '7 días'], [30, '30 días'], [365, '12 meses']], E.fuegoP) + '</div>' +
      '<div class="kpis">' + kpi(fmt(ds.length), 'puntos de calor en el periodo', ds.length ? 'aviso' : '') + kpi(d24, 'en las últimas 24 h', d24 ? 'alerta' : '') + kpi(Object.keys(porVer).length, 'veredas con detecciones') + '</div>' +
      '<div class="sec"><span>Puntos de calor por mes · ' + esc(nombreFiltro()) + '</span></div><div class="leyenda"><span style="--c:#e53935">NASA FIRMS</span><span style="--c:#ffb300">IDEAM (adicionales)</span></div><div class="grafica" id="g-mes"></div>' +
      '<div class="fila"><span>Ver en el mapa</span>' + seg('s-vista', [['densidad', 'Densidad'], ['puntos', 'Puntos'], ['ambos', 'Ambos']], E.fuegoVista) + '</div>' +
      '<div class="sec"><span>Veredas con más detecciones</span><button class="btn chico" id="b-csv-f">' + ic('bajar') + 'CSV</button></div>' +
      (top.length ? '<table class="tabla"><thead><tr><th>Vereda</th><th class="n">Puntos</th></tr></thead><tbody>' + top.map(function (r) { return '<tr data-ver="' + r.id + '"><td>' + esc(r.ver) + '<div class="sub">' + esc(r.mun) + '</div></td><td class="n">' + r.n + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="nota">Sin detecciones en el periodo y territorio seleccionados.</p>') +
      '<div class="sec"><span>Contexto histórico</span></div>' +
      capaTarjeta('mbf', 'Frecuencia de quemas 2000-2025', 'MapBiomas Fuego · años con área quemada', 'linear-gradient(90deg,#fee391,#fb8c00,#b71c1c)') +
      capaTarjeta('icv', 'Probabilidad de incendio (IDEAM)', 'Alertas ICV · en vivo', 'linear-gradient(90deg,#fff3e0,#ff7043,#bf360c)') +
      '<p class="fuente">FIRMS ' + (D.firms ? 'actualizado ' + hace(D.firms.actualizado) + (D.firms.con_api ? '' : ' · año en curso completado con IDEAM hasta activar la llave FIRMS') : '–') + ' · IDEAM ' + (D.ideam ? hace(D.ideam.actualizado) : '–') + '.</p>';
    barras($('#g-mes'), meses, [{ n: 'NASA FIRMS', c: '#e53935' }, { n: 'IDEAM', c: '#ffb300' }], 'puntos', 1);
    onSeg('s-per', function (v) { E.fuegoP = +v; }); onSeg('s-vista', function (v) { E.fuegoVista = v; });
    $$('tr[data-ver]', el).forEach(function (tr) { tr.onclick = function () { irVereda(tr.dataset.ver); }; });
    $('#b-csv-f').onclick = function () { descargar('puntos_calor_' + E.fuegoP + 'd.csv', ['fecha;fuente;lat;lon;vereda;municipio;frp'].concat(ds.map(function (d) { return [new Date(d.t).toISOString(), d.s, d.lat, d.lon, d.ver, d.mun, d.frp || ''].join(';'); }))); };
    enlazarTarjetas(el);
    // capas del módulo
    var etiqueta = E.fuegoP === 365 ? '12 meses' : E.fuegoP === 1 ? '24 h' : E.fuegoP + ' días';
    if (E.fuegoVista !== 'puntos' && window.L.heatLayer && ds.length) {
      tematica('fdens', { n: 'Densidad de puntos de calor (' + etiqueta + ')', tipo: 'rampa', f: 'NASA FIRMS + IDEAM; densidad de núcleo suavizada', leyenda: rampaHTML(['#ffeda0', '#feb24c', '#f03b20', '#bd0026'], 'baja', 'alta'),
        capa: L.heatLayer(ds.map(function (d) { return [d.lat, d.lon, .8]; }), { radius: 22, blur: 18, maxZoom: 13, minOpacity: .25, gradient: { .2: '#ffeda0', .45: '#feb24c', .7: '#f03b20', 1: '#bd0026' } }) });
    } else tematica('fdens', null);
    if (E.fuegoVista !== 'densidad') {
      var g = L.layerGroup();
      ds.forEach(function (d) {
        var edad = (ahora - d.t) / 864e5, c = edad <= 1 ? '#d50000' : edad <= 7 ? '#ff6d00' : edad <= 30 ? '#ffab00' : '#ffd54f';
        if (edad <= 1) L.marker([d.lat, d.lon], { pane: 'puntos', interactive: false, icon: L.divIcon({ className: '', html: '<div class="pulso-fuego" style="width:34px;height:34px"></div>', iconSize: [34, 34] }) }).addTo(g);
        L.circleMarker([d.lat, d.lon], { pane: 'puntos', radius: edad <= 7 ? 6 : 4.5, color: '#ffffff', weight: 1.5, fillColor: c, fillOpacity: 1 })
          .bindPopup(pp('Punto de calor', [['Fecha', fecha(d.t)], ['Hace', hace(d.t)], ['Fuente', d.s], ['Vereda', d.ver], ['Municipio', d.mun], ['Potencia radiativa', d.frp ? d.frp + ' MW' : null], ['Confianza', d.c]]) +
            botonAlerta({ lat: d.lat, lon: d.lon, prioridad: edad <= 2 ? 'alta' : 'media', fuente: d.f === 'FIRMS' ? 'firms' : 'ideam', fuenteAlterna: d.f === 'FIRMS' ? 'firms' : 'ideam', referencia: 'vf-calor-' + d.f + '-' + d.t + '-' + d.lat + '-' + d.lon, titulo: 'Verificar punto de calor · ' + d.ver + ' (' + d.mun + ')', descripcion: 'Punto de calor ' + d.s + ' detectado el ' + fecha(d.t) + (d.frp ? ', potencia radiativa ' + d.frp + ' MW' : '') + '. Verificar en campo si corresponde a un incendio.' })).addTo(g);
      });
      tematica('fpts', { n: 'Puntos de calor (' + etiqueta + ')', tipo: 'clases', f: 'NASA FIRMS (VIIRS / MODIS) e IDEAM', leyenda: clasesHTML([['#d50000', '≤ 24 h'], ['#ff6d00', '≤ 7 días'], ['#ffab00', '≤ 30 días'], ['#ffd54f', '> 30 días']]), capa: g });
    } else tematica('fpts', null);
    capasExtra();
  }
  var EXTRA = { mbf: false, icv: false, gfwt: false, defopts: true };
  var EXTRA_DEF = {
    mbf: { mod: 'incendios', n: 'Frecuencia de quemas MapBiomas 2000-2025', tipo: 'rampa', f: 'MapBiomas Fuego Colombia, Colección 1 (30 m), suavizado para visualización', leyenda: rampaHTML(['#fee391', '#fb8c00', '#b71c1c'], '1 año', '≥ 10 años'), op: .85,
      crear: function () { return L.imageOverlay('data/base/fuego_frecuencia_suave.png', D.mbMeta.bounds, { className: 'raster-suave', interactive: false }); } },
    icv: { mod: 'incendios', n: 'Probabilidad de incendio de la cobertura vegetal', tipo: 'rampa', f: 'IDEAM · Alertas ICV (StoryMaps_IDA), en vivo', leyenda: rampaHTML(['#fff3e0', '#ff7043', '#bf360c'], 'baja', 'alta'), op: .7,
      crear: function () { return L.esri.dynamicMapLayer({ url: IDEAM + '/StoryMaps_IDA/Alertas_ICV/MapServer', layers: [2], className: 'raster-suave' }); } },
    gfwt: { mod: 'deforestacion', n: 'Alertas integradas GFW (oficial)', tipo: 'area', c: '#e91e63', f: 'Global Forest Watch · alertas integradas, teselas oficiales', op: .9,
      crear: function () { return L.tileLayer('https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/default/{z}/{x}/{y}.png', { maxNativeZoom: 14, maxZoom: 18, className: 'raster-suave' }); } }
  };
  function capaTarjeta(id, n, sub, fondoSw) { return '<label class="capa' + (EXTRA[id] ? ' on' : '') + '"><span class="sw" style="background:' + fondoSw + '"></span><span class="tx">' + esc(n) + '<small>' + esc(sub) + '</small></span><span class="interruptor"><input type="checkbox" data-extra="' + id + '"' + (EXTRA[id] ? ' checked' : '') + '><span></span></span></label>'; }
  function enlazarTarjetas(el) { $$('input[data-extra]', el).forEach(function (i) { i.onchange = function () { EXTRA[i.dataset.extra] = i.checked; i.closest('.capa').classList.toggle('on', i.checked); capasExtra(); if (i.dataset.extra === 'defopts') pintar(); }; }); }
  function capasExtra() {
    Object.keys(EXTRA_DEF).forEach(function (k) {
      var d = EXTRA_DEF[k], ver = EXTRA[k] && d.mod === E.mod;
      if (ver && !TEM['x' + k]) { if (!d.capa) d.capa = d.crear(); tematica('x' + k, Object.assign({}, d, { capa: d.capa })); }
      if (!ver && TEM['x' + k]) tematica('x' + k, null);
    });
  }

  /* 3. Deforestación */
  function modDeforestacion(el) {
    var df = D.defo; if (!df) { el.innerHTML = ayuda('Aún no hay alertas de deforestación descargadas.'); return; }
    var ep = Date.parse(df.epoca + 'T00:00:00Z'), hoy = new Date(), sem0 = lunes(new Date(hoy.getTime() - (E.defoSem - 1) * 7 * 864e5));
    var semanas = []; for (var t = sem0.getTime(); t <= hoy.getTime(); t += 7 * 864e5) semanas.push({ k: isoSemana(new Date(t)), ini: new Date(t), v: [0, 0] });
    var ix = {}; semanas.forEach(function (s, i) { ix[s.k] = i; });
    var porVer = {}, pts = [], hp = df.ha_pixel, ahora = Date.now(), lim4 = ahora - 28 * 864e5, lim8 = ahora - 56 * 864e5, h4 = 0, h48 = 0, limMapa = ahora - E.defoMapa * 7 * 864e5;
    df.pts.forEach(function (p) {
      var vv = df.veredas[p[4]]; if (!pasa(vv[2], vv[0])) return; if (E.defoConf === 'alta' && p[3] !== 2) return;
      var t = ep + p[2] * 864e5, k = isoSemana(new Date(t));
      if (k in ix) semanas[ix[k]].v[p[3] === 2 ? 0 : 1] += hp;
      if (t >= lim4) { h4 += hp; porVer[p[4]] = (porVer[p[4]] || 0) + hp; } else if (t >= lim8) h48 += hp;
      if (t >= limMapa) pts.push([p[0], p[1], t, p[3], vv]);
    });
    var kUlt = df.ultima_alerta ? isoSemana(new Date(df.ultima_alerta + 'T00:00:00Z')) : null, ult = semanas[kUlt in ix ? ix[kUlt] : semanas.length - 1];
    var cambio = h48 ? (h4 - h48) / h48 * 100 : null;
    var top = Object.keys(porVer).map(function (k) { return [df.veredas[k], porVer[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 15);
    el.innerHTML = ayuda('Seguimiento <b>semanal</b> de la pérdida de bosque detectada por satélite (alertas integradas GLAD-L, GLAD-S2, RADD y DIST). Filtre por <b>municipio y vereda</b> arriba. Las de confianza nominal pueden ser falsas alarmas por nubes.') +
      '<div class="fila"><span>Confianza</span>' + seg('s-conf', [['todas', 'Todas'], ['alta', 'Solo alta']], E.defoConf) + '</div>' +
      '<div class="fila"><span>Periodo</span>' + seg('s-sem', [[12, '12 sem'], [26, '6 meses'], [52, '1 año'], [104, '2 años']], E.defoSem) + '</div>' +
      '<div class="kpis">' + kpi(fmt(ult.v[0] + ult.v[1], 1), 'ha en la semana ' + ult.k.slice(6) + ' (última publicada)', 'aviso') + kpi(fmt(h4, 1), 'ha en las últimas 4 semanas') +
        kpi(cambio == null ? '–' : cambio > 300 ? '×' + fmt(h4 / h48) : (cambio > 0 ? '+' : '') + fmt(cambio) + '%', 'frente a las 4 semanas anteriores', cambio > 50 ? 'alerta' : '') + '</div>' +
      '<div class="sec"><span>Hectáreas en alerta por semana · ' + esc(nombreFiltro()) + '</span></div>' +
      '<div class="leyenda"><span style="--c:#ad1457">Confianza alta</span>' + (E.defoConf === 'todas' ? '<span style="--c:#f48fb1">Confianza nominal</span>' : '') + '</div><div class="grafica" id="g-defo"></div>' +
      '<div class="fila"><button class="btn chico" id="b-tabla">' + ic('tabla') + 'Tabla semanal</button><button class="btn chico" id="b-csv">' + ic('bajar') + 'Descargar alertas (CSV)</button></div><div id="tabla-defo"></div>' +
      '<div class="sec"><span>Veredas con más alertas · 4 semanas</span></div>' +
      (top.length ? '<table class="tabla"><thead><tr><th>Vereda</th><th class="n">ha</th></tr></thead><tbody>' + top.map(function (r) { return '<tr data-ver="' + r[0][0] + '"><td>' + esc(r[0][1]) + '<div class="sub">' + esc(r[0][2]) + '</div></td><td class="n">' + fmt(r[1], 1) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="nota">Sin alertas en las últimas 4 semanas para este territorio.</p>') +
      '<div class="sec"><span>En el mapa</span></div><div class="fila"><span>Alertas de las últimas</span>' + seg('s-mapa', [[4, '4 sem'], [12, '12 sem'], [52, '1 año']], E.defoMapa) + '</div>' +
      capaTarjeta('defopts', 'Alertas como puntos (filtradas)', 'por antigüedad', 'linear-gradient(90deg,#880e4f,#e91e63,#f8bbd0)') +
      capaTarjeta('gfwt', 'Alertas integradas GFW (oficial)', 'todo el periodo, píxeles suavizados', '#e91e63') +
      '<p class="nota">Histórico: <b>Hansen 2001-2025</b>, <b>IDEAM cambio de bosque 1990-2024</b> y <b>detección temprana trimestral IDEAM</b> se activan en <b>Capas → Deforestación histórica</b>.</p>' +
      '<p class="fuente">' + esc(df.fuente) + '. Última alerta: ' + esc(df.ultima_alerta) + '. Píxel ≈ ' + fmt(hp, 3) + ' ha.</p>';
    var series = [{ n: 'Confianza alta', c: '#ad1457' }].concat(E.defoConf === 'todas' ? [{ n: 'Confianza nominal', c: '#f48fb1' }] : []);
    barras($('#g-defo'), semanas.map(function (s) { return { x: 'S' + s.k.slice(6), v: E.defoConf === 'todas' ? s.v : [s.v[0]], d: 'Semana ' + s.k.slice(6) + ' · desde ' + fechaCorta(s.ini) }; }), series, 'ha', E.defoSem > 52 ? 12 : E.defoSem > 26 ? 8 : 4);
    onSeg('s-conf', function (v) { E.defoConf = v; }); onSeg('s-sem', function (v) { E.defoSem = +v; }); onSeg('s-mapa', function (v) { E.defoMapa = +v; });
    $$('tr[data-ver]', el).forEach(function (tr) { tr.onclick = function () { irVereda(tr.dataset.ver); }; });
    $('#b-tabla').onclick = function () { var c = $('#tabla-defo'); c.innerHTML = c.innerHTML ? '' : '<table class="tabla"><thead><tr><th>Semana</th><th>Desde</th><th class="n">Alta</th><th class="n">Nominal</th></tr></thead><tbody>' + semanas.slice().reverse().map(function (s) { return '<tr><td>' + s.k + '</td><td>' + fechaCorta(s.ini) + '</td><td class="n">' + fmt(s.v[0], 2) + '</td><td class="n">' + fmt(s.v[1], 2) + '</td></tr>'; }).join('') + '</tbody></table>'; };
    $('#b-csv').onclick = function () { var f = ['fecha;lat;lon;confianza;vereda;municipio']; df.pts.forEach(function (p) { var vv = df.veredas[p[4]]; if (pasa(vv[2], vv[0])) f.push([new Date(ep + p[2] * 864e5).toISOString().slice(0, 10), p[0], p[1], p[3] === 2 ? 'alta' : 'nominal', vv[1], vv[2]].join(';')); }); descargar('alertas_deforestacion_' + norm(nombreFiltro()).replace(/\W+/g, '_') + '.csv', f); };
    enlazarTarjetas(el);
    if (EXTRA.defopts) {
      var g = L.layerGroup();
      pts.forEach(function (p) { var dias = (ahora - p[2]) / 864e5;
        L.circleMarker([p[0], p[1]], { pane: 'puntos', radius: dias <= 28 ? 4.5 : 3.5, color: '#fff', weight: .8, fillColor: dias <= 28 ? '#880e4f' : dias <= 84 ? '#e91e63' : '#f8bbd0', fillOpacity: .95 })
          .bindPopup(pp('Alerta de pérdida de bosque', [['Fecha', new Date(p[2]).toISOString().slice(0, 10)], ['Confianza', p[3] === 2 ? 'alta' : 'nominal'], ['Vereda', p[4][1]], ['Municipio', p[4][2]]])).addTo(g); });
      tematica('dpts', { n: 'Alertas de deforestación (' + E.defoMapa + ' sem)', tipo: 'clases', f: df.fuente, leyenda: clasesHTML([['#880e4f', '≤ 4 semanas'], ['#e91e63', '5-12 semanas'], ['#f8bbd0', '> 12 semanas']]), capa: g });
    } else tematica('dpts', null);
    capasExtra();
  }

  /* 4. Clima */
  var VARS = {
    an_tmax_7f: { n: 'Anomalía de temperatura máxima · próximos 7 días', u: '°C', stops: ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'], lo: -4, hi: 4 },
    an_tmax_7p: { n: 'Anomalía de temperatura máxima · últimos 7 días', u: '°C', stops: ['#2166ac', '#92c5de', '#f7f7f7', '#f4a582', '#b2182b'], lo: -4, hi: 4 },
    secos_hoy: { n: 'Días seguidos sin lluvia', u: 'días', stops: ['#fff7bc', '#fec44f', '#d95f0e', '#7f2704'], lo: 0, hi: 20 },
    lluvia_30d_pct: { n: 'Lluvia de 30 días frente a lo normal', u: '%', stops: ['#8c510a', '#d8b365', '#f5f5f5', '#5ab4ac', '#01665e'], lo: 20, hi: 180 },
    an_hr_7f: { n: 'Anomalía de humedad relativa · próximos 7 días', u: 'pts', stops: ['#8c510a', '#d8b365', '#f5f5f5', '#5ab4ac', '#01665e'], lo: -12, hi: 12 },
    dpv_max_7f: { n: 'Déficit de presión de vapor máximo · 7 días', u: 'kPa', stops: ['#ffffcc', '#fd8d3c', '#bd0026'], lo: 0, hi: 3 },
    tmax_max_fc: { n: 'Temperatura máxima pronosticada · 16 días', u: '°C', stops: ['#313695', '#74add1', '#ffffbf', '#f46d43', '#a50026'], lo: 5, hi: 36 }
  };
  function superficie(ps, k, def) {
    // interpolación IDW a una malla fina → imagen suavizada (sin píxeles visibles)
    var b = D.bounds, W = 220, H = Math.round(W * (b.getNorth() - b.getSouth()) / (b.getEast() - b.getWest()));
    var c = document.createElement('canvas'); c.width = W; c.height = H; var cx = c.getContext('2d'), img = cx.createImageData(W, H);
    var pts = ps.filter(function (p) { return p[k] != null; });
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var lon = b.getWest() + (x + .5) / W * (b.getEast() - b.getWest()), lat = b.getNorth() - (y + .5) / H * (b.getNorth() - b.getSouth()), sw = 0, sv = 0;
      for (var i = 0; i < pts.length; i++) { var dx = pts[i].lon - lon, dy = pts[i].lat - lat, d2 = dx * dx + dy * dy + 1e-5, w = 1 / Math.pow(d2, 1.25); sw += w; sv += w * pts[i][k]; }
      var col = rampa(def.stops, (sv / sw - def.lo) / (def.hi - def.lo)), o = (y * W + x) * 4;
      img.data[o] = parseInt(col.substr(1, 2), 16); img.data[o + 1] = parseInt(col.substr(3, 2), 16); img.data[o + 2] = parseInt(col.substr(5, 2), 16); img.data[o + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return L.imageOverlay(c.toDataURL(), b, { className: 'raster-suave', interactive: false });
  }
  function modClima(el) {
    var cl = D.clima; if (!cl) { el.innerHTML = ayuda('Aún no hay datos climáticos.'); return; }
    var def = VARS[E.climaVar], ps = cl.puntos, sel = E.climaSel != null ? ps[E.climaSel] : null;
    var dentro = ps.filter(function (p) { if (!F.mun && !F.ver) return true; var v = vereda(p.lon, p.lat); return v && pasa(v.mun, v.id); }); if (!dentro.length) dentro = ps;
    var prom = function (k) { var xs = dentro.map(function (p) { return p[k]; }).filter(function (x) { return x != null; }); return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; };
    var at = prom('an_tmax_7f');
    el.innerHTML = ayuda('Condiciones de <b>calor y sequía</b> que favorecen los incendios, comparadas con lo normal para esta época (2016-2025). Incluye <b>pronóstico de 16 días</b>. Haga clic en cualquier punto del mapa para ver su serie.') +
      '<div class="kpis">' + kpi((at == null ? '–' : (at > 0 ? '+' : '') + fmt(at, 1) + '°'), 'anomalía Tmax próx. 7 días', at >= 2 ? 'alerta' : at >= 1 ? 'aviso' : '') + kpi(fmt(prom('lluvia_30d_pct')) + '%', 'lluvia 30 días vs. normal', prom('lluvia_30d_pct') < 60 ? 'aviso' : '') +
        kpi(fmt(Math.max.apply(null, dentro.map(function (p) { return p.secos_hoy || 0; }).concat([0]))), 'máx. días seguidos sin lluvia') + '</div>' +
      '<div class="sec"><span>Variable en el mapa</span></div><div class="fila rejilla">' + seg('s-var', Object.keys(VARS).map(function (k) { return [k, { an_tmax_7f: 'Calor 7 d', an_tmax_7p: 'Calor pasado', secos_hoy: 'Días secos', lluvia_30d_pct: 'Lluvia 30 d', an_hr_7f: 'Humedad', dpv_max_7f: 'Sequedad aire', tmax_max_fc: 'Tmax 16 d' }[k]]; }), E.climaVar) + '</div>' +
      (sel ? '<div class="sec"><span>Punto seleccionado · ' + fmt(sel.elev) + ' m s.n.m.</span><button class="btn chico" id="b-cerrar-p">' + ic('x') + '</button></div>' +
        '<div class="leyenda"><span class="linea" style="--c:#c62828">Temperatura máxima</span><span class="linea" style="--c:#74817c">Normal</span></div><div class="grafica" id="g-tmax"></div>' +
        '<div class="leyenda" style="margin-top:8px"><span style="--c:#1565c0">Lluvia diaria (mm)</span></div><div class="grafica" id="g-lluvia"></div>' +
        '<table class="tabla" style="margin-top:8px"><tr><td>Anomalía Tmax últimos / próximos 7 días</td><td class="n">' + fmt(sel.an_tmax_7p, 1) + ' / ' + fmt(sel.an_tmax_7f, 1) + ' °C</td></tr><tr><td>Días seguidos sin lluvia</td><td class="n">' + fmt(sel.secos_hoy) + '</td></tr><tr><td>Lluvia 30 días</td><td class="n">' + fmt(sel.lluvia_30d) + ' mm (' + fmt(sel.lluvia_30d_pct) + '%)</td></tr><tr><td>Lluvia pronosticada 16 días</td><td class="n">' + fmt(sel.lluvia_fc16) + ' mm</td></tr></table>'
        : '<p class="nota">Haga clic sobre el mapa para ver la serie de 30 días observados + 16 días de pronóstico en ese lugar.</p>') +
      '<p class="fuente">' + esc(cl.fuente) + '. Actualizado ' + hace(cl.actualizado) + '.' + (cl.normales_completas < ps.length ? ' Línea base climática consolidada en ' + cl.normales_completas + ' de ' + ps.length + ' puntos de la malla.' : '') + '</p>';
    onSeg('s-var', function (v) { E.climaVar = v; });
    if (sel) {
      $('#b-cerrar-p').onclick = function () { E.climaSel = null; pintar(); };
      var s = sel.serie, hi = s.t.indexOf(cl.hoy);
      lineas($('#g-tmax'), s.t, [{ n: 'Tmax', c: '#c62828', v: s.tmax }, { n: 'Normal', c: '#74817c', v: s.tmax_n, dash: true }], '°C', hi);
      lineas($('#g-lluvia'), s.t, [{ n: 'Lluvia', c: '#1565c0', v: s.lluvia }], 'mm', hi, 'barras');
    }
    var capa = superficie(ps, E.climaVar, def);
    tematica('clima', { n: def.n, tipo: 'rampa', f: cl.fuente + ' · interpolación IDW suavizada', leyenda: rampaHTML(def.stops, fmt(def.lo) + ' ' + def.u, fmt(def.hi) + ' ' + def.u), op: .72, capa: capa });
    if (sel) tematica('clima-sel', { n: 'Punto seleccionado', tipo: 'punto', c: '#12355b', f: 'Celda de la malla climática', capa: L.circleMarker([sel.lat, sel.lon], { pane: 'puntos', radius: 8, color: '#fff', weight: 3, fillColor: '#12355b', fillOpacity: 1 }) });
    else tematica('clima-sel', null);
  }

  /* 5. Especies (datos propios) */
  var CAT_C = { CR: '#b71c1c', EN: '#ef6c00', VU: '#f9a825', NT: '#7cb342', LC: '#2e7d32', DD: '#78909c' };
  function modEspecies(el) {
    var es = D.esp;
    el.innerHTML = ayuda('Aquí se cargan los <b>registros de especies</b> del equipo (SiB Colombia / GBIF u otras fuentes). Se cruzan con las alertas para identificar <b>hábitat en riesgo</b>.') +
      (es ? '' : '<div class="zona-carga" id="zona">' + ic('subir') + '<div><b>Arrastre aquí su archivo</b> o haga clic para elegirlo</div><div class="nota">CSV (columnas: especie, categoria, lat, lon) o GeoJSON de puntos</div><input type="file" id="f-esp" accept=".csv,.geojson,.json" hidden></div>' +
        '<p class="nota">Para publicarlo para todos, guárdelo como <code>data/especies.geojson</code> en el repositorio.</p>') +
      (es ? resumenEspecies(es) : '');
    if (!es) {
      var z = $('#zona'), inp = $('#f-esp');
      z.onclick = function () { inp.click(); };
      z.ondragover = function (e) { e.preventDefault(); z.classList.add('sobre'); }; z.ondragleave = function () { z.classList.remove('sobre'); };
      z.ondrop = function (e) { e.preventDefault(); z.classList.remove('sobre'); if (e.dataTransfer.files[0]) leerEspecies(e.dataTransfer.files[0]); };
      inp.onchange = function () { if (inp.files[0]) leerEspecies(inp.files[0]); };
      tematica('esp', null);
    } else {
      var g = L.layerGroup();
      es.pts.filter(function (p) { if (!F.mun && !F.ver) return true; var v = vereda(p.lon, p.lat); return v && pasa(v.mun, v.id); }).forEach(function (p) {
        L.circleMarker([p.lat, p.lon], { pane: 'puntos', radius: 5, color: '#fff', weight: 1.2, fillColor: CAT_C[p.cat] || '#5e35b1', fillOpacity: .95 }).bindPopup(pp(p.sp, [['Categoría', p.cat], ['Grupo', p.grupo], ['Fecha', p.fecha]])).addTo(g); });
      tematica('esp', { n: 'Registros de especies', tipo: 'clases', f: es.fuente || 'Datos cargados por el equipo', leyenda: clasesHTML(Object.keys(CAT_C).map(function (k) { return [CAT_C[k], k]; })), capa: g });
      var b = $('#b-quitar-esp'); if (b) b.onclick = function () { D.esp = null; pintar(); };
    }
  }
  function resumenEspecies(es) {
    var c = {}; es.pts.forEach(function (p) { var k = p.sp; c[k] = c[k] || { n: 0, cat: p.cat }; c[k].n++; });
    var l = Object.keys(c).sort(function (a, b) { return c[b].n - c[a].n; });
    return '<div class="kpis">' + kpi(fmt(es.pts.length), 'registros') + kpi(l.length, 'especies') + kpi(l.filter(function (k) { return /CR|EN|VU/.test(c[k].cat || ''); }).length, 'amenazadas (CR, EN, VU)', 'aviso') + '</div>' +
      '<div class="sec"><span>Especies</span>' + (es.local ? '<button class="btn chico" id="b-quitar-esp">' + ic('x') + 'Quitar</button>' : '') + '</div><table class="tabla"><thead><tr><th>Especie</th><th>Cat.</th><th class="n">Reg.</th></tr></thead><tbody>' +
      l.slice(0, 150).map(function (k) { return '<tr><td><i>' + esc(k) + '</i></td><td><span class="chip"><i style="background:' + (CAT_C[c[k].cat] || '#5e35b1') + '"></i>' + esc(c[k].cat || '–') + '</span></td><td class="n">' + c[k].n + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function leerEspecies(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var txt = String(r.result), pts = [];
        if (/^\s*\{/.test(txt)) { JSON.parse(txt).features.forEach(function (f) { var p = f.properties || {}, c = f.geometry.coordinates; pts.push({ lon: c[0], lat: c[1], sp: p.especie || p.species || p.scientificName || '?', cat: (p.categoria || p.iucnRedListCategory || '').toUpperCase(), grupo: p.grupo || p.class || '', fecha: p.fecha || p.eventDate || '' }); }); }
        else {
          var filas = txt.split(/\r?\n/).filter(Boolean), sepr = filas[0].indexOf(';') >= 0 ? ';' : filas[0].indexOf('\t') >= 0 ? '\t' : ',', cab = filas[0].split(sepr).map(norm);
          var col = function (ns) { for (var i = 0; i < ns.length; i++) { var j = cab.indexOf(ns[i]); if (j >= 0) return j; } return -1; };
          var ila = col(['lat', 'latitud', 'decimallatitude', 'y']), ilo = col(['lon', 'longitud', 'decimallongitude', 'x']), isp = col(['especie', 'species', 'scientificname', 'nombre_cientifico']), ica = col(['categoria', 'iucnredlistcategory', 'cat', 'uicn']), igr = col(['grupo', 'class', 'clase']), ife = col(['fecha', 'eventdate']);
          filas.slice(1).forEach(function (f) { var c = f.split(sepr); var la = parseFloat(c[ila]), lo = parseFloat(c[ilo]); if (isFinite(la) && isFinite(lo)) pts.push({ lat: la, lon: lo, sp: c[isp] || '?', cat: (c[ica] || '').toUpperCase().trim(), grupo: c[igr] || '', fecha: c[ife] || '' }); });
        }
        pts = pts.filter(function (p) { return vereda(p.lon, p.lat); });
        D.esp = { pts: pts, fuente: file.name, local: true }; pintar();
        if (!pts.length) aviso('El archivo no tiene puntos dentro de Caldas o no se reconocieron las columnas lat/lon.');
      } catch (e) { aviso('No se pudo leer el archivo: ' + e.message); }
    };
    r.readAsText(file);
  }

  /* 6. Capas */
  function modCapas(el) {
    el.innerHTML = ayuda('Active o apague las capas de referencia. Las marcadas como <b>OBLIGATORIA</b> hacen parte de la vigilancia. En la <b>leyenda</b> del mapa puede ajustar la opacidad y ver la fuente de cada una.') +
      GRUPOS.map(function (g) {
        return '<div class="sec"><span>' + esc(g) + '</span></div>' + Object.keys(REG).filter(function (k) { return REG[k].g === g; }).map(function (k) { var r = REG[k];
          return '<label class="capa' + (r.on ? ' on' : '') + '" data-cat="' + k + '"><span class="sw">' + simbolo(r).replace('class="sim"', 'width="26" height="18"') + '</span><span class="tx">' + esc(r.n) + (r.obl ? '<span class="obl">OBLIGATORIA</span>' : '') + '<small>' + esc(r.f) + '</small></span><span class="interruptor"><input type="checkbox" data-capa="' + k + '"' + (r.on ? ' checked' : '') + '><span></span></span></label>';
        }).join('');
      }).join('');
    $$('input[data-capa]', el).forEach(function (i) { i.onchange = function () { encender(i.dataset.capa, i.checked); }; });
  }
  function sincCatalogo() { $$('label.capa[data-cat]').forEach(function (l) { var r = REG[l.dataset.cat]; l.classList.toggle('on', !!r.on); var i = l.querySelector('input'); if (i) i.checked = !!r.on; }); }

  /* 7. Campo · tablero completo de operación de campo (Supabase) ──────── */
  var CC = window.VF_CONFIG || {}, CT = CC.tablas || {};
  var C = {
    sb: null, ses: null, roles: [], nombre: '', al: [], rep: [], nov: [], pos: [], msg: [], perf: [],
    tab: 'resumen', filtro: 'activas', borrador: null, esperandoPunto: false, cargado: false, canal: null, err: '',
    per: 30, d1: '', d2: '', sort: { k: 'fecha', d: -1 }, sel: { r: {}, a: {}, m: {} },
    seen: {}, sound: false, feed: [], prev: null, alarmTO: null, chatCanal: 'general'
  };
  var EST_AL = { nueva: ['Nueva', '#c62828'], asignada: ['Asignada', '#ef6c00'], en_camino: ['En camino', '#1565c0'], verificada: ['Verificada', '#2e7d32'], descartada: ['Descartada', '#78909c'] };
  var PRIO = { alta: '#c62828', media: '#ef6c00', baja: '#f9a825' };
  var COL_C = { activo: '#e15759', controlado: '#f28e2b', extinguido: '#59a14f', nueva: '#e15759', asignada: '#f28e2b', en_camino: '#4e79a7', verificada: '#59a14f', descartada: '#9ca3af', validado: '#59a14f', pendiente: '#f28e2b', rechazado: '#9ca3af', alta: '#e15759', media: '#f28e2b', baja: '#59a14f', sos: '#e15759' };
  var PAL_C = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
  function sbCliente() {
    if (C.sb || !window.supabase || !CC.supabaseUrl) return C.sb;
    C.sb = window.supabase.createClient(CC.supabaseUrl, CC.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
    C.sb.auth.onAuthStateChange(function (ev, ses) { var antes = !!C.ses; C.ses = ses; if (!!ses !== antes) { cargarCampo(); } });
    return C.sb;
  }
  function puedeCoordinar() { return C.roles.some(function (r) { return r === 'coordinador' || r === 'planeacion'; }); }
  function esTecnico() { return C.roles.some(function (r) { return r === 'tecnico' || r === 'coordinador' || r === 'planeacion'; }); }
  async function iniciarCampo() {
    var sb = sbCliente(); if (!sb) return;
    var r = await sb.auth.getSession(); C.ses = r.data && r.data.session;
    await cargarCampo();
  }
  async function cargarCampo() {
    var sb = C.sb; if (!sb) return; C.err = '';
    try {
      if (C.ses) {
        var pf = await sb.from(CT.perfiles).select('rol,nombre').eq('user_id', C.ses.user.id);
        C.roles = (pf.data || []).map(function (x) { return x.rol; }); C.nombre = (pf.data && pf.data[0] && pf.data[0].nombre) || C.ses.user.email;
      } else { C.roles = []; C.nombre = ''; }
      var desde = new Date(Date.now() - 365 * 864e5).toISOString();
      var q = await Promise.all([
        sb.from(CT.alertas).select('*').gte('created_at', desde).order('created_at', { ascending: false }).limit(1000),
        sb.from(CT.reportes).select('*').gte('fecha_hora', desde).order('fecha_hora', { ascending: false }).limit(1000),
        sb.from(CT.novedades).select('*').gte('created_at', desde).order('created_at', { ascending: false }).limit(500),
        sb.from(CT.posiciones).select('*').order('updated_at', { ascending: false }).limit(200),
        sb.from('mensajes').select('*').order('created_at', { ascending: false }).limit(1500),
        sb.from(CT.perfiles).select('*').limit(300)
      ]);
      C.al = q[0].data || []; C.rep = q[1].data || []; C.nov = q[2].data || []; C.pos = q[3].data || [];
      C.msg = (q[4].data || []).reverse(); C.perf = q[5].data || [];
      [C.al, C.rep, C.nov].forEach(function (lista) { lista.forEach(function (x) { if (x.lat != null && x.lon != null) { var v = vereda(+x.lon, +x.lat); x._vid = v ? v.id : null; x._ver = v ? v.ver : x.vereda; x._mun = v ? v.mun : x.municipio; } }); });
      if (q.some(function (r) { return r.error; })) C.err = (q.filter(function (r) { return r.error; })[0].error.message || '');
      C.cargado = true;
      suscribir();
      detectarCampo();
    } catch (e) { C.err = e.message; }
    if (map) { pintarRail(); if (E.mod === 'campo') pintar(); }
  }
  function suscribir() {
    if (!C.sb || C.canal) return;
    var t = null, rec = function () { clearTimeout(t); t = setTimeout(cargarCampo, 800); };
    C.canal = C.sb.channel('vigia-fuego');
    [CT.alertas, CT.reportes, CT.novedades, CT.posiciones, 'mensajes'].forEach(function (tb) { C.canal.on('postgres_changes', { event: '*', schema: 'public', table: tb }, rec); });
    C.canal.subscribe();
  }
  function alertasActivas() { return C.al.filter(function (a) { return a.estado === 'nueva' || a.estado === 'asignada' || a.estado === 'en_camino'; }); }
  function enTerritorio(x) { if (!F.mun && !F.ver) return true; return x._vid != null ? pasa(x._mun, x._vid) : (F.mun && norm(x.municipio) === norm(F.mun) && !F.ver); }
  function chipEstado(e) { var d = EST_AL[e] || [e || '–', '#78909c']; return '<span class="estado" style="background:' + d[1] + '1a;color:' + d[1] + '">' + esc(d[0]) + '</span>'; }
  function tagC(c, t) { return '<span class="campo-tag" style="--tc:' + (COL_C[String(c).toLowerCase()] || '#6b7280') + '">' + esc(t || c || '') + '</span>'; }

  /* ── filtros de campo ── */
  function campoDias() { return C.per === 'rango' ? Math.max(1, Math.round(((C.d2 ? new Date(C.d2 + 'T23:59:59').getTime() : Date.now()) - (C.d1 ? new Date(C.d1 + 'T00:00:00').getTime() : Date.now() - 30 * 864e5)) / 864e5)) : (+C.per || 0); }
  function campoDesde(k) { k = k || 0; if (C.per === 'rango') { var i = C.d1 ? new Date(C.d1 + 'T00:00:00').getTime() : Date.now() - 30 * 864e5, f = C.d2 ? new Date(C.d2 + 'T23:59:59').getTime() : Date.now(); return i - k * (f - i); } var d = campoDias(); return d ? Date.now() - (k + 1) * d * 864e5 : 0; }
  function campoHasta(k) { k = k || 0; if (C.per === 'rango') { var i = C.d1 ? new Date(C.d1 + 'T00:00:00').getTime() : Date.now() - 30 * 864e5, f = C.d2 ? new Date(C.d2 + 'T23:59:59').getTime() : Date.now(); return f - k * (f - i); } return k ? Date.now() - k * campoDias() * 864e5 : Infinity; }
  function enPeriodo(d, k) { var t = new Date(d).getTime(); return t >= campoDesde(k) && t <= campoHasta(k); }
  function perTexto() { return C.per === 'rango' ? (C.d1 || 'inicio') + ' a ' + (C.d2 || 'hoy') : campoDias() ? 'últimos ' + campoDias() + ' días' : 'todo el período'; }
  function repNorm(r) { return { id: r.id, fecha: r.fecha_hora, lat: r.lat, lon: r.lon, municipio: r._mun || r.municipio, vereda: r._ver || r.vereda, cobertura: r.cobertura, area: r.area_ha, estado: String(r.estado || '').toLowerCase(), val: r.rechazado ? 'rechazado' : r.validado ? 'validado' : 'pendiente', por: r.reportante, causa: r.causa_probable, obs: r.observaciones, origen: r.origen || 'app', fotos: Array.isArray(r.fotos) ? r.fotos : [], nivel: r.nivel, raw: r }; }
  function fRepC(k) { return C.rep.filter(function (r) { var n = repNorm(r); return n.val !== 'rechazado' && enTerritorio(r) && enPeriodo(r.fecha_hora, k); }).map(repNorm); }
  function fRepAll() { return C.rep.filter(function (r) { return enTerritorio(r) && enPeriodo(r.fecha_hora); }).map(repNorm); }
  function fAlC() { return C.al.filter(function (a) { return enTerritorio(a) && enPeriodo(a.created_at); }); }
  function lugarC(r) { return [r.vereda || r._ver, r.municipio || r._mun].filter(Boolean).join(' · ') || 'sin ubicación'; }
  function agoC(t) { var m = Math.round((Date.now() - new Date(t)) / 60000); return !isFinite(m) ? '' : m < 1 ? 'ahora' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'hace ' + Math.round(m / 1440) + ' d'; }

  /* ── gráficas compactas ── */
  function hbarsC(rows, col) { var mx = Math.max(1, Math.max.apply(null, rows.map(function (x) { return x[1]; }))); return rows.length ? rows.map(function (x, i) { return '<div class="campo-bar"><span title="' + esc(x[0]) + '">' + esc(x[0]) + '</span><i style="width:' + Math.max(3, x[1] / mx * 100) + '%;background:' + (col || PAL_C[i % PAL_C.length]) + '"></i><b>' + x[1] + '</b></div>'; }).join('') : '<p class="nota">Sin datos en el período</p>'; }
  function donutC(rows) { var tot = rows.reduce(function (s, x) { return s + x[1]; }, 0); if (!tot) return '<p class="nota">Sin datos</p>'; var a = 0; var seg2 = rows.map(function (x) { var p = x[1] / tot * 100, r = x[2] + ' ' + a + '% ' + (a + p) + '%'; a += p; return r; }).join(','); return '<div class="campo-donut"><div class="campo-ring" style="background:conic-gradient(' + seg2 + ')" data-t="' + tot + '"></div><div class="campo-lg">' + rows.map(function (x) { return '<div><i style="background:' + x[2] + '"></i>' + esc(x[0]) + ' <b>' + x[1] + '</b> <span>(' + Math.round(x[1] / tot * 100) + '%)</span></div>'; }).join('') + '</div></div>'; }
  function lineaC(rep) {
    var n = Math.min(campoDias() || 90, 180), days = [], fin = C.per === 'rango' && C.d2 ? new Date(C.d2 + 'T23:59:59').getTime() : Date.now();
    for (var i = n - 1; i >= 0; i--) { var d = new Date(fin - i * 864e5); days.push({ k: d.toISOString().slice(0, 10), v: 0 }); }
    var ix = {}; days.forEach(function (d, j) { ix[d.k] = j; }); rep.forEach(function (r) { var k = (r.fecha || '').slice(0, 10); if (k in ix) days[ix[k]].v++; });
    var W = 340, H = 140, pl = 28, pb = 20, pt = 8, mx = Math.max(2, Math.max.apply(null, days.map(function (d) { return d.v; })));
    var ys = function (v) { return H - pb - v / mx * (H - pb - pt); };
    var g = ''; for (var j = 0; j <= 3; j++) { var v = Math.round(mx * j / 3), y = ys(v); g += '<line x1="' + pl + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#e5e7eb"/><text x="' + (pl - 4) + '" y="' + (y + 4) + '" text-anchor="end" style="font-size:9px">' + v + '</text>'; }
    var step = Math.ceil(days.length / 6);
    days.forEach(function (d, j) { if (j % step === 0) g += '<text x="' + (pl + j * ((W - pl - 4) / days.length) + ((W - pl - 4) / days.length) / 2) + '" y="' + (H - 4) + '" text-anchor="middle" style="font-size:9px">' + d.k.slice(8) + '/' + d.k.slice(5, 7) + '</text>'; });
    var bw = (W - pl - 4) / days.length;
    var bars = days.map(function (d, j) { return '<rect x="' + (pl + j * bw + 1) + '" y="' + ys(d.v) + '" width="' + Math.max(1, bw - 1) + '" height="' + (H - pb - ys(d.v)) + '" fill="#4e79a7" rx="1"><title>' + d.k + ': ' + d.v + '</title></rect>'; }).join('');
    return '<svg class="campo-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img">' + g + bars + '</svg>';
  }
  function cntBy(arr, f) { var c = {}; arr.forEach(function (x) { var k = f(x) || 'Sin dato'; c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort(function (a, b) { return b[1] - a[1]; }); }
  function deltaC(a, b, inv) { if (!campoDias()) return ''; if (!b) return a ? '<em class="campo-up">nuevo</em>' : ''; var p = Math.round((a - b) / b * 100); if (!p) return '<em class="campo-eq">= anterior</em>'; return '<em class="' + ((p > 0) !== !!inv ? 'campo-up' : 'campo-dn') + '">' + (p > 0 ? '▲' : '▼') + ' ' + Math.abs(p) + '%</em>'; }

  /* ── detección y alarma ── */
  var actxC;
  function beepC(n, hz) { if (!C.sound) return; n = n || 3; hz = hz || 880; try { actxC = actxC || new (window.AudioContext || window.webkitAudioContext)(); for (var i = 0; i < n; i++) { var o = actxC.createOscillator(), g = actxC.createGain(); o.type = 'square'; o.frequency.value = hz + (i % 2) * 220; g.gain.value = .12; o.connect(g); g.connect(actxC.destination); var t = actxC.currentTime + i * .28; o.start(t); o.stop(t + .2); } } catch (e) {} }
  function snapshotC() { return { al: new Map(C.al.map(function (a) { return [a.id, a.estado + '|' + (a.asignado_a || '')]; })), rep: new Set(C.rep.map(function (r) { return r.id; })), msg: new Set(C.msg.map(function (m) { return m.id; })), nov: new Set(C.nov.map(function (n) { return n.id; })) }; }
  function detectarCampo() {
    var cur = snapshotC(), p = C.prev; C.prev = cur; if (!p || !C.ses) return;
    var ev = [];
    C.al.forEach(function (a) {
      if (!p.al.has(a.id)) { if (a.estado === 'nueva') ev.push({ t: 'ALERTA ENTRANTE', d: (a.titulo || '') + (a.municipio ? ' · ' + a.municipio : ''), go: 'alertas', l: 'red' }); }
      else if (p.al.get(a.id) !== a.estado + '|' + (a.asignado_a || '')) {
        if (a.estado === 'en_camino' || a.estado === 'asignada') ev.push({ t: a.estado === 'en_camino' ? 'En camino' : 'Alerta tomada', d: (a.asignado_nombre || '') + ' · ' + (a.titulo || ''), go: 'alertas', l: 'amb' });
        else if (a.estado === 'verificada') ev.push({ t: 'Alerta verificada', d: a.titulo || '', go: 'alertas', l: 'grn' });
      }
    });
    C.rep.forEach(function (r) { if (!p.rep.has(r.id)) ev.push({ t: 'NUEVO REPORTE', d: lugarC(r), go: 'reportes', l: 'red' }); });
    C.msg.forEach(function (m) { if (!p.msg.has(m.id) && C.ses && m.autor_id !== C.ses.user.id) ev.push(m.tipo === 'sos' ? { t: 'SOS', d: (m.autor_nombre || '') + ': ' + (m.texto || 'pide ayuda'), go: 'chat', l: 'red' } : { t: 'Mensaje', d: (m.autor_nombre || '') + ': ' + (m.texto || ''), go: 'chat', l: 'blu' }); });
    C.nov.forEach(function (n) { if (!p.nov.has(n.id)) ev.push({ t: 'Novedad', d: (n.autor_nombre || '') + ' · ' + (n.tipo || ''), go: 'equipo', l: 'blu' }); });
    if (ev.length) dispararAlarma(ev);
  }
  var LV_C = { red: '#e15759', amb: '#f28e2b', blu: '#4e79a7', grn: '#59a14f' };
  function dispararAlarma(ev) {
    ev.forEach(function (e) { C.feed.unshift(Object.assign({}, e, { at: Date.now() })); }); C.feed = C.feed.slice(0, 30);
    var top = ev.find(function (e) { return e.l === 'red'; }) || ev.find(function (e) { return e.l === 'amb'; }) || ev[0];
    if (top.l === 'red') beepC(4); else if (top.l === 'amb') beepC(2, 660); else if (top.l === 'blu') beepC(1, 600);
    if (E.mod === 'campo') pintar();
  }

  /* ── CSV export ── */
  function csvDownC(rows, name) { var t = rows.map(function (r) { return r.map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','); }).join('\n'); var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + t], { type: 'text/csv' })); a.download = name; a.click(); }

  /* ── borrar con confirmación ── */
  async function borrarC(tabla, ids) {
    if (!ids.length) return 0;
    var r = await C.sb.from(tabla).delete().in('id', ids).select('id');
    if (r.error) throw r.error;
    return (r.data || []).length;
  }
  function fuerteC(n, que) { return n > 1 ? prompt('Va a eliminar ' + n + ' ' + que + ' de forma definitiva.\nEscriba ELIMINAR para confirmar.') === 'ELIMINAR' : confirm('¿Eliminar ' + que.replace(/s$/, '') + ' de forma definitiva?'); }

  /* Borrador de alerta desde otros módulos */
  window.__vfAlerta = function (k) { var d = (window.__vfBorradores || {})[k]; if (!d) return; map.closePopup(); C.borrador = d; C.esperandoPunto = false; C.tab = 'nueva'; E.mod = 'campo'; pintarRail(); pintar(); $('#contenido').scrollTop = 0; };
  function botonAlerta(datos) { window.__vfBorradores = window.__vfBorradores || {}; var k = 'b' + Math.random().toString(36).slice(2, 9); window.__vfBorradores[k] = datos; return '<button class="btn pri chico" style="margin-top:8px;width:100%;justify-content:center" onclick="__vfAlerta(\'' + k + '\')">Enviar alerta a campo</button>'; }

  /* ══════════════════════════════════════════════════════
     MÓDULO PRINCIPAL: modCampo — tablero completo de campo
     ══════════════════════════════════════════════════════ */
  function modCampo(el) {
    if (!C.sb) sbCliente();
    if (!C.sb) { el.innerHTML = ayuda('No fue posible cargar la conexión con la operación de campo. Verifique su conexión a internet.'); return; }
    if (!C.cargado) { el.innerHTML = '<p class="nota">Conectando con la operación de campo…</p>'; iniciarCampo(); return; }

    /* Sesión / login */
    var cab;
    if (C.ses) {
      var sndTxt = C.sound ? '🔔 Sonido' : '🔕 Sonido';
      cab = '<div class="sesion"><div class="av">' + esc((C.nombre || '?').slice(0, 1).toUpperCase()) + '</div><div style="flex:1;min-width:0"><b>' + esc(C.nombre) + '</b><div class="sub">' + esc(C.ses.user.email) + ' · ' + (C.roles.length ? C.roles.map(function (r) { return r.charAt(0).toUpperCase() + r.slice(1); }).join(', ') : 'sin rol') + '</div></div>' +
        '<button class="btn chico" id="c-snd" title="Alternar sonido">' + sndTxt + '</button>' +
        '<button class="btn chico" id="c-salir">Salir</button></div>' +
        '<div class="campo-live" id="c-live"><i></i><span>' + (C.err ? 'Error: ' + esc(C.err) : 'En vivo · ' + agoC(Date.now())) + '</span></div>';
    } else {
      cab = '<form class="login" id="c-login" autocomplete="on"><b>Ingreso del equipo de coordinación</b><p class="nota" style="margin:2px 0 8px">Use la misma cuenta del tablero de campo.</p>' +
        '<label>Correo<input type="email" id="c-em" autocomplete="username" required></label><label>Contraseña<input type="password" id="c-pw" autocomplete="current-password" required></label>' +
        '<div class="err" id="c-err"></div><button class="btn pri" type="submit" style="width:100%;justify-content:center">Ingresar</button></form>';
    }

    /* Filtros */
    var filtros = '';
    if (C.ses) {
      var munSet = {};
      C.rep.forEach(function (r) { if (r.municipio) munSet[r.municipio] = 1; });
      C.al.forEach(function (a) { if (a.municipio) munSet[a.municipio] = 1; });
      var muns = Object.keys(munSet).sort();
      filtros = '<div class="campo-filtros">' +
        '<select id="c-fper"><option value="7">7 días</option><option value="30"' + (C.per == 30 ? ' selected' : '') + '>30 días</option><option value="90">90 días</option><option value="365">Año</option><option value="0">Todo</option><option value="rango">Rango…</option></select>' +
        (C.per === 'rango' ? '<input type="date" id="c-fd1" value="' + esc(C.d1) + '"><input type="date" id="c-fd2" value="' + esc(C.d2) + '">' : '') +
        '<select id="c-fmun"><option value="">Todo Caldas</option>' + muns.map(function (m) { return '<option' + (F.mun && norm(F.mun) === norm(m) ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>' +
        '<span class="campo-cnt" id="c-fcnt"></span></div>';
    }

    /* Tabs */
    var tabs = C.ses ? [['resumen', 'Resumen'], ['reportes', 'Reportes'], ['alertas', 'Alertas'], ['chat', 'Chat'], ['equipo', 'Equipo'], ['informe', 'Informe']].concat(puedeCoordinar() ? [['nueva', '＋ Alerta']] : []) : [['reportes', 'Reportes'], ['alertas', 'Alertas'], ['equipo', 'Equipo']];
    if (!C.ses && ['resumen', 'chat', 'informe', 'nueva'].indexOf(C.tab) >= 0) C.tab = 'reportes';

    /* Alarma */
    var alarm = '';
    if (C.feed.length && C.ses) {
      var top = C.feed[0];
      alarm = '<div class="campo-alarm" style="--ac:' + (LV_C[top.l] || '#4e79a7') + '" id="c-alarm"><b>' + esc(top.t) + '</b> <span>' + esc(top.d) + '</span><button class="btn chico" id="c-alarm-go">Ver</button><button class="btn chico" id="c-alarm-x">×</button></div>';
    }

    el.innerHTML = alarm + cab + filtros +
      '<div class="fila" style="margin-top:8px">' + seg('c-tab', tabs, C.tab) + '</div>' +
      '<div id="c-cuerpo"></div>' +
      '<p class="fuente">Sincronizado con la operación de campo. <a href="' + esc(CC.tableroCampo || '#') + '" target="_blank" rel="noopener">Tablero externo</a> · <a href="' + esc(CC.appCampo || '#') + '" target="_blank" rel="noopener">App de guardabosques</a></p>';

    /* Eventos */
    onSeg('c-tab', function (v) { C.tab = v; if (v !== 'nueva') { C.esperandoPunto = false; map.getContainer().style.cursor = ''; } if (v === 'chat') { C.seen[C.chatCanal] = new Date().toISOString(); } });
    if (C.ses) {
      $('#c-salir').onclick = async function () { await C.sb.auth.signOut(); C.ses = null; C.tab = 'resumen'; await cargarCampo(); };
      $('#c-snd').onclick = function () { C.sound = !C.sound; if (C.sound) beepC(2); pintar(); };
      var fper = $('#c-fper'); if (fper) fper.onchange = function () { C.per = fper.value === 'rango' ? 'rango' : +fper.value; if (C.per === 'rango' && !C.d2) { var h = new Date(); C.d2 = h.toISOString().slice(0, 10); C.d1 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10); } pintar(); };
      var fd1 = $('#c-fd1'); if (fd1) fd1.onchange = function () { C.d1 = fd1.value; pintar(); };
      var fd2 = $('#c-fd2'); if (fd2) fd2.onchange = function () { C.d2 = fd2.value; pintar(); };
      var cnt = $('#c-fcnt'); if (cnt) cnt.textContent = fRepC().length + ' reportes · ' + fAlC().length + ' alertas';
    } else {
      $('#c-login').onsubmit = async function (e) {
        e.preventDefault(); var b = this.querySelector('button'); b.disabled = true; b.textContent = 'Ingresando…';
        var r = await C.sb.auth.signInWithPassword({ email: $('#c-em').value.trim(), password: $('#c-pw').value });
        if (r.error) { $('#c-err').textContent = /invalid/i.test(r.error.message) ? 'Correo o contraseña incorrectos.' : r.error.message; b.disabled = false; b.textContent = 'Ingresar'; return; }
        C.ses = r.data.session; C.tab = 'resumen'; await cargarCampo();
      };
    }
    if ($('#c-alarm-go')) $('#c-alarm-go').onclick = function () { C.tab = C.feed[0].go; C.feed = []; pintar(); };
    if ($('#c-alarm-x')) $('#c-alarm-x').onclick = function () { C.feed = []; pintar(); };

    /* Tab body */
    var cu = $('#c-cuerpo');
    if (C.tab === 'resumen') cuerpoResumen(cu);
    else if (C.tab === 'reportes') cuerpoReportes(cu);
    else if (C.tab === 'alertas') cuerpoAlertas(cu);
    else if (C.tab === 'chat') cuerpoChat(cu);
    else if (C.tab === 'equipo') cuerpoEquipo(cu);
    else if (C.tab === 'informe') cuerpoInforme(cu);
    else cuerpoNueva(cu);
    capasCampo();
  }

  /* ── RESUMEN ── */
  function cuerpoResumen(cu) {
    var rep = fRepC(), prev = fRepC(1), al = fAlC();
    var act = C.rep.filter(function (r) { return String(r.estado || '').toLowerCase() === 'activo' && !(r.rechazado) && enTerritorio(r); }).length;
    var pen = C.rep.filter(function (r) { return !r.validado && !r.rechazado && enTerritorio(r); }).length;
    var ha = rep.reduce(function (s, r) { return s + (+r.area || 0); }, 0), haP = prev.reduce(function (s, r) { return s + (+r.area || 0); }, 0);
    var alAb = alertasActivas().filter(enTerritorio).length;
    var enLinea = C.pos.filter(function (p) { return Date.now() - new Date(p.updated_at) < 36e5; }).length;
    var sos = C.msg.filter(function (m) { return m.tipo === 'sos' && Date.now() - new Date(m.created_at) < 864e5; }).length;

    var kpis2 = '<div class="kpis">' +
      kpi(act, 'incendios activos', act ? 'alerta' : '') +
      kpi(rep.length, 'reportes · ' + perTexto()) +
      kpi(pen, 'por validar', pen ? 'aviso' : '') +
      '</div><div class="kpis">' +
      kpi(ha.toFixed(1) + ' ha', 'área afectada · ' + deltaC(ha, haP)) +
      kpi(alAb, 'alertas abiertas', alAb ? 'aviso' : '') +
      kpi(enLinea, 'equipo en línea (1h)') +
      '</div>';
    if (sos) kpis2 += '<div class="kpis">' + kpi(sos, 'SOS en 24 h', 'alerta') + '</div>';

    /* Charts */
    var estRows = ['activo', 'controlado', 'extinguido'].map(function (k) { return [k, rep.filter(function (r) { return r.estado === k; }).length, COL_C[k]]; }).filter(function (x) { return x[1]; });
    var munRows = cntBy(rep, function (r) { return r.municipio; }).slice(0, 6);
    var cobRows = cntBy(rep, function (r) { return r.cobertura; }).slice(0, 6);

    cu.innerHTML = kpis2 +
      '<div class="sec"><span>Estado de los incendios</span></div>' + donutC(estRows) +
      '<div class="sec"><span>Actividad en vivo</span></div><div class="campo-feed" id="c-feed">' + (C.feed.length ? C.feed.slice(0, 15).map(function (e) { return '<div><i style="background:' + (LV_C[e.l] || '#4e79a7') + '"></i><div><b>' + esc(e.t) + '</b> <span>' + agoC(e.at) + '</span><br>' + esc(e.d) + '</div></div>'; }).join('') : '<p class="nota">Aquí aparecerá la actividad nueva.</p>') + '</div>' +
      '<div class="sec"><span>Municipios con más reportes</span></div><div class="campo-hb">' + hbarsC(munRows, '#4e79a7') + '</div>' +
      '<div class="sec"><span>Reportes por día</span></div>' + lineaC(rep) +
      '<div class="sec"><span>Cobertura afectada</span></div><div class="campo-hb">' + hbarsC(cobRows) + '</div>';
  }

  /* ── REPORTES ── */
  function cuerpoReportes(cu) {
    var allR = fRepAll();
    var eF = $('#c-rest') ? $('#c-rest').value : '', vF = $('#c-rval') ? $('#c-rval').value : '', qF = $('#c-rq') ? $('#c-rq').value : '';
    var rows = allR.filter(function (r) { return (!eF || r.estado === eF) && (!vF || r.val === vF) && (!qF || [r.municipio, r.vereda, r.por, r.cobertura, r.causa].join(' ').toLowerCase().indexOf(qF.toLowerCase()) >= 0); });
    rows.sort(function (a, b) { var x = a[C.sort.k] || '', y = b[C.sort.k] || ''; return (x > y ? 1 : x < y ? -1 : 0) * C.sort.d; });

    cu.innerHTML = '<div class="campo-bar">' +
      '<select id="c-rest"><option value="">Todos estados</option><option' + (eF === 'activo' ? ' selected' : '') + '>activo</option><option' + (eF === 'controlado' ? ' selected' : '') + '>controlado</option><option' + (eF === 'extinguido' ? ' selected' : '') + '>extinguido</option></select>' +
      '<select id="c-rval"><option value="">Toda validación</option><option value="pendiente"' + (vF === 'pendiente' ? ' selected' : '') + '>Por validar</option><option value="validado"' + (vF === 'validado' ? ' selected' : '') + '>Validados</option><option value="rechazado"' + (vF === 'rechazado' ? ' selected' : '') + '>Rechazados</option></select>' +
      '</div>' +
      '<input type="search" id="c-rq" placeholder="Buscar municipio, vereda…" style="width:100%;margin-bottom:8px" value="' + esc(qF) + '">' +
      '<div class="campo-bar"><span class="campo-cnt">' + rows.length + ' reportes</span>' +
        '<button class="btn chico" id="c-csv">CSV</button>' +
        (puedeCoordinar() ? '<button class="btn chico" id="c-rdel" style="color:#c62828">Eliminar filtrados</button>' : '') +
      '</div>' +
      '<div class="campo-tw"><table class="tabla campo-tabla"><thead><tr>' +
        '<th data-sk="fecha">Fecha</th><th data-sk="municipio">Lugar</th><th data-sk="area">Área</th><th data-sk="estado">Estado</th><th>Val.</th><th>Fotos</th>' +
      '</tr></thead><tbody>' +
      (rows.length ? rows.slice(0, 200).map(function (r) {
        return '<tr class="campo-fila" data-rid="' + esc(r.id) + '"><td>' + fechaCorta(r.fecha) + '</td><td><b>' + esc(r.municipio || '—') + '</b><div class="sub">' + esc(r.vereda || '') + '</div></td><td>' + (r.area != null ? fmt(r.area, 1) : '') + '</td><td>' + tagC(r.estado, r.estado) + '</td><td>' + tagC(r.val, r.val === 'pendiente' ? 'validar' : r.val) + '</td><td>' + (r.fotos.length ? '📷' + r.fotos.length : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="nota" style="padding:16px">Sin reportes</td></tr>') +
      '</tbody></table></div>';

    /* Eventos */
    var rest = $('#c-rest'), rval = $('#c-rval'), rq = $('#c-rq');
    if (rest) rest.onchange = function () { pintar(); };
    if (rval) rval.onchange = function () { pintar(); };
    if (rq) rq.oninput = function () { pintar(); };
    $$('th[data-sk]', cu).forEach(function (th) { th.onclick = function () { C.sort = { k: th.dataset.sk, d: C.sort.k === th.dataset.sk ? -C.sort.d : -1 }; pintar(); }; th.style.cursor = 'pointer'; });
    $$('.campo-fila', cu).forEach(function (tr) { tr.onclick = function () { abrirDetalle(tr.dataset.rid); }; tr.style.cursor = 'pointer'; });
    var csvBtn = $('#c-csv'); if (csvBtn) csvBtn.onclick = function () {
      var hdr = ['fecha', 'municipio', 'vereda', 'cobertura', 'area_ha', 'estado', 'validacion', 'causa', 'reportante', 'origen', 'lat', 'lon'];
      var data = rows.map(function (r) { return [r.fecha, r.municipio, r.vereda, r.cobertura, r.area, r.estado, r.val, r.causa, r.por, r.origen, r.raw ? r.raw.lat : '', r.raw ? r.raw.lon : '']; });
      csvDownC([hdr].concat(data), 'reportes_incendios.csv');
    };
    var rdel = $('#c-rdel'); if (rdel) rdel.onclick = async function () {
      var ids = rows.map(function (r) { return r.id; }); if (!ids.length || !fuerteC(ids.length, 'reportes')) return;
      try { await borrarC(CT.reportes, ids); aviso(ids.length + ' reportes eliminados'); } catch (e) { alert(e.message); }
      await cargarCampo();
    };
  }

  /* ── DETALLE DE REPORTE (modal) ── */
  function abrirDetalle(id) {
    var raw = C.rep.find(function (r) { return r.id === id; }); if (!raw) return;
    var r = repNorm(raw);
    var ex = $('#c-detalle'); if (ex) ex.remove();
    var d = document.createElement('div'); d.className = 'campo-modal'; d.id = 'c-detalle';
    var fotos = r.fotos.length ? '<div class="campo-ph">' + r.fotos.map(function (u) { return '<a href="' + esc(u) + '" target="_blank"><img src="' + esc(u) + '" alt="foto"></a>'; }).join('') + '</div>' : '';
    var row = function (k, v) { return v ? '<div class="campo-dr"><span>' + k + '</span><b>' + esc(v) + '</b></div>' : ''; };
    var acciones = '';
    if (esTecnico()) {
      acciones = '<div class="campo-bar" style="margin-top:10px">' +
        (r.val !== 'validado' ? '<button class="btn pri chico" id="cd-val">Validar</button>' : '') +
        (r.val !== 'rechazado' ? '<button class="btn chico" id="cd-rej" style="color:#c62828">Rechazar</button>' : '') +
        '<button class="btn chico" id="cd-pend">Por validar</button></div>';
    }
    if (puedeCoordinar()) {
      acciones += '<div class="campo-bar" style="margin-top:6px">' +
        '<label style="flex:1">Estado <select id="cd-est"><option' + (r.estado === 'activo' ? ' selected' : '') + '>activo</option><option' + (r.estado === 'controlado' ? ' selected' : '') + '>controlado</option><option' + (r.estado === 'extinguido' ? ' selected' : '') + '>extinguido</option></select></label>' +
        '<button class="btn chico" id="cd-del" style="color:#c62828">Eliminar</button></div>';
    }

    d.innerHTML = '<div class="campo-detalle"><button class="btn chico" id="cd-x" style="float:right">×</button>' +
      '<h3>' + esc(lugarC(r)) + '</h3><div>' + tagC(r.estado, r.estado) + ' ' + tagC(r.val, r.val === 'pendiente' ? 'por validar' : r.val) + '</div>' +
      row('Fecha', fecha(r.fecha) + ' (' + agoC(r.fecha) + ')') +
      row('Cobertura', r.cobertura) + row('Área', r.area != null ? r.area + ' ha' : null) +
      row('Causa probable', r.causa) + row('Reportó', r.por) + row('Origen', r.origen) +
      row('Observaciones', r.obs) +
      (raw.lat != null ? row('Coordenadas', (+raw.lat).toFixed(5) + ', ' + (+raw.lon).toFixed(5)) : '') +
      fotos + acciones + '</div>';

    document.body.appendChild(d);
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    $('#cd-x').onclick = function () { d.remove(); };
    if ($('#cd-val')) $('#cd-val').onclick = async function () { await C.sb.from(CT.reportes).update({ validado: true, rechazado: false }).eq('id', id); d.remove(); await cargarCampo(); };
    if ($('#cd-rej')) $('#cd-rej').onclick = async function () { await C.sb.from(CT.reportes).update({ validado: false, rechazado: true }).eq('id', id); d.remove(); await cargarCampo(); };
    if ($('#cd-pend')) $('#cd-pend').onclick = async function () { await C.sb.from(CT.reportes).update({ validado: false, rechazado: false }).eq('id', id); d.remove(); await cargarCampo(); };
    if ($('#cd-est')) $('#cd-est').onchange = async function () { await C.sb.from(CT.reportes).update({ estado: $('#cd-est').value }).eq('id', id); d.remove(); await cargarCampo(); };
    if ($('#cd-del')) $('#cd-del').onclick = async function () { if (!confirm('¿Eliminar este reporte?')) return; try { await borrarC(CT.reportes, [id]); } catch (e) { alert(e.message); } d.remove(); await cargarCampo(); };
    if (raw.lat != null) map.flyTo([raw.lat, raw.lon], 14, { duration: .6 });
  }

  /* ── ALERTAS ── */
  function cuerpoAlertas(cu) {
    var todas = fAlC().concat(C.al.filter(function (a) { return alertasActivas().indexOf(a) >= 0 && fAlC().indexOf(a) < 0; }));
    var filt = C.filtro;
    var rows = todas.filter(function (a) { return !filt || (filt === 'activas' ? ['nueva', 'asignada', 'en_camino'].indexOf(a.estado) >= 0 : a.estado === filt); }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    var staff = C.perf.filter(function (p) { return ['guardabosque', 'tecnico', 'coordinador', 'planeacion'].indexOf(p.rol) >= 0; });

    cu.innerHTML = '<div class="fila">' + seg('c-afil', [['activas', 'Activas'], ['verificada', 'Verificadas'], ['descartada', 'Descartadas'], ['', 'Todas']], filt) + '</div>' +
      '<div class="campo-bar"><span class="campo-cnt">' + rows.length + ' alertas</span>' +
        (puedeCoordinar() ? '<button class="btn chico" id="c-arei">Reiniciar abiertas</button><button class="btn chico" id="c-addesc" style="color:#c62828">Eliminar descartadas</button>' : '') +
      '</div>' +
      '<div class="campo-tw"><table class="tabla campo-tabla"><thead><tr><th>Fecha</th><th>Alerta</th><th>Prio</th><th>Estado</th><th>Asignada</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.slice(0, 150).map(function (a) {
        var asign = '';
        if (['nueva', 'asignada', 'en_camino'].indexOf(a.estado) >= 0) {
          asign = '<select data-aas="' + esc(a.id) + '" style="font-size:12px;max-width:100px"><option value="">Asignar…</option>' + staff.map(function (p) { return '<option value="' + esc(p.user_id) + '|' + esc(p.nombre || p.rol) + '"' + (p.user_id === a.asignado_a ? ' selected' : '') + '>' + esc(p.nombre || p.rol) + '</option>'; }).join('') + '</select>';
        } else { asign = esc(a.asignado_nombre || '—'); }
        return '<tr data-all="' + (a.lat || '') + ',' + (a.lon || '') + '"><td style="font-size:11px">' + agoC(a.created_at) + '<div class="sub">' + esc(a.fuente || '') + '</div></td><td><b>' + esc(a.titulo || 'Alerta') + '</b><div class="sub">' + esc(a.municipio || '') + '</div></td><td>' + tagC(a.prioridad || 'media', a.prioridad) + '</td><td>' + chipEstado(a.estado) + '</td><td>' + asign + '</td>' +
          '<td style="white-space:nowrap">' + (['nueva', 'asignada'].indexOf(a.estado) >= 0 ? '<button class="btn chico" data-adesc="' + esc(a.id) + '" style="color:#c62828;font-size:11px">Descartar</button>' : '') + (puedeCoordinar() && a.estado !== 'nueva' ? ' <button class="btn chico" data-arei="' + esc(a.id) + '" style="font-size:11px">Reiniciar</button>' : '') + (puedeCoordinar() ? ' <button class="btn chico" data-adel="' + esc(a.id) + '" style="color:#c62828;font-size:11px">×</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="nota" style="padding:16px">Sin alertas</td></tr>') +
      '</tbody></table></div>';

    onSeg('c-afil', function (v) { C.filtro = v; });
    /* Fly to alert on row click */
    $$('tr[data-all]', cu).forEach(function (tr) { tr.onclick = function (e) { if (e.target.closest('select') || e.target.closest('button')) return; var ll = tr.dataset.all.split(','); if (ll[0] && isFinite(+ll[0])) map.flyTo([+ll[0], +ll[1]], 14, { duration: .6 }); }; });
    /* Assignment */
    $$('select[data-aas]', cu).forEach(function (sel) { sel.onchange = async function () { if (!sel.value) return; var parts = sel.value.split('|'); await C.sb.from(CT.alertas).update({ asignado_a: parts[0], asignado_nombre: parts[1], estado: 'asignada' }).eq('id', sel.dataset.aas); await cargarCampo(); }; });
    /* Descartar */
    $$('[data-adesc]', cu).forEach(function (b) { b.onclick = async function () { if (!confirm('¿Descartar esta alerta?')) return; await C.sb.from(CT.alertas).update({ estado: 'descartada' }).eq('id', b.dataset.adesc); await cargarCampo(); }; });
    /* Reiniciar individual */
    $$('[data-arei]', cu).forEach(function (b) { b.onclick = async function () { await C.sb.from(CT.alertas).update({ estado: 'nueva', asignado_a: null, asignado_nombre: null }).eq('id', b.dataset.arei); await cargarCampo(); }; });
    /* Eliminar individual */
    $$('[data-adel]', cu).forEach(function (b) { b.onclick = async function () { if (!confirm('¿Eliminar esta alerta?')) return; try { await borrarC(CT.alertas, [b.dataset.adel]); } catch (e) { alert(e.message); } await cargarCampo(); }; });
    /* Batch: reiniciar abiertas */
    if ($('#c-arei')) $('#c-arei').onclick = async function () { var ab = alertasActivas(); if (!ab.length || !confirm('¿Reiniciar ' + ab.length + ' alertas abiertas?')) return; await C.sb.from(CT.alertas).update({ estado: 'nueva', asignado_a: null, asignado_nombre: null }).in('id', ab.map(function (a) { return a.id; })); await cargarCampo(); };
    /* Batch: eliminar descartadas */
    if ($('#c-addesc')) $('#c-addesc').onclick = async function () { var d = C.al.filter(function (a) { return a.estado === 'descartada'; }); if (!d.length) return alert('No hay descartadas'); if (!fuerteC(d.length, 'alertas')) return; try { await borrarC(CT.alertas, d.map(function (a) { return a.id; })); } catch (e) { alert(e.message); } await cargarCampo(); };
  }

  /* ── CHAT ── */
  function nombreCanal(c) { if (c === 'general') return 'General del equipo'; if (c.indexOf('inc:') === 0) { var r = C.rep.find(function (y) { return y.id === c.slice(4); }); return r ? 'Incendio · ' + lugarC(r) : 'Incendio (reporte)'; } return c; }
  function canalesCampo() {
    var m = new Map(); m.set('general', { n: nombreCanal('general'), last: null, u: 0, sos: 0 });
    C.msg.forEach(function (x) { var c = x.canal || 'general'; if (!m.has(c)) m.set(c, { n: nombreCanal(c), last: null, u: 0, sos: 0 }); var o = m.get(c); o.last = x; if (x.tipo === 'sos' && Date.now() - new Date(x.created_at) < 864e5) o.sos++; if (C.ses && new Date(x.created_at) > new Date(C.seen[c] || 0) && x.autor_id !== C.ses.user.id) o.u++; });
    return m;
  }
  function cuerpoChat(cu) {
    if (!C.ses) { cu.innerHTML = '<p class="nota">Inicie sesión para ver el chat del equipo.</p>'; return; }
    var cs = canalesCampo();
    var msgs = C.msg.filter(function (m) { return (m.canal || 'general') === C.chatCanal; });
    cu.innerHTML = '<div class="campo-canales" id="c-chs">' + Array.from(cs).map(function (e) {
      var k = e[0], v = e[1];
      return '<div class="campo-ch' + (k === C.chatCanal ? ' on' : '') + '" data-cc="' + esc(k) + '"><b>' + esc(v.n) + '</b>' + (v.sos ? ' ' + tagC('sos', 'SOS') : '') + (v.u && k !== C.chatCanal ? ' <span class="badge">' + v.u + '</span>' : '') + '<div class="sub">' + (v.last ? esc((v.last.autor_nombre || '') + ': ' + (v.last.texto || '').slice(0, 40)) : 'Sin mensajes') + '</div></div>';
    }).join('') + '</div>' +
      '<div class="sec"><span>' + esc(nombreCanal(C.chatCanal)) + ' · ' + msgs.length + ' mensajes</span></div>' +
      '<div class="campo-msgs" id="c-msgs">' + (msgs.length ? msgs.map(function (m) {
        var me = C.ses && m.autor_id === C.ses.user.id;
        return '<div class="campo-msg' + (me ? ' me' : '') + (m.tipo === 'sos' ? ' sos' : '') + '">' +
          (puedeCoordinar() ? '<button class="btn chico" data-cmdel="' + esc(m.id) + '" style="float:right;font-size:10px;color:#c62828" title="Eliminar">×</button>' : '') +
          '<small><b>' + esc(m.autor_nombre || '—') + '</b> · ' + agoC(m.created_at) + '</small>' +
          (m.tipo === 'sos' ? ' ' + tagC('sos', 'SOS') : '') +
          '<div>' + esc(m.texto || '') + '</div>' +
          (m.lat != null ? '<a href="https://www.google.com/maps?q=' + m.lat + ',' + m.lon + '" target="_blank" style="font-size:11px">📍 ubicación</a>' : '') +
          '</div>';
      }).join('') : '<p class="nota">Aún no hay mensajes aquí.</p>') + '</div>' +
      '<div class="campo-cf"><input type="text" id="c-cin" placeholder="Escribe un mensaje…"><button class="btn pri chico" id="c-csend">Enviar</button></div>';

    /* Events */
    $$('.campo-ch', cu).forEach(function (d) { d.onclick = function () { C.chatCanal = d.dataset.cc; C.seen[C.chatCanal] = new Date().toISOString(); pintar(); }; });
    var msgBox = $('#c-msgs'); if (msgBox) msgBox.scrollTop = msgBox.scrollHeight;
    var sendMsg = async function () {
      var t = $('#c-cin').value.trim(); if (!t) return; $('#c-cin').value = '';
      var m = { id: crypto.randomUUID ? crypto.randomUUID() : 'vf-' + Date.now(), canal: C.chatCanal, autor_id: C.ses.user.id, autor_nombre: C.nombre + ' (coordinación)', tipo: 'texto', texto: t, created_at: new Date().toISOString() };
      C.msg.push(m); pintar();
      var r = await C.sb.from('mensajes').insert(m);
      if (r.error) { alert('No se pudo enviar: ' + r.error.message); await cargarCampo(); }
    };
    if ($('#c-csend')) $('#c-csend').onclick = sendMsg;
    if ($('#c-cin')) $('#c-cin').onkeydown = function (e) { if (e.key === 'Enter') sendMsg(); };
    $$('[data-cmdel]', cu).forEach(function (b) { b.onclick = async function (e) { e.stopPropagation(); if (!confirm('¿Eliminar este mensaje?')) return; try { await borrarC('mensajes', [b.dataset.cmdel]); } catch (e2) { alert(e2.message); } await cargarCampo(); }; });
    C.seen[C.chatCanal] = new Date().toISOString();
  }

  /* ── EQUIPO ── */
  function cuerpoEquipo(cu) {
    cu.innerHTML = '<div class="sec"><span>Guardabosques · última posición</span></div>' +
      (C.pos.length ? '<div class="campo-tw"><table class="tabla campo-tabla"><thead><tr><th>Nombre</th><th>Última señal</th><th>Ubicación</th></tr></thead><tbody>' + C.pos.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).map(function (p) {
        var on = Date.now() - new Date(p.updated_at) < 2 * 36e5;
        return '<tr data-ll="' + p.lat + ',' + p.lon + '"><td>' + (on ? '<span class="campo-on">●</span>' : '<span class="campo-off">●</span>') + ' <b>' + esc(p.nombre || 'Guardabosque') + '</b></td><td>' + agoC(p.updated_at) + '</td><td>' + (p.lat != null ? '<a href="https://www.google.com/maps?q=' + p.lat + ',' + p.lon + '" target="_blank" style="font-size:11px">' + (+p.lat).toFixed(4) + ', ' + (+p.lon).toFixed(4) + '</a>' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="nota">' + (C.ses ? 'No hay posiciones recientes.' : 'Inicie sesión para ver el equipo.') + '</p>') +
      '<div class="sec"><span>Novedades de ronda</span></div>' +
      (C.nov.length ? '<div class="campo-tw" style="max-height:400px">' + C.nov.filter(enTerritorio).slice(0, 60).map(function (n) {
        var fo = (n.fotos || []).slice(0, 3).map(function (u, i) { return '<a href="' + esc(u) + '" target="_blank" style="font-size:11px">foto ' + (i + 1) + '</a>'; }).join(' · ');
        return '<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>' + esc(n.tipo || 'Novedad') + '</b> ' + tagC(n.prioridad || 'media', n.prioridad) + '<div class="sub">' + esc(n.autor_nombre || '') + ' · ' + fecha(n.created_at) + (n.lat != null ? ' · <a href="https://www.google.com/maps?q=' + n.lat + ',' + n.lon + '" target="_blank" style="font-size:11px">ubicación</a>' : '') + '</div>' + (n.descripcion ? '<div style="font-size:13px;margin-top:2px">' + esc(n.descripcion) + '</div>' : '') + (fo ? '<small>' + fo + '</small>' : '') + '</div>';
      }).join('') + '</div>' : '<p class="nota">Sin novedades.</p>');
    $$('tr[data-ll]', cu).forEach(function (tr) { tr.onclick = function () { var ll = tr.dataset.ll.split(','); if (isFinite(+ll[0])) map.flyTo([+ll[0], +ll[1]], 14, { duration: .6 }); }; tr.style.cursor = 'pointer'; });
  }

  /* ── INFORME ── */
  function cuerpoInforme(cu) {
    if (!C.ses) { cu.innerHTML = '<p class="nota">Inicie sesión para generar informes.</p>'; return; }
    var rep = fRepC(), al = fAlC();
    var act = rep.filter(function (r) { return r.estado === 'activo'; }).length;
    var pen = rep.filter(function (r) { return r.val === 'pendiente'; }).length;
    var ha = rep.reduce(function (s, r) { return s + (+r.area || 0); }, 0);
    var alAb = alertasActivas().filter(enTerritorio).length;
    var estRows = ['activo', 'controlado', 'extinguido'].map(function (k) { return [k, rep.filter(function (r) { return r.estado === k; }).length, COL_C[k]]; }).filter(function (x) { return x[1]; });
    var munRows = cntBy(rep, function (r) { return r.municipio; }).slice(0, 8);
    var cobRows = cntBy(rep, function (r) { return r.cobertura; }).slice(0, 8);

    cu.innerHTML = '<div class="campo-bar"><button class="btn pri chico" id="c-prn">Imprimir / PDF</button><button class="btn chico" id="c-csv2">CSV</button><span class="campo-cnt">' + perTexto() + '</span></div>' +
      '<div class="campo-inf" id="c-inf">' +
      '<h3>Informe de incendios reportados en campo</h3><div class="sub">Período: ' + esc(perTexto()) + ' · Generado por ' + esc(C.nombre) + ' · ' + fecha(Date.now()) + '</div>' +
      '<div class="kpis" style="margin:10px 0">' + kpi(rep.length, 'reportes') + kpi(act, 'activos') + kpi(pen, 'por validar') + kpi(ha.toFixed(1) + ' ha', 'área') + kpi(alAb, 'alertas abiertas') + '</div>' +
      '<div class="sec"><span>Estado</span></div>' + donutC(estRows) +
      '<div class="sec"><span>Municipios</span></div><div class="campo-hb">' + hbarsC(munRows, '#4e79a7') + '</div>' +
      '<div class="sec"><span>Cobertura</span></div><div class="campo-hb">' + hbarsC(cobRows) + '</div>' +
      '<div class="sec"><span>Reportes por día</span></div>' + lineaC(rep) +
      '<div class="sec"><span>Detalle</span></div>' +
      '<div class="campo-tw"><table class="tabla campo-tabla"><thead><tr><th>Fecha</th><th>Lugar</th><th>Cobertura</th><th>ha</th><th>Estado</th><th>Val.</th><th>Reportó</th></tr></thead><tbody>' +
      rep.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); }).map(function (r) {
        return '<tr><td>' + fechaCorta(r.fecha) + '</td><td>' + esc(lugarC(r)) + '</td><td>' + esc(r.cobertura || '') + '</td><td>' + (r.area != null ? fmt(r.area, 1) : '') + '</td><td>' + esc(r.estado) + '</td><td>' + (r.val === 'pendiente' ? 'validar' : r.val) + '</td><td>' + esc(r.por || '') + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="sub" style="margin-top:10px">Fuente: reportes de campo · Gobernación de Caldas. Los reportes rechazados no se incluyen.</div>' +
      '</div>';

    $('#c-prn').onclick = function () { window.print(); };
    $('#c-csv2').onclick = function () {
      var hdr = ['fecha', 'municipio', 'vereda', 'cobertura', 'area_ha', 'estado', 'validacion', 'causa', 'reportante'];
      var data = rep.map(function (r) { return [r.fecha, r.municipio, r.vereda, r.cobertura, r.area, r.estado, r.val, r.causa, r.por]; });
      csvDownC([hdr].concat(data), 'informe_incendios.csv');
    };
  }

  /* ── NUEVA ALERTA ── */
  function cuerpoNueva(cu) {
    var b = C.borrador || (C.borrador = { titulo: '', descripcion: '', prioridad: 'alta', fuente: 'vigia_fuego' });
    var v = b.lat != null ? vereda(b.lon, b.lat) : null;
    var guardas = C.pos.map(function (p) { return p; });
    cu.innerHTML = '<form class="formulario" id="c-form">' +
      '<div class="ubic ' + (b.lat != null ? 'ok' : '') + '">' + (b.lat != null ? '<b>Ubicación:</b> ' + esc(v ? v.ver + ' · ' + v.mun : fmt(b.lat, 5) + ', ' + fmt(b.lon, 5)) + '<div class="sub">' + fmt(b.lat, 5) + ', ' + fmt(b.lon, 5) + '</div>' : '<b>Ubicación pendiente</b>') +
        '<button type="button" class="btn chico" id="c-punto">' + (C.esperandoPunto ? 'Haga clic en el mapa…' : b.lat != null ? 'Cambiar en el mapa' : 'Marcar en el mapa') + '</button></div>' +
      '<label>Título<input id="c-ti" required maxlength="140" value="' + esc(b.titulo) + '" placeholder="Ej.: Verificar punto de calor en vereda…"></label>' +
      '<label>Prioridad</label>' + seg('c-prio', [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], b.prioridad) +
      '<label>Descripción e instrucciones<textarea id="c-de" rows="4" placeholder="Qué verificar, accesos, contactos…">' + esc(b.descripcion) + '</textarea></label>' +
      '<label>Asignar a (opcional)<select id="c-as"><option value="">Sin asignar · visible para todo el equipo</option>' + guardas.map(function (g) { return '<option value="' + esc(g.user_id) + '"' + (b.asignado_a === g.user_id ? ' selected' : '') + '>' + esc(g.nombre || 'Guardabosque') + '</option>'; }).join('') + '</select></label>' +
      '<div class="err" id="c-ferr"></div><button class="btn pri" type="submit" style="width:100%;justify-content:center">Enviar alerta a los guardabosques</button>' +
      '<button class="btn" type="button" id="c-cancelar" style="width:100%;justify-content:center;margin-top:6px">Cancelar</button></form>';
    var guardar = function () { b.titulo = $('#c-ti').value; b.descripcion = $('#c-de').value; b.asignado_a = $('#c-as').value || null; };
    $$('#c-prio button').forEach(function (x) { x.onclick = function () { guardar(); b.prioridad = x.dataset.v; pintar(); }; });
    $('#c-punto').onclick = function () { guardar(); C.esperandoPunto = true; map.getContainer().style.cursor = 'crosshair'; pintar(); };
    $('#c-cancelar').onclick = function () { C.borrador = null; C.esperandoPunto = false; map.getContainer().style.cursor = ''; C.tab = 'alertas'; pintar(); };
    $('#c-form').onsubmit = async function (e) {
      e.preventDefault(); guardar();
      if (b.lat == null) { $('#c-ferr').textContent = 'Marque la ubicación de la alerta en el mapa.'; return; }
      var btn = this.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Enviando…';
      var g = guardas.find(function (x) { return x.user_id === b.asignado_a; });
      var fila = { id: (crypto.randomUUID ? crypto.randomUUID() : 'vf-' + Date.now()), created_at: new Date().toISOString(), fuente: b.fuente || 'vigia_fuego',
        titulo: b.titulo.trim() || 'Alerta Vigías del Fuego', descripcion: b.descripcion.trim() || null, lat: +(+b.lat).toFixed(6), lon: +(+b.lon).toFixed(6),
        municipio: v ? v.mun : null, vereda: v ? v.ver : null, prioridad: b.prioridad, estado: b.asignado_a ? 'asignada' : 'nueva',
        asignado_a: b.asignado_a || null, asignado_nombre: g ? g.nombre : null, referencia_externa: b.referencia || null,
        creado_por: C.ses.user.id, creado_por_nombre: C.nombre || C.ses.user.email };
      var r = await C.sb.from(CT.alertas).insert(fila);
      if (r.error && /check|violates|constraint/i.test(r.error.message) && fila.fuente !== 'llamada') {
        fila.fuente = b.fuenteAlterna || 'llamada'; fila.descripcion = '[Vigías del Fuego] ' + (fila.descripcion || ''); r = await C.sb.from(CT.alertas).insert(fila);
      }
      if (r.error) { $('#c-ferr').textContent = 'No se pudo enviar: ' + r.error.message; btn.disabled = false; btn.textContent = 'Enviar alerta a los guardabosques'; return; }
      C.borrador = null; C.esperandoPunto = false; map.getContainer().style.cursor = ''; C.tab = 'alertas'; C.filtro = 'activas';
      aviso('Alerta enviada a la operación de campo.'); await cargarCampo();
    };
    if (b.lat != null) tematica('c-nueva', { n: 'Ubicación de la nueva alerta', tipo: 'punto', c: '#12355b', f: 'Borrador de alerta', capa: L.marker([b.lat, b.lon], { pane: 'puntos', draggable: true, icon: L.divIcon({ className: '', html: '<div class="pin-nueva"></div>', iconSize: [30, 40], iconAnchor: [15, 38] }) })
      .on('dragend', function (ev) { var ll = ev.target.getLatLng(); guardar(); b.lat = ll.lat; b.lon = ll.lng; pintar(); }) });
    else tematica('c-nueva', null);
  }

  /* ── CAPAS DE CAMPO (mapa) ── */
  function capasCampo() {
    var idx = {}, ga = L.layerGroup(), gr = L.layerGroup(), gp = L.layerGroup(), gn = L.layerGroup();
    C.al.filter(enTerritorio).filter(function (a) { return a.lat != null && (C.filtro === 'todas' || C.tab !== 'alertas' ? a.estado !== 'descartada' : C.filtro === 'activas' ? ['nueva', 'asignada', 'en_camino'].indexOf(a.estado) >= 0 : a.estado === C.filtro); }).forEach(function (a) {
      var c = (EST_AL[a.estado] || ['', '#78909c'])[1];
      var m = L.marker([a.lat, a.lon], { pane: 'puntos', icon: L.divIcon({ className: '', html: '<div class="pin-alerta' + (a.estado === 'nueva' ? ' viva' : '') + '" style="--c:' + c + '"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg></div>', iconSize: [30, 30], iconAnchor: [15, 15] }) })
        .bindPopup(pp(a.titulo || 'Alerta', [['Estado', (EST_AL[a.estado] || [a.estado])[0]], ['Prioridad', a.prioridad], ['Fuente', a.fuente], ['Vereda', a._ver || a.vereda], ['Municipio', a._mun || a.municipio], ['Creada', fecha(a.created_at)], ['Asignada a', a.asignado_nombre], ['Resultado', a.resultado], ['Verificada por', a.verificado_por_nombre]]) + (a.descripcion ? '<p style="margin:6px 0 0">' + esc(a.descripcion) + '</p>' : '') +
          (C.ses && puedeCoordinar() && ['nueva', 'asignada'].indexOf(a.estado) >= 0 ? '<button class="btn chico" style="margin-top:8px;width:100%;justify-content:center" onclick="__vfDescartar(\'' + esc(a.id) + '\')">Descartar alerta</button>' : ''));
      idx[a.id] = m; m.addTo(ga);
    });
    C.rep.filter(enTerritorio).filter(function (r) { return r.lat != null; }).forEach(function (r) {
      var c = r.estado === 'Activo' ? '#d50000' : r.estado === 'Controlado' ? '#ef6c00' : '#6d4c41';
      L.marker([r.lat, r.lon], { pane: 'puntos', icon: L.divIcon({ className: '', html: '<div class="pin-reporte" style="--c:' + c + '"><svg viewBox="0 0 24 24"><path d="M12 22c4.4 0 7-3 7-7 0-3-1.6-5.4-3.4-7.3-.4 1.8-1.4 3.1-2.6 3.6.2-3.3-1.3-6.4-4-8.3.3 3.2-1.4 5.3-3 7.2C4.7 11.8 5 13 5 15c0 4 2.6 7 7 7Z"/></svg></div>', iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindPopup(pp('Reporte de campo · ' + (r.tipo_fuego || 'incendio'), [['Fecha', fecha(r.fecha_hora)], ['Estado', r.estado], ['Validación', r.validado ? 'Validado' : r.rechazado ? 'Rechazado' : 'Por validar'], ['Cobertura', r.cobertura], ['Área', r.area_ha ? fmt(r.area_ha, 1) + ' ha' : null], ['Causa probable', r.causa_probable], ['Afectación', r.afectacion], ['Vereda', r._ver || r.vereda], ['Municipio', r._mun || r.municipio], ['Origen', r.origen], ['Reportante', r.reportante]]) +
          (r.fotos && r.fotos.length ? '<img src="' + esc(r.fotos[0]) + '" alt="Foto del reporte" style="width:100%;border-radius:8px;margin-top:6px">' : '')).addTo(gr);
    });
    C.pos.filter(function (p) { return p.lat != null; }).forEach(function (p) {
      var on = Date.now() - new Date(p.updated_at) < 2 * 36e5;
      L.marker([p.lat, p.lon], { pane: 'puntos', icon: L.divIcon({ className: '', html: '<div class="pin-guarda' + (on ? '' : ' off') + '"><svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></div>', iconSize: [28, 28], iconAnchor: [14, 14] }) })
        .bindPopup(pp(p.nombre || 'Guardabosque', [['Última posición', fecha(p.updated_at)], ['Hace', hace(p.updated_at)], ['Precisión', p.precision ? fmt(p.precision) + ' m' : null]])).addTo(gp);
    });
    C.nov.filter(enTerritorio).filter(function (n) { return n.lat != null; }).forEach(function (n) {
      L.circleMarker([n.lat, n.lon], { pane: 'puntos', radius: 6, color: '#fff', weight: 2, fillColor: '#6a1b9a', fillOpacity: 1 }).bindPopup(pp('Novedad · ' + (n.tipo || ''), [['Fecha', fecha(n.created_at)], ['Autor', n.autor_nombre], ['Prioridad', n.prioridad], ['Descripción', n.descripcion]])).addTo(gn);
    });
    tematica('c-al', { n: 'Alertas a campo', tipo: 'clases', f: 'Operación de campo · tabla de alertas (tiempo real)', leyenda: clasesHTML(Object.keys(EST_AL).filter(function (k) { return k !== 'descartada'; }).map(function (k) { return [EST_AL[k][1], EST_AL[k][0]]; })), capa: ga, idx: idx });
    tematica('c-rep', { n: 'Reportes de incendio de campo', tipo: 'clases', f: 'Aplicación de guardabosques y QField', leyenda: clasesHTML([['#d50000', 'Activo'], ['#ef6c00', 'Controlado'], ['#6d4c41', 'Extinguido']]), capa: gr });
    tematica('c-pos', { n: 'Guardabosques', tipo: 'punto', c: '#2e7d32', f: 'Última posición reportada por la aplicación', capa: gp });
    tematica('c-nov', { n: 'Novedades de campo', tipo: 'punto', c: '#6a1b9a', f: 'Novedades registradas por los guardabosques', capa: gn });
  }
  window.__vfDescartar = async function (id) {
    if (!confirm('¿Descartar esta alerta? Dejará de mostrarse a los guardabosques.')) return;
    var r = await C.sb.from(CT.alertas).update({ estado: 'descartada' }).eq('id', id);
    if (r.error) aviso('No se pudo descartar: ' + r.error.message); else { map.closePopup(); await cargarCampo(); }
  };


  /* 8. Constructor de reportes ─ genera infografía profesional en PDF */
  function abrirConstructor() {
    var f = $('.guia-fondo'); if (f) f.remove();
    var terr = nombreFiltro() || 'todo Caldas';
    var hoy = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
    var d = document.createElement('div'); d.className = 'guia-fondo'; d.id = 'rep-modal';
    d.innerHTML = '<div class="guia" style="width:min(560px,100%)" role="dialog" aria-modal="true">' +
      '<div class="g-cab"><div class="ic">' + ic('tabla') + '</div><div><small>Generar reporte</small><h3>Construir reporte personalizado</h3></div></div>' +
      '<div class="g-cuerpo">' +
      '<p style="margin-bottom:12px;font-size:13px">Seleccione las secciones que desea incluir y el estilo visual. El reporte se abre en una nueva pestaña, listo para guardar como PDF.</p>' +
      '<label style="display:block;margin-bottom:10px"><b>Título del reporte</b><br><input type="text" id="rep-titulo" style="width:100%;font:inherit;padding:8px 10px;border:1.5px solid var(--line-strong);border-radius:8px;background:var(--surface);color:var(--ink);margin-top:4px" value="Reporte de vigilancia · ' + esc(terr) + '"></label>' +
      '<div style="margin-bottom:10px"><b style="font-size:13px">Secciones</b></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;margin-bottom:14px">' +
        chk('rep-s-resumen', 'Resumen ejecutivo (KPIs)', true) +
        chk('rep-s-mapa', 'Captura del mapa', true) +
        chk('rep-s-vigilancia', 'Sitios prioritarios', true) +
        chk('rep-s-incendios', 'Puntos de calor', true) +
        chk('rep-s-deforestacion', 'Pérdida de bosque', true) +
        chk('rep-s-clima', 'Clima y anomalías', true) +
        chk('rep-s-campo', 'Operación de campo', C.cargado && C.ses) +
      '</div>' +
      '<label style="display:block;margin-bottom:6px"><b style="font-size:13px">Estilo visual</b></label>' +
      seg('rep-tema', [['dark', 'Infografía oscura'], ['light', 'Informe claro']], 'dark') +
      '</div>' +
      '<div class="g-pie"><button class="btn" id="rep-cerrar">Cancelar</button><button class="btn pri" id="rep-generar">Generar reporte</button></div></div>';
    document.body.appendChild(d);
    d.querySelector('#rep-cerrar').onclick = function () { d.remove(); };
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    var tema = 'dark';
    $$('#rep-tema button').forEach(function (b) { b.onclick = function () { tema = b.dataset.v; $$('#rep-tema button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.v === tema); }); }; });
    d.querySelector('#rep-generar').onclick = async function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Preparando…';
      try { await generarReporte($('#rep-titulo').value, secciones(), tema); } catch (e) { console.error(e); alert('Error al generar el reporte: ' + e.message); }
      d.remove();
    };
    function secciones() {
      return ['resumen','mapa','vigilancia','incendios','deforestacion','clima','campo'].filter(function (s) {
        var c = $('#rep-s-' + s); return c && c.checked;
      });
    }
  }
  function chk(id, label, checked) {
    return '<label style="display:flex;gap:6px;align-items:center;font-size:13px;cursor:pointer"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' + label + '</label>';
  }
  async function generarReporte(titulo, sec, tema) {
    var terr = nombreFiltro() || 'todo Caldas';
    var hoy = new Date().toISOString();
    var payload = {
      v: 1, titulo: titulo || 'Reporte Vigías del Fuego', subtitulo: terr + ' · ' + new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }),
      territorio: terr, tema: tema, generado: hoy, sec: sec, fuentes: 'NASA FIRMS (VIIRS/MODIS), IDEAM, Global Forest Watch, Open-Meteo, Corpocaldas, ANT, Supabase (operación de campo)'
    };
    /* Mapa */
    if (sec.indexOf('mapa') >= 0 && window.html2canvas) {
      try {
        var mapEl = map.getContainer();
        var canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 2, logging: false, backgroundColor: null });
        payload.mapa = canvas.toDataURL('image/jpeg', 0.88);
      } catch (e) { console.warn('No se pudo capturar el mapa:', e); }
    }
    /* KPIs */
    if (sec.indexOf('resumen') >= 0) {
      var nv = D.vig ? D.vig.veredas.filter(function (v) { return v.nivel === 'vigilar' && pasa(v.mun, v.id); }).length : 0;
      var na = D.vig ? D.vig.veredas.filter(function (v) { return v.nivel === 'atencion' && pasa(v.mun, v.id); }).length : 0;
      var cal30 = detecciones(30).length, cal24 = detecciones(1).length;
      var ha4 = 0;
      if (D.defo) { var e0 = Date.parse(D.defo.epoca + 'T00:00:00Z'), lim4 = Date.now() - 28 * 864e5; D.defo.pts.forEach(function (p) { if (pasa(D.defo.veredas[p[4]], null) && e0 + p[2] * 864e5 >= lim4) ha4 += D.defo.ha_pixel; }); }
      var at = D.clima ? D.clima.puntos.filter(function (p) { return pasa(p.mun, null); }).map(function (p) { return p.an_tmax_7f; }).filter(function (x) { return x != null; }) : [];
      var atm = at.length ? at.reduce(function (a, b) { return a + b; }, 0) / at.length : null;
      var nal = C.al ? C.al.filter(function (a) { return a.estado === 'nueva'; }).length : 0;
      payload.kpi = { vigilar: nv, atencion: na, calor_24h: cal24, calor_30d: cal30, defo_4s_ha: Math.round(ha4 * 10) / 10, anom_temp: atm != null ? Math.round(atm * 10) / 10 : null, alertas: nal, reportes: C.rep ? C.rep.length : 0 };
    }
    /* Vigilancia */
    if (sec.indexOf('vigilancia') >= 0 && D.vig) {
      payload.vig = D.vig.veredas.filter(function (v) { return pasa(v.mun, v.id); }).slice(0, 25).map(function (v) {
        return { p: v.puesto, v: v.ver, m: v.mun, n: v.nivel, r: Math.round(v.riesgo * 100) / 100, rz: v.razones || [] };
      });
    }
    /* Incendios */
    if (sec.indexOf('incendios') >= 0 && D.firms) {
      var ds = detecciones(E.fuegoP);
      var meses = {}, mk = [];
      ds.forEach(function (d) {
        var t = new Date(d.t), k = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
        if (!meses[k]) { meses[k] = [t.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }), 0, 0]; mk.push(k); }
        if (d.f === 'FIRMS') meses[k][1]++; else meses[k][2]++;
      });
      mk.sort();
      var porVer = {}; ds.forEach(function (d) { var k = (d.ver || '?') + ' (' + (d.mun || '?') + ')'; porVer[k] = (porVer[k] || 0) + 1; });
      var topV = Object.keys(porVer).map(function (k) { return [k, porVer[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
      payload.inc = { total: ds.length, meses: mk.map(function (k) { return meses[k]; }), top: topV.slice(0, 10) };
    }
    /* Deforestación */
    if (sec.indexOf('deforestacion') >= 0 && D.defo) {
      var semMap = {}, sk = [];
      var e0d = Date.parse(D.defo.epoca + 'T00:00:00Z'), ha = D.defo.ha_pixel;
      D.defo.pts.filter(function (p) { return pasa(D.defo.veredas[p[4]], null); }).forEach(function (p) {
        var t = new Date(e0d + p[2] * 864e5), sem = isoSemana(t);
        if (!semMap[sem]) { semMap[sem] = 0; sk.push(sem); }
        semMap[sem] += ha;
      });
      sk.sort(); var totalHa = 0; sk.forEach(function (k) { totalHa += semMap[k]; });
      var porVerD = {}; D.defo.pts.filter(function (p) { return pasa(D.defo.veredas[p[4]], null); }).forEach(function (p) {
        var vn = D.defo.veredas[p[4]] || '?'; porVerD[vn] = (porVerD[vn] || 0) + ha;
      });
      var topD = Object.keys(porVerD).map(function (k) { return [k, Math.round(porVerD[k] * 10) / 10]; }).sort(function (a, b) { return b[1] - a[1]; });
      payload.defo = { total_ha: Math.round(totalHa * 10) / 10, semanas: sk.slice(-26).map(function (k) { return [k, Math.round(semMap[k] * 10) / 10]; }), top: topD.slice(0, 10) };
    }
    /* Clima */
    if (sec.indexOf('clima') >= 0 && D.clima) {
      var pts = D.clima.puntos.filter(function (p) { return pasa(p.mun, null); });
      var prom = function (campo) { var vs = pts.map(function (p) { return p[campo]; }).filter(function (x) { return x != null; }); return vs.length ? vs.reduce(function (a, b) { return a + b; }, 0) / vs.length : null; };
      var vars = [];
      var tmx = prom('an_tmax_7f'); if (tmx != null) vars.push(['Anomalía Tmax (7 días)', (tmx > 0 ? '+' : '') + tmx.toFixed(1) + ' °C']);
      var tmn = prom('an_tmin_7f'); if (tmn != null) vars.push(['Anomalía Tmin (7 días)', (tmn > 0 ? '+' : '') + tmn.toFixed(1) + ' °C']);
      var ll = prom('pct_prec_30'); if (ll != null) vars.push(['Lluvia 30 días vs. normal', Math.round(ll) + '%']);
      var hr = prom('an_hr_7f'); if (hr != null) vars.push(['Anomalía HR (7 días)', (hr > 0 ? '+' : '') + hr.toFixed(0) + ' pts']);
      payload.clima = { vars: vars, texto: 'Resumen climático para ' + terr + '. Valores promedio del área seleccionada.' };
      /* Chart: anomalía diaria de temperatura */
      if (D.clima.dias && D.clima.dias.length) {
        payload.clima.chart = D.clima.dias.slice(-30).map(function (d) {
          return [new Date(d.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }), d.an_tmax != null ? Math.round(d.an_tmax * 10) / 10 : 0];
        });
      }
    }
    /* Campo */
    if (sec.indexOf('campo') >= 0 && C.cargado) {
      payload.campo = {
        nueva: C.al.filter(function (a) { return a.estado === 'nueva'; }).length,
        asignada: C.al.filter(function (a) { return a.estado === 'asignada'; }).length,
        en_camino: C.al.filter(function (a) { return a.estado === 'en_camino'; }).length,
        verificada: C.al.filter(function (a) { return a.estado === 'verificada'; }).length,
        reportes: C.rep.length,
        guardas: C.pos.filter(function (p) { return Date.now() - new Date(p.updated_at) < 2 * 36e5; }).length,
        novedades: C.nov.length
      };
    }
    localStorage.setItem('vf_reporte', JSON.stringify(payload));
    window.open('reporte.html', '_blank');
  }

  /* ── navegación ─────────────────────────────── */
  var MOD = {
    vigilancia: { n: 'Vigilancia', t: 'Sitios a vigilar', s: 'Veredas priorizadas por riesgo de incendio y deforestación', fn: modVigilancia, tem: ['vig'] },
    incendios: { n: 'Incendios', t: 'Incendios', s: 'Puntos de calor del último año completo y contexto histórico', fn: modIncendios, tem: ['fdens', 'fpts', 'xmbf', 'xicv'] },
    deforestacion: { n: 'Deforestación', t: 'Deforestación', s: 'Seguimiento semanal por municipio y vereda', fn: modDeforestacion, tem: ['dpts', 'xgfwt'] },
    clima: { n: 'Clima', t: 'Clima y sequía', s: 'Anomalías actuales y pronóstico a 16 días', fn: modClima, tem: ['clima', 'clima-sel'] },
    especies: { n: 'Especies', t: 'Especies', s: 'Registros biológicos y hábitat en riesgo', fn: modEspecies, tem: ['esp'] },
    campo: { n: 'Campo', t: 'Operación de campo', s: 'Alertas a guardabosques, reportes y equipo en tiempo real', fn: modCampo, tem: ['c-al', 'c-rep', 'c-pos', 'c-nov', 'c-nueva'] },
    capas: { n: 'Capas', t: 'Capas de referencia', s: 'Conservación, agua, vías, límites e histórico', fn: modCapas, tem: [] }
  };
  function pintarRail() {
    var nv = D.vig ? D.vig.veredas.filter(function (v) { return v.nivel === 'vigilar'; }).length : 0, n24 = detecciones(1).length;
    $('#rail').innerHTML = Object.keys(MOD).map(function (k, i) {
      var nal = C.al.filter(function (a) { return a.estado === 'nueva'; }).length;
      var badge = k === 'vigilancia' && nv ? '<span class="badge">' + nv + '</span>' : k === 'incendios' && n24 ? '<span class="badge">' + n24 + '</span>' : k === 'campo' && nal ? '<span class="badge">' + nal + '</span>' : '';
      return (k === 'capas' ? '<div class="esp"></div>' : '') + '<button role="tab" data-m="' + k + '" aria-selected="' + (E.mod === k) + '">' + ic(k) + MOD[k].n + badge + '</button>';
    }).join('');
    $$('#rail button').forEach(function (b) { b.onclick = function () { E.mod = b.dataset.m; pintarRail(); pintar(); $('#contenido').scrollTop = 0; }; });
  }
  function pintar() {
    try { history.replaceState(null, '', '#m=' + E.mod + (F.mun ? '&mun=' + encodeURIComponent(F.mun) : '') + (F.ver ? '&ver=' + F.ver : '')); } catch (e) {}
    var m = MOD[E.mod];
    if (!F.ver) E.volver = null;
    $('#p-titulo').innerHTML = ic(E.mod) + esc(m.t); $('#p-sub').textContent = m.s;
    var bv = $('#b-volver'); if (bv) bv.remove();
    if (E.volver) {
      var b = document.createElement('button'); b.id = 'b-volver'; b.className = 'btn pri volver';
      b.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>Volver a la lista';
      b.onclick = volver; $('.panel-cab').appendChild(b);
    }
    limpiarTematicas(m.tem);
    m.fn($('#contenido'));
    capasExtra();
  }

  /* ── territorio ─────────────────────────────── */
  function llenarFiltros() {
    var muns = {}; idxVer.forEach(function (v) { muns[v.p.mun] = 1; });
    $('#f-mun').innerHTML = '<option value="">Todo Caldas</option>' + Object.keys(muns).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('');
    $('#f-mun').onchange = function () { E.volver = null; F.mun = this.value; F.ver = ''; llenarVeredas(); zoomFiltro(); pintar(); };
    $('#f-ver').onchange = function () { E.volver = null; F.ver = this.value; zoomFiltro(); pintar(); };
  }
  function llenarVeredas() {
    var s = $('#f-ver');
    if (!F.mun) { s.innerHTML = '<option value="">Todas las veredas</option>'; s.disabled = true; return; }
    var vs = idxVer.filter(function (v) { return norm(v.p.mun) === norm(F.mun); }).sort(function (a, b) { return String(a.p.ver).localeCompare(String(b.p.ver), 'es'); });
    s.innerHTML = '<option value="">Todas las veredas (' + vs.length + ')</option>' + vs.map(function (v) { return '<option value="' + v.p.id + '"' + (String(v.p.id) === F.ver ? ' selected' : '') + '>' + esc(v.p.ver) + '</option>'; }).join('');
    s.disabled = false;
  }
  function zoomFiltro() {
    if (resaltado) { map.removeLayer(resaltado); resaltado = null; }
    var fs = D.veredas.features.filter(function (f) { return F.ver ? String(f.properties.id) === F.ver : F.mun ? norm(f.properties.mun) === norm(F.mun) : false; });
    if (!fs.length) { map.flyToBounds(D.bounds, { padding: [20, 20], duration: .6 }); return; }
    var fc = { type: 'FeatureCollection', features: fs };
    resaltado = L.featureGroup([L.geoJSON(fc, { pane: 'limites', style: { color: '#ffffff', weight: F.ver ? 7 : 4, fill: false, opacity: .9 }, interactive: false }), L.geoJSON(fc, { pane: 'limites', style: { color: '#f2b705', weight: F.ver ? 3.5 : 1.6, fill: false }, interactive: false })]).addTo(map);
    map.flyToBounds(resaltado.getBounds(), { padding: [30, 30], maxZoom: 14, duration: .6 });
  }
  function irVereda(id, desdeLista) {
    var v = idxVer.find(function (x) { return String(x.p.id) === String(id); }); if (!v) return;
    if (desdeLista !== false && !E.volver) E.volver = { mun: F.mun, ver: F.ver, centro: map.getCenter(), zoom: map.getZoom(), scroll: $('#contenido').scrollTop };
    F.mun = v.p.mun; F.ver = String(id); $('#f-mun').value = v.p.mun; llenarVeredas(); $('#f-ver').value = F.ver; zoomFiltro(); pintar();
  }

  function volver() {
    var r = E.volver; if (!r) return; E.volver = null;
    F.mun = r.mun; F.ver = r.ver; $('#f-mun').value = F.mun; llenarVeredas(); $('#f-ver').value = F.ver;
    if (resaltado) { map.removeLayer(resaltado); resaltado = null; }
    if (F.mun || F.ver) { zoomFiltro(); } else map.flyTo(r.centro, r.zoom, { duration: .6 });
    pintar(); setTimeout(function () { $('#contenido').scrollTop = r.scroll || 0; }, 0);
  }

  /* ── guía rápida ────────────────────────────── */
  var GUIA = [
    { ic: 'vigilancia', t: 'Bienvenido a Vigías del Fuego', h: '<p>Una sola vista para la <b>vigilancia estricta</b> de incendios y deforestación en Caldas, con datos satelitales y climáticos que se actualizan solos.</p><ul><li><b>Vigilancia</b>: qué veredas revisar primero y por qué.</li><li><b>Incendios</b> y <b>Deforestación</b>: lo que detectan los satélites.</li><li><b>Clima</b>: calor y sequía frente a lo normal, con pronóstico.</li></ul>' },
    { ic: 'capas', t: '1 · Elija el territorio', h: '<p>Arriba, en <b>Territorio</b>, seleccione un <b>municipio</b> y luego una <b>vereda</b>. Todo el sistema (cifras, gráficas, tablas y mapa) se filtra a esa zona.</p><p>El botón <b>⌂</b> del mapa vuelve a todo Caldas.</p>' },
    { ic: 'incendios', t: '2 · Lea las alertas', h: '<p>Use los módulos de la barra izquierda. Cada uno abre con un recuadro verde que explica <b>qué está viendo</b>.</p><p>Haga clic en una vereda de cualquier tabla o tarjeta para ir a ella en el mapa.</p>' },
    { ic: 'info', t: '3 · Controle el mapa', h: '<p>La <b>leyenda</b> (arriba a la derecha) muestra solo lo que está encendido: ajuste la <b>opacidad</b>, oculte capas o vea su <b>fuente</b> con ⓘ.</p><p>Abajo a la izquierda cambia el fondo: <b>Claro, Satélite o Relieve</b>. Con <b>Reporte</b> imprime o guarda en PDF.</p>' },
    { ic: 'campo', t: '4 · Operación de campo', h: '<p>El módulo <b>Campo</b> conecta con la <b>aplicación de guardabosques</b>: desde aquí puede enviar alertas a los equipos y ver en tiempo real sus reportes, posiciones y verificaciones.</p><p>Inicie sesión con la misma cuenta del tablero de campo para coordinar la operación.</p>' }
  ];
  function guia(i) {
    i = i || 0; var g = GUIA[i], f = $('.guia-fondo'); if (f) f.remove();
    var d = document.createElement('div'); d.className = 'guia-fondo';
    d.innerHTML = '<div class="guia" role="dialog" aria-modal="true"><div class="g-cab"><div class="ic">' + ic(g.ic) + '</div><div><small>Guía rápida · ' + (i + 1) + ' de ' + GUIA.length + '</small><h3>' + g.t + '</h3></div></div><div class="g-cuerpo">' + g.h + '</div>' +
      '<div class="g-pie"><div class="puntos">' + GUIA.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
      '<button class="btn" data-a="cerrar">Saltar</button>' + (i > 0 ? '<button class="btn" data-a="atras">Atrás</button>' : '') + '<button class="btn pri" data-a="sig">' + (i < GUIA.length - 1 ? 'Siguiente' : 'Empezar') + '</button></div></div>';
    document.body.appendChild(d);
    var cerrar = function () { d.remove(); try { localStorage.setItem('sat.guia', '1'); } catch (e) {} };
    d.querySelector('[data-a="cerrar"]').onclick = cerrar;
    d.querySelector('[data-a="sig"]').onclick = function () { if (i < GUIA.length - 1) guia(i + 1); else cerrar(); };
    var at = d.querySelector('[data-a="atras"]'); if (at) at.onclick = function () { guia(i - 1); };
    d.onclick = function (e) { if (e.target === d) cerrar(); };
  }

  /* ── portada de monitoreo ───────────────────── */
  var P = { meta: null, pasos: [], hechos: 0 };
  function reloj() {
    var el = $('#p-reloj'); if (!el) return;
    el.textContent = new Date().toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Bogota' }) + ' · hora de Colombia';
  }
  function pxPortada(lon, lat) { var m = P.meta; return [(lon - m.bbox[0]) * m.k * m.sc, (m.bbox[3] - lat) * m.sc]; }
  function puntosPortada(lista, color, conHalo) {
    if (!P.meta) return; var g = $('#p-puntos'), ns = 'http://www.w3.org/2000/svg', k = 0;
    lista.forEach(function (q) {
      var xy = pxPortada(q[1], q[0]), dl = (P.retardo = (P.retardo || 0) + 12);
      if (conHalo && k++ < 40) { var h = document.createElementNS(ns, 'circle'); h.setAttribute('cx', xy[0]); h.setAttribute('cy', xy[1]); h.setAttribute('r', 7); h.setAttribute('fill', color); h.setAttribute('class', 'halo'); h.style.animationDelay = (Math.random() * 2).toFixed(2) + 's'; g.appendChild(h); }
      var c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', xy[0]); c.setAttribute('cy', xy[1]); c.setAttribute('r', conHalo ? 5 : 3.2); c.setAttribute('fill', color); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 1.2); c.style.animationDelay = Math.min(dl, 2500) + 'ms'; g.appendChild(c);
    });
  }
  function paso(id, txt) { P.pasos.push(id); $('#p-fuentes').insertAdjacentHTML('beforeend', '<li id="ps-' + id + '"><span class="st"></span>' + txt + '<small></small></li>'); }
  function listo(id, ok, nota) {
    var li = $('#ps-' + id); if (!li) return; li.classList.add(ok ? 'ok' : 'err'); if (nota) li.querySelector('small').textContent = nota;
    P.hechos++; $('#p-barra').style.width = Math.round(100 * P.hechos / P.pasos.length) + '%';
  }
  async function cargarPaso(id, txt, fn) { paso(id, txt); try { var n = await fn(); listo(id, true, n); } catch (e) { console.warn(id, e); listo(id, false, 'sin conexión'); } }

  async function main() {
    reloj(); setInterval(reloj, 1000);
    try { P.meta = await json('app/img/caldas.svgpath'); ['p-silueta', 'p-silueta-clip', 'p-silueta-borde'].forEach(function (i) { $('#' + i).setAttribute('d', P.meta.d); }); $('#p-svg').setAttribute('viewBox', '0 0 ' + P.meta.w + ' ' + P.meta.h); } catch (e) {}
    await Promise.all([
      cargarPaso('lim', 'Límite departamental y veredas', async function () { var r = await Promise.all([json('data/base/caldas_limite.json'), json('data/capas/veredas.geojson'), json('data/base/meta.json')]); D.limite = r[0]; D.veredas = r[1]; D.mbMeta = r[2]; return fmt(r[1].features.length) + ' veredas'; }),
      cargarPaso('firms', 'Puntos de calor · NASA FIRMS', async function () { D.firms = await json('data/firms_caldas.json'); return fmt(D.firms.puntos.length) + ' en 12 meses'; }),
      cargarPaso('ideam', 'Puntos de calor · IDEAM', async function () { D.ideam = await json('data/ideam_caldas.json'); return fmt(D.ideam.pts.length) + ' en 12 meses'; }),
      cargarPaso('gfw', 'Alertas de pérdida de bosque · GFW', async function () { D.defo = await json('data/deforestacion_alertas.json'); return 'hasta ' + fechaCorta(D.defo.ultima_alerta + 'T12:00:00'); }),
      cargarPaso('clima', 'Clima y pronóstico a 16 días', async function () { D.clima = await json('data/clima_actual.json'); return D.clima.puntos.length + ' puntos'; }),
      cargarPaso('vig', 'Índice de priorización por vereda', async function () { D.vig = await json('data/vigilancia.json'); return 'calculado ' + hace(D.vig.actualizado); })
    ]);
    var esp = await opt('data/especies.geojson');
    if (esp && esp.features) D.esp = { fuente: 'data/especies.geojson', pts: esp.features.map(function (f) { var p = f.properties || {}; return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], sp: p.especie || p.species || '?', cat: String(p.categoria || p.iucnRedListCategory || '').toUpperCase(), grupo: p.grupo || p.class || '', fecha: p.fecha || p.eventDate || '' }; }) };
    if (!D.limite) throw new Error('No se pudo cargar el límite de Caldas');
    prepVeredas();
    if (D.defo) { var ep = Date.parse(D.defo.epoca + 'T00:00:00Z'), l4 = Date.now() - 28 * 864e5; puntosPortada(D.defo.pts.filter(function (p) { return ep + p[2] * 864e5 >= l4 && p[3] === 2; }).slice(0, 400), '#ad1457', false); }
    var cal = detecciones(30); puntosPortada(cal.map(function (d) { return [d.lat, d.lon]; }), '#e64a19', true);
    iniciarMapa(); llenarFiltros();
    var h = new URLSearchParams(location.hash.slice(1)); if (h.get('m') && MOD[h.get('m')]) E.mod = h.get('m');
    pintarRail();
    iniciarCampo();
    for (var k of Object.keys(REG)) if (REG[k].on) await encender(k, true);
    map.on('click', function (e) {
      if (E.mod === 'campo' && C.esperandoPunto && C.borrador) { C.borrador.lat = e.latlng.lat; C.borrador.lon = e.latlng.lng; C.esperandoPunto = false; map.getContainer().style.cursor = ''; pintar(); return; }
      if (E.mod !== 'clima' || !D.clima) return;
      var best = 0, bd = 1e9; D.clima.puntos.forEach(function (p, i) { var d = Math.pow(p.lat - e.latlng.lat, 2) + Math.pow(p.lon - e.latlng.lng, 2); if (d < bd) { bd = d; best = i; } });
      E.climaSel = best; pintar();
    });
    var ult = [D.vig && D.vig.actualizado, D.firms && D.firms.actualizado, D.clima && D.clima.actualizado].filter(Boolean).sort().pop();
    $('#estado-datos').innerHTML = '<i></i>Actualizado ' + (ult ? hace(ult) : '–');
    $('#b-guia').onclick = function () { guia(0); };
    $('#b-imprimir').onclick = function () { abrirConstructor(); };
    if (h.get('ver')) irVereda(h.get('ver'), false); else if (h.get('mun')) { F.mun = h.get('mun'); $('#f-mun').value = F.mun; llenarVeredas(); zoomFiltro(); }
    pintar();
    var nv = D.vig ? D.vig.veredas.filter(function (v) { return v.nivel === 'vigilar'; }).length : 0, ha4 = 0;
    if (D.defo) { var e0 = Date.parse(D.defo.epoca + 'T00:00:00Z'), lim = Date.now() - 28 * 864e5; D.defo.pts.forEach(function (p) { if (e0 + p[2] * 864e5 >= lim) ha4 += D.defo.ha_pixel; }); }
    var at = D.clima ? D.clima.puntos.map(function (p) { return p.an_tmax_7f; }).filter(function (x) { return x != null; }) : [], atm = at.length ? at.reduce(function (a, b) { return a + b; }, 0) / at.length : null;
    $('#p-resumen').innerHTML = '<div class="r"><b>' + nv + '</b><span>veredas para vigilar de cerca</span></div><div class="n"><b>' + fmt(cal.length) + '</b><span>puntos de calor en 30 días</span></div>' +
      '<div class="m"><b>' + fmt(ha4) + '</b><span>ha en alerta de pérdida de bosque (4 semanas)</span></div><div><b>' + (atm == null ? '–' : (atm > 0 ? '+' : '') + fmt(atm, 1) + ' °C') + '</b><span>anomalía de temperatura próximos 7 días</span></div>';
    $('#p-resumen').hidden = false; $('#p-acciones').hidden = false;
    var tecla;
    var salir = function () {
      var p = $('#portada'); if (!p || p.classList.contains('saliendo')) return; p.classList.add('saliendo'); map.invalidateSize();
      document.removeEventListener('keydown', tecla);
      setTimeout(function () { p.remove(); map.invalidateSize(); var visto = null; try { visto = localStorage.getItem('sat.guia'); } catch (e) {} if (!visto && !h.get('singuia')) guia(0); }, 550);
    };
    tecla = function (e) { if (e.key === 'Enter' || e.key === 'Escape') salir(); };
    document.addEventListener('keydown', tecla);
    $('#p-entrar').onclick = salir; $('#p-entrar').focus();
    if (h.get('entrar')) salir();
  }
  main().catch(function (e) { console.error(e); var l = $('#p-fuentes'); if (l) l.insertAdjacentHTML('beforeend', '<li class="err"><span class="st"></span>No se pudo iniciar el sistema: ' + esc(e.message) + '</li>'); });
})();
