/* Descarga de las variables macroeconómicas (PIB, inflación, desempleo y TRM) con fuentes
 * de respaldo: si una no responde se prueba la siguiente. Los lectores están en
 * portafolios/js/macro.js (los mismos que usa la interfaz). */
'use strict';

async function fetchSource(PF, fetch, src) {
  const res = await fetch(PF.macro.sourceUrl(src), { headers: { 'User-Agent': 'Mozilla/5.0 FronteraEficiente', Accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (src.kind === 'fred') return PF.macro.parseFred(text);
  if (src.kind === 'wb') return PF.macro.parseWorldBank(JSON.parse(text));
  if (src.kind === 'socrata') return PF.macro.parseSocrata(JSON.parse(text));
  throw new Error('fuente desconocida');
}

async function updateMacro(store, fetch, PF, log) {
  const out = { updated: [], errors: [] };
  store.data.macro = store.data.macro || {};
  for (const key of Object.keys(PF.macro.VARS)) {
    const tried = [];
    let ok = false;
    for (const src of PF.macro.SOURCES[key]) {
      try {
        const d = await fetchSource(PF, fetch, src);
        const prev = store.data.macro[key];
        const fresh = !prev || prev.dates[prev.dates.length - 1] !== d.dates[d.dates.length - 1] || prev.source !== src.note;
        store.data.macro[key] = { dates: d.dates, values: d.values, source: src.note, url: PF.macro.sourceUrl(src), updated: new Date().toISOString() };
        if (fresh) out.updated.push(key);
        ok = true;
        break;
      } catch (e) {
        tried.push(`${src.note}: ${e.message}`);
      }
    }
    if (!ok) {
      out.errors.push(`${PF.macro.VARS[key].label}: ${tried.join('; ')}`);
      if (log) log('macro', key, tried.join(' | '));
    }
  }
  return out;
}

const DAMODARAN_URL = 'https://pages.stern.nyu.edu/~adamodar/pc/datasets/betaemerg.xls';
async function fetchDamodaran(fetch) {
  const res = await fetch(DAMODARAN_URL, { headers: { 'User-Agent': 'Mozilla/5.0 FronteraEficiente' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en pages.stern.nyu.edu`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { updateMacro, fetchDamodaran, DAMODARAN_URL };
