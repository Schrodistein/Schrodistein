/* Almacén local de la app de escritorio: un archivo JSON en la carpeta de datos
 * del usuario. Guarda la lista de activos, los precios por fecha (con su fuente),
 * las noticias y los ajustes. Se escribe de forma atómica (archivo temporal + rename). */
'use strict';
const fs = require('fs');
const path = require('path');

// Precio de la BVC (descarga oficial) > fuente automática alternativa.
const RANK = { bvc: 2, yahoo: 1 };

const DEFAULT_ASSETS = [
  { name: 'MSCI COLCAP', yahoo: '', news: 'COLCAP Bolsa de Valores de Colombia', index: true },
  { name: 'ICOLCAP', yahoo: 'ICOLCAP.CL', news: 'iShares COLCAP ICOLCAP', index: false },
  { name: 'ECOPETROL', yahoo: 'ECOPETROL.CL', news: 'Ecopetrol acción', index: false },
  { name: 'PFCIBEST', yahoo: 'PFCIBEST.CL', news: 'Grupo Cibest acción', index: false },
  { name: 'CIBEST', yahoo: 'CIBEST.CL', news: 'Grupo Cibest Bancolombia', index: false },
  { name: 'PFGRUPSURA', yahoo: 'PFGRUPSURA.CL', news: 'Grupo Sura acción', index: false },
  { name: 'TERPEL', yahoo: 'TERPEL.CL', news: 'Terpel acción', index: false },
  { name: 'GEB', yahoo: 'GEB.CL', news: 'Grupo Energía Bogotá acción', index: false },
  { name: 'ISA', yahoo: 'ISA.CL', news: 'ISA Interconexión Eléctrica acción', index: false },
  { name: 'GRUPOARGOS', yahoo: 'GRUPOARGOS.CL', news: 'Grupo Argos acción', index: false },
];

const DEFAULT_SETTINGS = {
  auto: true, // actualizar solo
  yahoo: true, // usar la fuente automática de cierres
  news: true,
  intervalHours: 3,
  background: true, // seguir en la bandeja al cerrar la ventana
  openAtLogin: false,
  notify: true,
  newsDays: 14, // antigüedad máxima de las noticias guardadas
};

function emptyData() {
  return {
    version: 1,
    assets: DEFAULT_ASSETS.map((a) => Object.assign({ enabled: true }, a)),
    prices: {},
    news: [],
    meta: { lastPrices: null, lastNews: null, errors: {} },
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
      }
    } catch (e) {
      /* primera vez o archivo dañado: se empieza vacío */
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  asset(name) {
    return this.data.assets.find((a) => a.name.toUpperCase() === String(name).toUpperCase());
  }

  /* Agrega el activo si no está en la lista (p. ej. al importar un CSV de otra acción). */
  ensureAsset(name, isIndex) {
    let a = this.asset(name);
    if (!a) {
      a = { name, yahoo: '', news: name + ' acción', index: !!isIndex, enabled: true };
      this.data.assets.push(a);
    }
    return a;
  }

  /* Une precios de una fuente. Una fecha que ya tiene precio de una fuente de mayor
   * rango no se sobrescribe. Devuelve cuántas fechas nuevas o corregidas hubo. */
  mergePrices(name, dates, prices, src) {
    const key = this.ensureAsset(name).name;
    const book = this.data.prices[key] || (this.data.prices[key] = {});
    let changed = 0;
    dates.forEach((d, i) => {
      const p = prices[i];
      if (!(p > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const cur = book[d];
      if (cur && RANK[cur[1]] > RANK[src]) return;
      if (!cur || cur[0] !== p || cur[1] !== src) {
        book[d] = [p, src];
        changed++;
      }
    });
    return changed;
  }

  /* Historial ordenado de un activo: { dates, prices, sources }. */
  history(name) {
    const book = this.data.prices[name] || {};
    const dates = Object.keys(book).sort();
    return { dates, prices: dates.map((d) => book[d][0]), sources: dates.map((d) => book[d][1]) };
  }

  /* Series para el análisis (formato de PF.data): solo activos activos con datos. */
  series() {
    return this.data.assets
      .filter((a) => a.enabled)
      .map((a) => {
        const h = this.history(a.name);
        const bvc = h.sources.filter((s) => s === 'bvc').length;
        return { name: a.name, dates: h.dates, prices: h.prices, column: bvc === h.dates.length ? 'BVC' : bvc ? 'BVC + automática' : 'automática', rank: 2, parts: 1 };
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

module.exports = { Store, DEFAULT_ASSETS, DEFAULT_SETTINGS, RANK };
