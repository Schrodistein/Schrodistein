/* Prueba de extremo a extremo de la app de escritorio con Playwright + Electron,
 * con respuestas grabadas en lugar de internet (FE_FIXTURES).
 * Uso: xvfb-run node tests/e2e.js [carpeta-capturas]   (Linux sin pantalla) */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require('playwright');
const fx = require('./fixtures');

const shots = process.argv[2];
(async () => {
  const fixtures = fx.writeAll(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-fx-')));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-ud-'));
  const errors = [];
  // Precios de la BVC ya importados (la única fuente de acciones, índices y ETF)
  {
    const { Store } = require('../lib/store');
    const st = new Store(userData);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [name, p0] of [['ICOLCAP', 14000], ['ECOPETROL', 2300], ['PFCIBEST', 45000], ['TERPEL', 12000], ['PFGRUPSURA', 30000]]) {
      const dates = [];
      const prices = [];
      let p = p0;
      for (let t = Date.UTC(2025, 0, 2), k = 0; k < 400; t += 864e5) {
        const wd = new Date(t).getUTCDay();
        if (wd === 0 || wd === 6) continue;
        p *= Math.exp(0.012 * (rnd() - 0.5) + (name === 'ICOLCAP' ? 0 : 0.004 * (rnd() - 0.48)));
        dates.push(new Date(t).toISOString().slice(0, 10));
        prices.push(Math.round(p * 100) / 100);
        k++;
      }
      st.mergePrices(name, dates, prices, 'bvc', dates.map(() => 1000), prices.map((x) => x * 1000));
    }
    st.save();
  }
  const app = await _electron.launch({
    // FE_EXE = ejecutable ya empaquetado (dist/linux-unpacked/frontera-eficiente)
    executablePath: process.env.FE_EXE || require('electron'),
    args: process.env.FE_EXE ? ['--no-sandbox'] : [path.join(__dirname, '..'), '--no-sandbox'],
    env: Object.assign({}, process.env, { FE_FIXTURES: fixtures, FE_USERDATA: userData }),
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push('página: ' + e.message));
  await win.waitForSelector('#tab-mercado:not([hidden])', { timeout: 20000 });
  await win.click('#tab-mercado');
  // La actualización automática al abrir (primera vez) o la manual
  await win.click('#mk-update');
  await win.waitForFunction(() => /Actualizado:/.test(document.getElementById('mk-status').textContent), null, { timeout: 30000 });
  const st = await win.textContent('#mk-status');
  if (!/activos con cierres nuevos/.test(st)) errors.push('estado: ' + st);
  const table = await win.textContent('#mk-table');
  if (!/ECOPETROL/.test(table) || /GEB\.CL/.test(table)) errors.push('tabla de mercado: las acciones no deben pedirse a la fuente automática');
  if ((await win.$$('#mk-table input[data-f="yahoo"]')).length !== 2) errors.push('solo el dólar y el euro tienen símbolo automático');
  if (shots) await win.screenshot({ path: path.join(shots, 'escritorio-mercado.png'), fullPage: true });

  await win.click('#tab-noticias');
  const items = await win.$$eval('#nw-list li', (l) => l.length);
  if (items !== 3) errors.push('noticias: ' + items);
  if (shots) await win.screenshot({ path: path.join(shots, 'escritorio-noticias.png'), fullPage: true });

  await win.click('#tab-mercado');
  await win.click('#mk-use');
  await win.waitForSelector('#screen-frontera:not([hidden]) #chart-front svg', { timeout: 15000 });
  const summary = await win.textContent('#summary');
  if (!/Portafolio recomendado/.test(summary)) errors.push('sin análisis');
  const market = await win.$eval('#market', (s) => s.value);
  if (market !== 'ICOLCAP') errors.push('índice de mercado: ' + market);
  if (shots) await win.screenshot({ path: path.join(shots, 'escritorio-portafolio.png'), fullPage: true });

  // Cambiar un símbolo se guarda en disco
  await win.click('#tab-mercado');
  const input = await win.$('#mk-table input[data-f="yahoo"]');
  await input.fill('USDCOP=X');
  await input.dispatchEvent('change');
  await win.waitForTimeout(500);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'datos.json'), 'utf8'));
  if (!saved.assets.some((a) => a.yahoo === 'USDCOP=X')) errors.push('el símbolo editado no se guardó');
  if (Object.entries(saved.prices).some(([n, b]) => !/\//.test(n) && Object.values(b).some((x) => x[1] !== 'bvc'))) errors.push('hay cierres de acciones que no son de la BVC');
  if (!saved.news.length || !Object.keys(saved.prices).length) errors.push('datos no guardados');

  // Variables macro y biblioteca local
  await win.click('#tab-macro');
  await win.waitForFunction(() => document.querySelectorAll('#macro-cards .macro-card svg').length >= 4, null, { timeout: 15000 }).catch(() => errors.push('macro: faltan gráficos de las 4 variables'));
  await win.click('#macro-update');
  await win.waitForFunction(() => /Descargadas:/.test(document.getElementById('macro-status').textContent), null, { timeout: 20000 }).catch(() => errors.push('macro: ' + 'sin estado'));
  const ms = await win.textContent('#macro-status');
  if (!/Banco Mundial/.test(ms) || !/datos\.gov\.co/.test(ms)) errors.push('macro: ' + ms);
  if (shots) await win.screenshot({ path: path.join(shots, 'escritorio-macro.png'), fullPage: true });
  await win.click('#tab-estadistica');
  await win.waitForSelector('#dam-panel', { timeout: 10000 }).catch(() => errors.push('sin paso a paso'));
  await win.click('#tab-mercado');
  await win.click('#mk-lib-save');
  await win.waitForFunction(() => /Biblioteca guardada/.test(document.getElementById('mk-status').textContent), null, { timeout: 15000 }).catch(() => errors.push('biblioteca: ' + 'sin confirmación'));
  const lib = path.join(userData, 'Biblioteca');
  for (const f of ['LEEME.txt', 'acciones/ECOPETROL.csv', 'macro/trm.csv', 'macro/pib.csv', 'documentos/Paso a paso - varianza, covarianza, correlacion y betas.html', 'documentos/Teoria de portafolios.html', 'documentos/Sistema economico y sistema financiero en Colombia.html']) if (!fs.existsSync(path.join(lib, f))) errors.push('biblioteca sin ' + f);

  await app.evaluate(({ app }) => app.exit(0));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('e2e de escritorio correcto');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
