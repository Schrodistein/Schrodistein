/* Escáner de consola de Radar de Divisas: analiza una lista de pares con el
 * mismo motor que la app y avisa de las entradas nuevas. Pensado para dejarlo
 * funcionando en un ordenador o servidor y recibir los avisos 24/7.
 *
 * Uso:
 *   node scripts/scan.js [--symbols EUR/USD,USD/JPY,BTCUSDT] [--interval 1h] [--profile equilibrado]
 *                        [--futures] [--no-trend-filter] [--rr 2] [--watch] [--backtest] [--bars 3000]
 *   node scripts/scan.js --calendar [--currencies USD,EUR]   calendario económico de la semana
 *   node scripts/scan.js --strength                          fuerza relativa de las 8 divisas principales
 *
 * Divisas: sin clave se usan los tipos diarios del BCE; con TWELVEDATA_API_KEY
 * (o --td-key) hay velas intradía de cualquier par y del oro (XAU/USD).
 * Avisos por Telegram (opcional): define TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.
 * La app no envía órdenes: tú decides y ejecutas en Binance. */
'use strict';
const path = require('path');
for (const f of ['core', 'indicators', 'patterns', 'stats', 'signals', 'backtest', 'binance', 'forex', 'feeds']) require(path.join(__dirname, '..', 'trading', 'js', f + '.js'));
const { util: U, signals: SG, backtest: BT, forex: F, feeds: FEEDS } = globalThis.FX;

function args(argv) {
  const o = { symbols: 'EUR/USD,GBP/USD,USD/JPY,AUD/USD,EURUSDT,PAXGUSDT,BTCUSDT', interval: '1h', profile: 'equilibrado', rr: 2, bars: 3000, 'td-key': process.env.TWELVEDATA_API_KEY || '' };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--watch') o.watch = true;
    else if (a === '--backtest') o.backtest = true;
    else if (a === '--futures') o.futures = true;
    else if (a === '--no-trend-filter') o.noTrend = true;
    else if (a === '--calendar') o.calendar = true;
    else if (a === '--strength') o.strength = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++k];
  }
  o.symbols = String(o.symbols).split(',').map((s) => F.normalize(s).symbol).filter(Boolean);
  o.rr = +o.rr;
  o.bars = +o.bars;
  return o;
}

const opt = args(process.argv.slice(2));
if (opt.help) {
  console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]);
  process.exit(0);
}
if (!U.INTERVALS[opt.interval] || !SG.PROFILES[opt.profile]) {
  console.error('Temporalidad o perfil no válidos.');
  process.exit(1);
}
const sigOpts = (dec, sym) => ({ profile: opt.profile, trendFilter: !opt.noTrend, rr: opt.rr, atrStop: 1.5, allowShort: !!opt.futures || F.isForex(sym || ''), decimals: dec });
const feedOf = (sym) => FEEDS.pick(sym, { tdKey: opt['td-key'] });
let calendar = null;
async function loadCalendar() {
  try {
    calendar = await FEEDS.calendar.week();
  } catch (e) {
    calendar = null;
  }
}
const color = process.stdout.isTTY ? { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' } : { g: '', r: '', d: '', b: '', x: '' };
const word = (d) => (d > 0 ? color.g + 'COMPRA' + color.x : d < 0 ? color.r + (opt.futures ? 'VENTA' : 'VENTA/CERRAR') + color.x : color.d + 'esperar' + color.x);
const seen = new Set();

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text }) });
  } catch (e) {
    console.error('No se pudo enviar el aviso a Telegram:', e.message);
  }
}

async function scanOnce(alert) {
  console.log(`\n${color.b}${new Date().toLocaleString('es-ES')} · ${opt.interval} · perfil ${opt.profile}${color.x}  ${color.d}${F.sessions(new Date()).note}${color.x}`);
  await loadCalendar();
  for (const sym of opt.symbols) {
    try {
      const feed = feedOf(sym);
      if (!feed) throw new Error('Necesita TWELVEDATA_API_KEY (no está entre los tipos del BCE).');
      const iv = feed.intervals.includes(opt.interval) ? opt.interval : '1d';
      const kl = await feed.klines(sym, iv, 1000);
      const ctx = SG.analyze(kl, { interval: iv });
      const li = U.lastClosed(kl);
      const dec = F.isForex(sym) ? F.decimals(sym) : U.autoDecimals(kl[li].c);
      const evs = SG.evaluateRange(ctx, sigOpts(dec, sym), li - SG.COOLDOWN, li);
      const r = evs[evs.length - 1];
      const fresh = SG.isFresh(evs, evs.length - 1);
      const tr = r.trend > 0 ? 'alcista' : r.trend < 0 ? 'bajista' : 'lateral';
      const src = feed.id === 'binance' ? '' : ` ${color.d}[${feed.label}${iv !== opt.interval ? ', ' + iv : ''}]${color.x}`;
      console.log(`${sym.padEnd(10)} ${U.fmtPrice(kl[kl.length - 1].c, dec).padStart(12)}  tendencia ${tr.padEnd(7)}  RSI ${r.snap.rsi.toFixed(0).padStart(3)}  compra ${r.long.score.toFixed(1).padStart(5)} / venta ${r.short.score.toFixed(1).padStart(5)}  ${word(r.dir)}${fresh ? ' (nueva)' : ''}${src}`);
      const risk = calendar && F.eventRisk(calendar, F.currenciesOf(sym), Date.now(), 24);
      if (risk) console.log(`${color.r}           noticia de alto impacto en < 24 h: ${risk.map((e) => e.country + ' ' + e.title + ' (' + new Date(e.t).toLocaleString('es-ES') + ')').join(' · ')}${color.x}`);
      if (r.dir) {
        const side = r.dir > 0 ? r.long : r.short;
        console.log(`${color.d}           entrada ${U.fmtPrice(r.entry, dec)} · stop ${U.fmtPrice(r.stop, dec)} · objetivo ${U.fmtPrice(r.target, dec)} · confluencia ${r.strength} (${r.score})${color.x}`);
        for (const x of side.reasons.filter((y) => y.trigger).slice(0, 4)) console.log(`${color.d}           ▲ ${x.text}${color.x}`);
      }
      const key = [sym, opt.interval, r.t, r.dir].join('|');
      if (alert && fresh && !seen.has(key)) {
        seen.add(key);
        const side = r.dir > 0 ? r.long : r.short;
        await telegram(`${r.dir > 0 ? '🟢 COMPRA' : '🔴 VENTA'} ${sym} (${opt.interval})\nEntrada ${U.fmtPrice(r.entry, dec)} · Stop ${U.fmtPrice(r.stop, dec)} · Objetivo ${U.fmtPrice(r.target, dec)}\nConfluencia ${r.strength} (${r.score})\n${side.reasons.filter((y) => y.trigger).slice(0, 3).map((y) => '• ' + y.text).join('\n')}\nSeñal probabilística, no asesoramiento financiero.`);
      }
    } catch (e) {
      console.log(`${sym.padEnd(10)} ${color.r}${e.message}${color.x}`);
    }
  }
}

