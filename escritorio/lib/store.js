/* Almacén local de la app de escritorio: un archivo JSON en la carpeta de datos
 * del usuario. Guarda la lista de activos, los precios por fecha (con su fuente),
 * las noticias y los ajustes. Se escribe de forma atómica (archivo temporal + rename). */
'use strict';
const fs = require('fs');
const path = require('path');

// Precio de la BVC (descarga oficial) > fuente automática alternativa.
const RANK = { bvc: 2, yahoo: 1 };

/* Precios de acciones, índices y ETF: solo de la BVC. La fuente automática (Yahoo Finance) queda
 * únicamente para divisas (dólar, euro), que no se negocian en la BVC. */
// Número largo de descarga antes del nombre (1790829234836-COLTES LP): no es parte del activo
const cleanName = (n) => String(n).replace(/^\d{6,}\s*[-_ ]\s*(?=\S)/, '').trim();
const keyOf = (n) => cleanName(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[\s_]+/g, ' ');

const isFx = (a) => !!a && (a.cls === 'divisa' || /^[A-Z]{3}\/[A-Z]{3}$/i.test(a.name));

const DEFAULT_ASSETS = [
  { name: 'MSCI COLCAP', yahoo: '', news: 'COLCAP Bolsa de Valores de Colombia', index: true },
  { name: 'ICOLCAP', yahoo: '', news: 'iShares COLCAP ICOLCAP', index: false },
  { name: 'ECOPETROL', yahoo: '', news: 'Ecopetrol acción', index: false },
  { name: 'PFCIBEST', yahoo: '', news: 'Grupo Cibest acción', index: false },
  { name: 'CIBEST', yahoo: '', news: 'Grupo Cibest Bancolombia', index: false },
  { name: 'PFGRUPSURA', yahoo: '', news: 'Grupo Sura acción', index: false },
  { name: 'TERPEL', yahoo: '', news: 'Terpel acción', index: false },
  { name: 'GEB', yahoo: '', news: 'Grupo Energía Bogotá acción', index: false },
  { name: 'ISA', yahoo: '', news: 'ISA Interconexión Eléctrica acción', index: false },
  { name: 'GRUPOARGOS', yahoo: '', news: 'Grupo Argos acción', index: false },
  // Divisas: el dólar se descarga solo; es también el índice de referencia del segmento
  { name: 'USD/COP', yahoo: 'COP=X', news: 'dólar peso colombiano TRM', index: false },
  // Índices de referencia de renta fija: se importan desde la BVC (no hay fuente automática)
  { name: 'COLTES LP', yahoo: '', news: 'TES Colombia tasas deuda pública', index: true },
  { name: 'COLIBR', yahoo: '', news: 'IBR tasa interbancaria Colombia', index: true },
];
/* Catálogo de acciones y ETF de la BVC (portafolios/js/catalogo.js, compartido con la interfaz). */
function catalog() {
  for (const d of [path.join(__dirname, '..', 'portafolios', 'js'), path.join(__dirname, '..', '..', 'portafolios', 'js')]) {
    const f = path.join(d, 'catalogo.js');
    if (fs.existsSync(f)) return require(f);
  }
  return [];
}
const catalogAsset = (c) => ({ name: c.nemo, yahoo: c.type === 'divisa' ? c.yahoo || '' : '', news: `${c.name} ${c.type === 'accion' ? 'acción' : ''}`.trim(), index: c.type === 'indice', enabled: true, cls: c.type === 'accion' ? undefined : c.type });

const DEFAULTS_VERSION = 5; // sube cuando se agregan activos predeterminados o se hace una limpieza

/* Renta fija e índices de tasas (COLTES, COLIBR, TES, CDT, bonos) leídos con las reglas anteriores:
 * se borran una vez para volver a cargarlos con el lector corregido. */
const STALE_FIXED = /(^| )(COLTES|COLIBR|IBR|TES|CDT|BONO)/i;
function isStaleFixed(a) {
  return a.kind === 'tasa' || ['tes', 'cdt', 'bono'].includes(a.cls) || STALE_FIXED.test(a.name);
}

const DEFAULT_SETTINGS = {
  auto: true, // actualizar solo
  yahoo: true, // usar la fuente automática de cierres
  news: true,
  intervalHours: 168, // semanal
  background: true, // seguir en la bandeja al cerrar la ventana
  openAtLogin: false,
  notify: true,
  newsDays: 14, // antigüedad máxima de las noticias guardadas
};

