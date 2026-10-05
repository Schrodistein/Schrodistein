/* Biblioteca local: una carpeta con todo lo descargado, en archivos que se abren sin la app.
 *   acciones/<ACTIVO>.csv          un solo archivo por activo con todo su historial (los tramos de 6 meses
 *                                  que entrega la BVC se unen): fecha, cierre o tasa, fuente, cantidad, volumen
 *   macro/<variable>.csv           PIB, inflación, desempleo y TRM, con su fuente
 *   damodaran/                     betas por industria de Damodaran
 *   documentos/*.html              paso a paso, variables macro y teoría
 *   LEEME.txt */
'use strict';
const fs = require('fs');
const path = require('path');

/* Formato de Excel en español: punto y coma entre columnas, punto de miles y coma decimal (2.400,5). */
function excelNum(x) {
  if (x == null || !Number.isFinite(x)) return '';
  let t = String(+x.toPrecision(15));
  if (/e/i.test(t)) t = x.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
  const neg = t[0] === '-';
  if (neg) t = t.slice(1);
  const [i, d] = t.split('.');
  return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (d ? ',' + d : '');
}
const txt = (x) => (/[;"\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x));

const safe = (n) => String(n).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'activo';

function write(store, dir, docs) {
  const sub = (s) => {
    const d = path.join(dir, s);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const acc = sub('acciones');
  fs.rmSync(path.join(acc, 'originales'), { recursive: true, force: true }); // versiones anteriores guardaban cada tramo
  let assets = 0;
  const written = new Set();
  for (const a of store.data.assets) {
    const h = store.history(a.name);
    if (!h.dates.length) continue;
    const head = (a.kind === 'tasa' ? 'Fecha;Tasa (%);Fuente' : 'Fecha;Cierre;Fuente') + (h.qty ? ';Cantidad;Volumen' : '');
    // Las tasas se guardan como fracción (0,105) y se escriben en porcentaje (10,5), como en la BVC
    const val = (x) => excelNum(a.kind === 'tasa' ? x * 100 : x);
    const rows = h.dates.map((d, i) => `${d};${val(h.prices[i])};${h.sources[i] === 'bvc' ? 'BVC' : 'Yahoo Finance'}${h.qty ? `;${excelNum(h.qty[i])};${excelNum(h.vol[i])}` : ''}`);
    fs.writeFileSync(path.join(acc, safe(a.name) + '.csv'), '\ufeff' + [head].concat(rows).join('\r\n'));
    written.add(safe(a.name) + '.csv');
    assets++;
  }
  // Archivos de activos que ya no están o se limpiaron (p. ej. COLTES leídos con reglas anteriores)
  for (const f of fs.readdirSync(acc)) if (f.toLowerCase().endsWith('.csv') && !written.has(f)) fs.rmSync(path.join(acc, f), { force: true });
  const mac = sub('macro');
  const m = store.data.macro || {};
  let vars = 0;
  const all = ['Variable;Fecha;Valor;Fuente'];
  for (const k of Object.keys(m)) {
    const d = m[k];
    if (!d || !d.dates) continue;
    fs.writeFileSync(path.join(mac, k + '.csv'), '\ufeff' + ['Fecha;Valor'].concat(d.dates.map((t, i) => `${t};${excelNum(d.values[i])}`)).join('\r\n') + `\r\n\r\nFuente: ${txt(d.source)}\r\nURL: ${d.url || ''}\r\nDescargado: ${d.updated || ''}\r\n`);
    d.dates.forEach((t, i) => all.push(`${k};${t};${excelNum(d.values[i])};${txt(d.source)}`));
    vars++;
  }
  if (vars) fs.writeFileSync(path.join(mac, 'todas.csv'), '\ufeff' + all.join('\r\n'));
  let ndocs = 0;
  if (Array.isArray(docs) && docs.length) {
    const doc = sub('documentos');
    for (const d of docs) {
      if (!d || !d.name || typeof d.html !== 'string') continue;
      fs.writeFileSync(path.join(doc, safe(d.name)), d.html);
      ndocs++;
    }
  }
  fs.writeFileSync(
    path.join(dir, 'LEEME.txt'),
    [
      'Biblioteca local de Frontera Eficiente',
      `Actualizada: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      '',
      'acciones/       un solo CSV por acción, ETF o índice con todo su historial: los tramos de 6 meses que descarga la BVC quedan unidos (fecha, cierre o tasa, fuente, cantidad y volumen).',
      'macro/          PIB, inflación, desempleo y TRM de Colombia, con la fuente y la fecha de descarga.',
      'damodaran/      betas por industria de Aswath Damodaran (NYU Stern), mercados emergentes.',
      'documentos/     paso a paso de varianza, covarianza, desviación, correlación y betas; variables macro; teoría.',
      '',
      'La app reescribe esta carpeta en cada actualización (semanal por defecto). Los CSV usan punto y coma, punto de miles y coma decimal (Excel en español): se abren directamente en Excel.',
    ].join('\r\n')
  );
  return { dir, assets, vars, docs: ndocs };
}

module.exports = { write, excelNum };
