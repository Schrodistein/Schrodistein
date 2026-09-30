/* Fuentes de internet de la app de escritorio.
 *   Cierres diarios: API de gráficos de Yahoo Finance (símbolos de la BVC con sufijo .CL).
 *     La BVC no publica una API abierta; sus descargas oficiales se capturan aparte
 *     (ventana de la BVC o importación de archivos) y tienen prioridad sobre esta fuente.
 *   Noticias: búsqueda de Google News en RSS, en español para Colombia.
 * Todas las funciones reciben `fetch` para poder probarlas sin red. */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function yahooUrl(symbol, range) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includeAdjustedClose=true&events=div%2Csplit`;
}

/* Respuesta del gráfico de Yahoo → { dates, prices, currency }. La fecha es la del
 * mercado (se suma el desfase horario de la bolsa) y se omiten los días sin cierre. */
function parseYahoo(json, symbol) {
  const ch = json && json.chart;
  if (!ch) throw new Error(`Respuesta inesperada para ${symbol}.`);
  if (ch.error) {
    if (/not ?found|no data/i.test(`${ch.error.code} ${ch.error.description}`)) throw new Error(`La fuente automática no encontró el símbolo ${symbol}.`);
    throw new Error(`La fuente automática respondió con un error para ${symbol}: ${ch.error.description || ch.error.code}.`);
  }
  const r = ch.result && ch.result[0];
  if (!r || !r.timestamp) throw new Error(`Yahoo no tiene precios para ${symbol}.`);
  const off = (r.meta && r.meta.gmtoffset) || 0;
  const close = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  const dates = [];
  const prices = [];
  r.timestamp.forEach((t, i) => {
    const p = close[i];
    if (p == null || !(p > 0)) return;
    const d = new Date((t + off) * 1000).toISOString().slice(0, 10);
    if (dates.length && dates[dates.length - 1] === d) {
      prices[prices.length - 1] = p; // el último dato del día manda
      return;
    }
    dates.push(d);
    prices.push(Math.round(p * 1e6) / 1e6);
  });
  return { dates, prices, currency: r.meta && r.meta.currency };
}

async function fetchYahoo(fetch, symbol, range) {
  const res = await fetch(yahooUrl(symbol, range), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    /* cuerpo no JSON */
  }
  if (!res.ok && !(json && json.chart && json.chart.error)) throw new Error(`Yahoo respondió ${res.status} para ${symbol}.`);
  return parseYahoo(json, symbol);
}

function newsUrl(query, days) {
  const q = `${query} when:${days || 7}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=CO&ceid=CO:es-419`;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

/* RSS de Google News → [{ title, link, source, date }]. El título trae « - Medio» al final. */
function parseRss(xml, asset) {
  const out = [];
  const items = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const it of items) {
    const source = decode(tag(it, 'source'));
    let title = decode(tag(it, 'title'));
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    const link = decode(tag(it, 'link'));
    const pub = decode(tag(it, 'pubDate'));
    const t = Date.parse(pub);
    if (!title || !link) continue;
    out.push({ asset, title, link, source, date: Number.isFinite(t) ? new Date(t).toISOString() : '' });
  }
  return out;
}

async function fetchNews(fetch, query, asset, days) {
  const res = await fetch(newsUrl(query, days), { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml' } });
  if (!res.ok) throw new Error(`Google News respondió ${res.status}.`);
  return parseRss(await res.text(), asset);
}

module.exports = { yahooUrl, parseYahoo, fetchYahoo, newsUrl, parseRss, fetchNews, decode };