function emptyData() {
  const assets = DEFAULT_ASSETS.map((a) => Object.assign({ enabled: true }, a));
  const have = new Set(assets.map((a) => a.name.toUpperCase()));
  for (const c of catalog()) {
    if (have.has(c.nemo.toUpperCase())) continue;
    const a = catalogAsset(c);
    if (!a.cls) delete a.cls;
    assets.push(a);
  }
  return {
    version: 1,
    assets,
    prices: {},
    news: [],
    macro: {},
    meta: { lastPrices: null, lastNews: null, errors: {}, defaults: DEFAULTS_VERSION },
    settings: Object.assign({}, DEFAULT_SETTINGS),
  };
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'datos.json');
    fs.mkdirSync(dir, { recursive: true });
    this.data = emptyData();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.version === 1) {
        this.data = Object.assign(emptyData(), raw);
        this.data.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings);
        this.data.meta = Object.assign({ errors: {} }, raw.meta);
        // Activos predeterminados nuevos (divisas e índices de renta fija) para quien ya usaba la app
        const from = this.data.meta.defaults || 1;
        if (from < DEFAULTS_VERSION) {
          for (const a of DEFAULT_ASSETS) if (!this.asset(a.name)) this.data.assets.push(Object.assign({ enabled: true }, a));
          if (from < 3) this.cleanFixed();
          if (from < 4) this.addCatalog();
          if (from < 5) this.bvcOnly();
          this.data.meta.defaults = DEFAULTS_VERSION;
        }
        this.mergeDuplicates();
      }
    } catch (e) {
      /* primera vez o archivo dañado: se empieza vacío */
    }
  }

  /* Solo la BVC para acciones, índices y ETF: quita los cierres de la fuente automática y su símbolo. */
  bvcOnly() {
    let removed = 0;
    for (const a of this.data.assets) {
      if (isFx(a)) continue;
      a.yahoo = '';
      delete this.data.meta.errors[a.name];
      const book = this.data.prices[a.name];
      if (!book) continue;
      for (const d of Object.keys(book))
        if (book[d][1] !== 'bvc') {
          delete book[d];
          removed++;
        }
    }
    return removed;
  }

  /* Agrega todas las acciones y ETF de la BVC que falten; devuelve cuántos agregó. */
  addCatalog() {
    let n = 0;
    for (const c of catalog()) {
      if (this.asset(c.nemo)) continue;
      const a = catalogAsset(c);
      if (!a.cls) delete a.cls;
      this.data.assets.push(a);
      n++;
    }
    if (n) this.data.meta.lastPrices = null; // descarga el historial de los nuevos al abrir
    return n;
  }

  /* Limpieza: borra los históricos de renta fija e índices de tasas guardados, quita los activos
   * importados de ese tipo (los predeterminados se conservan, vacíos) y pide descargar todo de nuevo. */
  cleanFixed() {
    const keep = new Set(DEFAULT_ASSETS.map((a) => a.name));
    const removed = [];
    this.data.assets = this.data.assets.filter((a) => {
      if (!isStaleFixed(a)) return true;
      delete this.data.prices[a.name];
      delete this.data.meta.errors[a.name];
      removed.push(a.name);
      if (!keep.has(a.name)) return false;
      delete a.kind;
      delete a.dur;
      delete a.cls;
      return true;
    });
    this.data.meta.lastPrices = null; // fuerza la descarga completa al abrir
    this.data.meta.cleaned = removed;
    return removed;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  asset(name) {
    const k = keyOf(name);
    return this.data.assets.find((a) => keyOf(a.name) === k);
  }

  /* Une los activos que son el mismo con nombres distintos (tramos con número de descarga, guiones
   * bajos, tildes): un solo activo con el nombre limpio y todas sus fechas. Si dos tramos tienen la
   * misma fecha, queda el de la fuente de mayor rango (la BVC). Devuelve cuántos se unieron. */
  mergeDuplicates() {
    const groups = new Map();
    for (const a of this.data.assets) {
      const k = keyOf(a.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(a);
    }
    let merged = 0;
    const drop = new Set();
    for (const list of groups.values()) {
      const clean = cleanName(list[0].name);
      if (list.length === 1 && list[0].name === clean) continue;
      const keep = list.find((a) => a.name === clean) || list[0];
      const book = {};
      for (const a of list) {
        for (const [d, v] of Object.entries(this.data.prices[a.name] || {})) if (!book[d] || RANK[v[1]] > RANK[book[d][1]]) book[d] = v;
        if (a !== keep) {
          drop.add(a);
          delete this.data.prices[a.name];
          delete this.data.meta.errors[a.name];
          merged++;
          for (const f of ['cls', 'kind', 'dur']) if (keep[f] == null && a[f] != null) keep[f] = a[f];
          keep.index = keep.index || a.index;
        }
      }
      delete this.data.prices[keep.name];
      keep.name = clean;
      if (Object.keys(book).length) this.data.prices[clean] = book;
    }
    if (drop.size) this.data.assets = this.data.assets.filter((a) => !drop.has(a));
    return merged;
  }

  /* Agrega el activo si no está en la lista (p. ej. al importar un CSV de otra acción). */
  ensureAsset(name, isIndex, info) {
    let a = this.asset(name);
    if (!a) {
      name = cleanName(name);
      a = { name, yahoo: '', news: name + (isIndex ? '' : ' acción'), index: !!isIndex, enabled: true };
      this.data.assets.push(a);
    }
    // Tipo de instrumento y, en renta fija por tasas, la duración (los precios guardados son tasas)
    if (info) {
      if (info.cls) a.cls = info.cls;
      if (info.kind === 'tasa') {
        a.kind = 'tasa';
        a.dur = info.dur;
      }
    }
    return a;
  }

  /* Une precios de una fuente. Una fecha que ya tiene precio de una fuente de mayor
   * rango no se sobrescribe. Devuelve cuántas fechas nuevas o corregidas hubo. */
  mergePrices(name, dates, prices, src, qty, vol) {
    const key = this.ensureAsset(name).name;
    const book = this.data.prices[key] || (this.data.prices[key] = {});
    let changed = 0;
    dates.forEach((d, i) => {
      const p = prices[i];
      if (!(p > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const cur = book[d];
      if (cur && RANK[cur[1]] > RANK[src]) return;
      // [precio, fuente, acciones negociadas, monto negociado] (los dos últimos, de la BVC)
      const q = qty && Number.isFinite(qty[i]) ? qty[i] : cur && cur[1] === src ? cur[2] : undefined;
      const v = vol && Number.isFinite(vol[i]) ? vol[i] : cur && cur[1] === src ? cur[3] : undefined;
      if (!cur || cur[0] !== p || cur[1] !== src || cur[2] !== q || cur[3] !== v) {
        book[d] = q != null || v != null ? [p, src, q == null ? null : q, v == null ? null : v] : [p, src];
        changed++;
      }
    });
    return changed;
  }

  /* Historial ordenado de un activo: { dates, prices, sources }. */
  history(name) {
    const book = this.data.prices[name] || {};
    const dates = Object.keys(book).sort();
    const h = { dates, prices: dates.map((d) => book[d][0]), sources: dates.map((d) => book[d][1]) };
    if (dates.some((d) => book[d].length > 2)) {
      h.qty = dates.map((d) => (book[d][2] == null ? NaN : book[d][2]));
      h.vol = dates.map((d) => (book[d][3] == null ? NaN : book[d][3]));
    }
    return h;
  }

  /* Series para el análisis (formato de PF.data): solo activos activos con datos.
   * Acciones, índices y ETF llevan solo los precios descargados o importados de la BVC. */
  series() {
    return this.data.assets
      .filter((a) => a.enabled)
      .map((a) => {
        const full = this.history(a.name);
        // Acciones, índices y ETF: solo la BVC. Divisas: también la fuente automática.
        const keep = full.sources.map((s) => s === 'bvc' || isFx(a));
        const h = { dates: full.dates.filter((_, i) => keep[i]), prices: full.prices.filter((_, i) => keep[i]), sources: full.sources.filter((_, i) => keep[i]) };
        const bvc = h.sources.filter((s) => s === 'bvc').length;
        const out = { name: a.name, dates: h.dates, prices: h.prices, column: bvc === h.dates.length ? 'BVC' : bvc ? 'BVC + automática' : 'automática', rank: 2, parts: 1 };
        if (a.cls) out.cls = a.cls;
        else if (a.index) out.cls = 'indice';
        if (a.kind === 'tasa') Object.assign(out, { kind: 'tasa', dur: a.dur });
        if (full.qty) {
          out.qty = full.qty.filter((_, i) => keep[i]);
          out.vol = full.vol.filter((_, i) => keep[i]);
        }
        return out;
      })
      .filter((s) => s.dates.length >= 3);
  }

  /* Noticias nuevas (por enlace o título) y recorte por antigüedad. */
  addNews(items, now) {
    // Una misma noticia puede salir en la búsqueda de varios activos: se guarda una vez.
    const seen = new Set(this.data.news.map((n) => n.link || n.title));
    const fresh = [];
    for (const n of items) {
      const k = n.link || n.title;
      if (seen.has(k)) continue;
      seen.add(k);
      fresh.push(n);
    }
    const limit = (now || Date.now()) - this.data.settings.newsDays * 864e5;
    this.data.news = fresh.concat(this.data.news).filter((n) => Date.parse(n.date) >= limit || !n.date);
    this.data.news.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    this.data.news = this.data.news.slice(0, 2000);
    return fresh;
  }

  /* Respaldo para llevar los datos a otro equipo. */
  exportData() {
    return { app: 'frontera-eficiente', version: 1, exported: new Date().toISOString(), data: this.data };
  }

  /* Une un respaldo con los datos de este equipo: activos nuevos, precios (sin pisar
   * un cierre de la BVC con uno automático) y noticias. Los ajustes locales se conservan. */
  importData(backup) {
    const d = backup && backup.app === 'frontera-eficiente' && backup.data;
    if (!d || backup.version !== 1 || !Array.isArray(d.assets) || typeof d.prices !== 'object') throw new Error('El archivo no es un respaldo de Frontera Eficiente.');
    let assets = 0;
    let points = 0;
    for (const a of d.assets) {
      if (!a || !a.name) continue;
      if (!this.asset(a.name)) {
        const na = { name: String(a.name).toUpperCase().slice(0, 40), yahoo: String(a.yahoo || ''), news: String(a.news || a.name), index: !!a.index, enabled: a.enabled !== false };
        if (a.cls) na.cls = String(a.cls).slice(0, 12);
        if (a.kind === 'tasa' && a.dur > 0) Object.assign(na, { kind: 'tasa', dur: +a.dur });
        this.data.assets.push(na);
        assets++;
      }
    }
    for (const [name, book] of Object.entries(d.prices)) {
      for (const src of ['yahoo', 'bvc']) {
        const dates = Object.keys(book || {}).filter((k) => Array.isArray(book[k]) && book[k][1] === src);
        points += this.mergePrices(name, dates, dates.map((k) => +book[k][0]), src);
      }
    }
    const news = Array.isArray(d.news) ? this.addNews(d.news.filter((n) => n && n.title)) : [];
    // Variables macro: se conserva la serie más larga de cada una
    if (d.macro && typeof d.macro === 'object') {
      this.data.macro = this.data.macro || {};
      for (const k of Object.keys(d.macro)) {
        const v = d.macro[k];
        if (v && Array.isArray(v.dates) && (!this.data.macro[k] || v.dates.length > this.data.macro[k].dates.length)) this.data.macro[k] = v;
      }
    }
    this.bvcOnly(); // un respaldo antiguo puede traer cierres automáticos de acciones
    this.mergeDuplicates();
    return { assets, points, news: news.length };
  }

  summary() {
    const d = this.data;
    return {
      assets: d.assets.map((a) => {
        const h = this.history(a.name);
        const n = h.dates.length;
        return Object.assign({}, a, {
          count: n,
          first: h.dates[0] || null,
          last: h.dates[n - 1] || null,
          price: n ? h.prices[n - 1] : null,
          prev: n > 1 ? h.prices[n - 2] : null,
          source: n ? h.sources[n - 1] : null,
          error: d.meta.errors[a.name] || null,
        });
      }),
      meta: d.meta,
      settings: d.settings,
      newsCount: d.news.length,
    };
  }
}

module.exports = { catalog, cleanName, isFx, isStaleFixed, Store, DEFAULT_ASSETS, DEFAULT_SETTINGS, RANK };
