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
  if (!/ECOPETROL/.test(table) || !/no encontró el símbolo GEB.CL/.test(table)) errors.push('tabla de mercado sin datos o sin errores de símbolo');
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
  const input = await win.$('#mk-table tr[data-i="7"] input[data-f="yahoo"]');
  await input.fill('GEB2.CL');
  await input.dispatchEvent('change');
  await win.waitForTimeout(500);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'datos.json'), 'utf8'));
  if (!saved.assets.some((a) => a.yahoo === 'GEB2.CL')) errors.push('el símbolo editado no se guardó');
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
  for (const f of ['LEEME.txt', 'acciones/ECOPETROL.csv', 'macro/trm.csv', 'macro/pib.csv', 'documentos/Paso a paso - varianza, covarianza, correlacion y betas.html', 'documentos/Teoria de portafolios.html']) if (!fs.existsSync(path.join(lib, f))) errors.push('biblioteca sin ' + f);

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
