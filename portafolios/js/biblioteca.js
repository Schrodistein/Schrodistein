/* Biblioteca local: el histórico de cada acción, ETF, índice e instrumento, y de cada variable
 * macroeconómica, guardado en el equipo (IndexedDB del navegador o de la app de escritorio).
 *
 * Los cálculos se hacen con estos valores guardados. Cada dato que entra a la biblioteca queda
 * fijo: al cargar archivos o descargas nuevas solo se agregan las fechas que faltan, nunca se
 * reemplaza un valor ya guardado. Así un análisis con la misma fecha de corte da siempre el
 * mismo resultado. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;
  const DB = 'frontera-eficiente';
  const VERSION = 2;
  /* Versión 2: limpieza única de la renta fija e índices de tasas (COLTES, COLIBR, TES, CDT, bonos)
   * guardados con las reglas de lectura anteriores; se vuelven a cargar con el lector corregido. */
  const STALE_FIXED = /(^| )(COLTES|COLIBR|IBR|TES|CDT|BONO)/i;
  const isStaleFixed = (r) => r.kind === 'tasa' || ['tes', 'cdt', 'bono'].includes(r.cls) || STALE_FIXED.test(r.name);

  /* Une una serie nueva con la guardada. Los valores guardados no cambian; se agregan las
   * fechas nuevas (con su cantidad y volumen, si los hay). Devuelve el registro y cuántas
   * fechas se agregaron. */
  function mergeRecord(old, s, source, now) {
    const map = new Map();
    const put = (r, fixed) => {
      r.dates.forEach((d, i) => {
        const cur = map.get(d);
        const p = r.prices[i];
        if (!fin(p)) return;
        if (cur && fixed !== true) {
          // Valor ya guardado: se conserva; solo se completan cantidad y volumen si faltaban
          if (!fin(cur.q) && r.qty && fin(r.qty[i])) cur.q = r.qty[i];
          if (!fin(cur.v) && r.vol && fin(r.vol[i])) cur.v = r.vol[i];
          return;
        }
        map.set(d, { p, q: r.qty ? r.qty[i] : NaN, v: r.vol ? r.vol[i] : NaN });
      });
    };
    if (old) put(old, true);
    const before = map.size;
    put(s, false);
    const dates = [...map.keys()].sort();
    const rows = dates.map((d) => map.get(d));
    const hasQ = rows.some((x) => fin(x.q) || fin(x.v));
    const rec = {
      name: s.name,
      cls: s.cls || (old && old.cls) || null,
      kind: s.kind || (old && old.kind) || null,
      dur: s.dur || (old && old.dur) || null,
      // Las series de tasa se guardan como tasa (no como índice) para poder unir tramos
      dates,
      prices: rows.map((x) => x.p),
      qty: hasQ ? rows.map((x) => (fin(x.q) ? x.q : null)) : null,
      vol: hasQ ? rows.map((x) => (fin(x.v) ? x.v : null)) : null,
      source: old && old.source && old.source !== source ? `${old.source} + ${source}` : source,
      column: s.column || (old && old.column) || '',
      created: (old && old.created) || now,
      updated: map.size > before ? now : (old && old.updated) || now,
      use: old ? old.use !== false : true,
    };
    return { rec, added: map.size - before };
  }

  /* Serie de la biblioteca en el formato del motor (las de tasa vuelven a ser índice al unirse). */
  function toSeries(rec, cut) {
    const keep = rec.dates.map((d) => !cut || d <= cut);
    const pick = (a) => (a ? a.filter((_, i) => keep[i]).map((x) => (x == null ? NaN : x)) : undefined);
    const s = { name: rec.name, dates: rec.dates.filter((_, i) => keep[i]), prices: pick(rec.prices), column: `biblioteca (${rec.source})`, rank: 2, parts: 1 };
    if (rec.cls) s.cls = rec.cls;
    if (rec.kind === 'tasa') Object.assign(s, { kind: 'tasa', dur: rec.dur });
    if (rec.qty) {
      s.qty = pick(rec.qty);
      s.vol = pick(rec.vol);
    }
    return s;
  }

  /* ---------- Almacenamiento (IndexedDB; en memoria si no está disponible) ---------- */
  let dbp = null;
  const mem = { series: new Map(), macro: new Map() };
  function open() {
    if (!root.indexedDB) return Promise.resolve(null);
    if (!dbp) {
      dbp = new Promise((ok) => {
        let req;
        try {
          req = root.indexedDB.open(DB, VERSION);
        } catch (e) {
          return ok(null);
        }
        req.onupgradeneeded = (ev) => {
          const db = req.result;
          if (ev.oldVersion >= 1 && ev.oldVersion < 2 && db.objectStoreNames.contains('series')) {
            const cur = req.transaction.objectStore('series').openCursor();
            cur.onsuccess = () => {
              const c = cur.result;
              if (!c) return;
              if (isStaleFixed(c.value)) c.delete();
              c.continue();
            };
          }
          if (!db.objectStoreNames.contains('series')) db.createObjectStore('series', { keyPath: 'name' });
          if (!db.objectStoreNames.contains('macro')) db.createObjectStore('macro', { keyPath: 'key' });
        };
        req.onsuccess = () => ok(req.result);
        req.onerror = () => ok(null);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) return fn(null, mem[store]);
    return new Promise((ok, ko) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      let out;
      Promise.resolve(fn(os)).then((r) => (out = r), ko);
      t.oncomplete = () => ok(out);
      t.onerror = () => ko(t.error);
    });
  }
  const reqP = (r) => new Promise((ok, ko) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => ko(r.error))));
  const getAll = (store) => tx(store, 'readonly', (os, m) => (os ? reqP(os.getAll()) : [...m.values()]));

  async function all() {
    const [series, macro] = await Promise.all([getAll('series'), getAll('macro')]);
    series.sort((a, b) => a.name.localeCompare(b.name));
    return { series, macro: Object.fromEntries(macro.map((m) => [m.key, m])) };
  }

  /* Guarda varias series; devuelve { nuevas, agregadas } (instrumentos nuevos y fechas nuevas). */
  async function saveSeries(list, source) {
    const now = new Date().toISOString();
    const key = (n) => (PF.data && PF.data.assetKey ? PF.data.assetKey(n) : String(n).toUpperCase());
    const cur = new Map((await getAll('series')).map((r) => [key(r.name), r]));
    const out = { nuevas: 0, agregadas: 0, porActivo: {} };
    const recs = [];
    for (const s of list) {
      if (!s || !s.dates || s.dates.length < 2) continue;
      const old = cur.get(key(s.name));
      // Las series de tasa llegan convertidas en índice: se guarda la tasa original
      const raw = s.kind === 'tasa' && s.rates ? Object.assign({}, s, { prices: s.rates }) : s;
      const { rec, added } = mergeRecord(old, raw, source, now);
      if (old) rec.name = old.name;
      if (!old) out.nuevas++;
      out.agregadas += added;
      out.porActivo[rec.name] = added;
      recs.push(rec);
    }
    await tx('series', 'readwrite', (os, m) => recs.forEach((r) => (os ? os.put(r) : m.set(r.name, r))));
    return out;
  }

  async function saveMacro(key, d, source) {
    const now = new Date().toISOString();
    const cur = (await getAll('macro')).find((m) => m.key === key);
    const { rec, added } = mergeRecord(cur ? { dates: cur.dates, prices: cur.values, source: cur.source, created: cur.created, updated: cur.updated } : null, { name: key, dates: d.dates, prices: d.values }, source || d.source || 'archivo', now);
    const out = { key, dates: rec.dates, values: rec.prices, source: rec.source, created: rec.created, updated: rec.updated };
    await tx('macro', 'readwrite', (os, m) => (os ? os.put(out) : m.set(key, out)));
    return added;
  }

  async function setUse(name, use) {
    const r = (await getAll('series')).find((x) => x.name === name);
    if (!r) return;
    r.use = !!use;
    await tx('series', 'readwrite', (os, m) => (os ? os.put(r) : m.set(r.name, r)));
  }
  const remove = (store, key) => tx(store, 'readwrite', (os, m) => (os ? os.delete(key) : m.delete(key)));
  const clear = () => Promise.all(['series', 'macro'].map((s) => tx(s, 'readwrite', (os, m) => (os ? os.clear() : m.clear()))));

  async function exportJSON() {
    const a = await all();
    return { app: 'frontera-eficiente', tipo: 'biblioteca', version: 1, exportado: new Date().toISOString(), series: a.series, macro: Object.values(a.macro) };
  }
  async function importJSON(obj) {
    if (!obj || obj.tipo !== 'biblioteca' || !Array.isArray(obj.series)) throw new Error('El archivo no es una biblioteca de Frontera Eficiente.');
    const res = await saveSeries(
      obj.series.map((r) => ({ name: r.name, dates: r.dates, prices: r.prices, qty: r.qty, vol: r.vol, cls: r.cls, kind: r.kind, dur: r.dur, column: r.column })),
      'respaldo importado'
    );
    let mac = 0;
    for (const m of obj.macro || []) mac += await saveMacro(m.key, m, m.source);
    return Object.assign(res, { macro: mac });
  }

  PF.lib = { isStaleFixed, mergeRecord, toSeries, all, saveSeries, saveMacro, setUse, remove, clear, exportJSON, importJSON };
})(typeof globalThis !== 'undefined' ? globalThis : this);
