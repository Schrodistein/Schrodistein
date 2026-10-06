/* Descarga directa de los históricos de la BVC, aprendida de una descarga hecha a mano.
 *
 * La BVC no publica una conexión abierta para aplicaciones. Su sitio sí pide los históricos a un
 * servicio propio cuando el usuario pulsa «Descargar». La app observa esa petición la primera vez
 * (en la ventana de la BVC que abre la propia app): guarda la dirección como plantilla, cambiando
 * el nemotécnico por {NEMO} y las fechas por {DESDE} y {HASTA}. Después repite la misma petición
 * para cada acción y ETF en tramos de 6 meses, y para cada índice en tramos trimestrales (los máximos
 * que entrega la BVC por descarga), y une los
 * tramos en el historial de cada activo. Así la descarga es directa desde la BVC, sin otra fuente.
 *
 * Dos formas de respuesta: un archivo (CSV o Excel, como la descarga manual) o datos JSON que el
 * sitio convierte en archivo en el navegador. Los dos se leen con el mismo lector de la app. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/* Fechas dentro de una dirección: aaaa-mm-dd, dd/mm/aaaa (también codificada %2F) y aaaammdd. */
const DATE_RES = [
  { re: /(\d{4})-(\d{2})-(\d{2})/g, fmt: 'iso', parse: (m) => [m[1], m[2], m[3]] },
  { re: /(\d{2})(?:\/|%2F)(\d{2})(?:\/|%2F)(\d{4})/gi, fmt: 'dmy', parse: (m) => [m[3], m[2], m[1]] },
  { re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g, fmt: 'ymd', parse: (m) => [m[1], m[2], m[3]] },
];
const validDate = (y, mo, d) => +y >= 1990 && +y <= 2100 && +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31;

function formatDate(d, fmt, enc) {
  const [y, m, dd] = d.split('-');
  if (fmt === 'dmy') return `${dd}${enc ? '%2F' : '/'}${m}${enc ? '%2F' : '/'}${y}`;
  if (fmt === 'ymd') return `${y}${m}${dd}`;
  return d;
}

/* Convierte una dirección real en plantilla: nemotécnico → {NEMO}, fechas → {DESDE}/{HASTA}. */
function learnTemplate(url, nemo) {
  if (!url || !/^https?:\/\//i.test(url) || !nemo) return null;
  const variants = [nemo, encodeURIComponent(nemo), nemo.replace(/\s+/g, '+')];
  let tpl = url;
  let hit = false;
  for (const v of variants) {
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(tpl)) {
      tpl = tpl.replace(re, '{NEMO}');
      hit = true;
    }
  }
  if (!hit) return null;
  let fmt = null;
  let enc = false;
  const found = [];
  for (const D of DATE_RES) {
    for (const m of tpl.matchAll(D.re)) {
      const [y, mo, d] = D.parse(m);
      if (validDate(y, mo, d)) found.push({ text: m[0], date: `${y}-${mo}-${d}`, fmt: D.fmt, enc: /%2F/i.test(m[0]) });
    }
    if (found.length) {
      fmt = D.fmt;
      enc = found[0].enc;
      break;
    }
  }
  if (found.length >= 2) {
    found.sort((a, b) => (a.date < b.date ? -1 : 1));
    tpl = tpl.replace(found[0].text, '{DESDE}').replace(found[found.length - 1].text, '{HASTA}');
  } else if (found.length === 1) tpl = tpl.replace(found[0].text, '{HASTA}');
  return { url: tpl, fmt, enc, dates: found.length };
}

function fill(t, nemo, from, to) {
  return t.url
    .replace(/\{NEMO\}/g, encodeURIComponent(nemo))
    .replace('{DESDE}', formatDate(from, t.fmt, t.enc))
    .replace('{HASTA}', formatDate(to, t.fmt, t.enc));
}