async function backtest() {
  for (const sym of opt.symbols) {
    try {
      const feed = feedOf(sym);
      if (!feed) throw new Error('Necesita TWELVEDATA_API_KEY.');
      const iv = feed.intervals.includes(opt.interval) ? opt.interval : '1d';
      const C = (await feed.history(sym, iv, opt.bars)).filter((k) => k.closed);
      const ctx = SG.analyze(C, { interval: iv });
      const fx = F.isForex(sym);
      const s = BT.run(ctx, Object.assign(sigOpts(null, sym), { capital: 1000, riskPct: 1, feePct: fx ? 0.01 : 0.1, maxLeverage: fx ? 10 : opt.futures ? 3 : 1 })).stats;
      const ci = s.expectancyCI.map((x) => x.toFixed(2)).join(' a ');
      console.log(`${sym.padEnd(10)} ${color.d}[${feed.label}, ${iv}]${color.x} ${String(s.trades).padStart(4)} op.  acierto ${(s.winRate * 100).toFixed(0).padStart(3)} %  FB ${s.profitFactor.toFixed(2).padStart(5)}  esperanza ${s.expectancyR.toFixed(2)} R (IC ${ci})  neto ${s.netPct.toFixed(1)} %  caída máx ${s.maxDDPct.toFixed(1)} %  comprar y mantener ${s.buyHoldPct.toFixed(1)} %`);
    } catch (e) {
      console.log(`${sym.padEnd(10)} ${color.r}${e.message}${color.x}`);
    }
  }
}

async function showCalendar() {
  await loadCalendar();
  if (!calendar) return console.log('No se pudo cargar el calendario económico.');
  const cs = opt.currencies ? String(opt.currencies).toUpperCase().split(',') : null;
  const list = F.upcoming(calendar, cs, Date.now(), { minLevel: 2, pastMs: 6 * 3600e3 });
  console.log(`${color.b}Calendario económico (impacto medio y alto${cs ? ', ' + cs.join(', ') : ''})${color.x}`);
  for (const e of list) console.log(`${new Date(e.t).toLocaleString('es-ES').padEnd(22)} ${e.country.padEnd(4)} ${(e.level >= 3 ? color.r + 'ALTO ' : 'medio') + color.x}  ${e.title}${e.forecast ? '  · previsión ' + e.forecast : ''}${e.previous ? ' · anterior ' + e.previous : ''}`);
}

async function showStrength() {
  const series = await FEEDS.ecb.series(Date.now() - 140 * 86400e3, null, F.MAJORS.filter((c) => c !== 'EUR'));
  console.log(`${color.b}Fuerza de las divisas (tipos del BCE hasta ${series[series.length - 1].date})${color.x}`);
  const cols = [1, 5, 20, 60].map((n) => F.strength(series, n));
  console.log('       ' + ['1 día', '1 semana', '1 mes', '3 meses'].map((x) => x.padStart(10)).join(''));
  for (const c of cols[1].map((x) => x.currency)) console.log(c.padEnd(7) + cols.map((col) => (col ? col.find((x) => x.currency === c).pct.toFixed(2) + ' %' : '—').padStart(10)).join(''));
}

(async () => {
  if (opt.calendar) return showCalendar();
  if (opt.strength) return showStrength();
  if (opt.backtest) {
    console.log(`Backtest de ${opt.bars} velas, perfil ${opt.profile}, 1 % de riesgo; coste por lado 0,1 % (Binance) o 0,01 % (divisas):`);
    await backtest();
    return;
  }
  await scanOnce(opt.watch);
  if (!opt.watch) return;
  if (!process.env.TELEGRAM_BOT_TOKEN) console.log(`${color.d}(Sin TELEGRAM_BOT_TOKEN: los avisos solo se muestran en la consola.)${color.x}`);
  const step = U.INTERVALS[opt.interval];
  for (;;) {
    const wait = step - (Date.now() % step) + 5000;
    console.log(`${color.d}Próximo análisis: ${new Date(Date.now() + wait).toLocaleTimeString('es-ES')}${color.x}`);
    await new Promise((r) => setTimeout(r, wait));
    await scanOnce(true);
  }
})();
