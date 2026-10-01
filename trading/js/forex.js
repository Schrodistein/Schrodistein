/* Herramientas propias del mercado de divisas: identificación de pares,
 * pips y lotes, sesiones de negociación, fuerza relativa de las divisas,
 * correlaciones y lectura del calendario económico. Sin red: los datos
 * llegan desde feeds.js. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  // Divisas reconocidas en formato AAA/BBB (más oro y plata).
  const CURRENCIES = [
    'USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'ISK', 'TRY',
    'ZAR', 'MXN', 'BRL', 'CNY', 'CNH', 'HKD', 'SGD', 'KRW', 'INR', 'IDR', 'MYR', 'PHP', 'THB', 'ILS', 'XAU', 'XAG',
  ];
  const MAJORS = ['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD'];
  const PAIRS = [
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'NZD/USD',
    'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'EUR/CHF', 'AUD/JPY', 'EUR/AUD', 'GBP/CHF', 'CAD/JPY', 'CHF/JPY', 'EUR/CAD', 'AUD/NZD',
    'USD/MXN', 'USD/TRY', 'USD/ZAR', 'USD/BRL', 'USD/PLN', 'USD/SEK', 'USD/NOK', 'XAU/USD', 'XAG/USD',
  ];
  const NAMES = {
    USD: 'dólar estadounidense', EUR: 'euro', JPY: 'yen', GBP: 'libra', CHF: 'franco suizo', CAD: 'dólar canadiense', AUD: 'dólar australiano',
    NZD: 'dólar neozelandés', XAU: 'oro', XAG: 'plata', MXN: 'peso mexicano', TRY: 'lira turca', BRL: 'real brasileño', ZAR: 'rand',
  };

  /* Normaliza lo que escribe el usuario. Devuelve { symbol, forex }:
   * "eurusd", "EUR-USD" o "eur/usd" → "EUR/USD" (divisas);
   * "EURUSDT" o "btcusdt" → par de Binance. */
  function normalize(input) {
    const raw = String(input || '').toUpperCase().trim();
    const m = raw.match(/^([A-Z]{3})\s*[/\-_ ]?\s*([A-Z]{3})$/);
    if (m && CURRENCIES.includes(m[1]) && CURRENCIES.includes(m[2]) && m[1] !== m[2]) return { symbol: m[1] + '/' + m[2], forex: true };
    return { symbol: raw.replace(/[^A-Z0-9]/g, ''), forex: false };
  }
  const isForex = (s) => /^[A-Z]{3}\/[A-Z]{3}$/.test(s);
  function split(s) {
    const [base, quote] = s.split('/');
    return { base, quote };
  }

  // Divisas que mueven un par de Binance (las monedas estables siguen al dólar).
  function currenciesOf(symbol) {
    if (isForex(symbol)) {
      const { base, quote } = split(symbol);
      return [base, quote];
    }
    const out = new Set();
    const stable = /(USDT|USDC|FDUSD|BUSD|TUSD|USDP|DAI)/;
    if (stable.test(symbol)) out.add('USD');
    if (/PAXG|XAUT/.test(symbol)) out.add('XAU');
    for (const c of ['EUR', 'TRY', 'BRL', 'ARS', 'MXN', 'JPY', 'GBP', 'PLN', 'ZAR', 'UAH', 'COP', 'RON', 'CZK']) {
      if (symbol.startsWith(c) || symbol.endsWith(c)) out.add(c);
    }
    return Array.from(out);
  }

  /* ---------- Pips y lotes ---------- */
  function pipSize(symbol) {
    const { base, quote } = isForex(symbol) ? split(symbol) : { base: '', quote: '' };
    if (base === 'XAU') return 0.1;
    if (base === 'XAG') return 0.01;
    if (quote === 'JPY' || quote === 'HUF' || quote === 'KRW' || quote === 'IDR') return 0.01;
    return 0.0001;
  }
  const decimals = (symbol) => Math.max(0, Math.round(-Math.log10(pipSize(symbol)))) + 1;
  const LOT = 100000;

  // Tasas del BCE (unidades por 1 EUR) → convierte importes entre divisas.
  function convert(amount, from, to, rates) {
    if (from === to) return amount;
    if (!rates) return NaN;
    const r = (c) => (c === 'EUR' ? 1 : rates[c]);
    if (!(r(from) > 0) || !(r(to) > 0)) return NaN;
    return (amount / r(from)) * r(to);
  }

  /* Tamaño en divisas: riesgo en la divisa de la cuenta → unidades, lotes y
   * valor del pip. El precio del par expresa la divisa cotizada por unidad
   * de la base, así que el riesgo se pasa primero a la divisa cotizada. */
  function lotSize(p) {
    const { base, quote } = split(p.symbol);
    const dist = Math.abs(p.entry - p.stop);
    if (!(dist > 0)) return null;
    const pip = pipSize(p.symbol);
    const riskAcc = (p.capital * p.riskPct) / 100;
    // Si la cuenta va en la divisa base, 1 unidad de cotizada vale 1/precio.
    const toQuote = p.account === quote ? 1 : p.account === base ? p.entry : convert(1, p.account, quote, p.rates);
    if (!(toQuote > 0)) return { error: `No hay tipo de cambio para pasar de ${p.account} a ${quote}.` };
    const units = (riskAcc * toQuote) / dist;
    const pipQuote = units * pip;
    return {
      units, lots: units / LOT, pips: dist / pip, riskAcc,
      pipValue: pipQuote / toQuote, pipValueLot: (LOT * pip) / toQuote,
      notional: (units * p.entry) / toQuote, account: p.account,
    };
  }

  /* ---------- Sesiones ---------- */
  const SESSIONS = [
    { id: 'sydney', name: 'Sídney', tz: 'Australia/Sydney', open: 7, close: 16 },
    { id: 'tokyo', name: 'Tokio', tz: 'Asia/Tokyo', open: 9, close: 18 },
    { id: 'london', name: 'Londres', tz: 'Europe/London', open: 8, close: 17 },
    { id: 'newyork', name: 'Nueva York', tz: 'America/New_York', open: 8, close: 17 },
  ];
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const fmtCache = {};
  function local(date, tz) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }));
    const parts = {};
    for (const x of f.formatToParts(date)) parts[x.type] = x.value;
    return { wd: WD[parts.weekday], min: (+parts.hour % 24) * 60 + +parts.minute };
  }
  // El mercado de divisas abre el domingo a las 17:00 de Nueva York y cierra el viernes a la misma hora.
  function marketOpen(date) {
    const ny = local(date, 'America/New_York');
    if (ny.wd === 6) return false;
    if (ny.wd === 0) return ny.min >= 17 * 60;
    if (ny.wd === 5) return ny.min < 17 * 60;
    return true;
  }
  // Minutos hasta el siguiente cambio de estado de una sesión (apertura o cierre), buscando minuto a minuto por horas.
  function nextChange(s, date, isOpen) {
    for (let m = 1; m <= 7 * 24 * 60; m += m < 180 ? 1 : 15) {
      if (sessionOpen(s, new Date(date.getTime() + m * 60e3)) !== isOpen) return m;
    }
    return null;
  }
  function sessionOpen(s, date) {
    const l = local(date, s.tz);
    return l.wd >= 1 && l.wd <= 5 && l.min >= s.open * 60 && l.min < s.close * 60 && marketOpen(date);
  }
  function sessions(date) {
    date = date || new Date();
    const list = SESSIONS.map((s) => {
      const open = sessionOpen(s, date);
      return Object.assign({}, s, { isOpen: open, changeIn: nextChange(s, date, open) });
    });
    const openIds = list.filter((s) => s.isOpen).map((s) => s.id);
    let note = 'Liquidez baja: ninguna sesión principal abierta.';
    if (!marketOpen(date)) note = 'Mercado de divisas cerrado (fin de semana). Reabre el domingo a las 17:00 de Nueva York.';
    else if (openIds.includes('london') && openIds.includes('newyork')) note = 'Solapamiento Londres–Nueva York: máxima liquidez y movimientos más amplios del día.';
    else if (openIds.includes('london')) note = 'Sesión de Londres: la más líquida para EUR, GBP y CHF.';
    else if (openIds.includes('newyork')) note = 'Sesión de Nueva York: el dólar y los datos de EE. UU. mandan.';
    else if (openIds.includes('tokyo')) note = 'Sesión asiática: rangos más estrechos; protagonistas JPY, AUD y NZD.';
    else if (openIds.includes('sydney')) note = 'Sesión de Sídney: poca liquidez; cuidado con los huecos de apertura.';
    return { list, marketOpen: marketOpen(date), note };
  }

  /* ---------- Fuerza relativa y correlaciones ---------- */
  /* series: [{ date, rates: { USD: 1.13, JPY: 178, ... } }] con base EUR, en orden temporal.
   * Fuerza de X en n días = media de los cambios de X frente a cada otra divisa (en %). */
  function strength(series, n, list) {
    list = list || MAJORS;
    if (!series || series.length <= n) return null;
    const a = series[series.length - 1 - n].rates;
    const b = series[series.length - 1].rates;
    const r = (rates, c) => (c === 'EUR' ? 1 : rates[c]);
    const out = list.map((x) => {
      let s = 0;
      let k = 0;
      for (const y of list) {
        if (y === x || !(r(a, x) > 0 && r(b, x) > 0 && r(a, y) > 0 && r(b, y) > 0)) continue;
        // Precio de X en Y = r(Y)/r(X)
        s += Math.log(r(b, y) / r(b, x)) - Math.log(r(a, y) / r(a, x));
        k++;
      }
      return { currency: x, pct: k ? (Math.expm1(s / k)) * 100 : NaN };
    });
    return out.sort((p, q) => q.pct - p.pct);
  }

  // Cotización de un par a partir de tasas con base EUR.
  function pairPrice(pair, rates) {
    const { base, quote } = split(pair);
    const r = (c) => (c === 'EUR' ? 1 : rates[c]);
    return r(base) > 0 && r(quote) > 0 ? r(quote) / r(base) : NaN;
  }

  function correlations(series, pairs, n) {
    const tail = series.slice(-(n + 1));
    const rets = pairs.map((p) => {
      const out = [];
      for (let k = 1; k < tail.length; k++) out.push(Math.log(pairPrice(p, tail[k].rates) / pairPrice(p, tail[k - 1].rates)));
      return out;
    });
    const corr = (x, y) => {
      const mx = x.reduce((s, v) => s + v, 0) / x.length;
      const my = y.reduce((s, v) => s + v, 0) / y.length;
      let a = 0;
      let bx = 0;
      let by = 0;
      for (let k = 0; k < x.length; k++) {
        a += (x[k] - mx) * (y[k] - my);
        bx += (x[k] - mx) ** 2;
        by += (y[k] - my) ** 2;
      }
      return bx && by ? a / Math.sqrt(bx * by) : NaN;
    };
    return pairs.map((p, i) => pairs.map((q, j) => (i === j ? 1 : corr(rets[i], rets[j]))));
  }

  /* ---------- Calendario económico ---------- */
  const IMPACT = { High: 3, Medium: 2, Low: 1, Holiday: 0 };
  /* events: [{ title, country, date, impact, forecast, previous }] (formato de Forex Factory).
   * Devuelve los que afectan a las divisas indicadas, desde `from`, ordenados. */
  function upcoming(events, currencies, from, opts) {
    opts = opts || {};
    const cs = currencies && currencies.length ? currencies : null;
    return (events || [])
      .map((e) => Object.assign({}, e, { t: Date.parse(e.date), level: IMPACT[e.impact] || 0 }))
      .filter((e) => Number.isFinite(e.t) && e.t >= from - (opts.pastMs || 0) && (!cs || cs.includes(e.country) || e.country === 'All') && e.level >= (opts.minLevel || 0))
      .sort((a, b) => a.t - b.t);
  }
  // Evento de alto impacto en las próximas `hours` horas para esas divisas (o null).
  function eventRisk(events, currencies, now, hours) {
    const list = upcoming(events, currencies, now, { minLevel: 3 }).filter((e) => e.t - now <= hours * 3600e3);
    return list.length ? list : null;
  }

  FX.forex = {
    CURRENCIES, MAJORS, PAIRS, NAMES, SESSIONS, LOT, normalize, isForex, split, currenciesOf, pipSize, decimals, convert, lotSize,
    marketOpen, sessionOpen, sessions, strength, pairPrice, correlations, upcoming, eventRisk,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
