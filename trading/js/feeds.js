/* Fuentes de datos con una interfaz común, para que el análisis funcione
 * igual con criptomonedas y con divisas:
 *
 *   binance     pares de Binance (criptos y monedas estables frente a monedas
 *               nacionales), velas en directo por WebSocket. Sin clave.
 *   twelvedata  divisas reales (EUR/USD, USD/JPY, XAU/USD…) con velas OHLC
 *               intradía. Requiere una clave gratuita de twelvedata.com.
 *   ecb         tipos de referencia diarios del Banco Central Europeo
 *               (vía Frankfurter): ~30 divisas desde 1999. Sin clave.
 *   calendar    calendario económico semanal (Forex Factory).
 *
 * Cada fuente expone: intervals, klines(), history(), info(), stream(),
 * ticker() (opcional) y tradeUrl(). */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});
  const U = FX.util;
  const F = FX.forex;
  const ApiError = FX.binance.ApiError;

  const query = (params) => {
    const q = Object.keys(params || {})
      .filter((k) => params[k] != null && params[k] !== '')
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    return q ? '?' + q : '';
  };
  async function getJSON(url, what) {
    let res;
    try {
      res = await root.fetch(url);
    } catch (e) {
      throw new ApiError(`No se puede conectar con ${what}. Revisa tu conexión a internet.`, 0);
    }
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* sin JSON */
    }
    if (!res.ok && !(body && body.status === 'error')) throw new ApiError(`${what} respondió con un error ${res.status}.`, res.status);
    return body;
  }

  // Sondeo periódico para las fuentes sin WebSocket: entrega las últimas velas a onKline.
  function poll(fetchLast, periodMs, onKline, onStatus) {
    let timer = null;
    let stopped = false;
    const run = async () => {
      if (stopped) return;
      try {
        const ks = await fetchLast();
        if (stopped) return;
        ks.forEach(onKline);
        onStatus && onStatus('poll');
      } catch (e) {
        onStatus && onStatus('retry');
      }
      timer = setTimeout(run, typeof periodMs === 'function' ? periodMs() : periodMs);
    };
    timer = setTimeout(run, typeof periodMs === 'function' ? periodMs() : periodMs);
    onStatus && onStatus('poll');
    return { close() { stopped = true; clearTimeout(timer); } };
  }

  /* ---------- Binance ---------- */
  const B = FX.binance;
  const binance = {
    id: 'binance', label: 'Binance', live: true,
    intervals: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w'],
    klines: (s, iv, n, end) => B.klines(s, iv, n, end),
    history: (s, iv, n, cb) => B.history(s, iv, n, cb),
    info: (s) => B.symbolInfo(s),
    ticker: (s) => B.ticker24(s),
    stream: (s, iv, onK, onS) => B.stream(s, iv, onK, onS),
    tradeUrl: (info, s, futures) => B.tradeUrl(info, s, futures),
  };

  /* ---------- Twelve Data ---------- */
  const TD_URL = 'https://api.twelvedata.com';
  const TD_IV = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1day', '1w': '1week' };
  const tdTime = (s) => Date.parse(s.length <= 10 ? s + 'T00:00:00Z' : s.replace(' ', 'T') + 'Z');
  const tdStamp = (t) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

  function parseTwelve(body, interval, now) {
    if (!body || body.status === 'error') {
      const code = body && body.code;
      const msg = (body && body.message) || 'Error desconocido';
      if (code === 401 || /api ?key/i.test(msg)) throw new ApiError('La clave de Twelve Data no es válida. Revísala en Ajustes.', 401);
      if (code === 429) throw new ApiError('Has agotado los créditos de Twelve Data por ahora (plan gratuito: 8 por minuto y 800 al día). Espera un poco o usa una temporalidad mayor.', 429);
      if (code === 400 && /symbol/i.test(msg)) throw new ApiError('Twelve Data no reconoce ese par.', -1121);
      throw new ApiError('Twelve Data: ' + msg, code || 0);
    }
    const step = U.INTERVALS[interval];
    now = now || Date.now();
    return (body.values || []).map((v) => {
      const t = tdTime(v.datetime);
      return { t, o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0), T: t + step - 1, closed: t + step <= now };
    }).sort((a, b) => a.t - b.t);
  }

  function twelvedata(key) {
    const get = (path, params) => getJSON(TD_URL + path + query(Object.assign({ apikey: key }, params)), 'Twelve Data');
    const series = async (s, iv, n, end) => parseTwelve(await get('/time_series', { symbol: s, interval: TD_IV[iv], outputsize: Math.min(5000, n), timezone: 'UTC', order: 'ASC', end_date: end ? tdStamp(end) : null }), iv);
    return {
      id: 'twelvedata', label: 'Twelve Data', live: false,
      intervals: Object.keys(TD_IV),
      klines: (s, iv, n, end) => series(s, iv, n || 500, end),
      async history(s, iv, total, cb) {
        let out = [];
        let end = null;
        while (out.length < total) {
          const want = Math.min(5000, total - out.length);
          const batch = await series(s, iv, want, end);
          if (!batch.length) break;
          out = batch.filter((k) => !out.length || k.t < out[0].t).concat(out);
          end = batch[0].t - 1000;
          if (cb) cb(out.length, total);
          if (batch.length < want) break;
        }
        return out;
      },
      async info(s) {
        const { base, quote } = F.split(s);
        return { symbol: s, base, quote, forex: true, pip: F.pipSize(s), decimals: F.decimals(s), qtyDecimals: 0 };
      },
      async ticker(s) {
        const q = await get('/quote', { symbol: s });
        if (q && q.status === 'error') return null;
        const last = +q.close;
        const prev = +q.previous_close;
        return { symbol: s, last, open: prev, high: +q.high, low: +q.low, quoteVolume: NaN, changePct: prev ? (last / prev - 1) * 100 : 0 };
      },
      // Sin WebSocket en el plan gratuito: se sondea al cerrar cada vela y cada pocos minutos.
      stream(s, iv, onK, onS) {
        const step = U.INTERVALS[iv];
        const period = () => {
          if (!F.marketOpen(new Date())) return 30 * 60e3;
          const toClose = step - (Date.now() % step) + 8000;
          return Math.min(toClose, Math.max(60e3, Math.min(300e3, step / 4)));
        };
        return poll(() => series(s, iv, 3), period, onK, onS);
      },
      tradeUrl: (info, s) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent('FX:' + s.replace('/', '')),
    };
  }

  /* ---------- BCE (Frankfurter) ---------- */
  const ECB_URLS = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app'];
  const ECB_CCY = ['AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR'];
  const day = (t) => new Date(t).toISOString().slice(0, 10);

  async function frankfurter(path, params) {
    let last;
    for (const base of ECB_URLS) {
      try {
        const body = await getJSON(base + path + query(params), 'el BCE (Frankfurter)');
        if (body && body.rates) return body;
        last = new ApiError((body && body.message) || 'Respuesta inesperada del BCE.', 0);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  // Serie diaria de tasas con base EUR: [{ date, t, rates }]
  async function ecbSeries(fromDate, toDate, symbols) {
    const body = await frankfurter('/' + day(fromDate) + '..' + (toDate ? day(toDate) : ''), { base: 'EUR', symbols: symbols ? symbols.join(',') : null });
    return Object.keys(body.rates).sort().map((d) => ({ date: d, t: Date.parse(d + 'T00:00:00Z'), rates: body.rates[d] }));
  }

  // Fijaciones diarias → velas (apertura = fijación anterior; sin mechas ni volumen).
  function fixingsToCandles(series, pair) {
    const out = [];
    let prev = null;
    for (const d of series) {
      const c = F.pairPrice(pair, d.rates);
      if (!(c > 0)) continue;
      const o = prev == null ? c : prev;
      out.push({ t: d.t, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 0, T: d.t + 86400e3 - 1, closed: true });
      prev = c;
    }
    return out;
  }
  // Velas diarias → semanales (semana de lunes a domingo).
  function weekly(daily, now) {
    const W = 7 * 86400e3;
    const out = [];
    for (const k of daily) {
      const s = Math.floor((k.t + 3 * 86400e3) / W) * W - 3 * 86400e3;
      const w = out[out.length - 1];
      if (w && w.t === s) {
        w.h = Math.max(w.h, k.h);
        w.l = Math.min(w.l, k.l);
        w.c = k.c;
      } else out.push({ t: s, o: k.o, h: k.h, l: k.l, c: k.c, v: 0, T: s + W - 1 });
    }
    now = now || Date.now();
    out.forEach((w) => (w.closed = w.T < now));
    return out;
  }

  const ecb = {
    id: 'ecb', label: 'BCE (diario)', live: false,
    intervals: ['1d', '1w'],
    supports: (s) => {
      if (!F.isForex(s)) return false;
      const { base, quote } = F.split(s);
      return ECB_CCY.includes(base) && ECB_CCY.includes(quote);
    },
    async klines(s, iv, n, end) {
      const { base, quote } = F.split(s);
      const endT = end || Date.now();
      // ~252 fijaciones por año: se pide algo más de lo necesario, por tramos de un año.
      const days = Math.ceil((iv === '1w' ? n * 7 : n * 1.45) + 10);
      const series = [];
      // Tramos de menos de un año: con rangos largos el servicio podría devolver datos semanales.
      for (let to = endT; to > endT - days * 86400e3; to -= 361 * 86400e3) {
        const from = Math.max(endT - days * 86400e3, to - 360 * 86400e3);
        const part = await ecbSeries(from, to, [base, quote].filter((c) => c !== 'EUR'));
        series.unshift(...part.filter((d) => !series.length || d.t < series[0].t));
      }
      let C = fixingsToCandles(series, s);
      if (iv === '1w') C = weekly(C);
      return C.slice(-n);
    },
    history(s, iv, total) {
      return ecb.klines(s, iv, total);
    },
    async info(s) {
      const { base, quote } = F.split(s);
      return { symbol: s, base, quote, forex: true, pip: F.pipSize(s), decimals: quote === 'JPY' ? 2 : 4, qtyDecimals: 0 };
    },
    stream(s, iv, onK, onS) {
      return poll(async () => (await ecb.klines(s, iv, 3)), 30 * 60e3, onK, onS);
    },
    tradeUrl: (info, s) => 'https://www.tradingview.com/chart/?symbol=' + encodeURIComponent('FX:' + s.replace('/', '')),
    series: ecbSeries,
    latest: async () => (await frankfurter('/latest', { base: 'EUR' })).rates,
    fixingsToCandles, weekly, CURRENCIES: ECB_CCY,
  };

  // Serie larga del BCE (todas las divisas si symbols es null), pedida por tramos de menos de un año.
  async function ecbRange(days, symbols, endT) {
    endT = endT || Date.now();
    const start = endT - days * 86400e3;
    const out = [];
    for (let to = endT; to > start; to -= 361 * 86400e3) {
      const from = Math.max(start, to - 360 * 86400e3);
      const part = await ecbSeries(from, to, symbols);
      out.unshift(...part.filter((d) => !out.length || d.t < out[0].t));
    }
    return out;
  }
  ecb.range = ecbRange;

  // Catálogo de pares de divisas de Twelve Data (datos de referencia).
  async function tdForexPairs(key) {
    const body = await getJSON(TD_URL + '/forex_pairs' + query({ apikey: key || null }), 'Twelve Data');
    if (!body || !Array.isArray(body.data)) throw new ApiError((body && body.message) || 'Twelve Data no devolvió la lista de pares.', (body && body.code) || 0);
    return body.data.map((d) => d.symbol).filter((x) => /^[A-Z]{3}\/[A-Z]{3}$/.test(x));
  }

  /* ---------- Noticias (RSS/Atom) ---------- */
  const NEWS = [
    { id: 'fed', name: 'Reserva Federal', url: 'https://www.federalreserve.gov/feeds/press_all.xml', ccy: ['USD'] },
    { id: 'ecb', name: 'BCE', url: 'https://www.ecb.europa.eu/rss/press.html', ccy: ['EUR'] },
    { id: 'boe', name: 'Banco de Inglaterra', url: 'https://www.bankofengland.co.uk/rss/news', ccy: ['GBP'] },
    { id: 'boj', name: 'Banco de Japón', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', ccy: ['JPY'] },
    { id: 'fxstreet', name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news', ccy: [] },
  ];
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  }).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  // Lee RSS 2.0, RSS 1.0 (RDF) y Atom sin depender del navegador.
  function parseFeed(xml, src) {
    const items = [];
    const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
    for (const b of blocks.slice(0, 40)) {
      const tag = (name) => {
        const m = b.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i'));
        return m ? decode(m[1]) : '';
      };
      const title = tag('title');
      let link = tag('link');
      if (!link) {
        const m = b.match(/<link[^>]*href="([^"]+)"/i);
        link = m ? m[1] : '';
      }
      const date = Date.parse(tag('pubDate') || tag('dc:date') || tag('updated') || tag('published'));
      if (title && /^https?:\/\//.test(link)) items.push({ title, link, t: Number.isFinite(date) ? date : null, source: src.name, ccy: src.ccy });
    }
    return items;
  }
  const news = {
    SOURCES: NEWS,
    parseFeed,
    async load() {
      const status = {};
      const lists = await Promise.all(NEWS.map(async (src) => {
        try {
          const res = await root.fetch(src.url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const items = parseFeed(await res.text(), src);
          status[src.id] = items.length ? 'ok' : 'vacío';
          return items;
        } catch (e) {
          status[src.id] = 'error';
          return [];
        }
      }));
      const items = [].concat(...lists).sort((a, b) => (b.t || 0) - (a.t || 0));
      return { items, status };
    },
  };

  /* ---------- Calendario económico ---------- */
  const CAL_URLS = ['https://nfs.faireconomy.media/ff_calendar_thisweek.json'];
  const calendar = {
    async week() {
      let last;
      for (const url of CAL_URLS) {
        try {
          const rows = await getJSON(url, 'el calendario económico');
          if (Array.isArray(rows)) return rows;
        } catch (e) {
          last = e;
        }
      }
      throw last || new ApiError('Calendario no disponible.', 0);
    },
  };

  /* Elige la fuente para un símbolo. Con divisas se usa Twelve Data si hay
   * clave; si no, el BCE (solo diario y semanal). */
  function pick(symbol, opts) {
    opts = opts || {};
    if (!F.isForex(symbol)) return binance;
    if (opts.tdKey) return twelvedata(opts.tdKey);
    if (ecb.supports(symbol)) return ecb;
    return null;
  }

  FX.feeds = { binance, twelvedata, ecb, calendar, news, pick, parseTwelve, poll, tdForexPairs, TD_IV };
})(typeof globalThis !== 'undefined' ? globalThis : this);
