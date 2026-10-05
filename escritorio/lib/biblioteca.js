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
  for (const a of store.data.assets) {
    const h = store.history(a.name);
    if (!h.dates.length) continue;
    const head = (a.kind === 'tasa' ? 'Fecha,Tasa,Fuente' : 'Fecha,Cierre,Fuente') + (h.qty ? ',Cantidad,Volumen' : '');
    const cell = (x) => (Number.isFinite(x) ? x : '');
    const rows = h.dates.map((d, i) => `${d},${h.prices[i]},${h.sources[i] === 'bvc' ? 'BVC' : 'Yahoo Finance'}${h.qty ? `,${cell(h.qty[i])},${cell(h.vol[i])}` : ''}`);
    fs.writeFileSync(path.join(acc, safe(a.name) + '.csv'), '﻿' + [head].concat(rows).join('\n'));
    assets++;
  }
  const mac = sub('macro');
  const m = store.data.macro || {};
  let vars = 0;
  const all = ['Variable,Fecha,Valor,Fuente'];
  for (const k of Object.keys(m)) {
    const d = m[k];
    if (!d || !d.dates) continue;
    fs.writeFileSync(path.join(mac, k + '.csv'), '﻿' + ['Fecha,Valor'].concat(d.dates.map((t, i) => `${t},${d.values[i]}`)).join('\n') + `\n\nFuente: ${d.source}\nURL: ${d.url || ''}\nDescargado: ${d.updated || ''}\n`);
    d.dates.forEach((t, i) => all.push(`${k},${t},${d.values[i]},"${d.source}"`));
    vars++;
  }
  if (vars) fs.writeFileSync(path.join(mac, 'todas.csv'), '﻿' + all.join('\n'));
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
      'La app reescribe esta carpeta en cada actualización (semanal por defecto). Los CSV se abren en Excel.',
    ].join('\r\n')
  );
  return { dir, assets, vars, docs: ndocs };
}

module.exports = { write };
