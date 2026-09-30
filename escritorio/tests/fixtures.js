/* Respuestas grabadas con la forma de las reales, para probar sin red. */
'use strict';
const fs = require('fs');
const path = require('path');

// Gráfico de Yahoo: días hábiles, cierre a las 14:00 de Bogotá (UTC−5), con un día sin cierre.
function yahooChart(symbol, start, days, p0, seed) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const ts = [];
  const close = [];
  let p = p0;
  const d = new Date(Date.UTC(...start));
  while (ts.length < days) {
    if (d.getUTCDay() % 6) {
      ts.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 19, 0) / 1000);
      p *= 1 + (rnd() - 0.48) * 0.03;
      close.push(ts.length === 5 ? null : Math.round(p * 100) / 100);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { chart: { result: [{ meta: { currency: 'COP', symbol, exchangeName: 'BVC', gmtoffset: -18000, exchangeTimezoneName: 'America/Bogota' }, timestamp: ts, indicators: { quote: [{ close }], adjclose: [{ adjclose: close }] } }], error: null } };
}

const NEWS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>"Ecopetrol" - Google Noticias</title>
<item><title>Ecopetrol reporta utilidades de $3,2 billones en el trimestre - Portafolio</title><link>https://news.google.com/rss/articles/abc1</link><guid isPermaLink="false">abc1</guid><pubDate>Mon, 28 Sep 2026 14:05:00 GMT</pubDate><description>&lt;a href="https://news.google.com/rss/articles/abc1"&gt;Ecopetrol reporta&lt;/a&gt;</description><source url="https://www.portafolio.co">Portafolio</source></item>
<item><title><![CDATA[Acciones de Grupo Cibest & PF Cibest suben 3 % - La República]]></title><link>https://news.google.com/rss/articles/abc2</link><pubDate>Tue, 29 Sep 2026 11:00:00 GMT</pubDate><source url="https://www.larepublica.co">La República</source></item>
<item><title>El COLCAP cierra en m&#225;ximos del a&#241;o - Valora Analitik</title><link>https://news.google.com/rss/articles/abc3</link><pubDate>Tue, 29 Sep 2026 22:30:00 GMT</pubDate><source url="https://www.valoraanalitik.com">Valora Analitik</source></item>
</channel></rss>`;

const BVC_CSV =
  '﻿Fecha;Nemotécnico;Precio cierre;Precio máximo;Precio promedio ponderado;Precio mínimo;Variación absoluta;Variación porcentual;Cantidad;Volumen\r\n' +
  '2026-08-13;ECOPETROL;2,700.00;2,720.00;2,705.00;2,690.00;10.00;0.37;1,000.00;2,700,000.00\r\n' +
  '2026-08-14;ECOPETROL;2,745.00;2,750.00;2,730.00;2,700.00;45.00;1.67;1,000.00;2,745,000.00\r\n' +
  '2026-08-17;ECOPETROL;;;;;;;;\r\n' +
  '2026-08-18;ECOPETROL;2,770.00;2,780.00;2,760.00;2,740.00;25.00;0.91;1,000.00;2,770,000.00\r\n';

function writeAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(dir, f), typeof o === 'string' ? o : JSON.stringify(o));
  w('yahoo-ECOPETROL.CL.json', yahooChart('ECOPETROL.CL', [2025, 0, 2], 400, 2300, 3));
  w('yahoo-ICOLCAP.CL.json', yahooChart('ICOLCAP.CL', [2025, 0, 2], 400, 14000, 5));
  w('yahoo-PFGRUPSURA.CL.json', yahooChart('PFGRUPSURA.CL', [2025, 0, 2], 400, 30000, 7));
  w('yahoo-TERPEL.CL.json', yahooChart('TERPEL.CL', [2025, 0, 2], 400, 12000, 11));
  w('yahoo-PFCIBEST.CL.json', yahooChart('PFCIBEST.CL', [2025, 0, 2], 400, 45000, 13));
  w('news.xml', NEWS);
  w('ECOPETROL_20260908_045259.csv', BVC_CSV);
  return dir;
}

module.exports = { yahooChart, NEWS, BVC_CSV, writeAll };
