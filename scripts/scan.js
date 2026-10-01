/* Escáner de consola de Radar de Divisas: analiza una lista de pares con el
 * mismo motor que la app y avisa de las entradas nuevas. Pensado para dejarlo
 * funcionando en un ordenador o servidor y recibir los avisos 24/7.
 *
 * Uso:
 *   node scripts/scan.js [--symbols EURUSDT,BTCUSDT] [--interval 1h] [--profile equilibrado]
 *                        [--futures] [--no-trend-filter] [--rr 2] [--watch] [--backtest] [--bars 3000]
 *
 * Avisos por Telegram (opcional): define TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.
 * La app no envía órdenes: tú decides y ejecutas en Binance. */
'use strict';
const path = require('path');
for (const f of ['core', 'indicators', 'patterns', 'stats', 'signals', 'backtest', 'binance']) require(path.join(__dirname, '..', 'trading', 'js', f + '.js'));
const { util: U, signals: SG, backtest: BT, binance: API } = globalThis.FX;

function args(argv) {
  const o = { symbols: 'EURUSDT,PAXGUSDT,USDTTRY,USDTBRL,BTCUSDT,ETHUSDT', interval: '1h', profile: 'equilibrado', rr: 2, bars: 3000 };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--watch') o.watch = true;
    else if (a === '--backtest') o.backtest = true;
    else if (a === '--futures') o.futures = true;
    else if (a === '--no-trend-filter') o.noTrend = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++k];
  }
  o.symbols = String(o.symbols).toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);
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
const sigOpts = (dec) => ({ profile: opt.profile, trendFilter: !opt.noTrend, rr: opt.rr, atrStop: 1.5, allowShort: !!opt.futures, decimals: dec });
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
  console.log(`\n${color.b}${new Date().toLocaleString('es-ES')} · ${opt.interval} · perfil ${opt.profile}${color.x}`);
  for (const sym of opt.symbols) {
    try {
      const kl = await API.klines(sym, opt.interval, 1000);
      const ctx = SG.analyze(kl, { interval: opt.interval });
      const li = U.lastClosed(kl);
      const dec = U.autoDecimals(kl[li].c);
      const evs = SG.evaluateRange(ctx, sigOpts(dec), li - SG.COOLDOWN, li);
      const r = evs[evs.length - 1];
      const fresh = SG.isFresh(evs, evs.length - 1);
      const tr = r.trend > 0 ? 'alcista' : r.trend < 0 ? 'bajista' : 'lateral';
      console.log(`${sym.padEnd(10)} ${U.fmtPrice(kl[kl.length - 1].c, dec).padStart(12)}  tendencia ${tr.padEnd(7)}  RSI ${r.snap.rsi.toFixed(0).padStart(3)}  compra ${r.long.score.toFixed(1).padStart(5)} / venta ${r.short.score.toFixed(1).padStart(5)}  ${word(r.dir)}${fresh ? ' (nueva)' : ''}`);
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
      const C = (await API.history(sym, opt.interval, opt.bars)).filter((k) => k.closed);
      const ctx = SG.analyze(C, { interval: opt.interval });
      const s = BT.run(ctx, Object.assign(sigOpts(), { capital: 1000, riskPct: 1, feePct: 0.1, maxLeverage: opt.futures ? 3 : 1 })).stats;
      const ci = s.expectancyCI.map((x) => x.toFixed(2)).join(' a ');
      console.log(`${sym.padEnd(10)} ${String(s.trades).padStart(4)} op.  acierto ${(s.winRate * 100).toFixed(0).padStart(3)} %  FB ${s.profitFactor.toFixed(2).padStart(5)}  esperanza ${s.expectancyR.toFixed(2)} R (IC ${ci})  neto ${s.netPct.toFixed(1)} %  caída máx ${s.maxDDPct.toFixed(1)} %  comprar y mantener ${s.buyHoldPct.toFixed(1)} %`);
    } catch (e) {
      console.log(`${sym.padEnd(10)} ${color.r}${e.message}${color.x}`);
    }
  }
}

(async () => {
  if (opt.backtest) {
    console.log(`Backtest de ${opt.bars} velas de ${opt.interval}, perfil ${opt.profile}, 1 % de riesgo y 0,1 % de comisión por lado:`);
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
