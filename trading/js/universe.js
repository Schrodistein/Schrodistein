/* Universo de divisas: catálogo, índice de todas las divisas que cotizan en
 * las fuentes conectadas (BCE, Binance y Twelve Data), métricas de
 * comportamiento, construcción de pares para analizar y seguimiento de las
 * señales emitidas (activa, objetivo alcanzado, stop o caducada).
 * Lógica pura sin red: los datos llegan desde feeds.js y binance.js. */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});

  // código: [nombre, país o zona, región, banco central]
  const CATALOG = {
    USD: ['Dólar estadounidense', 'Estados Unidos', 'Norteamérica', 'Reserva Federal'],
    EUR: ['Euro', 'Zona euro', 'Europa', 'Banco Central Europeo'],
    JPY: ['Yen japonés', 'Japón', 'Asia-Pacífico', 'Banco de Japón'],
    GBP: ['Libra esterlina', 'Reino Unido', 'Europa', 'Banco de Inglaterra'],
    CHF: ['Franco suizo', 'Suiza', 'Europa', 'Banco Nacional Suizo'],
    CAD: ['Dólar canadiense', 'Canadá', 'Norteamérica', 'Banco de Canadá'],
    AUD: ['Dólar australiano', 'Australia', 'Asia-Pacífico', 'Banco de la Reserva de Australia'],
    NZD: ['Dólar neozelandés', 'Nueva Zelanda', 'Asia-Pacífico', 'Banco de la Reserva de Nueva Zelanda'],
    CNY: ['Yuan renminbi', 'China', 'Asia-Pacífico', 'Banco Popular de China'],
    CNH: ['Yuan offshore', 'China (fuera del continente)', 'Asia-Pacífico', 'Banco Popular de China'],
    HKD: ['Dólar de Hong Kong', 'Hong Kong', 'Asia-Pacífico', 'Autoridad Monetaria de Hong Kong'],
    SGD: ['Dólar de Singapur', 'Singapur', 'Asia-Pacífico', 'Autoridad Monetaria de Singapur'],
    SEK: ['Corona sueca', 'Suecia', 'Europa', 'Riksbank'],
    NOK: ['Corona noruega', 'Noruega', 'Europa', 'Norges Bank'],
    DKK: ['Corona danesa', 'Dinamarca', 'Europa', 'Danmarks Nationalbank'],
    PLN: ['Esloti polaco', 'Polonia', 'Europa', 'Banco Nacional de Polonia'],
    CZK: ['Corona checa', 'Chequia', 'Europa', 'Banco Nacional Checo'],
    HUF: ['Forinto húngaro', 'Hungría', 'Europa', 'Banco Nacional de Hungría'],
    RON: ['Leu rumano', 'Rumanía', 'Europa', 'Banco Nacional de Rumanía'],
    BGN: ['Lev búlgaro', 'Bulgaria', 'Europa', 'Banco Nacional de Bulgaria'],
    ISK: ['Corona islandesa', 'Islandia', 'Europa', 'Banco Central de Islandia'],
    TRY: ['Lira turca', 'Turquía', 'Europa', 'Banco Central de Turquía'],
    RUB: ['Rublo ruso', 'Rusia', 'Europa', 'Banco de Rusia'],
    UAH: ['Grivna ucraniana', 'Ucrania', 'Europa', 'Banco Nacional de Ucrania'],
    ILS: ['Nuevo séquel', 'Israel', 'Oriente Medio y África', 'Banco de Israel'],
    ZAR: ['Rand sudafricano', 'Sudáfrica', 'Oriente Medio y África', 'Banco de la Reserva de Sudáfrica'],
    NGN: ['Naira', 'Nigeria', 'Oriente Medio y África', 'Banco Central de Nigeria'],
    EGP: ['Libra egipcia', 'Egipto', 'Oriente Medio y África', 'Banco Central de Egipto'],
    KES: ['Chelín keniano', 'Kenia', 'Oriente Medio y África', 'Banco Central de Kenia'],
    MAD: ['Dírham marroquí', 'Marruecos', 'Oriente Medio y África', 'Bank Al-Maghrib'],
    SAR: ['Riyal saudí', 'Arabia Saudí', 'Oriente Medio y África', 'Banco Central Saudí'],
    AED: ['Dírham de los EAU', 'Emiratos Árabes Unidos', 'Oriente Medio y África', 'Banco Central de los EAU'],
    QAR: ['Riyal catarí', 'Catar', 'Oriente Medio y África', 'Banco Central de Catar'],
    KWD: ['Dinar kuwaití', 'Kuwait', 'Oriente Medio y África', 'Banco Central de Kuwait'],
    MXN: ['Peso mexicano', 'México', 'Latinoamérica', 'Banco de México'],
    BRL: ['Real brasileño', 'Brasil', 'Latinoamérica', 'Banco Central de Brasil'],
    ARS: ['Peso argentino', 'Argentina', 'Latinoamérica', 'Banco Central de la República Argentina'],
    CLP: ['Peso chileno', 'Chile', 'Latinoamérica', 'Banco Central de Chile'],
    COP: ['Peso colombiano', 'Colombia', 'Latinoamérica', 'Banco de la República'],
    PEN: ['Sol peruano', 'Perú', 'Latinoamérica', 'Banco Central de Reserva del Perú'],
    UYU: ['Peso uruguayo', 'Uruguay', 'Latinoamérica', 'Banco Central del Uruguay'],
    VES: ['Bolívar', 'Venezuela', 'Latinoamérica', 'Banco Central de Venezuela'],
    DOP: ['Peso dominicano', 'República Dominicana', 'Latinoamérica', 'Banco Central de la República Dominicana'],
    CRC: ['Colón costarricense', 'Costa Rica', 'Latinoamérica', 'Banco Central de Costa Rica'],
    GTQ: ['Quetzal', 'Guatemala', 'Latinoamérica', 'Banco de Guatemala'],
    INR: ['Rupia india', 'India', 'Asia-Pacífico', 'Banco de la Reserva de la India'],
    IDR: ['Rupia indonesia', 'Indonesia', 'Asia-Pacífico', 'Bank Indonesia'],
    KRW: ['Won surcoreano', 'Corea del Sur', 'Asia-Pacífico', 'Banco de Corea'],
    MYR: ['Ringgit', 'Malasia', 'Asia-Pacífico', 'Bank Negara Malaysia'],
    PHP: ['Peso filipino', 'Filipinas', 'Asia-Pacífico', 'Bangko Sentral ng Pilipinas'],
    THB: ['Baht', 'Tailandia', 'Asia-Pacífico', 'Banco de Tailandia'],
    TWD: ['Nuevo dólar taiwanés', 'Taiwán', 'Asia-Pacífico', 'Banco Central de Taiwán'],
    VND: ['Dong', 'Vietnam', 'Asia-Pacífico', 'Banco Estatal de Vietnam'],
    PKR: ['Rupia pakistaní', 'Pakistán', 'Asia-Pacífico', 'Banco Estatal de Pakistán'],
    BDT: ['Taka', 'Bangladés', 'Asia-Pacífico', 'Banco de Bangladés'],
    KZT: ['Tenge', 'Kazajistán', 'Asia-Pacífico', 'Banco Nacional de Kazajistán'],
    XAU: ['Oro (onza troy)', 'Metal precioso', 'Materias primas', ''],
    XAG: ['Plata (onza troy)', 'Metal precioso', 'Materias primas', ''],
  };
  const METALS = ['XAU', 'XAG'];
  // Monedas estables y tokens respaldados: código → activo al que siguen.
  const PEGGED = { USDT: 'USD', USDC: 'USD', FDUSD: 'USD', TUSD: 'USD', USDP: 'USD', DAI: 'USD', BUSD: 'USD', USD1: 'USD', EURI: 'EUR', AEUR: 'EUR', PAXG: 'XAU', XAUT: 'XAU' };
  const USD_STABLES = ['USDT', 'USDC', 'FDUSD'];

  const typeOf = (code) => (METALS.includes(code) ? 'metal' : CATALOG[code] ? 'fiat' : 'otra');

  /* ---------- Binance: monedas nacionales y su par frente a una estable en USD ---------- */
  // symbols: [{ symbol, base, quote }] → { currencies: { EUR: { pairs: [...], usdPair: { symbol, inverse } } }, pairs: [...] }
  function binanceFiat(symbols) {
    const out = {};
    const pairs = [];
    const isFiat = (a) => !!CATALOG[a] && !METALS.includes(a) && a !== 'USD';
    for (const s of symbols || []) {
      const fb = isFiat(s.base);
      const fq = isFiat(s.quote);
      if (!fb && !fq) continue;
      pairs.push(s);
      for (const code of [fb ? s.base : null, fq ? s.quote : null].filter(Boolean)) {
        const c = (out[code] = out[code] || { pairs: [], usdPair: null });
        c.pairs.push(s.symbol);
        const other = code === s.base ? s.quote : s.base;
        const rank = USD_STABLES.indexOf(other);
        if (rank >= 0 && (!c.usdPair || rank < c.usdPair.rank)) c.usdPair = { symbol: s.symbol, inverse: code === s.quote, rank };
      }
    }
    return { currencies: out, pairs };
  }

  /* ---------- Métricas de comportamiento ---------- */
  // values: precios en USD de una unidad de la divisa, en orden temporal.
  function metrics(values, lags, perYear) {
    const v = values.filter((x) => Number.isFinite(x) && x > 0);
    const n = v.length;
    if (n < 2) return null;
    const last = v[n - 1];
    const chg = (k) => (n > k ? (last / v[n - 1 - k] - 1) * 100 : NaN);
    const rets = [];
    for (let k = Math.max(1, n - 60); k < n; k++) rets.push(Math.log(v[k] / v[k - 1]));
    const m = rets.reduce((s, x) => s + x, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, rets.length - 1));
    let trend = 'lateral';
    if (n >= 60) {
      const sma = (end) => v.slice(end - 50, end).reduce((s, x) => s + x, 0) / 50;
      const now = sma(n);
      const before = sma(n - 10);
      if (last > now && now > before) trend = 'alcista';
      else if (last < now && now < before) trend = 'bajista';
    }
    return { last, chg1: chg(lags[0]), chg5: chg(lags[1]), chg21: chg(lags[2]), vol: sd * Math.sqrt(perYear) * 100, trend };
  }

  /* ---------- Índice ---------- */
  /* src: {
   *   ecb: [{ t, date, rates }] (base EUR, todas las divisas),
   *   binance: { symbols, histories: { CODE: [velas diarias del par frente a USD estable] } },
   *   twelve: ['EUR/USD', ...] (pares de divisas de Twelve Data)
   * } */
  function buildIndex(src) {
    const map = {};
    const get = (code) => {
      if (!map[code]) {
        const c = CATALOG[code];
        map[code] = {
          code, name: c ? c[0] : code, country: c ? c[1] : '', region: c ? c[2] : 'Otras', bank: c ? c[3] : '', type: typeOf(code),
          sources: { ecb: false, binance: false, td: false }, pairs: { binance: 0, td: 0 }, m: null, strength: NaN, src: '',
        };
      }
      return map[code];
    };
    const ecb = src.ecb && src.ecb.length ? src.ecb : null;
    if (ecb) {
      const last = ecb[ecb.length - 1].rates;
      const codes = ['EUR'].concat(Object.keys(last));
      codes.forEach((c) => (get(c).sources.ecb = true));
      const r = (d, c) => (c === 'EUR' ? 1 : d.rates[c]);
      for (const c of codes) {
        if (c === 'USD') continue;
        const e = get(c);
        e.m = metrics(ecb.map((d) => r(d, 'USD') / r(d, c)), [1, 5, 21], 252);
        e.src = 'BCE';
      }
      const st = FX.forex.strength(ecb, 5, codes);
      if (st) st.forEach((x) => (get(x.currency).strength = x.pct));
      const usd = get('USD');
      usd.m = { last: 1, chg1: 0, chg5: 0, chg21: 0, vol: 0, trend: 'lateral' };
      usd.src = 'BCE';
    }
    const bin = src.binance;
    if (bin && bin.symbols) {
      const f = binanceFiat(bin.symbols);
      for (const code of Object.keys(f.currencies)) {
        const e = get(code);
        e.sources.binance = true;
        e.pairs.binance = f.currencies[code].pairs.length;
        e.usdPair = f.currencies[code].usdPair;
        const h = bin.histories && bin.histories[code];
        if (!e.m && h && h.length && e.usdPair) {
          const vals = h.map((k) => (e.usdPair.inverse ? 1 / k.c : k.c));
          e.m = metrics(vals, [1, 7, 30], 365);
          e.src = 'Binance';
        }
      }
      if (f.currencies.EUR || f.pairs.some((s) => USD_STABLES.includes(s.base) || USD_STABLES.includes(s.quote))) get('USD').sources.binance = true;
    }
    if (src.twelve && src.twelve.length) {
      for (const p of src.twelve) {
        const [a, b] = p.split('/');
        if (!a || !b) continue;
        for (const c of [a, b]) {
          const e = get(c);
          e.sources.td = true;
          e.pairs.td++;
        }
      }
    }
    const list = Object.values(map).sort((a, b) => (Number.isFinite(b.strength) ? b.strength : -1e9) - (Number.isFinite(a.strength) ? a.strength : -1e9) || a.code.localeCompare(b.code));
    return {
      list,
      counts: {
        total: list.length,
        ecb: list.filter((x) => x.sources.ecb).length,
        binance: list.filter((x) => x.sources.binance).length,
        td: list.filter((x) => x.sources.td).length,
        tdPairs: (src.twelve || []).length,
        binancePairs: bin && bin.symbols ? binanceFiat(bin.symbols).pairs.length : 0,
      },
    };
  }

  /* ---------- Pares ---------- */
  // Convención del mercado: la divisa de mayor prioridad va como base (EUR/USD, GBP/JPY, USD/MXN…).
  const PRIORITY = ['XAU', 'XAG', 'EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];
  function orderPair(a, b) {
    const ra = PRIORITY.indexOf(a);
    const rb = PRIORITY.indexOf(b);
    const ka = ra < 0 ? 100 : ra;
    const kb = rb < 0 ? 100 : rb;
    const base = ka < kb || (ka === kb && a < b) ? a : b;
    return base + '/' + (base === a ? b : a);
  }

  /* modos: 'majors' (28 cruces de las 8 principales), 'majors+usd' (además el
   * resto frente a USD y EUR), 'all' (todas las combinaciones), 'currency'
   * (todos los pares de una divisa). codes: divisas disponibles. */
  function buildPairs(mode, codes, focus) {
    const majors = FX.forex.MAJORS.filter((c) => codes.includes(c));
    const set = new Set();
    const add = (a, b) => a !== b && codes.includes(a) && codes.includes(b) && set.add(orderPair(a, b));
    const combos = (list) => list.forEach((a, i) => list.slice(i + 1).forEach((b) => add(a, b)));
    if (mode === 'all') combos(codes);
    else if (mode === 'currency' && focus) codes.forEach((c) => add(focus, c));
    else {
      combos(majors);
      if (mode === 'majors+usd') codes.filter((c) => !majors.includes(c)).forEach((c) => (add('USD', c), add('EUR', c)));
    }
    return Array.from(set);
  }

  // Mapa de calor: cambio porcentual de cada par base/cotizada en n fijaciones.
  function heatmap(series, codes, n) {
    if (!series || series.length <= n) return null;
    const a = series[series.length - 1 - n].rates;
    const b = series[series.length - 1].rates;
    const r = (rates, c) => (c === 'EUR' ? 1 : rates[c]);
    return codes.map((x) => codes.map((y) => (x === y ? NaN : (Math.log(r(b, y) / r(b, x)) - Math.log(r(a, y) / r(a, x))) * 100)));
  }

  /* ---------- Seguimiento de señales ---------- */
  const signalId = (sym, iv, t, dir) => [sym, iv, t, dir].join('|');

  /* Estado de una señal con las velas posteriores a su vela de emisión:
   * objetivo, stop (si una vela toca ambos, cuenta el stop), caducada tras
   * maxBars velas cerradas, o activa con su resultado latente en R. */
  function trackSignal(rec, candles, maxBars) {
    if (rec.status !== 'activa') return rec;
    const risk = Math.abs(rec.entry - rec.stop);
    if (!(risk > 0)) return rec;
    const out = Object.assign({}, rec);
    let bars = 0;
    let lastK = null;
    for (const k of candles) {
      if (k.t <= rec.t) continue;
      lastK = k;
      const hitStop = rec.dir > 0 ? k.l <= rec.stop : k.h >= rec.stop;
      const hitTarget = rec.dir > 0 ? k.h >= rec.target : k.l <= rec.target;
      if (hitStop) return Object.assign(out, { status: 'stop', r: -1, exit: rec.stop, closedT: k.t, last: k.c });
      if (hitTarget) return Object.assign(out, { status: 'objetivo', r: Math.abs(rec.target - rec.entry) / risk, exit: rec.target, closedT: k.t, last: k.c });
      if (k.closed !== false && ++bars >= (maxBars || 48)) return Object.assign(out, { status: 'caducada', r: (rec.dir * (k.c - rec.entry)) / risk, exit: k.c, closedT: k.t, last: k.c });
    }
    if (lastK) Object.assign(out, { r: (rec.dir * (lastK.c - rec.entry)) / risk, last: lastK.c, bars });
    return out;
  }

  function boardStats(records) {
    const act = records.filter((r) => r.status === 'activa');
    const done = records.filter((r) => r.status !== 'activa');
    const wins = done.filter((r) => r.status === 'objetivo').length;
    const losses = done.filter((r) => r.status === 'stop').length;
    const avgR = done.length ? done.reduce((s, r) => s + (r.r || 0), 0) / done.length : NaN;
    return {
      active: act.length, activeLong: act.filter((r) => r.dir > 0).length, activeShort: act.filter((r) => r.dir < 0).length,
      wins, losses, expired: done.filter((r) => r.status === 'caducada').length, resolved: done.length,
      winRate: wins + losses ? wins / (wins + losses) : NaN, avgR,
      first: records.length ? Math.min(...records.map((r) => r.at || r.t)) : null,
    };
  }

  FX.universe = { CATALOG, METALS, PEGGED, USD_STABLES, typeOf, binanceFiat, metrics, buildIndex, orderPair, buildPairs, heatmap, signalId, trackSignal, boardStats };
})(typeof globalThis !== 'undefined' ? globalThis : this);
