/* Actualización diaria: cierres (fuente automática) y noticias de cada activo.
 * También importa los archivos descargados de la BVC (CSV o Excel). */
'use strict';
const fs = require('fs');
const path = require('path');
const src = require('./sources');

function loadPF() {
  // El motor de la app web (portafolios/js) funciona igual en Node: agrega globalThis.PF.
  const base = [path.join(__dirname, '..', 'portafolios', 'js'), path.join(__dirname, '..', '..', 'portafolios', 'js')].find((d) => fs.existsSync(path.join(d, 'stats.js')));
  if (!base) throw new Error('No se encontró el motor de cálculo (portafolios/js).');
  require(path.join(base, 'stats.js'));
  return globalThis.PF;
}

/* Precios: la primera vez 5 años; después el último mes (corrige cierres recientes). */
async function updatePrices(store, fetch, log) {
  const s = store.data.settings;
  const out = { updated: [], errors: [], newest: null };
  if (!s.yahoo) return out;
  for (const a of store.data.assets) {
    if (!a.enabled || !a.yahoo) continue;
    const have = (store.data.prices[a.name] && Object.keys(store.data.prices[a.name]).length) || 0;
    try {
      const r = await src.fetchYahoo(fetch, a.yahoo, have > 200 ? '1mo' : '5y');
      const n = store.mergePrices(a.name, r.dates, r.prices, 'yahoo');
      delete store.data.meta.errors[a.name];
      if (n) out.updated.push({ name: a.name, count: n, last: r.dates[r.dates.length - 1] });
      const last = r.dates[r.dates.length - 1];
      if (last && (!out.newest || last > out.newest)) out.newest = last;
    } catch (e) {
      store.data.meta.errors[a.name] = e.message;
      out.errors.push({ name: a.name, error: e.message });
      if (log) log(`precios ${a.name}: ${e.message}`);
    }
  }
  store.data.meta.lastPrices = new Date().toISOString();
  return out;
}

async function updateNews(store, fetch, log) {
  const s = store.data.settings;
  const out = { fresh: [], errors: [] };
  if (!s.news) return out;
  const queries = store.data.assets.filter((a) => a.enabled && a.news).map((a) => [a.news, a.name]);
  queries.push(['"Bolsa de Valores de Colombia"', 'BVC']);
  const all = [];
  for (const [q, name] of queries) {
    try {
      all.push(...(await src.fetchNews(fetch, q, name, 7)));
    } catch (e) {
      out.errors.push({ name, error: e.message });
      if (log) log(`noticias ${name}: ${e.message}`);
    }
  }
  // La misma noticia puede salir en varias búsquedas: se asigna al activo que el titular menciona.
  const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const key = (name) => {
    const a = store.asset(name);
    const words = fold((a && a.news) || name).replace(/["']/g, '').split(/\s+/).filter((w) => w.length > 3 && !/^(accion|acciones|grupo|bolsa|valores)$/.test(w));
    return words[0] || fold(name);
  };
  const best = new Map();
  for (const n of all) {
    const k = n.link || n.title;
    const cur = best.get(k);
    const hit = fold(n.title).includes(key(n.asset));
    if (!cur || (hit && !cur.hit)) best.set(k, { n, hit });
  }
  out.fresh = store.addNews([...best.values()].map((x) => x.n));
  store.data.meta.lastNews = new Date().toISOString();
  return out;
}

/* Archivos de la BVC (o de Investing/Yahoo): se leen con el mismo lector de la app
 * web y se guardan como precios de la BVC, con prioridad sobre la fuente automática. */
function importFiles(store, files, readExcel) {
  const PF = loadPF();
  const res = { assets: {}, errors: [] };
  for (const f of files) {
    try {
      let series;
      if (/\.(xlsx|xlsm|xls|ods)$/i.test(f)) {
        if (!readExcel) throw new Error('es un libro de Excel; cárgalo en la sección Datos con «Subir archivos». Las descargas de la BVC son CSV y se importan aquí');
        series = [];
        for (const rows of readExcel(f)) {
          try {
            const r = PF.data.readRows(rows, path.basename(f));
            if (!r.returnsLike) series.push(...r.series);
          } catch (e) {
            /* hoja sin precios */
          }
        }
        if (!series.length) throw new Error('no tiene hojas con fechas y precios');
      } else {
        const buf = fs.readFileSync(f);
        let text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) {
          text = new TextDecoder('windows-1252').decode(buf);
        }
        series = PF.data.readText(text, path.basename(f)).series;
      }
      for (const s of series) {
        store.ensureAsset(s.name, s.cls === 'indice' || PF.data.isMarketName(s.name), s);
        const n = store.mergePrices(s.name, s.dates, s.prices, 'bvc');
        res.assets[s.name] = (res.assets[s.name] || 0) + n;
      }
    } catch (e) {
      res.errors.push(`${path.basename(f)}: ${e.message}`);
    }
  }
  return res;
}

module.exports = { updatePrices, updateNews, importFiles, loadPF };