/* Tramos de 6 meses hacia atrás desde hoy (o desde la última fecha guardada hacia hoy). */
function windows(today, since, months) {
  const out = [];
  let end = new Date(Date.parse(today));
  const stop = since ? Date.parse(since) : Date.parse('2010-01-01');
  while (end.getTime() > stop) {
    const start = new Date(end.getTime());
    start.setUTCMonth(start.getUTCMonth() - (months || 6));
    start.setUTCDate(start.getUTCDate() + 1);
    const s = start.getTime() < stop ? new Date(stop) : start;
    out.push([iso(s), iso(end)]);
    end = new Date(s.getTime() - 864e5);
  }
  return out;
}

/* JSON → tabla CSV: busca el arreglo de registros con fecha y números (en cualquier nivel). */
function jsonToCsv(json) {
  const arrays = [];
  (function walk(x, depth) {
    if (depth > 6 || x == null) return;
    if (Array.isArray(x)) {
      if (x.length && x.every((r) => r && typeof r === 'object' && !Array.isArray(r))) arrays.push(x);
      else x.forEach((v) => walk(v, depth + 1));
    } else if (typeof x === 'object') Object.values(x).forEach((v) => walk(v, depth + 1));
  })(json, 0);
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{4}/.test(v);
  const best = arrays
    .filter((a) => Object.values(a[0]).some(isDate))
    .sort((a, b) => b.length - a.length)[0];
  if (!best) return null;
  const keys = [...new Set(best.flatMap((r) => Object.keys(r)))];
  // camelCase → palabras, para que el lector reconozca «tradeDate», «closingPrice», «volume»…
  const label = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  const cell = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v).replace(/[;\r\n]+/g, ' '));
  return [keys.map(label).join(';')].concat(best.map((r) => keys.map((k) => cell(r[k])).join(';'))).join('\n');
}

/* Descarga todos los activos con la plantilla aprendida. fetch: el de la sesión de la ventana de
 * la BVC (con sus cookies). importFiles: el lector de la app. Devuelve el resumen por activo. */
async function downloadAll(opts) {
  const { template, nemos, fetch, importFile, lastDate, today, log, delay } = opts;
  // Meses por tramo: 6 para acciones y ETF; los índices (MSCI COLCAP, COLTES, COLIBR…) se descargan por trimestre
  const months = opts.monthsFor || (() => 6);
  const out = { assets: {}, errors: [], requests: 0 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-bvc-'));
  try {
    for (const nemo of nemos) {
      const since = lastDate ? lastDate(nemo) : null;
      const list = template.dates ? windows(today || iso(new Date()), since, months(nemo)) : [[null, null]];
      let empty = 0;
      let added = 0;
      for (const [from, to] of list) {
        out.requests++;
        try {
          const res = await fetch(fill(template, nemo, from || today, to || today));
          if (!res.ok) throw new Error(`la BVC respondió ${res.status}`);
          const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          let text = null;
          let file = path.join(tmp, `${nemo.replace(/[\\/:*?"<>|]+/g, '-')}.csv`);
          if (/json/i.test(type)) text = jsonToCsv(await res.json());
          else if (/sheet|excel|octet/i.test(type)) {
            file = path.join(tmp, `${nemo.replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`);
            fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
          } else {
            text = await res.text();
            if (/^\s*[[{]/.test(text)) text = jsonToCsv(JSON.parse(text));
          }
          if (text != null) fs.writeFileSync(file, text);
          const r = text === null && !fs.existsSync(file) ? { assets: {} } : importFile(file, nemo);
          const n = Object.values(r.assets || {}).reduce((a, x) => a + x, 0);
          added += n;
          empty = n ? 0 : empty + 1;
        } catch (e) {
          empty++;
          if (log) log(`BVC ${nemo} ${from}–${to}: ${e.message}`);
        }
        // Dos tramos seguidos sin datos: el activo no tiene historia más atrás
        if (empty >= 2) break;
        if (delay) await new Promise((ok) => setTimeout(ok, delay));
      }
      if (added) out.assets[nemo] = added;
      else out.errors.push(nemo);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

module.exports = { learnTemplate, fill, windows, jsonToCsv, downloadAll, formatDate };
