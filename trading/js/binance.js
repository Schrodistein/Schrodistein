/* Cliente de datos públicos de Binance (no necesita claves ni cuenta).
 *
 * - REST: velas, información del par, precios y estadísticas de 24 h.
 *   Se usa primero data-api.binance.vision (solo datos de mercado) y, si
 *   falla, los servidores principales de la API.
 * - WebSocket: velas en tiempo real con reconexión automática.
 * - Futuros (opcional): financiación, interés abierto y ratio
 *   largos/cortos, como indicadores de sentimiento.
 *
 * La app no envía órdenes: las alertas se ejecutan a mano en Binance. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  const REST = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api-gcp.binance.com'];
  const WS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];
  const FAPI = 'https://fapi.binance.com';
  let restIdx = 0;

  class ApiError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const query = (params) => {
    if (!params) return '';
    const q = Object.keys(params)
      .filter((k) => params[k] != null)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    return q ? '?' + q : '';
  };

  async function get(path, params) {
    let lastErr = null;
    for (let k = 0; k < REST.length; k++) {
      const idx = (restIdx + k) % REST.length;
      let res;
      try {
        res = await root.fetch(REST[idx] + path + query(params));
      } catch (e) {
        lastErr = e;
        continue;
      }
      if (res.ok) {
        restIdx = idx;
        return res.json();
      }
      let body = null;
      try {
        body = await res.json();
      } catch (e) {
        /* sin cuerpo JSON */
      }
      if (res.status === 429 || res.status === 418) throw new ApiError('Binance está limitando las peticiones: espera un minuto.', res.status);
      if (res.status === 400 && body && body.code != null) {
        if (body.code === -1121) throw new ApiError('Ese par no existe en Binance (revisa el símbolo, p. ej. EURUSDT).', body.code);
        throw new ApiError(body.msg || 'Petición rechazada por Binance.', body.code);
      }
      lastErr = new ApiError(res.status === 451 ? 'Binance no está disponible desde tu ubicación.' : 'Binance respondió con un error ' + res.status + '.', res.status);
    }
    throw lastErr instanceof ApiError ? lastErr : new ApiError('No se puede conectar con Binance. Revisa tu conexión a internet.', 0);
  }

  function parseKline(a, now) {
    return { t: a[0], o: +a[1], h: +a[2], l: +a[3], c: +a[4], v: +a[5], T: a[6], closed: a[6] < (now || Date.now()) };
  }
  function parseWsKline(k) {
    return { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, T: k.T, closed: !!k.x };
  }

  async function klines(symbol, interval, limit, endTime) {
    const rows = await get('/api/v3/klines', { symbol, interval, limit: limit || 500, endTime });
    const now = Date.now();
    return rows.map((r) => parseKline(r, now));
  }

  // Histórico largo: pagina hacia atrás de 1000 en 1000 velas.
  async function history(symbol, interval, total, onProgress) {
    let out = [];
    let end;
    while (out.length < total) {
      const want = Math.min(1000, total - out.length);
      const batch = await klines(symbol, interval, want, end);
      if (!batch.length) break;
      out = batch.concat(out);
      end = batch[0].t - 1;
      if (onProgress) onProgress(out.length, total);
      if (batch.length < want) break;
    }
    return out;
  }

  async function symbolInfo(symbol) {
    const data = await get('/api/v3/exchangeInfo', { symbol });
    const s = data.symbols && data.symbols[0];
    if (!s) throw new ApiError('Ese par no existe en Binance.', -1121);
    const f = (type) => (s.filters || []).find((x) => x.filterType === type) || {};
    const tick = f('PRICE_FILTER').tickSize;
    const notional = f('NOTIONAL').minNotional || f('MIN_NOTIONAL').minNotional;
    return {
      symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset, status: s.status,
      tickSize: +tick || null, stepSize: +f('LOT_SIZE').stepSize || null, minQty: +f('LOT_SIZE').minQty || null,
      minNotional: notional ? +notional : null,
      decimals: FX.util.decimalsFromTick(tick),
      qtyDecimals: FX.util.decimalsFromTick(f('LOT_SIZE').stepSize),
    };
  }

  // Todos los pares de contado en negociación: [{ symbol, base, quote }].
  async function exchangeInfoAll() {
    let data;
    try {
      data = await get('/api/v3/exchangeInfo', { permissions: 'SPOT', symbolStatus: 'TRADING' });
    } catch (e) {
      data = await get('/api/v3/exchangeInfo');
    }
    return (data.symbols || []).filter((s) => !s.status || s.status === 'TRADING').map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }));
  }

  // Estadísticas de 24 h de varios pares en una sola petición.
  async function tickers(list) {
    if (!list.length) return {};
    const rows = await get('/api/v3/ticker/24hr', { symbols: JSON.stringify(list), type: 'MINI' });
    const out = {};
    for (const r of rows) {
      const open = +r.openPrice;
      const last = +r.lastPrice;
      out[r.symbol] = { last, open, changePct: open ? (last / open - 1) * 100 : 0, quoteVolume: +r.quoteVolume };
    }
    return out;
  }

  async function symbols() {
    const rows = await get('/api/v3/ticker/price');
    return rows.map((r) => r.symbol).sort();
  }

  async function ticker24(symbol) {
    const r = await get('/api/v3/ticker/24hr', { symbol, type: 'MINI' });
    const open = +r.openPrice;
    const last = +r.lastPrice;
    return { symbol: r.symbol, last, open, high: +r.highPrice, low: +r.lowPrice, quoteVolume: +r.quoteVolume, changePct: open ? (last / open - 1) * 100 : 0 };
  }

  /* Sentimiento en futuros perpetuos (si el par existe allí). Devuelve null si no hay datos. */
  async function sentiment(symbol) {
    const j = async (path, params) => {
      const res = await root.fetch(FAPI + path + query(params));
      if (!res.ok) throw new ApiError('Sin datos de futuros', res.status);
      return res.json();
    };
    try {
      const [prem, oi, ls] = await Promise.all([
        j('/fapi/v1/premiumIndex', { symbol }),
        j('/futures/data/openInterestHist', { symbol, period: '1h', limit: 25 }).catch(() => []),
        j('/futures/data/globalLongShortAccountRatio', { symbol, period: '1h', limit: 1 }).catch(() => []),
      ]);
      const oiNow = oi.length ? +oi[oi.length - 1].sumOpenInterestValue : null;
      const oiPrev = oi.length ? +oi[0].sumOpenInterestValue : null;
      return {
        funding: +prem.lastFundingRate,
        nextFunding: prem.nextFundingTime,
        oiValue: oiNow,
        oiChangePct: oiNow && oiPrev ? (oiNow / oiPrev - 1) * 100 : null,
        longShort: ls.length ? +ls[0].longShortRatio : null,
        longPct: ls.length ? +ls[0].longAccount * 100 : null,
      };
    } catch (e) {
      return null;
    }
  }

  /* Velas en tiempo real. onStatus recibe 'connecting' | 'live' | 'retry'. */
  function stream(symbol, interval, onKline, onStatus) {
    if (!root.WebSocket) return null;
    const name = symbol.toLowerCase() + '@kline_' + interval;
    let ws = null;
    let closed = false;
    let attempt = 0;
    let host = 0;
    let timer = null;
    const status = (s) => onStatus && onStatus(s);
    function open() {
      status('connecting');
      try {
        ws = new root.WebSocket(WS[host % WS.length] + '/ws/' + name);
      } catch (e) {
        return retry();
      }
      ws.onopen = () => {
        attempt = 0;
        status('live');
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (m && m.k) onKline(parseWsKline(m.k));
      };
      ws.onclose = () => {
        if (!closed) retry();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch (e) {
          /* ya cerrado */
        }
      };
    }
    function retry() {
      attempt++;
      if (attempt % 2 === 0) host++;
      status('retry');
      clearTimeout(timer);
      timer = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
    }
    open();
    return {
      close() {
        closed = true;
        clearTimeout(timer);
        if (ws) {
          ws.onclose = null;
          try {
            ws.close();
          } catch (e) {
            /* ya cerrado */
          }
        }
      },
    };
  }

  // Enlace para operar el par en la web de Binance.
  function tradeUrl(info, symbol, futures) {
    if (futures) return 'https://www.binance.com/es/futures/' + symbol;
    if (info && info.base && info.quote) return 'https://www.binance.com/es/trade/' + info.base + '_' + info.quote + '?type=spot';
    return 'https://www.binance.com/es/markets/overview';
  }

  FX.binance = { REST, WS, ApiError, get, parseKline, parseWsKline, klines, history, symbolInfo, symbols, exchangeInfoAll, tickers, ticker24, sentiment, stream, tradeUrl };
})(typeof globalThis !== 'undefined' ? globalThis : this);
