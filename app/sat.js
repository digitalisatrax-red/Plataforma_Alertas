/* SAT Caldas · Sistema de alertas tempranas de incendios y deforestación.
   Página estática: lee los JSON que generan los scripts de herramientas/ (GitHub Actions) y servicios públicos en vivo.
   La vista está restringida a Caldas: máscara opaca fuera del límite departamental y límites de navegación. */
(function () {
  'use strict';
  var V = '?v=' + Math.floor(Date.now() / 6e5);
  var CORPO = 'https://swappweb.corpocaldas.gov.co/waserver/rest/services';
  var IDEAM = 'https://visualizador.ideam.gov.co/gisserver/rest/services';
  var D = {};                        // datos cargados
  var F = { mun: '', ver: '' };      // filtro global
  var E = { tab: 'vigilar', diasFuego: 7, defoConf: 'todas', defoSem: 26, climaVar: 'an_tmax_7f', climaSel: null, defoMapa: 12 };
  var map, capas = {}, activas = {}, mascara, resaltado;

  /* ── utilidades ─────────────────────────────── */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function fmt(n, d) { return n == null || isNaN(n) ? '–' : Number(n).toLocaleString('es-CO', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); }
  function fecha(t) { try { return new Date(t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }); } catch (e) { return t; } }
  function fechaCorta(d) { return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
  async function json(url) { var r = await fetch(url + V, { cache: 'no-cache' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
  async function opt(url) { try { return await json(url); } catch (e) { console.warn('Sin datos:', url); return null; } }
  function isoSemana(d) {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia);
    var a = t.getUTCFullYear(), s = Math.ceil(((t - Date.UTC(a, 0, 1)) / 864e5 + 1) / 7);
    return a + '-S' + (s < 10 ? '0' : '') + s;
  }
  function lunes(d) { var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() || 7) - 1)); return t; }

  /* ── punto en vereda (cliente) ──────────────── */
  var idxVer = [];
  function prepVeredas() {
    D.veredas.features.forEach(function (f) {
      var polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      var bb = [180, 90, -180, -90];
      polys.forEach(function (p) { p[0].forEach(function (c) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }); });
      idxVer.push({ p: f.properties, polys: polys, bb: bb });
    });
  }
  function anillo(x, y, r) { var d = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) d = !d; } return d; }
  function vereda(lon, lat) {
    for (var k = 0; k < idxVer.length; k++) {
      var v = idxVer[k]; if (lon < v.bb[0] || lon > v.bb[2] || lat < v.bb[1] || lat > v.bb[3]) continue;
      for (var q = 0; q < v.polys.length; q++) { var p = v.polys[q]; if (anillo(lon, lat, p[0]) && !p.slice(1).some(function (h) { return anillo(lon, lat, h); })) return v.p; }
    }
    return null;
  }
  function pasa(mun, verId) {
    if (F.ver) return String(verId) === F.ver;
    if (F.mun) return norm(mun) === norm(F.mun);
    return true;
  }

  /* ── mapa y máscara de Caldas ───────────────── */
  function iniciarMapa() {
    var lim = D.limite.poligonos, bb = [180, 90, -180, -90];
    lim.forEach(function (p) { p[0].forEach(function (c) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }); });
    var b = L.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]);
    map = L.map('mapa', { zoomControl: true, minZoom: 8, maxBounds: b.pad(0.25), maxBoundsViscosity: 1, preferCanvas: true });
    map.fitBounds(b, { padding: [10, 10] });
    map.setMinZoom(map.getZoom() - 0.5 > 8 ? Math.floor(map.getZoom()) : 8);
    var fondos = {
      'Satélite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri, Maxar' }),
      'Claro (Carto)': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: '© OpenStreetMap, © CARTO' }),
      'Relieve (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Esri' })
    };
    fondos['Satélite (Esri)'].addTo(map);
    L.control.layers(fondos, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    // Panes: la máscara va por encima de todas las capas temáticas
    map.createPane('mascara').style.zIndex = 640;
    map.createPane('vigil').style.zIndex = 410;
    map.createPane('puntos').style.zIndex = 620;
    map.createPane('limites').style.zIndex = 650;
    var mundo = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    var huecos = lim.map(function (p) { return p[0].map(function (c) { return [c[1], c[0]]; }); });
    mascara = L.polygon([mundo].concat(huecos), { pane: 'mascara', stroke: false, fillColor: css('--mask'), fillOpacity: 1, interactive: false }).addTo(map);
    L.polygon(huecos, { pane: 'limites', color: css('--text-primary'), weight: 2, fill: false, interactive: false }).addTo(map);
  }
  function recolorearMascara() { if (mascara) mascara.setStyle({ fillColor: css('--mask') }); refrescarActivas(); }

  /* ── catálogo de capas ───────────────────────── */
  function estiloGeo(color, o) { return Object.assign({ color: color, weight: 1.5, fillColor: color, fillOpacity: .18, opacity: .95 }, o || {}); }
  function popupProps(titulo, campos) {
    return function (f, l) {
      var p = f.properties || {};
      l.bindPopup('<h3>' + esc(titulo) + '</h3>' + campos.map(function (c) { return p[c[0]] == null || p[c[0]] === '' ? '' : '<div><b>' + esc(c[1]) + ':</b> ' + esc(p[c[0]]) + '</div>'; }).join(''));
    };
  }
  function geoCapa(archivo, estilo, onEach, filtro) {
    return async function () {
      var fc = await json('data/capas/' + archivo + '.geojson');
      return L.geoJSON(fc, { style: typeof estilo === 'function' ? estilo : function () { return estilo; }, onEachFeature: onEach, filter: filtro });
    };
  }
  function esriDin(url, ids, defs, op) {
    return function () { return L.esri.dynamicMapLayer({ url: url, layers: ids, layerDefs: defs, opacity: op || .85, f: 'image', format: 'png32' }); };
  }
  var CAT = [
    { g: 'Obligatorias · Conservación', items: [
      { id: 'sinap', n: 'Áreas protegidas SINAP (EEP nov. 2026)', c: '#0ca30c', on: true, f: geoCapa('sinap', estiloGeo('#0ca30c'), popupProps('Área protegida SINAP', [['nombre', 'Nombre'], ['categoria', 'Categoría'], ['acto', 'Acto'], ['ha', 'Hectáreas']])) },
      { id: 'rnsc', n: 'Reservas naturales de la sociedad civil', c: '#1baf7a', on: false, f: geoCapa('rnsc', estiloGeo('#1baf7a'), function (f, l) { l.bindPopup('<h3>RNSC</h3>' + esc(Object.values(f.properties).filter(function (x) { return typeof x === 'string'; }).slice(0, 3).join(' · '))); }) },
      { id: 'paramos', n: 'Páramos (complejos)', c: '#6250d6', on: true, f: geoCapa('paramos', estiloGeo('#6250d6', { fillOpacity: .22 }), popupProps('Páramo', [['complejo', 'Complejo'], ['distrito', 'Distrito'], ['sector', 'Sector']])) },
      { id: 'eep', n: 'Estructura Ecológica Principal · componentes', c: '#008300', on: false, f: geoCapa('eep_componentes', estiloGeo('#008300', { fillOpacity: .12, dashArray: '4 3' }), function (f, l) { l.bindPopup('<h3>EEP · componente</h3>' + esc(Object.values(f.properties).filter(function (x) { return typeof x === 'string'; }).slice(0, 3).join(' · '))); }) },
      { id: 'eepvivo', n: 'EEP noviembre 2026 · elementos constituyentes (en vivo)', c: '#4a8f3a', on: false, f: esriDin(CORPO + '/EEPNoviembre2026/MapServer', [8], null, .6) },
      { id: 'resguardos', n: 'Resguardos indígenas (ANT)', c: '#eda100', on: true, f: geoCapa('resguardos', estiloGeo('#c98500', { fillOpacity: .2, weight: 2 }), popupProps('Resguardo indígena', [['nombre', 'Nombre'], ['pueblo', 'Pueblo'], ['acto', 'Acto'], ['ha', 'Hectáreas']])) },
      { id: 'ley2', n: 'Reserva Forestal Central (Ley 2ª)', c: '#7a7974', on: false, f: geoCapa('ley2', estiloGeo('#7a7974', { fillOpacity: .06, dashArray: '6 4' })) },
      { id: 'aica', n: 'AICA (áreas importantes para aves)', c: '#e87ba4', on: false, f: geoCapa('aica', estiloGeo('#e87ba4', { fillOpacity: .12 })) }
    ]},
    { g: 'Obligatorias · Agua', items: [
      { id: 'rios', n: 'Ríos principales (Strahler ≥ 5)', c: '#2a78d6', on: true, f: geoCapa('rios_principales', function (f) { return { color: '#2a78d6', weight: f.properties.orden >= 7 ? 3.5 : f.properties.orden >= 6 ? 2.5 : 1.6, opacity: .95 }; }, popupProps('Río', [['nombre', 'Nombre'], ['orden', 'Orden Strahler']])) },
      { id: 'drenajes', n: 'Drenajes (Strahler 1-4, en vivo)', c: '#6da7ec', on: false, f: esriDin(CORPO + '/CartografiaBase/MapServer', [18], { 18: 'Straler<5' }, .8) }
    ]},
    { g: 'Obligatorias · Vías', items: [
      { id: 'v_pri', n: 'Vías primarias', c: '#ffffff', on: true, f: geoCapa('vias_jerarquia', { color: '#ffffff', weight: 3.2, opacity: 1 }, popupProps('Vía primaria', [['nombre', 'Nombre'], ['ref', 'Ruta'], ['osm', 'Tipo OSM']]), function (f) { return f.properties.clase === 'primaria'; }) },
      { id: 'v_sec', n: 'Vías secundarias', c: '#d6d5cf', on: true, f: geoCapa('vias_jerarquia', { color: '#d6d5cf', weight: 2, opacity: .95 }, popupProps('Vía secundaria', [['nombre', 'Nombre'], ['ref', 'Ruta'], ['osm', 'Tipo OSM']]), function (f) { return f.properties.clase === 'secundaria'; }) },
      { id: 'v_ter', n: 'Vías terciarias', c: '#a8a79f', on: false, f: geoCapa('vias_jerarquia', { color: '#a8a79f', weight: 1.2, opacity: .9, dashArray: '5 3' }, popupProps('Vía terciaria', [['nombre', 'Nombre'], ['osm', 'Tipo OSM']]), function (f) { return f.properties.clase === 'terciaria'; }) },
      { id: 'v_corpo', n: 'Carreteras y carreteables (Corpocaldas)', c: '#94938b', on: false, f: geoCapa('vias_corpocaldas', function (f) { return { color: '#94938b', weight: f.properties.tipo === 'V1' ? 1.6 : 1, dashArray: f.properties.tipo === 'V2' ? '4 3' : null }; }) },
      { id: 'v_send', n: 'Senderos (Corpocaldas, en vivo)', c: '#c3c2b7', on: false, f: esriDin(CORPO + '/CartografiaBase/MapServer', [15], { 15: "tipo='V3'" }, .8) }
    ]},
    { g: 'Población y límites', items: [
      { id: 'centros', n: 'Centros poblados rurales 2026 y suelo urbano', c: '#52514e', on: false, f: async function () {
          var a = await json('data/base/centros_poblados_rurales_2026.geojson'), b = await json('data/base/suelos_urbanos_2026.geojson');
          return L.featureGroup([L.geoJSON(a, { style: estiloGeo('#52514e', { fillOpacity: .35 }), onEachFeature: function (f, l) { l.bindPopup('Centro poblado'); } }), L.geoJSON(b, { style: estiloGeo('#0b0b0b', { fillOpacity: .3, weight: 1 }) })]);
        } },
      { id: 'veredas', n: 'Límite de veredas', c: '#c3c2b7', on: false, f: async function () { return L.geoJSON(D.veredas, { style: { color: '#f0efec', weight: .7, fill: false, opacity: .8 }, interactive: false }); } }
    ]},
    { g: 'Deforestación histórica', items: [
      { id: 'hansen', n: 'Pérdida de cobertura Hansen/UMD 2021-2025', c: '#e34948', on: false, f: function () { return L.tileLayer('https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png?start_year=2021&end_year=2025&tree_cover_density_threshold=30&render_type=true_color', { maxNativeZoom: 12, maxZoom: 18, opacity: .9, attribution: 'Hansen/UMD/Google/USGS/NASA vía GFW' }); } },
      { id: 'hansen01', n: 'Pérdida Hansen/UMD 2001-2020', c: '#eda100', on: false, f: function () { return L.tileLayer('https://tiles.globalforestwatch.org/umd_tree_cover_loss/latest/dynamic/{z}/{x}/{y}.png?start_year=2001&end_year=2020&tree_cover_density_threshold=30&render_type=true_color', { maxNativeZoom: 12, maxZoom: 18, opacity: .8 }); } },
      { id: 'ideamcb', n: 'IDEAM · cambio de bosque 2023-2024', c: '#d55181', on: false, f: esriDin(IDEAM + '/Dinamica_Cambio_Cobertura_Bosque/MapServer', [15], null, .8) },
      { id: 'ideamcb2', n: 'IDEAM · cambio de bosque 2020-2023 (3 periodos)', c: '#e87ba4', on: false, f: esriDin(IDEAM + '/Dinamica_Cambio_Cobertura_Bosque/MapServer', [12, 13, 14], null, .8) },
      { id: 'ideambnb', n: 'IDEAM · bosque/no bosque 2024', c: '#1baf7a', on: false, f: esriDin(IDEAM + '/Superficie_Bosque/MapServer', [16], null, .55) },
      { id: 'dtd', n: 'IDEAM · detección temprana trimestral (DTD)', c: '#d03b3b', on: false, f: async function () {
          var fc = await json('data/capas/dtd_ideam.geojson');
          return L.geoJSON(fc, { pointToLayer: function (f, ll) { return L.circleMarker(ll, { pane: 'puntos', radius: 6, color: '#fff', weight: 2, fillColor: '#d03b3b', fillOpacity: 1 }); },
            onEachFeature: popupProps('Detección temprana de deforestación (IDEAM)', [['anio', 'Año'], ['periodo', 'Trimestre'], ['mun', 'Municipio'], ['runap', 'Área protegida'], ['nucleo', 'Núcleo']]) });
        } }
    ]}
  ];
  var CAT_ID = {}; CAT.forEach(function (g) { g.items.forEach(function (it) { CAT_ID[it.id] = it; }); });

  async function alternar(id, on) {
    var it = CAT_ID[id]; if (!it) return;
    activas[id] = on;
    if (on) {
      if (!capas[id]) { try { capas[id] = await it.f(); } catch (e) { console.error(e); alert('No se pudo cargar la capa ' + it.n); activas[id] = false; return; } }
      if (activas[id]) capas[id].addTo(map);
    } else if (capas[id]) map.removeLayer(capas[id]);
  }
  function refrescarActivas() { /* las capas con colores fijos no requieren cambio de tema */ }

  /* ── capas dinámicas de cada pestaña ─────────── */
  var dyn = {};
  function ponerDyn(nombre, capa) { if (dyn[nombre]) map.removeLayer(dyn[nombre]); dyn[nombre] = capa; if (capa) capa.addTo(map); }
  function quitarDynMenos(conservar) { Object.keys(dyn).forEach(function (k) { if (conservar.indexOf(k) < 0 && dyn[k]) { map.removeLayer(dyn[k]); dyn[k] = null; } }); }

  /* ── leyenda flotante ───────────────────────── */
  var leyendaCtl;
  function leyendaMapa(html) {
    if (!leyendaCtl) { leyendaCtl = L.control({ position: 'bottomright' }); leyendaCtl.onAdd = function () { var d = L.DomUtil.create('div', 'leyenda-mapa'); L.DomEvent.disableClickPropagation(d); return d; }; leyendaCtl.addTo(map); }
    var el = leyendaCtl.getContainer(); el.innerHTML = html || ''; el.style.display = html ? '' : 'none';
  }

  /* ── gráficas SVG ────────────────────────────── */
  function barrasApiladas(cont, datos, series, unidad) {
    // datos: [{x: etiqueta, v: [a, b], d: texto fecha}]
    var W = 380, H = 170, m = { l: 34, r: 6, t: 8, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var max = Math.max.apply(null, datos.map(function (d) { return d.v.reduce(function (a, b) { return a + b; }, 0); }).concat([1]));
    var paso = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / paso) * paso; if (top / paso > 6) paso *= 2;
    var bw = iw / datos.length, g = 2;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Alertas semanales"><g class="grid eje">';
    for (var y = 0; y <= top + 1e-9; y += paso) { var py = m.t + ih - y / top * ih; s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + py + '" y2="' + py + '"/><text x="' + (m.l - 4) + '" y="' + (py + 3) + '" text-anchor="end">' + fmt(y) + '</text>'; }
    s += '</g>';
    datos.forEach(function (d, i) {
      var x = m.l + i * bw + g / 2, acum = 0, w = Math.max(bw - g, 1);
      d.v.forEach(function (v, k) {
        if (v <= 0) return; var h = v / top * ih, yy = m.t + ih - (acum + v) / top * ih;
        var r = k === d.v.length - 1 || d.v.slice(k + 1).every(function (z) { return z <= 0; }) ? Math.min(3, w / 2) : 0;
        s += '<path d="' + barra(x, yy, w, h - (acum > 0 ? 1 : 0), r) + '" fill="' + series[k].c + '"/>'; acum += v;
      });
      if (i % 4 === datos.length % 4 || i === datos.length - 1) s += '<text class="eje" x="' + (x + w / 2) + '" y="' + (H - 6) + '" text-anchor="middle" style="fill:var(--text-muted);font-size:10px">' + esc(d.x) + '</text>';
      s += '<rect x="' + (m.l + i * bw) + '" y="' + m.t + '" width="' + bw + '" height="' + ih + '" fill="transparent" data-i="' + i + '"/>';
    });
    s += '</svg><div class="tip"></div>';
    cont.innerHTML = s;
    var tip = $('.tip', cont), svg = $('svg', cont);
    svg.addEventListener('mousemove', function (ev) {
      var t = ev.target.getAttribute('data-i'); if (t == null) { tip.style.display = 'none'; return; }
      var d = datos[+t], tot = d.v.reduce(function (a, b) { return a + b; }, 0);
      tip.innerHTML = '<div>' + esc(d.d) + '</div>' + series.map(function (sr, k) { return '<div><span style="color:' + sr.c + '">■</span> ' + esc(sr.n) + ': <b>' + fmt(d.v[k], 1) + '</b> ' + unidad + '</div>'; }).join('') + '<div>Total: <b>' + fmt(tot, 1) + '</b> ' + unidad + '</div>';
      var r = cont.getBoundingClientRect(); tip.style.display = 'block';
      var x = ev.clientX - r.left + 12; if (x + 190 > r.width) x = ev.clientX - r.left - 190; tip.style.left = x + 'px'; tip.style.top = (ev.clientY - r.top - 10) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
  }
  function barra(x, y, w, h, r) { if (h <= 0) return ''; r = Math.min(r, h); return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z'; }

  function lineas(cont, xs, series, unidad, hoyIdx, tipo) {
    var W = 380, H = 160, m = { l: 34, r: 8, t: 8, b: 22 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var vals = []; series.forEach(function (s) { s.v.forEach(function (v) { if (v != null) vals.push(v); }); });
    var lo = tipo === 'barras' ? 0 : Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals.concat([lo + 1])) + (tipo === 'barras' ? 0 : 1));
    var X = function (i) { return m.l + (xs.length < 2 ? 0 : i / (xs.length - 1) * iw); }, Y = function (v) { return m.t + ih - (v - lo) / (hi - lo) * ih; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '"><g class="grid eje">';
    var nt = 4; for (var k = 0; k <= nt; k++) { var v = lo + (hi - lo) * k / nt, py = Y(v); s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + py + '" y2="' + py + '"/><text x="' + (m.l - 4) + '" y="' + (py + 3) + '" text-anchor="end">' + fmt(v) + '</text>'; }
    s += '</g>';
    if (hoyIdx != null) s += '<line x1="' + X(hoyIdx) + '" x2="' + X(hoyIdx) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--text-muted)" stroke-dasharray="3 3"/><text x="' + (X(hoyIdx) + 3) + '" y="' + (m.t + 9) + '" style="fill:var(--text-muted);font-size:10px">hoy → pronóstico</text>';
    series.forEach(function (sr) {
      if (tipo === 'barras') {
        var bw = iw / xs.length;
        sr.v.forEach(function (v, i) { if (v > 0) s += '<path d="' + barra(m.l + i * bw + 1, Y(v), Math.max(bw - 2, 1), Y(lo) - Y(v), 2) + '" fill="' + sr.c + '" opacity="' + (i > hoyIdx ? .55 : 1) + '"/>'; });
      } else {
        var d = ''; sr.v.forEach(function (v, i) { if (v == null) return; d += (d ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); });
        s += '<path d="' + d + '" fill="none" stroke="' + sr.c + '" stroke-width="2" ' + (sr.dash ? 'stroke-dasharray="4 3"' : '') + ' stroke-linejoin="round"/>';
      }
    });
    [0, Math.floor(xs.length / 2), xs.length - 1].forEach(function (i) { s += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle') + '" style="fill:var(--text-muted);font-size:10px">' + esc(xs[i].slice(5)) + '</text>'; });
    s += '<line class="cruz" x1="0" x2="0" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--text-secondary)" style="display:none"/>';
    s += '<rect x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '" fill="transparent" class="hit"/></svg><div class="tip"></div>';
    cont.innerHTML = s;
    var tip = $('.tip', cont), svg = $('svg', cont), cruz = $('.cruz', cont);
    svg.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width * W, i = Math.round((fx - m.l) / iw * (xs.length - 1));
      if (i < 0 || i >= xs.length) { tip.style.display = 'none'; return; }
      cruz.setAttribute('x1', X(i)); cruz.setAttribute('x2', X(i)); cruz.style.display = '';
      tip.innerHTML = '<div>' + esc(xs[i]) + (i > hoyIdx ? ' (pronóstico)' : '') + '</div>' + series.map(function (sr) { return '<div><span style="color:' + sr.c + '">■</span> ' + esc(sr.n) + ': <b>' + fmt(sr.v[i], 1) + '</b> ' + unidad + '</div>'; }).join('');
      var cr = cont.getBoundingClientRect(), x = ev.clientX - cr.left + 12; if (x + 180 > cr.width) x -= 200;
      tip.style.display = 'block'; tip.style.left = x + 'px'; tip.style.top = (ev.clientY - cr.top - 10) + 'px';
    });
    svg.addEventListener('mouseleave', function () { tip.style.display = 'none'; cruz.style.display = 'none'; });
  }

  /* ── pestañas ───────────────────────────────── */
  var NIVEL = { vigilar: 'Vigilar de cerca', atencion: 'Atención', normal: 'Normal' };
  function estado(n) { return '<span class="estado ' + n + '"><i></i>' + NIVEL[n] + '</span>'; }

  function tabVigilar(el) {
    var vs = (D.vig ? D.vig.veredas : []).filter(function (v) { return pasa(v.mun, v.id); });
    var nv = vs.filter(function (v) { return v.nivel === 'vigilar'; }).length, na = vs.filter(function (v) { return v.nivel === 'atencion'; }).length;
    var maxT = Math.max.apply(null, vs.map(function (v) { return v.an_tmax_7f || -99; }).concat([-99]));
    var lista = vs.filter(function (v) { return F.ver || F.mun ? true : v.nivel !== 'normal'; }).slice(0, 60);
    el.innerHTML = '<div class="kpis"><div class="kpi"><div class="v" style="color:var(--critical)">' + nv + '</div><div class="l">veredas para vigilar de cerca</div></div>' +
      '<div class="kpi"><div class="v">' + na + '</div><div class="l">veredas en atención</div></div>' +
      '<div class="kpi"><div class="v">' + (maxT > -99 ? '+' + fmt(maxT, 1) + ' °C' : '–') + '</div><div class="l">máx. anomalía Tmax próx. 7 días</div></div></div>' +
      '<p class="nota">Índice por vereda que combina susceptibilidad (fuego histórico MapBiomas, deforestación reciente, cercanía a vías y poblados) con el peligro climático pronosticado (anomalía de temperatura, días secos, déficit de lluvia, humedad) y la actividad actual (puntos de calor). <b>Versión preliminar</b>: en la fase 3 lo reemplaza el modelo entrenado y validado.</p>' +
      '<div class="sec">' + (F.mun || F.ver ? 'Veredas del filtro (de mayor a menor riesgo)' : 'Prioridad en todo Caldas') + '</div><ul class="lista">' +
      lista.map(function (v) {
        var chips = (v.paramo ? '<span class="chip">Páramo</span>' : '') + (v.sinap ? '<span class="chip">Área protegida</span>' : '') + (v.resguardo ? '<span class="chip">Resguardo</span>' : '');
        return '<li data-ver="' + v.id + '"><div class="t"><span>' + v.puesto + '. ' + esc(v.ver) + '</span>' + estado(v.nivel) + '</div><div class="m">' + esc(v.mun) + ' · índice ' + fmt(v.riesgo, 2) + ' (susc. ' + fmt(v.S, 2) + ', clima ' + fmt(v.H, 2) + ')</div>' +
          (v.razones.length ? '<ul class="r">' + v.razones.slice(0, 4).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' : '') + chips + '</li>';
      }).join('') + '</ul>' + (D.vig ? '<p class="fuente">Calculado ' + fecha(D.vig.actualizado) + '. Clima del ' + esc(D.vig.clima_hoy) + '.</p>' : '<p class="nota">Aún no hay índice calculado.</p>');
    el.querySelectorAll('li[data-ver]').forEach(function (li) { li.onclick = function () { irVereda(li.getAttribute('data-ver')); }; });
    // capa de veredas coloreada por nivel
    var porId = {}; (D.vig ? D.vig.veredas : []).forEach(function (v) { porId[v.id] = v; });
    var col = { vigilar: css('--critical'), atencion: css('--serious') };
    ponerDyn('vigil', L.geoJSON(D.veredas, {
      pane: 'vigil',
      filter: function (f) { var v = porId[f.properties.id]; return v && v.nivel !== 'normal' || (F.mun && norm(f.properties.mun) === norm(F.mun)); },
      style: function (f) { var v = porId[f.properties.id] || {}; return { color: col[v.nivel] || css('--good'), weight: 1.5, fillColor: col[v.nivel] || css('--good'), fillOpacity: v.nivel === 'normal' ? .08 : .38 }; },
      onEachFeature: function (f, l) { var v = porId[f.properties.id]; if (v) l.bindPopup(popupVereda(v)); }
    }));
    leyendaMapa('<b>Sitios a vigilar</b><div>' + estado('vigilar') + '</div><div>' + estado('atencion') + '</div><div class="fuente">5 % y siguiente 10 % de veredas por índice</div>');
  }
  function popupVereda(v) {
    return '<h3>' + esc(v.ver) + ' · ' + esc(v.mun) + '</h3>' + estado(v.nivel) + ' <span class="num">#' + v.puesto + '</span>' +
      '<div>Índice ' + fmt(v.riesgo, 2) + ' · susceptibilidad ' + fmt(v.S, 2) + ' · clima ' + fmt(v.H, 2) + '</div>' +
      '<div>Tmax próx. 7 d: <b>' + (v.an_tmax_7f == null ? '–' : (v.an_tmax_7f > 0 ? '+' : '') + fmt(v.an_tmax_7f, 1) + ' °C') + '</b> · días secos: <b>' + fmt(v.secos) + '</b> · lluvia 30 d: <b>' + fmt(v.lluvia30_pct) + ' %</b></div>' +
      '<div>Fuego histórico: ' + v.anios_fuego + ' años · ' + fmt(v.quema_ha_km2, 1) + ' ha/km² · deforestación 90 d: ' + fmt(v.defo90_ha, 1) + ' ha · calor 30 d: ' + v.calor30 + '</div>' +
      '<div>Vía principal a ' + fmt(v.km_via, 1) + ' km · centro poblado a ' + fmt(v.km_centro_poblado, 1) + ' km</div>';
  }

  function detecciones() {
    var lim = Date.now() - E.diasFuego * 864e5, out = [];
    (D.firms && D.firms.puntos || []).forEach(function (p) { var t = new Date(p.fecha_hora).getTime(); if (t >= lim) out.push({ f: 'FIRMS', s: p.fuente.replace('_NRT', '').replace('_', ' '), t: t, lat: p.lat, lon: p.lon, frp: p.frp, c: p.confianza }); });
    // IDEAM reprocesa varias de las mismas pasadas satelitales: se omite si hay un punto FIRMS a < 0,01° y ± 10 min
    if (D.ideam && D.ideam.t0) { var t0 = new Date(D.ideam.t0 + '-05:00').getTime(), fi = out.slice(); D.ideam.pts.forEach(function (q) { var t = t0 + q[2] * 6e4; if (t < lim) return; if (fi.some(function (d) { return Math.abs(d.t - t) <= 6e5 && Math.abs(d.lat - q[0]) < .01 && Math.abs(d.lon - q[1]) < .01; })) return; out.push({ f: 'IDEAM', s: 'IDEAM', t: t, lat: q[0], lon: q[1] }); }); }
    out.forEach(function (d) { var v = vereda(d.lon, d.lat); d.ver = v ? v.ver : ''; d.mun = v ? v.mun : ''; d.vid = v ? v.id : null; });
    return out.filter(function (d) { return d.vid != null && pasa(d.mun, d.vid); }).sort(function (a, b) { return b.t - a.t; });
  }
  function tabFuego(el) {
    var ds = detecciones(), nf = ds.filter(function (d) { return d.f === 'FIRMS'; }).length, ni = ds.length - nf;
    var vers = {}; ds.forEach(function (d) { vers[d.vid] = 1; });
    el.innerHTML = '<div class="fila"><span>Periodo:</span><div class="seg" id="seg-dias">' + [1, 3, 7, 30].map(function (d) { return '<button aria-pressed="' + (E.diasFuego === d) + '" data-d="' + d + '">' + (d === 1 ? '24 h' : d + ' días') + '</button>'; }).join('') + '</div></div>' +
      '<div class="kpis"><div class="kpi"><div class="v">' + nf + '</div><div class="l">detecciones FIRMS (NASA)</div></div><div class="kpi"><div class="v">' + ni + '</div><div class="l">puntos IDEAM adicionales</div></div><div class="kpi"><div class="v">' + Object.keys(vers).length + '</div><div class="l">veredas con detecciones</div></div></div>' +
      '<p class="nota">Los puntos de calor son detecciones térmicas satelitales, no incendios confirmados. FIRMS se actualiza cada 3 horas (VIIRS S-NPP, NOAA-20, NOAA-21 y MODIS); el IDEAM, con su propio procesamiento.</p>' +
      '<div class="sec">Capas de fuego</div>' +
      chk('mb', 'Frecuencia de quemas MapBiomas Fuego 2000-2025', '#eb6834') + chk('icv', 'IDEAM · probabilidad de incendios de la cobertura vegetal (en vivo)', '#d55181') +
      '<div class="sec">Detecciones recientes</div>' + (ds.length ? '<table class="tabla"><thead><tr><th>Fecha</th><th>Fuente</th><th>Vereda</th><th class="n">FRP</th></tr></thead><tbody>' +
      ds.slice(0, 150).map(function (d) { return '<tr data-ll="' + d.lat + ',' + d.lon + '"><td>' + fecha(d.t) + '</td><td>' + esc(d.s) + '</td><td>' + esc(d.ver) + '<div class="fuente">' + esc(d.mun) + '</div></td><td class="n">' + esc(d.frp || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="nota">Sin detecciones en el periodo y filtro seleccionados.</p>') +
      '<p class="fuente">FIRMS actualizado ' + (D.firms ? fecha(D.firms.actualizado) : '–') + ' · IDEAM ' + (D.ideam ? fecha(D.ideam.actualizado) : '–') + '</p>';
    el.querySelectorAll('#seg-dias button').forEach(function (b) { b.onclick = function () { E.diasFuego = +b.dataset.d; pintar(); }; });
    el.querySelectorAll('tr[data-ll]').forEach(function (tr) { tr.style.cursor = 'pointer'; tr.onclick = function () { var ll = tr.dataset.ll.split(','); map.setView([+ll[0], +ll[1]], 14); }; });
    enlazarChk(el);
    var g = L.layerGroup();
    ds.forEach(function (d) {
      L.circleMarker([d.lat, d.lon], { pane: 'puntos', radius: d.f === 'FIRMS' ? 6 : 5, color: '#fff', weight: 1.5, fillColor: d.f === 'FIRMS' ? '#eb6834' : '#d55181', fillOpacity: 1 })
        .bindPopup('<h3>Punto de calor · ' + esc(d.s) + '</h3><div>' + fecha(d.t) + '</div><div>' + esc(d.ver) + ' · ' + esc(d.mun) + '</div>' + (d.frp ? '<div>FRP: ' + esc(d.frp) + ' MW · confianza: ' + esc(d.c) + '</div>' : '')).addTo(g);
    });
    ponerDyn('fuego', g);
    leyendaMapa('<b>Puntos de calor (' + (E.diasFuego === 1 ? '24 h' : E.diasFuego + ' días') + ')</b><div class="leyenda"><span style="--c:#eb6834">FIRMS</span><span style="--c:#d55181">IDEAM (no duplicados)</span></div>' + (activasDyn.mb ? '<b>MapBiomas: años con quema</b><div class="rampa" style="background:linear-gradient(90deg,#fde0c5,#eb6834,#7a1f00)"></div><div class="ext"><span>1</span><span>≥ 10</span></div>' : ''));
  }
  var activasDyn = { mb: false, icv: false, gfwt: false, defopts: true };
  function chk(id, n, c) { return '<label class="capa"><input type="checkbox" data-dyn="' + id + '"' + (activasDyn[id] ? ' checked' : '') + '><span class="sw" style="background:' + c + '"></span>' + esc(n) + '</label>'; }
  function enlazarChk(el) { el.querySelectorAll('input[data-dyn]').forEach(function (i) { i.onchange = function () { activasDyn[i.dataset.dyn] = i.checked; aplicarDynExtra(); pintar(); }; }); }
  var extra = {};
  function aplicarDynExtra() {
    var defs = {
      mb: function () { return L.imageOverlay('data/base/fuego_frecuencia.png', D.mbMeta.bounds, { opacity: .85, interactive: false }); },
      icv: function () { return L.esri.dynamicMapLayer({ url: IDEAM + '/StoryMaps_IDA/Alertas_ICV/MapServer', layers: [2], opacity: .6 }); },
      gfwt: function () { return L.tileLayer('https://tiles.globalforestwatch.org/gfw_integrated_alerts/latest/default/{z}/{x}/{y}.png', { maxNativeZoom: 14, maxZoom: 18, opacity: .9 }); }
    };
    Object.keys(defs).forEach(function (k) {
      var visible = activasDyn[k] && ((k === 'mb' || k === 'icv') ? E.tab === 'fuego' : E.tab === 'defo');
      if (visible && !extra[k]) extra[k] = defs[k]();
      if (extra[k]) { if (visible) extra[k].addTo(map); else map.removeLayer(extra[k]); }
    });
  }

  function tabDefo(el) {
    var df = D.defo; if (!df) { el.innerHTML = '<p class="nota">Aún no hay alertas de deforestación descargadas.</p>'; return; }
    var ep = Date.parse(df.epoca + 'T00:00:00Z'), hoy = new Date(), sem0 = lunes(new Date(hoy.getTime() - (E.defoSem - 1) * 7 * 864e5));
    var semanas = []; for (var t = sem0.getTime(); t <= hoy.getTime(); t += 7 * 864e5) semanas.push({ k: isoSemana(new Date(t)), ini: new Date(t), v: [0, 0] });
    var ix = {}; semanas.forEach(function (s, i) { ix[s.k] = i; });
    var porVer = {}, pts = [], hp = df.ha_pixel, lim4 = Date.now() - 28 * 864e5, lim8 = Date.now() - 56 * 864e5, h4 = 0, h48 = 0, limMapa = Date.now() - E.defoMapa * 7 * 864e5;
    df.pts.forEach(function (p) {
      var vv = df.veredas[p[4]]; if (!pasa(vv[2], vv[0])) return;
      if (E.defoConf === 'alta' && p[3] !== 2) return;
      var t = ep + p[2] * 864e5, k = isoSemana(new Date(t));
      if (k in ix) semanas[ix[k]].v[p[3] === 2 ? 0 : 1] += hp;
      if (t >= lim4) { h4 += hp; var key = p[4]; porVer[key] = (porVer[key] || 0) + hp; } else if (t >= lim8) h48 += hp;
      if (t >= limMapa) pts.push([p[0], p[1], t, p[3], vv]);
    });
    var kUlt = df.ultima_alerta ? isoSemana(new Date(df.ultima_alerta + 'T00:00:00Z')) : null;
    var ult = semanas[kUlt in ix ? ix[kUlt] : semanas.length - 1], cambio = h48 ? (h4 - h48) / h48 * 100 : null;
    var top = Object.keys(porVer).map(function (k) { return [df.veredas[k], porVer[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 15);
    el.innerHTML = '<div class="fila"><span>Confianza:</span><div class="seg" id="seg-conf"><button data-c="todas" aria-pressed="' + (E.defoConf === 'todas') + '">Todas</button><button data-c="alta" aria-pressed="' + (E.defoConf === 'alta') + '">Solo alta</button></div>' +
      '<div class="seg" id="seg-sem">' + [12, 26, 52, 104].map(function (n) { return '<button data-s="' + n + '" aria-pressed="' + (E.defoSem === n) + '">' + (n < 52 ? n + ' sem' : n / 52 + ' año' + (n > 52 ? 's' : '')) + '</button>'; }).join('') + '</div></div>' +
      '<div class="kpis"><div class="kpi"><div class="v">' + fmt(ult.v[0] + ult.v[1], 1) + '</div><div class="l">ha semana ' + ult.k.slice(5) + ' (última publicada)</div></div><div class="kpi"><div class="v">' + fmt(h4, 1) + '</div><div class="l">ha últimas 4 semanas</div></div><div class="kpi"><div class="v">' + (cambio == null ? '–' : (cambio > 0 ? '+' : '') + fmt(cambio) + ' %') + '</div><div class="l">vs. 4 semanas anteriores</div></div></div>' +
      '<div class="sec">Área en alerta por semana · ' + esc(F.ver ? (vNombre(F.ver)) : F.mun || 'todo Caldas') + '</div>' +
      '<div class="leyenda"><span style="--c:' + css('--series-1') + '">Confianza alta</span>' + (E.defoConf === 'todas' ? '<span style="--c:' + css('--series-2') + '">Confianza nominal</span>' : '') + '</div>' +
      '<div class="grafica" id="g-defo"></div>' +
      '<div class="fila"><button class="btn" id="b-tabla-defo">Ver tabla semanal</button><button class="btn" id="b-csv-defo">Descargar CSV</button></div><div id="tabla-defo"></div>' +
      '<div class="sec">Veredas con más alertas (4 semanas)</div>' + (top.length ? '<table class="tabla"><thead><tr><th>Vereda</th><th>Municipio</th><th class="n">ha</th></tr></thead><tbody>' + top.map(function (r) { return '<tr data-ver="' + r[0][0] + '" style="cursor:pointer"><td>' + esc(r[0][1]) + '</td><td>' + esc(r[0][2]) + '</td><td class="n">' + fmt(r[1], 1) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="nota">Sin alertas en las últimas 4 semanas para este filtro.</p>') +
      '<div class="sec">En el mapa</div><div class="fila"><span>Alertas de las últimas</span><div class="seg" id="seg-mapa">' + [4, 12, 52].map(function (n) { return '<button data-m="' + n + '" aria-pressed="' + (E.defoMapa === n) + '">' + n + ' sem</button>'; }).join('') + '</div></div>' +
      chk('defopts', 'Alertas GFW como puntos (filtradas)', css('--series-1')) + chk('gfwt', 'Alertas integradas GFW (teselas oficiales, todo el periodo)', '#ec6db0') +
      '<p class="nota">Pérdida Hansen 2001-2025, cambio de bosque IDEAM 1990-2024 y detección temprana trimestral del IDEAM están en la pestaña <b>Capas</b> → Deforestación histórica.</p>' +
      '<p class="fuente">' + esc(df.fuente) + '. Última alerta: ' + esc(df.ultima_alerta) + '. Descargado ' + fecha(df.actualizado) + '. Píxel ≈ ' + fmt(hp, 3) + ' ha. Las alertas de confianza nominal pueden incluir falsas alarmas por nubes.</p>';
    var series = [{ n: 'Confianza alta', c: css('--series-1') }].concat(E.defoConf === 'todas' ? [{ n: 'Confianza nominal', c: css('--series-2') }] : []);
    barrasApiladas($('#g-defo'), semanas.map(function (s) { return { x: s.k.slice(5), v: E.defoConf === 'todas' ? s.v : [s.v[0]], d: 'Semana ' + s.k + ' (desde ' + fechaCorta(s.ini) + ')' }; }), series, 'ha');
    el.querySelectorAll('#seg-conf button').forEach(function (b) { b.onclick = function () { E.defoConf = b.dataset.c; pintar(); }; });
    el.querySelectorAll('#seg-sem button').forEach(function (b) { b.onclick = function () { E.defoSem = +b.dataset.s; pintar(); }; });
    el.querySelectorAll('#seg-mapa button').forEach(function (b) { b.onclick = function () { E.defoMapa = +b.dataset.m; pintar(); }; });
    el.querySelectorAll('tr[data-ver]').forEach(function (tr) { tr.onclick = function () { irVereda(tr.dataset.ver); }; });
    $('#b-tabla-defo').onclick = function () { $('#tabla-defo').innerHTML = '<table class="tabla"><thead><tr><th>Semana</th><th>Desde</th><th class="n">Alta (ha)</th><th class="n">Nominal (ha)</th></tr></thead><tbody>' + semanas.slice().reverse().map(function (s) { return '<tr><td>' + s.k + '</td><td>' + fechaCorta(s.ini) + '</td><td class="n">' + fmt(s.v[0], 2) + '</td><td class="n">' + fmt(s.v[1], 2) + '</td></tr>'; }).join('') + '</tbody></table>'; };
    $('#b-csv-defo').onclick = function () {
      var filas = ['fecha,lat,lon,confianza,vereda,municipio'];
      df.pts.forEach(function (p) { var vv = df.veredas[p[4]]; if (!pasa(vv[2], vv[0])) return; filas.push(new Date(ep + p[2] * 864e5).toISOString().slice(0, 10) + ',' + p[0] + ',' + p[1] + ',' + (p[3] === 2 ? 'alta' : 'nominal') + ',"' + vv[1] + '","' + vv[2] + '"'); });
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([filas.join('\n')], { type: 'text/csv' })); a.download = 'alertas_deforestacion_' + (F.ver ? 'vereda_' + F.ver : F.mun || 'caldas') + '.csv'; a.click();
    };
    enlazarChk(el);
    if (activasDyn.defopts) {
      var g = L.layerGroup(), ahora = Date.now();
      pts.forEach(function (p) {
        var dias = (ahora - p[2]) / 864e5;
        L.circleMarker([p[0], p[1]], { pane: 'puntos', radius: 3.5, stroke: false, fillColor: dias <= 28 ? '#a63603' : dias <= 84 ? '#eb6834' : '#fdbe85', fillOpacity: .9 })
          .bindPopup('<h3>Alerta de deforestación</h3><div>' + new Date(p[2]).toISOString().slice(0, 10) + ' · confianza ' + (p[3] === 2 ? 'alta' : 'nominal') + '</div><div>' + esc(p[4][1]) + ' · ' + esc(p[4][2]) + '</div>').addTo(g);
      });
      ponerDyn('defo', g);
    } else ponerDyn('defo', null);
    leyendaMapa('<b>Alertas de deforestación</b><div class="leyenda"><span style="--c:#a63603">≤ 4 semanas</span><span style="--c:#eb6834">5-12 sem</span><span style="--c:#fdbe85">&gt; 12 sem</span></div>');
  }
  function vNombre(id) { var f = idxVer.find(function (v) { return String(v.p.id) === String(id); }); return f ? f.p.ver + ' (' + f.p.mun + ')' : id; }

  var VARS_CLIMA = {
    an_tmax_7f: { n: 'Anomalía Tmax próximos 7 días', u: '°C', div: true, r: 4 },
    an_tmax_7p: { n: 'Anomalía Tmax últimos 7 días', u: '°C', div: true, r: 4 },
    an_tmax_16f: { n: 'Anomalía Tmax próximos 16 días', u: '°C', div: true, r: 4 },
    secos_hoy: { n: 'Días seguidos sin lluvia (hasta hoy)', u: 'días', seq: [0, 20] },
    lluvia_30d_pct: { n: 'Lluvia 30 días (% de lo normal)', u: '%', div: true, centro: 100, r: 80, inv: true },
    an_hr_7f: { n: 'Anomalía humedad relativa próx. 7 días', u: 'pts', div: true, r: 12, inv: true },
    dpv_max_7f: { n: 'Déficit de presión de vapor máx. próx. 7 días', u: 'kPa', seq: [0, 3] },
    tmax_max_fc: { n: 'Tmax máxima pronosticada (16 días)', u: '°C', seq: [5, 38] }
  };
  function mezcla(a, b, t) { var pa = [1, 3, 5].map(function (i) { return parseInt(a.substr(i, 2), 16); }), pb = [1, 3, 5].map(function (i) { return parseInt(b.substr(i, 2), 16); }); return '#' + pa.map(function (x, i) { return Math.round(x + (pb[i] - x) * t).toString(16).padStart(2, '0'); }).join(''); }
  function colorClima(v, def) {
    if (v == null) return null;
    if (def.div) { var c = def.centro || 0, t = Math.max(-1, Math.min(1, (v - c) / def.r)); if (def.inv) t = -t; return t >= 0 ? mezcla(css('--div-mid'), css('--div-warm'), t) : mezcla(css('--div-mid'), css('--div-cold'), -t); }
    var u = Math.max(0, Math.min(1, (v - def.seq[0]) / (def.seq[1] - def.seq[0]))); return u < .5 ? mezcla(css('--seq-100'), css('--seq-500'), u * 2) : mezcla(css('--seq-500'), css('--seq-700'), (u - .5) * 2);
  }
  function tabClima(el) {
    var cl = D.clima; if (!cl) { el.innerHTML = '<p class="nota">Aún no hay datos climáticos.</p>'; return; }
    var def = VARS_CLIMA[E.climaVar], ps = cl.puntos, sel = E.climaSel != null ? ps[E.climaSel] : null;
    var dentro = ps.filter(function (p) { if (!F.mun && !F.ver) return true; var v = vereda(p.lon, p.lat); return v && pasa(v.mun, v.id); });
    var prom = function (k) { var xs = dentro.map(function (p) { return p[k]; }).filter(function (x) { return x != null; }); return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : null; };
    el.innerHTML = '<div class="fila"><select id="s-var" style="flex:1;padding:6px;border:1px solid var(--line);border-radius:8px;background:var(--surface-1)">' + Object.keys(VARS_CLIMA).map(function (k) { return '<option value="' + k + '"' + (k === E.climaVar ? ' selected' : '') + '>' + VARS_CLIMA[k].n + '</option>'; }).join('') + '</select></div>' +
      '<div class="kpis"><div class="kpi"><div class="v">' + (prom('an_tmax_7f') == null ? '–' : (prom('an_tmax_7f') > 0 ? '+' : '') + fmt(prom('an_tmax_7f'), 1) + '°') + '</div><div class="l">anomalía Tmax próx. 7 días (prom.)</div></div><div class="kpi"><div class="v">' + fmt(prom('lluvia_30d_pct')) + ' %</div><div class="l">lluvia 30 días vs. normal</div></div><div class="kpi"><div class="v">' + fmt(Math.max.apply(null, dentro.map(function (p) { return p.secos_hoy || 0; }).concat([0]))) + '</div><div class="l">máx. días seguidos sin lluvia</div></div></div>' +
      '<p class="nota">Malla de ' + ps.length + ' puntos (' + cl.paso + '°) con corrección por elevación. Haga clic en una celda del mapa para ver su serie: 30 días observados + 16 de pronóstico frente a la normal 2016-2025.' + (cl.normales_completas < ps.length ? ' <b>Normales completas en ' + cl.normales_completas + ' de ' + ps.length + ' puntos</b>; las demás se completan automáticamente en las próximas actualizaciones (las aproximadas usan el vecino de altura similar).' : '') + '</p>' +
      (sel ? '<div class="sec">Punto ' + sel.lat + ', ' + sel.lon + ' · ' + fmt(sel.elev) + ' m' + (sel.normal_aprox ? ' (normal aproximada)' : '') + '</div><div class="leyenda"><span class="linea" style="--c:' + css('--series-1') + '">Tmax</span><span class="linea" style="--c:' + css('--text-muted') + '">Tmax normal</span></div><div class="grafica" id="g-tmax"></div><div class="leyenda"><span style="--c:' + css('--series-1') + '">Lluvia diaria (mm)</span></div><div class="grafica" id="g-lluvia"></div>' +
        '<table class="tabla"><tr><td>Anomalía Tmax últimos 7 días</td><td class="n">' + fmt(sel.an_tmax_7p, 1) + ' °C</td></tr><tr><td>Anomalía Tmax próximos 7 días</td><td class="n">' + fmt(sel.an_tmax_7f, 1) + ' °C</td></tr><tr><td>Días seguidos sin lluvia</td><td class="n">' + fmt(sel.secos_hoy) + '</td></tr><tr><td>Lluvia 30 días</td><td class="n">' + fmt(sel.lluvia_30d) + ' mm (' + fmt(sel.lluvia_30d_pct) + ' %)</td></tr><tr><td>Lluvia pronosticada 16 días</td><td class="n">' + fmt(sel.lluvia_fc16) + ' mm</td></tr><tr><td>Anomalía HR próximos 7 días</td><td class="n">' + fmt(sel.an_hr_7f, 1) + ' pts</td></tr></table>' : '') +
      '<div class="sec">Pronósticos oficiales</div><p class="nota">Para contrastar: <a href="https://www.ideam.gov.co/" target="_blank" rel="noopener">IDEAM</a> publica predicciones mensuales de anomalía de temperatura y precipitación y el boletín ENSO.</p>' +
      '<p class="fuente">' + esc(cl.fuente) + '. Actualizado ' + fecha(cl.actualizado) + '. Las anomalías comparan el pronóstico con normales de reanálisis; pueden tener un sesgo sistemático de modelo y se están contrastando con estaciones del IDEAM.</p>';
    $('#s-var').onchange = function () { E.climaVar = this.value; pintar(); };
    if (sel) {
      var s = sel.serie, hoyI = s.t.indexOf(cl.hoy);
      lineas($('#g-tmax'), s.t, [{ n: 'Tmax', c: css('--series-1'), v: s.tmax }, { n: 'Tmax normal', c: css('--text-muted'), v: s.tmax_n, dash: true }], '°C', hoyI);
      lineas($('#g-lluvia'), s.t, [{ n: 'Lluvia', c: css('--series-1'), v: s.lluvia }], 'mm', hoyI, 'barras');
    }
    var g = L.layerGroup(), h = cl.paso / 2;
    ps.forEach(function (p, i) {
      var c = colorClima(p[E.climaVar], def); if (!c) return;
      L.rectangle([[p.lat - h, p.lon - h], [p.lat + h, p.lon + h]], { pane: 'vigil', color: i === E.climaSel ? css('--text-primary') : c, weight: i === E.climaSel ? 2.5 : 0, fillColor: c, fillOpacity: .6 })
        .bindTooltip(def.n + ': <b>' + fmt(p[E.climaVar], 1) + ' ' + def.u + '</b><br>' + fmt(p.elev) + ' m').on('click', function () { E.climaSel = i; pintar(); }).addTo(g);
    });
    ponerDyn('clima', g);
    var lo, hi; if (def.div) { var c0 = def.centro || 0; lo = def.inv ? c0 + def.r : c0 - def.r; hi = def.inv ? c0 - def.r : c0 + def.r; } else { lo = def.seq[0]; hi = def.seq[1]; }
    var rampa = def.div ? 'linear-gradient(90deg,' + css('--div-cold') + ',' + css('--div-mid') + ',' + css('--div-warm') + ')' : 'linear-gradient(90deg,' + css('--seq-100') + ',' + css('--seq-500') + ',' + css('--seq-700') + ')';
    leyendaMapa('<b>' + esc(def.n) + '</b><div class="rampa" style="background:' + rampa + '"></div><div class="ext"><span>' + fmt(lo) + ' ' + def.u + '</span><span>' + fmt(hi) + ' ' + def.u + '</span></div>' + (def.inv ? '<div class="fuente">Rojo = más seco que lo normal</div>' : ''));
  }

  var CAT_UICN = { CR: { n: 'En peligro crítico (CR)', c: '--series-1' }, EN: { n: 'En peligro (EN)', c: '--series-2' }, VU: { n: 'Vulnerable (VU)', c: '#1baf7a' } };
  function cUICN(k) { var c = CAT_UICN[k].c; return c.charAt(0) === '-' ? css(c) : c; }
  function tabEspecies(el) {
    var es = D.esp; if (!es) { el.innerHTML = '<p class="nota">Aún no hay datos de especies (GBIF / SiB Colombia).</p>'; return; }
    var pts = es.pts.filter(function (p) { if (!F.mun && !F.ver) return true; var v = vereda(p[1], p[0]); return v && pasa(v.mun, v.id); });
    var cuenta = {}; pts.forEach(function (p) { cuenta[p[2]] = (cuenta[p[2]] || 0) + 1; });
    var sps = Object.keys(cuenta).map(function (k) { return [k, es.amenazadas[k] || {}, cuenta[k]]; }).sort(function (a, b) { return ['CR', 'EN', 'VU'].indexOf(a[1].cat) - ['CR', 'EN', 'VU'].indexOf(b[1].cat) || b[2] - a[2]; });
    var porCat = { CR: 0, EN: 0, VU: 0 }; sps.forEach(function (s) { porCat[s[1].cat] = (porCat[s[1].cat] || 0) + 1; });
    el.innerHTML = '<div class="kpis"><div class="kpi"><div class="v">' + fmt(es.registros_total) + '</div><div class="l">registros GBIF en Caldas</div></div><div class="kpi"><div class="v">' + sps.length + '</div><div class="l">especies amenazadas ' + (F.mun || F.ver ? 'en el filtro' : '') + '</div></div><div class="kpi"><div class="v">' + fmt(pts.length) + '</div><div class="l">registros de amenazadas</div></div></div>' +
      '<div class="leyenda">' + Object.keys(CAT_UICN).map(function (k) { return '<span style="--c:' + cUICN(k) + '">' + CAT_UICN[k].n + ': ' + porCat[k] + '</span>'; }).join('') + '</div>' +
      '<p class="nota">Las especies amenazadas con registros cerca de alertas de fuego o deforestación indican hábitat en riesgo. Categoría UICN global según GBIF; consulte también la Resolución 0126 de 2024 (listado nacional).</p>' +
      '<div class="sec">Especies amenazadas</div><table class="tabla"><thead><tr><th>Especie</th><th>Grupo</th><th>UICN</th><th class="n">Reg.</th></tr></thead><tbody>' +
      sps.slice(0, 200).map(function (s) { return '<tr><td><i>' + esc(s[0]) + '</i>' + (s[1].nombre_comun ? '<div class="fuente">' + esc(s[1].nombre_comun) + '</div>' : '') + '</td><td>' + esc(s[1].clase || '') + '</td><td>' + esc(s[1].cat) + '</td><td class="n">' + s[2] + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<div class="sec">Registros por grupo (todas las especies)</div><table class="tabla">' + (es.clases || []).slice(0, 12).map(function (c) { return '<tr><td>' + esc(c[0]) + '</td><td class="n">' + fmt(c[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<p class="fuente">' + esc(es.fuente) + '. Actualizado ' + fecha(es.actualizado) + '. <a href="' + esc(es.consulta) + '" target="_blank" rel="noopener">Ver en GBIF</a> · <a href="https://biodiversidad.co/" target="_blank" rel="noopener">SiB Colombia</a></p>';
    var g = L.layerGroup();
    pts.forEach(function (p) { var info = es.amenazadas[p[2]] || {}; L.circleMarker([p[0], p[1]], { pane: 'puntos', radius: 4, color: css('--surface-1'), weight: 1, fillColor: cUICN(info.cat || 'VU'), fillOpacity: .9 }).bindPopup('<h3><i>' + esc(p[2]) + '</i></h3><div>' + esc(info.cat) + ' · ' + esc(info.clase || '') + '</div><div>' + esc(p[3]) + '</div>').addTo(g); });
    ponerDyn('esp', g);
    leyendaMapa('<b>Especies amenazadas (GBIF)</b><div class="leyenda">' + Object.keys(CAT_UICN).map(function (k) { return '<span style="--c:' + cUICN(k) + '">' + k + '</span>'; }).join('') + '</div>');
  }

  function tabCapas(el) {
    el.innerHTML = '<p class="nota">Las capas obligatorias arrancan encendidas. Todo se recorta al límite de Caldas; las capas "en vivo" se consultan directamente a Corpocaldas o al IDEAM.</p>' +
      CAT.map(function (g) {
        return '<div class="grupo-capas"><div class="sec">' + esc(g.g) + '</div>' + g.items.map(function (it) { return '<label class="capa"><input type="checkbox" data-capa="' + it.id + '"' + (activas[it.id] ? ' checked' : '') + '><span class="sw" style="background:' + it.c + '"></span>' + esc(it.n) + '</label>'; }).join('') + '</div>';
      }).join('') +
      '<div class="sec">Fuentes</div><p class="fuente">Corpocaldas (EEP noviembre 2026, cartografía base) · Agencia Nacional de Tierras · IDEAM-SMByC · Global Forest Watch / UMD (Hansen) · OpenStreetMap · MapBiomas Colombia · NASA FIRMS · Open-Meteo · GBIF / SiB Colombia.</p>';
    el.querySelectorAll('input[data-capa]').forEach(function (i) { i.onchange = function () { alternar(i.dataset.capa, i.checked); }; });
    leyendaMapa('');
  }

  var TABS = { vigilar: tabVigilar, fuego: tabFuego, defo: tabDefo, clima: tabClima, especies: tabEspecies, capas: tabCapas };
  var DYN_TAB = { vigilar: ['vigil'], fuego: ['fuego'], defo: ['defo'], clima: ['clima'], especies: ['esp'], capas: [] };
  function pintar() {
    try { history.replaceState(null, '', '#tab=' + E.tab + (F.mun ? '&mun=' + encodeURIComponent(F.mun) : '') + (F.ver ? '&ver=' + F.ver : '')); } catch (e) {}
    quitarDynMenos(DYN_TAB[E.tab]);
    aplicarDynExtra();
    TABS[E.tab]($('#contenido'));
  }

  /* ── filtros ────────────────────────────────── */
  function llenarFiltros() {
    var muns = {}; idxVer.forEach(function (v) { muns[v.p.mun] = 1; });
    $('#f-mun').innerHTML = '<option value="">Todo Caldas</option>' + Object.keys(muns).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('');
    $('#f-mun').onchange = function () { F.mun = this.value; F.ver = ''; llenarVeredas(); zoomFiltro(); pintar(); };
    $('#f-ver').onchange = function () { F.ver = this.value; zoomFiltro(); pintar(); };
  }
  function llenarVeredas() {
    var s = $('#f-ver');
    if (!F.mun) { s.innerHTML = '<option value="">Todas las veredas</option>'; s.disabled = true; return; }
    var vs = idxVer.filter(function (v) { return norm(v.p.mun) === norm(F.mun); }).sort(function (a, b) { return String(a.p.ver).localeCompare(String(b.p.ver), 'es'); });
    s.innerHTML = '<option value="">Todas las veredas de ' + esc(F.mun) + '</option>' + vs.map(function (v) { return '<option value="' + v.p.id + '"' + (String(v.p.id) === F.ver ? ' selected' : '') + '>' + esc(v.p.ver) + '</option>'; }).join('');
    s.disabled = false;
  }
  function zoomFiltro() {
    if (resaltado) { map.removeLayer(resaltado); resaltado = null; }
    var fs = D.veredas.features.filter(function (f) { return F.ver ? String(f.properties.id) === F.ver : F.mun ? norm(f.properties.mun) === norm(F.mun) : false; });
    if (!fs.length) { map.fitBounds(L.geoJSON(D.veredas).getBounds()); return; }
    var capa = L.geoJSON({ type: 'FeatureCollection', features: fs }, { pane: 'limites', style: { color: '#fab219', weight: 3, fill: false }, interactive: false });
    if (F.ver) { resaltado = capa.addTo(map); } else { var mun = fs; resaltado = L.geoJSON({ type: 'FeatureCollection', features: mun }, { pane: 'limites', style: { color: '#fab219', weight: 1, fill: false, opacity: .8 }, interactive: false }).addTo(map); }
    map.fitBounds(capa.getBounds(), { padding: [20, 20], maxZoom: 14 });
  }
  function irVereda(id) {
    var v = idxVer.find(function (x) { return String(x.p.id) === String(id); }); if (!v) return;
    F.mun = v.p.mun; F.ver = String(id); $('#f-mun').value = v.p.mun; llenarVeredas(); $('#f-ver').value = F.ver; zoomFiltro(); pintar();
  }

  /* ── arranque ───────────────────────────────── */
  async function main() {
    var r = await Promise.all([json('data/base/caldas_limite.json'), json('data/capas/veredas.geojson'), json('data/base/meta.json'),
      opt('data/vigilancia.json'), opt('data/deforestacion_alertas.json'), opt('data/clima_actual.json'), opt('data/firms_caldas.json'), opt('data/ideam_caldas.json'), opt('data/especies.json')]);
    D.limite = r[0]; D.veredas = r[1]; D.mbMeta = r[2]; D.vig = r[3]; D.defo = r[4]; D.clima = r[5]; D.firms = r[6]; D.ideam = r[7]; D.esp = r[8];
    prepVeredas(); iniciarMapa(); llenarFiltros();
    for (var g of CAT) for (var it of g.items) if (it.on) await alternar(it.id, true);
    $('#estado-datos').textContent = 'Índice ' + (D.vig ? fecha(D.vig.actualizado) : '–') + ' · FIRMS ' + (D.firms ? fecha(D.firms.actualizado) : '–') + ' · GFW ' + (D.defo ? D.defo.ultima_alerta : '–') + ' · Clima ' + (D.clima ? fecha(D.clima.actualizado) : '–');
    document.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b); }); E.tab = b.dataset.tab; pintar(); }; });
    $('#b-tema').onclick = function () {
      var oscuro = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = oscuro ? 'light' : 'dark';
      try { localStorage.setItem('sat.tema', document.documentElement.dataset.theme); } catch (e) {}
      recolorearMascara(); pintar();
    };
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('tab') && TABS[h.get('tab')]) { E.tab = h.get('tab'); document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x.dataset.tab === E.tab); }); }
    if (h.get('ver')) irVereda(h.get('ver')); else if (h.get('mun')) { F.mun = h.get('mun'); $('#f-mun').value = F.mun; llenarVeredas(); zoomFiltro(); }
    if (h.get('clima')) E.climaSel = +h.get('clima');
    pintar();
    $('#cargando').remove();
  }
  try { var t = localStorage.getItem('sat.tema'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  main().catch(function (e) { console.error(e); $('#cargando').textContent = 'No se pudo cargar el sistema: ' + e.message; });
})();
